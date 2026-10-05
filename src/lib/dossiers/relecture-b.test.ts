import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-relecture-b-"));

/**
 * Mission 18, relecture des lots B0 à B6 : chaque constat corrigé a son essai — un déclencheur, puis l'état des deux
 * côtés (`etatDesDeuxCotes` : étape, main, prochaine action, statut du lead, étape de l'espace, relances, tâches).
 * - une seule règle de l'envoi par l'espace (génération et mise en ligne) : visible sans annonce = pas envoyé ;
 * - les relances ne visent jamais un devis pas encore envoyé (mail et SMS) ;
 * - le statut du lead suit le passage en « Devis envoyé » dans la transaction ;
 * - un devis déposé « accepté » signe un dossier en pause d'avant la signature ;
 * - un rappel daté posé par un appel noté n'est pas écrasé ;
 * - une attente du client ne range pas de tâche à la place d'une action posée à la main ;
 * - l'analyse des opérations compte l'ancienneté d'un devis depuis son envoi.
 * Rien ne part hors du poste : les mails sont seulement programmés (file locale), le réseau est coupé.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let existants: typeof import("./documents-existants");
let transitions: typeof import("./transitions");
let devisEnvoye: typeof import("./devis-envoye");
let synchro: typeof import("./synchro");
let auto: typeof import("./prochaine-action-auto");
let dates: typeof import("./dates");
let appels: typeof import("@/lib/commercial/appels");
let copie: typeof import("@/lib/sms/copie");
let operations: typeof import("@/lib/assistant/analyses/operations");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
const generer = (dossierId: string, objet: string, notifier: boolean, libelleVariante?: string) =>
  avecActeur(LUCAS, () =>
    documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier, ...(libelleVariante ? { libelleVariante } : {}) }))
  );
const rendreVisible = (dossierId: string, documentId: string) => avecActeur(LUCAS, () => documents.modifierPresentationDevis(dossierId, documentId, { visibleEspace: true }));
const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);
const tachesSynchro = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>) => etat.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO));

async function contact(prenom: string) {
  const email = `${prenom.toLowerCase()}.relecture@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, permanentId: ouvert.permanent.id, nom: `${prenom} Essai` };
}
/** En Simulation, le client a choisi : l'espace a posé « Préparer le devis (simulation choisie) ». */
async function enSimulation(dossierId: string) {
  await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "SIMULATION" }));
  await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  existants = await import("./documents-existants");
  transitions = await import("./transitions");
  devisEnvoye = await import("./devis-envoye");
  synchro = await import("./synchro");
  auto = await import("./prochaine-action-auto");
  dates = await import("./dates");
  appels = await import("@/lib/commercial/appels");
  copie = await import("@/lib/sms/copie");
  operations = await import("@/lib/assistant/analyses/operations");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("mission 18, relecture de B0 à B6", () => {
  test("variante silencieuse en Relance : visible mais pas envoyée — l'étape ne bouge pas, tâche « Envoyer le devis », les relances (mail, SMS) restent sur le devis envoyé", async () => {
    const c = await contact("Variante");
    await enSimulation(c.dossierId);
    const { document: envoye } = await generer(c.dossierId, "Cuisine", true, "façades");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "RELANCE" }));
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.statutLead, avant.etapeEspace], ["RELANCE", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(avant.relances.devis.map((r) => r.numero), [envoye.numero]);

    const { document: variante } = await generer(c.dossierId, "Cuisine", false, "façades et plan");
    assert.equal(variante.visibleEspace, true, "le client voit ses devis dans son espace");
    const generation = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_GENERE", metadata: { contains: variante.id } } });
    assert.equal(JSON.parse(generation.metadata).envoye, false, "pas annoncée : pas envoyée");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "RELANCE", "elle ne fait pas revenir le dossier en « Devis envoyé »");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", metadata: { contains: variante.id } } }), 0);
    assert.equal(etat.main, etat.mainCalculee, "la main écrite est celle de la règle");
    assert.deepEqual([etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "DEVIS"]);
    const envoyer = tachesDe(etat, "ENVOYER_DEVIS");
    assert.equal(envoyer.length, 1);
    assert.match(envoyer[0].raison, new RegExp(`^devis ${variante.numero} prêt le \\d{2}/\\d{2}, pas encore annoncé$`));
    // Les relances restent sur le devis réellement envoyé, jamais « le devis que je vous ai adressé » qu'il n'a pas reçu.
    assert.deepEqual(etat.relances.devis.map((r) => r.numero), [envoye.numero]);
    await assert.rejects(copie.devisARelancer(variante.id, c.dossierId), /pas encore été envoyé au client/);
    assert.deepEqual(await copie.devisARelancer(envoye.id, c.dossierId), { id: envoye.id, dossierId: c.dossierId });
  });

  test("une seule règle de l'envoi : espace fermé, le devis rendu visible n'est pas envoyé (comme à la génération) ; espace rouvert et adresse connue, remis en ligne, il l'est", async () => {
    const c = await contact("Ferme");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Salle de bain", false);
    assert.equal(devis.visibleEspace, false);
    await prisma.espacePermanent.update({ where: { id: c.permanentId }, data: { revoqueLe: new Date() } });

    const rendu = await rendreVisible(c.dossierId, devis.id);
    assert.deepEqual([rendu.visibleEspace, rendu.passage, rendu.annonce?.mail], [true, null, false]);
    assert.match(rendu.nonEnvoye ?? "", /^Visible dans son espace, mais pas envoyé : espace client fermé ou lien désactivé\. /);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction], ["SIMULATION", "MOI", "MOI", "Envoyer le devis au client"]);
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
    assert.equal(tachesDe(etat, "ENVOYER_DEVIS").length, 1, "la tâche « Envoyer le devis » reste ouverte");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } }), 0, "aucun « Devis envoyé »");
    assert.equal(await prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${devis.id}` } }), 0);

    // L'espace rouvert : masqué puis remis en ligne, il est envoyé et annoncé, la tâche se coche.
    await prisma.espacePermanent.update({ where: { id: c.permanentId }, data: { revoqueLe: null } });
    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: false }));
    const remis = await rendreVisible(c.dossierId, devis.id);
    assert.deepEqual([remis.passage?.vers, remis.annonce, remis.nonEnvoye], ["DEVIS_ENVOYE", { mail: true, raison: null }, null]);
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.main, apres.prochaineAction, apres.statutLead, apres.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(tachesDe(apres, "ENVOYER_DEVIS"), []);
    assert.deepEqual(apres.relances.devis.map((r) => r.numero), [devis.numero]);
  });

  test("passage en « Devis envoyé » : le statut du lead suit DANS la transaction (lu avant qu'elle se termine), comme l'étape", async () => {
    const c = await contact("Lead");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine", false);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: c.leadId } })).statut, "CONTACTE");
    const lu = await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: devis.id }, data: { visibleEspace: true } });
      const changement = await devisEnvoye.passerEnDevisEnvoye(tx, c.dossierId, { documentId: devis.id, raison: "essai" });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: c.leadId }, select: { statut: true } });
      return { vers: changement?.vers, statut: lead.statut };
    });
    assert.deepEqual(lu, { vers: "DEVIS_ENVOYE", statut: "DEVIS_ENVOYE" });

    // À la génération annoncée aussi (emettre) : étape, statut du lead et main ensemble.
    const autre = await contact("Annonce");
    await enSimulation(autre.dossierId);
    await generer(autre.dossierId, "Cuisine", true);
    const etat = await etatDesDeuxCotes(autre.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.statutLead, etat.main, etat.mainCalculee], ["DEVIS_ENVOYE", "DEVIS_ENVOYE", "CLIENT", "CLIENT"]);
  });

  test("en pause depuis « Devis envoyé », un devis déposé « accepté » signe le dossier (sortie de pause) ; en pause après la signature, rien ne bouge", async () => {
    const c = await contact("Pause");
    await enSimulation(c.dossierId);
    const { document: propose } = await generer(c.dossierId, "Cuisine", true);
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "EN_PAUSE" }));
    const deposer = (dossierId: string, numero: string) =>
      avecActeur(LUCAS, () => existants.enregistrerDocumentExistant(dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero, montant: 1500, dateEmission: dates.jourParis(new Date()), statut: "ACCEPTE", objet: "Cuisine signée", inscrireAuRegistre: true })));

    const depot = await deposer(c.dossierId, "2026-871");
    assert.deepEqual(depot.changements.map((x) => [x.de, x.vers]), [["EN_PAUSE", "SIGNE"]]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead], ["SIGNE", "SIGNE"]);
    assert.equal(etat.main, etat.mainCalculee, "la main écrite est celle de la règle");
    assert.equal(etat.prochaineAction, "Appeler le client : fixer la date du chantier, suivre l'acompte");
    assert.deepEqual(etat.relances.devis, [], "signé : plus de relance");
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: propose.id } })).statut, "NON_RETENU", "il n'en signe qu'un");

    // En pause APRÈS la signature : le dépôt d'un devis accepté (un avenant) ne touche pas à l'étape.
    const signe = await contact("Apres");
    await avecActeur(LUCAS, () => transitions.changerEtape(signe.dossierId, { vers: "SIGNE" }));
    await avecActeur(LUCAS, () => transitions.changerEtape(signe.dossierId, { vers: "EN_PAUSE" }));
    const avenant = await deposer(signe.dossierId, "2026-872");
    assert.deepEqual(avenant.changements, []);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: signe.dossierId } })).etape, "EN_PAUSE");
  });

  test("un rappel daté posé par un appel noté n'est pas écrasé par l'événement suivant : une tâche à la place, la date gardée ; passé, il ne tient plus", async () => {
    const c = await contact("Rappel");
    const rappelLe = new Date(Date.now() + 3 * JOUR);
    await avecActeur(LUCAS, () => appels.noterAppel({ dossierId: c.dossierId, issue: "A_RAPPELER", note: "", rappelLe: rappelLe.toISOString() }));
    const pose = await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } });
    assert.deepEqual([pose.prochaineAction, pose.prochaineActionInstant?.toISOString()], ["Rappeler", rappelLe.toISOString()]);

    const suites = await synchro.evenementDossier(c.dossierId, { type: "CHOIX_VALIDE" });
    assert.equal(suites.prochaineAction, "GARDEE");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.prochaineAction, "Rappeler", "jamais écrasé");
    assert.equal(etat.prochaineActionDate?.toISOString(), pose.prochaineActionDate?.toISOString(), "la date du rappel (et l'agenda) ne bouge pas");
    const rangees = tachesSynchro(etat);
    assert.deepEqual(rangees.map((t) => [t.cle, t.titre]), [[auto.cleTacheSynchro(c.dossierId, "choix"), `Préparer le devis (simulation choisie) · ${c.nom}`]]);
    assert.match(rangees[0].raison, /^ton rappel « Rappeler » du \d{2}\/\d{2} est gardé$/);
    // Rejoué : toujours une seule tâche.
    await synchro.evenementDossier(c.dossierId, { type: "CHOIX_VALIDE" });
    assert.equal(tachesSynchro(await etatDesDeuxCotes(c.dossierId)).length, 1);

    // Un rappel d'avant-hier ne tient plus le dossier : l'événement écrit sa prochaine action.
    const passe = new Date(Date.now() - 2 * JOUR);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineActionDate: passe, prochaineActionInstant: passe } });
    assert.equal((await synchro.evenementDossier(c.dossierId, { type: "CHOIX_VALIDE" })).prochaineAction, "ECRITE");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction, "Préparer le devis (simulation choisie)");
  });

  test("une attente du client (simulation publiée) sous une action posée à la main : l'action reste, aucune tâche rangée ; un geste du client en range une", async () => {
    const c = await contact("Attente");
    const texte = "Rappeler pour les teintes du plan de travail";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: texte }));
    const publiee = await synchro.evenementDossier(c.dossierId, { type: "SIMULATION_PUBLIEE", simulationIds: [] });
    assert.equal(publiee.prochaineAction, "GARDEE");
    let etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], [texte, texte]);
    assert.deepEqual(tachesSynchro(etat), [], "« Attendre le retour du client » : rien à faire de mon côté");

    await synchro.evenementDossier(c.dossierId, { type: "CHOIX_VALIDE" });
    etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual(tachesSynchro(etat).map((t) => t.titre), [`Préparer le devis (simulation choisie) · ${c.nom}`]);
  });

  test("analyse des opérations : l'ancienneté d'un devis à relancer se compte depuis son envoi (mise en ligne), pas depuis son émission", async () => {
    const c = await contact("Anciennete");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine", false);
    // Mis en ligne trois jours après son émission (un document émis ne se modifie pas : c'est la mise en ligne qu'on
    // date), puis lu le jour où la relance est due depuis la mise en ligne.
    await rendreVisible(c.dossierId, devis.id);
    const miseEnLigne = new Date(Date.now() + 3 * JOUR);
    await prisma.dossierEvenement.updateMany({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" }, data: { createdAt: miseEnLigne } });
    const { jours: delai } = await (await import("@/lib/relances/service")).lireDelaiRelance();
    const analyse = await operations.analyseOperations(new Date(miseEnLigne.getTime() + (delai + 1) * JOUR));
    const du = analyse.relances.devisDus.find((d) => d.dossierId === c.dossierId);
    assert.ok(du, "la relance est due");
    assert.equal(du.numero, devis.numero);
    assert.equal(du.joursDepuis, delai + 1, "depuis la mise en ligne, pas depuis l'émission (trois jours de plus)");
  });
});
