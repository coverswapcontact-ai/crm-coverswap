import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-devis-retire-"));

/**
 * Mission 18 (B6, écart 6) : un devis annulé ou masqué, sans autre devis qui attend la réponse du client, fait revenir
 * le dossier à son étape d'avant le devis (Simulation ou Qualification) dans la même transaction : main à Lucas
 * (« refaire le devis »), prochaine action « Refaire le devis » (une action posée à la main reste, une tâche à côté),
 * tâche « Refaire le devis », relances arrêtées et mails de relance en attente annulés, espace revenu avant le devis,
 * lead CONTACTE. Avec un autre devis en attente, rien ne recule. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`).
 * Rien ne part hors du poste : réseau coupé, mails seulement programmés (file locale).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let existants: typeof import("./documents-existants");
let transitions: typeof import("./transitions");
let relances: typeof import("@/lib/relances/service");
let retire: typeof import("./devis-retire");
let auto: typeof import("./prochaine-action-auto");
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let session: import("@/lib/assistant/execution").Session;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré ; `notifier` : annoncé (« Devis disponible ») et donc envoyé (B1), sinon masqué en Q ou S. */
const generer = (dossierId: string, objet: string, notifier = true, libelleVariante?: string) =>
  avecActeur(LUCAS, () =>
    documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier, ...(libelleVariante ? { libelleVariante } : {}) }))
  );
const masquer = (dossierId: string, documentId: string) => avecActeur(LUCAS, () => documents.modifierPresentationDevis(dossierId, documentId, { visibleEspace: false }));
const annuler = (dossierId: string, documentId: string, motif = "erreur de métrage") => avecActeur(LUCAS, () => documents.annulerDevis(dossierId, documentId, motif));

async function contact(prenom: string, email?: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...(email ? { email } : {}) } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, nom: `${prenom} Essai` };
}
/** En Simulation, le client a choisi : l'espace a posé « Préparer le devis (simulation choisie) ». */
async function enSimulation(dossierId: string) {
  await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "SIMULATION" }));
  await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
}
const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);
const dernierPassage = (dossierId: string) => prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
/** Un mail de relance proposé (en attente de validation) pour le devis le plus récent du dossier. */
const proposerRelance = (dossierId: string, documentId?: string) => avecActeur(LUCAS, () => relances.relancerDevis(dossierId, { forcer: true, ...(documentId ? { documentId } : {}) }));

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
  relances = await import("@/lib/relances/service");
  retire = await import("./devis-retire");
  auto = await import("./prochaine-action-auto");
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "devis-retire", utilisateur: "essai@local" });
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("devis annulé ou masqué sans autre devis actif (mission 18, B6)", () => {
  test("Simulation → devis envoyé puis annulé : retour en Simulation, main à moi, « Refaire le devis », relances arrêtées et mail de relance annulé, lead CONTACTE ; un nouveau devis repart", async () => {
    const c = await contact("Annule", "annule.essai@example.test");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Recouvrement cuisine");
    const relance = await proposerRelance(c.dossierId);
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.main, avant.prochaineAction, avant.statutLead, avant.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(avant.relances.devis.map((r) => [r.numero, r.rang]), [[devis.numero, 1]]);

    const r = await annuler(c.dossierId, devis.id);
    assert.deepEqual([r.retour?.de, r.retour?.vers, r.retour?.nature], ["DEVIS_ENVOYE", "SIMULATION", "RETOUR"]);
    assert.deepEqual(r.avertissements, ["Plus aucun devis n'attend sa réponse : le dossier revient à « Simulation », la main est à toi pour refaire le devis, les relances s'arrêtent."]);

    // Côté CRM et côté client.
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "SIMULATION", "l'étape d'où il était passé en « Devis envoyé »");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["MOI", "MOI", `Devis ${devis.numero} annulé : refaire le devis`]);
    assert.equal(etat.prochaineAction, "Refaire le devis");
    assert.equal(etat.statutLead, "CONTACTE");
    assert.notEqual(etat.etapeEspace, "DEVIS", "le client ne voit plus de devis à signer");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] }, "relances arrêtées");
    assert.deepEqual(tachesDe(etat, "DEVIS").map((t) => [t.titre, t.raison]), [[`Refaire le devis · ${c.nom}`, `devis ${devis.numero} annulé le ${(await import("@/lib/a-faire/achevement")).jourMois(new Date())}`]]);
    assert.deepEqual(tachesDe(etat, "RELANCER_DEVIS"), [], "pas de relance d'un devis annulé");

    // Le mail de relance en attente est annulé ; l'historique dit le retour, d'un bloc avec l'annulation.
    const proposition = await prisma.proposition.findUniqueOrThrow({ where: { id: relance.propositionId } });
    assert.deepEqual([proposition.statut, proposition.commentaireRejet], ["ANNULEE", retire.MOTIF_RELANCE_DEVIS_RETIRE]);
    const passage = await dernierPassage(c.dossierId);
    assert.equal(passage.contenu, `Devis envoyé → Simulation : devis ${devis.numero} annulé, plus aucun devis n'attend sa réponse (retour en arrière)`);
    assert.deepEqual(JSON.parse(passage.metadata).devisRetire, { numero: devis.numero, geste: "ANNULE" });
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).statut, "ANNULEE");
    await assert.rejects(annuler(c.dossierId, devis.id), /déjà annulé/, "rejoué : refusé, rien ne bouge");
    assert.equal((await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", metadata: { contains: "devisRetire" } } })), 1);

    // Le nouveau devis, annoncé : de nouveau « Devis envoyé », « Refaire le devis » est fait.
    const { document: nouveau } = await generer(c.dossierId, "Recouvrement cuisine, métrage corrigé");
    const refait = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([refait.etape, refait.main, refait.prochaineAction, refait.statutLead, refait.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(tachesDe(refait, "DEVIS"), [], "« Refaire le devis » coché par le nouveau devis");
    assert.deepEqual(refait.relances.devis.map((x) => x.numero), [nouveau.numero]);
  });

  test("Qualification → Relance, le seul devis masqué : retour en Qualification ; remis en ligne, il repart", async () => {
    const c = await contact("Masque", "masque.essai@example.test");
    const { document: devis } = await generer(c.dossierId, "Salle de bain");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "RELANCE" }));
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "RELANCE");

    const masque = await masquer(c.dossierId, devis.id);
    assert.deepEqual([masque.passage?.de, masque.passage?.vers, masque.passage?.nature], ["RELANCE", "QUALIFICATION", "RETOUR"]);
    assert.match(masque.retrait ?? "", /revient à « Qualification »/);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.mainMotif], ["QUALIFICATION", "MOI", "MOI", `Devis ${devis.numero} masqué : refaire le devis`]);
    assert.deepEqual([etat.prochaineAction, etat.statutLead], ["Refaire le devis", "CONTACTE"]);
    assert.notEqual(etat.etapeEspace, "DEVIS");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
    assert.deepEqual(tachesDe(etat, "DEVIS").map((t) => t.titre), [`Refaire le devis · ${c.nom}`]);

    const remis = await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: true }));
    assert.deepEqual([remis.passage?.de, remis.passage?.vers], ["QUALIFICATION", "DEVIS_ENVOYE"]);
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.main, apres.prochaineAction, apres.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
    assert.deepEqual(tachesDe(apres, "DEVIS"), []);
  });

  test("un autre devis attend encore sa réponse : rien ne recule, seuls les mails de relance du devis retiré sont annulés", async () => {
    const c = await contact("Variantes", "variantes.essai@example.test");
    await enSimulation(c.dossierId);
    const { document: a } = await generer(c.dossierId, "Cuisine", true, "façades");
    // Relecture : la seconde variante est annoncée elle aussi (une variante silencieuse est visible, pas envoyée : pas de relance).
    const { document: b } = await generer(c.dossierId, "Cuisine", true, "façades et plan");
    const relanceA = await proposerRelance(c.dossierId, a.id);
    const relanceB = await proposerRelance(c.dossierId, b.id);

    const r = await annuler(c.dossierId, a.id);
    assert.deepEqual([r.retour, r.avertissements], [null, []]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
    assert.deepEqual(etat.relances.devis.map((x) => x.numero), [b.numero], "le devis restant se relance");
    assert.deepEqual(tachesDe(etat, "DEVIS"), []);
    const statut = async (id: string) => (await prisma.proposition.findUniqueOrThrow({ where: { id } })).statut;
    assert.deepEqual([await statut(relanceA.propositionId), await statut(relanceB.propositionId)], ["ANNULEE", "EN_ATTENTE"]);

    // Masquer le dernier : cette fois, le dossier revient en Simulation et tous les mails de relance sont annulés.
    const masque = await masquer(c.dossierId, b.id);
    assert.equal(masque.passage?.vers, "SIMULATION");
    assert.equal(await statut(relanceB.propositionId), "ANNULEE");
    const fin = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([fin.etape, fin.main, fin.prochaineAction, fin.relances.devis], ["SIMULATION", "MOI", "Refaire le devis", []]);
  });

  test("action posée à la main : gardée, la tâche « Refaire le devis » à côté (une seule, même rejouée)", async () => {
    const c = await contact("Manuelle", "manuelle.essai@example.test");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine");
    const texte = "Rappeler pour le plan de travail";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: texte }));

    await masquer(c.dossierId, devis.id);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.statutLead], ["SIMULATION", "MOI", "CONTACTE"]);
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], [texte, texte], "jamais écrasée");
    const cle = `${auto.PREFIXE_TACHE_SYNCHRO}${c.dossierId}:devis-a-refaire`;
    assert.deepEqual(etat.taches.filter((t) => t.cle === cle).map((t) => [t.type, t.titre]), [["MANUELLE", `Refaire le devis · ${c.nom}`]]);

    // Remis en ligne puis annulé : la même tâche, jamais une seconde.
    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: true }));
    await annuler(c.dossierId, devis.id);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle } }), 1);
    const fin = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([fin.etape, fin.prochaineAction], ["SIMULATION", texte]);
  });

  test("devis masqué pas encore envoyé (Simulation), annulé : l'étape ne bouge pas, « Envoyer le devis » devient « Refaire le devis », la tâche d'envoi est cochée", async () => {
    const c = await contact("Pasenvoye");
    await enSimulation(c.dossierId);
    // L'espace ouvert avant-hier, pas dans la minute du passage en Simulation (un geste si proche l'emporterait sur l'étape).
    await prisma.dossierEvenement.updateMany({ where: { dossierId: c.dossierId, type: { not: "CHANGEMENT_ETAPE" } }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) } });
    const { document: devis } = await generer(c.dossierId, "Cuisine", false);
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.prochaineAction, tachesDe(avant, "ENVOYER_DEVIS").length], ["SIMULATION", "Envoyer le devis au client", 1]);

    const r = await annuler(c.dossierId, devis.id);
    assert.equal(r.retour, null);
    const etat = await etatDesDeuxCotes(c.dossierId);
    // La main suit la règle : le devis annulé ne compte plus, l'étape la donne à moi.
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.mainMotif, etat.prochaineAction], ["SIMULATION", "MOI", "MOI", "Étape « Simulation »", "Refaire le devis"]);
    assert.deepEqual(tachesDe(etat, "ENVOYER_DEVIS"), [], "plus rien à envoyer");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
  });

  test("devis repris (fait ailleurs) masqué par la correction : le même retour que par l'interrupteur", async () => {
    const c = await contact("Reprismasque");
    await enSimulation(c.dossierId);
    const depose = await avecActeur(LUCAS, () =>
      existants.enregistrerDocumentExistant(c.dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-783", montant: 900, dateEmission: "2026-10-01", statut: "ENVOYE", objet: "Repris", inscrireAuRegistre: true }))
    );
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "DEVIS_ENVOYE");
    const avertissements = await avecActeur(LUCAS, () => existants.modifierDocumentExistant(c.dossierId, depose.documentId, { visibleEspace: false }));
    assert.deepEqual(avertissements, ["Plus aucun devis n'attend sa réponse : le dossier revient à « Simulation », la main est à toi pour refaire le devis, les relances s'arrêtent."]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainMotif, etat.prochaineAction, etat.statutLead], ["SIMULATION", "MOI", "Devis 2026-783 masqué : refaire le devis", "Refaire le devis", "CONTACTE"]);
    assert.notEqual(etat.etapeEspace, "DEVIS");
    assert.deepEqual(tachesDe(etat, "DEVIS").map((t) => t.titre), [`Refaire le devis · ${c.nom}`]);
  });

  test("outil « annuler_document » : l'aperçu annonce le retour, le résultat le dit (même fonction que l'écran)", async () => {
    const c = await contact("Outilretire", "outil.retire@example.test");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine");
    const appeler = (entree: Record<string, unknown>) => execution.executerOutil(catalogue.outilParNom("annuler_document")!, { commande: "annule ce devis", ...entree }, session, new Date());
    const entree = { dossierId: c.dossierId, documentId: devis.id, motif: "le client renonce" };
    const apercu = await appeler(entree);
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.match(apercu.texte, /C'est le seul devis qui attend sa réponse : le dossier reviendra à son étape d'avant le devis/);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).statut, "GENERE", "l'aperçu n'écrit rien");
    const fait = await appeler({ ...entree, confirmation: apercu.confirmation!.jeton });
    assert.match(fait.texte, /annulé : gardé en historique, plus proposé dans son espace\. Plus aucun devis n'attend sa réponse : le dossier revient à « Simulation »/);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.statutLead], ["SIMULATION", "MOI", "Refaire le devis", "CONTACTE"]);
  });
});
