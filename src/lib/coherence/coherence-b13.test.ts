import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-coherence-b13-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B13) : le contrôle de cohérence voit les écarts 1, 3, 5, 6 et 7 de la partie B, « Attendre l'accord » sans
 * devis, la date du chantier posée en « Signé » et l'espace encore ouvert d'un dossier perdu ou archivé ; chacun se
 * corrige d'un clic (quand c'est possible), par les fonctions du métier, avec sa trace. Chaque cas : l'incohérence
 * fabriquée comme les anciennes données la portent, puis la correction, puis l'état DES DEUX CÔTÉS (`etatDesDeuxCotes`).
 * Rien ne sort du poste : réseau coupé, mails seulement programmés (file locale, tâches de fond coupées).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let documents: typeof import("@/lib/dossiers/documents");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let transitions: typeof import("@/lib/dossiers/transitions");
let relances: typeof import("@/lib/relances/service");
let notifications: typeof import("@/lib/mail/notifications");
let fichiers: typeof import("@/lib/fichiers/stockage");
let gestes: typeof import("@/lib/assistant/outils/gestes");
let controle: typeof import("./controle");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const LIGNES = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement de 12 façades", quantite: 10, unite: "ml", prixUnitaire: 150 }]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
let suivant = 0;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré ; `notifier` : annoncé (« Devis disponible ») et donc envoyé (B1), sinon masqué en Q ou S. */
const generer = (dossierId: string, objet: string, notifier = true) =>
  avecActeur(LUCAS, () => documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier })));

async function contact(prenom: string, avecEmail = true) {
  const email = avecEmail ? `${prenom.toLowerCase()}.b13@example.test` : null;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3363${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...(email ? { email } : {}) } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  if (email) await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouvert.dossierId }, select: { clientId: true } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, clientId: dossier.clientId!, nom: `${prenom} Essai`, email };
}
type Contact = Awaited<ReturnType<typeof contact>>;

/** En Simulation, le client a choisi : l'espace a posé « Préparer le devis (simulation choisie) ». */
async function enSimulation(dossierId: string) {
  await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "SIMULATION" }));
  await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
}
/** Un devis écrit directement en base, comme les anciennes données (aucun événement, aucun mail). */
const devisDirect = (dossierId: string, numero: string, donnees: Record<string, unknown> = {}) =>
  prisma.document.create({ data: { dossierId, type: "DEVIS", numero, dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "GENERE", ...donnees } });
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const incoherencesDe = async (dossierId: string, etendu = false) => (await controle.controlerCoherence({ etendu })).incoherences.filter((i) => i.dossierId === dossierId);
const codesDe = async (dossierId: string, etendu = false) => (await incoherencesDe(dossierId, etendu)).map((i) => i.code).sort();
const corriger = (cle: string) => avecActeur(LUCAS, () => controle.corrigerIncoherence(cle));
const traces = (dossierId: string) => prisma.dossierEvenement.findMany({ where: { dossierId, type: "COHERENCE_CORRIGEE" }, orderBy: { createdAt: "asc" } });
const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);
const sensible = (cle: string) => gestes.outilAgirSysteme.sensible!({ action: "CORRIGER_INCOHERENCE", cle } as never);
const notifsDevis = (documentId: string) => prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${documentId}` } });

/** Un mail parti de la boîte Gmail chez ce client, avec un PDF conservé (comme après la file MAIL_PDF_SORTANTS). */
async function mailParti(c: Contact, nom: string) {
  suivant++;
  const recuLe = new Date(Date.now() - JOUR);
  const message = await prisma.message.create({
    data: { canal: "EMAIL", compte: "contact@coverswap.fr", identifiantCanal: `gmail-b13-${suivant}`, filCanal: `fil-b13-${suivant}`, sens: "SORTANT", de: "contact@coverswap.fr", a: JSON.stringify([c.email]), objet: "Votre devis CoverSwap", extrait: "Bonjour, voici le devis.", recuLe, classe: "CLIENT", statut: "RATTACHE", clientId: c.clientId, dossierId: c.dossierId },
  });
  const fichier = await fichiers.enregistrerFichier("messages", new File([new Uint8Array(PDF)], nom, { type: "application/pdf" }), recuLe);
  const piece = await prisma.pieceMessage.create({ data: { messageId: message.id, rang: 1, nom, typeMime: "application/pdf", taille: PDF.length, partie: "1", statut: "CONSERVEE", fichierId: fichier.id } });
  return { messageId: message.id, pieceId: piece.id, recuLe };
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
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  documents = await import("@/lib/dossiers/documents");
  dossiers = await import("@/lib/dossiers/dossiers");
  transitions = await import("@/lib/dossiers/transitions");
  relances = await import("@/lib/relances/service");
  notifications = await import("@/lib/mail/notifications");
  fichiers = await import("@/lib/fichiers/stockage");
  gestes = await import("@/lib/assistant/outils/gestes");
  controle = await import("./controle");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("cohérence de la partie B (mission 18, B13)", () => {
  test("écart 6 : « Devis envoyé » sans aucun devis actif → retour en Simulation, main à moi, « Refaire le devis », relances arrêtées, lead CONTACTE ; corrigé une fois", async () => {
    const c = await contact("Sixtine");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Recouvrement cuisine");
    const relance = await avecActeur(LUCAS, () => relances.relancerDevis(c.dossierId, { forcer: true }));
    // Donnée d'avant B6 : le devis annulé sans que le dossier recule.
    await prisma.document.update({ where: { id: devis.id }, data: { statut: "ANNULEE" } });
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => i.code).sort(), ["ATTENTE_ACCORD_SANS_DEVIS", "DEVIS_ENVOYE_SANS_DEVIS_ACTIF"]);
    const ecart = vues.find((i) => i.code === "DEVIS_ENVOYE_SANS_DEVIS_ACTIF")!;
    assert.equal(ecart.correction, "Revenir à « Simulation » et refaire le devis");
    assert.equal(await sensible(ecart.cle), true, "l'étape change : l'assistant demande confirmation");

    const resultat = await corriger(ecart.cle);
    assert.equal(resultat.corrigee, true);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "SIMULATION");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["MOI", "MOI", `Devis ${devis.numero} annulé : refaire le devis`]);
    assert.equal(etat.prochaineAction, "Refaire le devis");
    assert.equal(etat.statutLead, "CONTACTE");
    assert.notEqual(etat.etapeEspace, "DEVIS");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: relance.propositionId } })).statut, "ANNULEE", "le mail de relance en attente est annulé");
    assert.deepEqual(tachesDe(etat, "DEVIS").map((t) => t.titre), [`Refaire le devis · ${c.nom}`]);
    assert.deepEqual(tachesDe(etat, "COHERENCE"), [], "plus rien à corriger");
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, /Devis envoyé → Simulation : contrôle de cohérence : aucun devis n'attend sa réponse \(retour en arrière\)/);
    assert.deepEqual((await traces(c.dossierId)).map((t) => JSON.parse(t.metadata).code), ["DEVIS_ENVOYE_SANS_DEVIS_ACTIF"]);
    assert.deepEqual(await codesDe(c.dossierId), []);
    assert.deepEqual(await corriger(ecart.cle), { corrigee: false, message: "Cette incohérence n'existe plus : rien à corriger." });
  });

  test("écart 1 : « Devis envoyé » alors que le seul devis est masqué, jamais parti → retour en Simulation, « Envoyer le devis au client » ; une action posée à la main reste, une tâche à côté", async () => {
    const c = await contact("Ulysse");
    await enSimulation(c.dossierId);
    await devisDirect(c.dossierId, "D-ULYSSE-1", { visibleEspace: false });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Passer voir la cuisine avec le métreur" }));
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => i.code), ["DEVIS_ENVOYE_SANS_ENVOI"]);
    assert.equal(vues[0].correction, "Revenir à « Simulation » (le devis reste à envoyer)");
    assert.match(vues[0].constat, /D-ULYSSE-1 : masqué dans son espace/);

    await corriger(vues[0].cle);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "SIMULATION");
    assert.deepEqual([etat.main, etat.mainCalculee], ["MOI", "MOI"]);
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], ["Passer voir la cuisine avec le métreur", "Passer voir la cuisine avec le métreur"], "l'action posée à la main n'est jamais écrasée");
    assert.deepEqual(etat.taches.filter((t) => t.cle.startsWith("MANUELLE:synchro:")).map((t) => t.titre), [`Envoyer le devis au client · ${c.nom}`]);
    assert.equal(etat.statutLead, "CONTACTE");
    assert.notEqual(etat.etapeEspace, "DEVIS");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
    assert.deepEqual(await codesDe(c.dossierId), []);
  });

  test("écart 5 : devis visible jamais annoncé → « Devis disponible » programmé une fois, Devis envoyé daté d'aujourd'hui (relance depuis), « Attendre l'accord » ; interrupteur coupé : rien ; sans adresse : à la main", async () => {
    const c = await contact("Cinna");
    await enSimulation(c.dossierId);
    const il_y_a = new Date(Date.now() - 20 * JOUR);
    const devis = await devisDirect(c.dossierId, "D-CINNA-1", { dateEmission: il_y_a, createdAt: il_y_a });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.ok(avant.relances.devis[0]?.le && new Date(avant.relances.devis[0].le) < new Date(), "avant : la relance compte depuis l'émission, il y a 20 jours");
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => i.code).sort(), ["DEVIS_VISIBLE_NON_NOTIFIE", "PROCHAINE_ACTION_PERIMEE"]);
    const ecart = vues.find((i) => i.code === "DEVIS_VISIBLE_NON_NOTIFIE")!;
    assert.equal(ecart.correction, "Le prévenir par le mail « Devis disponible » (devis D-CINNA-1 ; relances comptées depuis aujourd'hui)");
    assert.equal(await sensible(ecart.cle), true, "un mail part chez le client : sensible");

    const resultat = await corriger(ecart.cle);
    assert.match(resultat.message, /Le client est prévenu par le mail « Devis disponible »/);
    assert.equal(await notifsDevis(devis.id), 1);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction, etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.ok(etat.relances.devis[0]?.le && new Date(etat.relances.devis[0].le) > new Date(), "la relance compte depuis l'annonce");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE", metadata: { contains: '"canal":"ESPACE"' } } }), 1);
    assert.deepEqual(tachesDe(etat, "COHERENCE"), []);
    assert.deepEqual(await codesDe(c.dossierId), []);
    await corriger(ecart.cle);
    assert.equal(await notifsDevis(devis.id), 1, "jamais deux mails");

    // Interrupteur coupé dans Paramètres : la mise en ligne vaut envoi (décision 7), rien à signaler.
    const coupe = await contact("Coupe");
    await enSimulation(coupe.dossierId);
    await devisDirect(coupe.dossierId, "D-COUPE-1");
    await avecActeur(LUCAS, () => transitions.changerEtape(coupe.dossierId, { vers: "DEVIS_ENVOYE" }));
    await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", { ...notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, actif: false }, "essai");
    try {
      assert.deepEqual((await codesDe(coupe.dossierId)).filter((x) => x.startsWith("DEVIS_")), []);
    } finally {
      await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, "essai");
    }

    // Sans adresse : l'incohérence est dite, la correction est à la main (l'envoyer autrement).
    const sans = await contact("Sansmail", false);
    await enSimulation(sans.dossierId);
    await devisDirect(sans.dossierId, "D-SANS-1");
    await avecActeur(LUCAS, () => transitions.changerEtape(sans.dossierId, { vers: "DEVIS_ENVOYE" }));
    const sansMail = (await incoherencesDe(sans.dossierId)).find((i) => i.code === "DEVIS_VISIBLE_NON_NOTIFIE")!;
    assert.equal(sansMail.correction, null);
    assert.match(sansMail.constat, /Aucun mail possible \(aucune adresse e-mail valide pour ce client\)/);
  });

  test("écart 3 : PDF du devis du CRM parti de Gmail → enregistré d'un clic (Devis envoyé, relance depuis le mail, tâches cochées) ; sans numéro ni montant : la tâche seule", async () => {
    const c = await contact("Gaspard");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine", false);
    const mail = await mailParti(c, `Devis ${devis.numero}.pdf`);
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => i.code), ["DEVIS_GMAIL_NON_ENREGISTRE"]);
    assert.equal(vues[0].cle, `DEVIS_GMAIL_NON_ENREGISTRE:${mail.pieceId}`);
    assert.match(vues[0].correction ?? "", new RegExp(`^Enregistrer le devis ${devis.numero} comme envoyé depuis Gmail le `));
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual(tachesDe(avant, "COHERENCE"), [], "pas de seconde tâche : « Enregistrer comme devis envoyé » le propose déjà");
    assert.equal(tachesDe(avant, "ENREGISTRER_DEVIS").length, 1);

    await corriger(vues[0].cle);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction, etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual([tachesDe(etat, "ENREGISTRER_DEVIS"), tachesDe(etat, "ENVOYER_DEVIS")], [[], []]);
    assert.equal(await notifsDevis(devis.id), 0, "aucun mail : le client a déjà le devis");
    assert.equal((await traces(c.dossierId)).length, 1);
    assert.deepEqual(await codesDe(c.dossierId), []);

    const autre = await contact("Gisele");
    await enSimulation(autre.dossierId);
    await mailParti(autre, "devis-cuisine.pdf");
    const sansMontant = (await incoherencesDe(autre.dossierId)).find((i) => i.code === "DEVIS_GMAIL_NON_ENREGISTRE")!;
    assert.equal(sansMontant.correction, null);
    assert.match(sansMontant.constat, /Montant à saisir : tâche « Enregistrer comme devis envoyé »/);
  });

  test("écart 7 : devis émis après la signature, visible mais l'espace n'est plus ouvert → envoyé par mail d'un clic (texte type) ; l'étape ne bouge pas ; un devis pas encore envoyé garde sa tâche « Envoyer le devis » ; espace ouvert : proposé, rien à signaler (B7)", async () => {
    const c = await contact("Septime");
    await enSimulation(c.dossierId);
    const { document: signe } = await generer(c.dossierId, "Cuisine");
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: signe.id, nom: c.nom, accepte: true }, { ip: null, navigateur: null });
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).etape, "SIGNE");
    const { document: avenant } = await generer(c.dossierId, "Avenant : crédence");
    const { document: silencieuse } = await generer(c.dossierId, "Variante silencieuse", false);
    // Mission 18 (B7) : l'espace ouvert propose l'avenant (et la variante, visible sans annonce) et les fait signer : plus d'écart.
    assert.deepEqual(await codesDe(c.dossierId), []);
    assert.deepEqual((await service.etatEspace(await espaceDe(c.espaceId))).devisASigner.map((d) => d.id), [avenant.id, silencieuse.id]);
    // L'espace fermé ensuite (lien désactivé) : le client ne peut plus le signer en ligne.
    const espace = await espaceDe(c.espaceId);
    await prisma.espacePermanent.update({ where: { id: espace.permanentId! }, data: { revoqueLe: new Date() } });
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => i.code), ["AVENANT_NON_PROPOSE"]);
    assert.equal(vues[0].correction, `Lui envoyer le devis ${avenant.numero} par mail (texte type, à ${c.email})`);
    assert.match(vues[0].constat, new RegExp(`Le devis ${avenant.numero}, émis après la signature`));
    assert.equal(await sensible(vues[0].cle), true);
    const avant = await etatDesDeuxCotes(c.dossierId);

    const resultat = await corriger(vues[0].cle);
    assert.match(resultat.message, new RegExp(`Devis ${avenant.numero} envoyé par mail à ${c.email}`));
    const propositions = await prisma.proposition.findMany({ where: { type: "ENVOI_MAIL", cleUnicite: { startsWith: `envoi-document:${avenant.id}:` } } });
    assert.equal(propositions.length, 1);
    assert.notEqual(propositions[0].statut, "EN_ATTENTE", "validée par le clic (comme le bouton « Envoyer par mail »)");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.main], ["SIGNE", avant.statutLead, avant.etapeEspace, etat.mainCalculee]);
    assert.equal(tachesDe(etat, "ENVOYER_DEVIS").length, 1, "la variante silencieuse garde sa tâche");
    assert.deepEqual(await codesDe(c.dossierId), [], "en cours d'envoi : plus rien à signaler");
    assert.deepEqual(await corriger(vues[0].cle), { corrigee: false, message: "Cette incohérence n'existe plus : rien à corriger." });
  });

  test("« Attendre l'accord » sans devis : effacée d'un clic ; posée à la main : jamais signalée", async () => {
    const c = await contact("Agnes");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: "Attendre l'accord du client sur le devis" } });
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => [i.code, i.correction]), [["ATTENTE_ACCORD_SANS_DEVIS", "Effacer cette prochaine action"]]);
    assert.equal(await sensible(vues[0].cle), false);
    await corriger(vues[0].cle);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.prochaineAction, etat.main], ["QUALIFICATION", null, etat.mainCalculee]);
    assert.match((await traces(c.dossierId))[0].contenu, /prochaine action « Attendre l'accord du client sur le devis » effacée/);

    const main = await contact("Amaury");
    await avecActeur(LUCAS, () => dossiers.modifierDossier(main.dossierId, { prochaineAction: "Attendre l'accord du client sur le devis" }));
    assert.deepEqual(await codesDe(main.dossierId), []);
  });

  test("date du chantier posée en « Signé » → « Planifié » d'un clic, lead CHANTIER_PLANIFIE, « fixer la date du chantier » effacée", async () => {
    const c = await contact("Dorian");
    await enSimulation(c.dossierId);
    const { document: devis } = await generer(c.dossierId, "Cuisine");
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: devis.id, nom: c.nom, accepte: true }, { ip: null, navigateur: null });
    assert.match((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction ?? "", /fixer la date du chantier/);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { dateChantier: new Date("2026-11-16T00:00:00Z") } });
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => [i.code, i.correction]), [["DATE_CHANTIER_EN_SIGNE", "Passer le dossier en « Planifié » (chantier le 16/11/2026)"]]);
    assert.equal(await sensible(vues[0].cle), true);

    await corriger(vues[0].cle);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.prochaineAction, etat.etapeEspace, etat.main], ["PLANIFIE", "CHANTIER_PLANIFIE", null, "CHANTIER", etat.mainCalculee]);
    assert.deepEqual(tachesDe(etat, "COHERENCE"), []);
    assert.deepEqual(await codesDe(c.dossierId), []);
  });

  test("dossier perdu ou archivé avec un espace ouvert : lien désactivé si tous ses projets sont clos depuis le délai de la révocation ; un projet perdu à côté d'un projet vivant reste affiché", async () => {
    // Perdu aujourd'hui, seul projet de son espace : pas une incohérence (relecture) — la révocation automatique fermera
    // le lien 90 jours après la perte ; au-delà, le lien qui fonctionne encore est signalé.
    const c = await contact("Lazare");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "PERDU", perteLe: new Date() } });
    assert.deepEqual(await codesDe(c.dossierId), [], "passer en « Perdu » ne crée pas d'incohérence");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { perteLe: new Date(Date.now() - 93 * 86_400_000) } });
    const vues = await incoherencesDe(c.dossierId);
    assert.deepEqual(vues.map((i) => [i.code, i.correction]), [["ESPACE_ACTIF_DOSSIER_CLOS", "Désactiver le lien"]]);
    assert.equal(await sensible(vues[0].cle), false);
    await corriger(vues[0].cle);
    const projet = await prisma.espaceClient.findUniqueOrThrow({ where: { id: c.espaceId }, include: { permanent: true } });
    assert.ok(projet.permanent?.revoqueLe, "le lien du client est désactivé");
    assert.equal(projet.revoqueLe, null, "le projet perdu reste « non réalisé » dans son espace s'il est rouvert");
    assert.equal(await liens.lienPourLeProjet(projet), null);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "ESPACE_LIEN_DESACTIVE" } }), 1);
    assert.deepEqual(await codesDe(c.dossierId), []);
    assert.equal(await prisma.envoiMail.count({ where: { dossierId: c.dossierId } }), 0, "aucun envoi");

    // Perdu, mais un autre projet vivant dans son espace : rien à signaler.
    const d = await contact("Leonie");
    const second = await prisma.dossier.create({ data: { clientId: d.clientId, clientNom: d.nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33600000000", objet: "Dressing", source: "ENTRANT", etape: "QUALIFICATION", leadId: null } });
    const autreProjet = await liens.ouvrirEspace(second.id);
    assert.equal(autreProjet.espace.permanentId, (await espaceDe(d.espaceId)).permanentId, "deux projets, un seul espace");
    await prisma.dossier.update({ where: { id: d.dossierId }, data: { etape: "PERDU" } });
    assert.deepEqual(await codesDe(d.dossierId), []);

    // Archivé, projet resté ouvert (donnée d'avant) : le projet se ferme ; le lien, seul projet, une fois le délai passé.
    const a = await contact("Aristide");
    await avecActeur(LUCAS, async () => (await import("@/lib/dossiers/archivage")).archiverDossier(a.dossierId, "doublon"));
    await prisma.espaceClient.update({ where: { id: a.espaceId }, data: { revoqueLe: null } });
    const recent = (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === a.dossierId);
    assert.deepEqual(recent.map((i) => [i.code, i.correction]), [["ESPACE_ACTIF_DOSSIER_CLOS", "Fermer le projet dans son espace"]], "archivé aujourd'hui : le lien attend le délai");
    await prisma.dossier.update({ where: { id: a.dossierId }, data: { archiveLe: new Date(Date.now() - 93 * 86_400_000) } });
    const archive = (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === a.dossierId);
    assert.deepEqual(archive.map((i) => [i.code, i.correction, i.leadId]), [["ESPACE_ACTIF_DOSSIER_CLOS", "Fermer le projet et désactiver le lien", a.leadId]]);
    await corriger(archive[0].cle);
    const ferme = await prisma.espaceClient.findUniqueOrThrow({ where: { id: a.espaceId }, include: { permanent: true } });
    assert.ok(ferme.revoqueLe && ferme.permanent?.revoqueLe);
    assert.equal((await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === a.dossierId).length, 0);
  });

  test("contrôle étendu : les dossiers perdus et archivés sont lus ; la correction s'applique sans rejouer le contrôle, avec sa trace", async () => {
    const c = await contact("Etienne");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "PERDU" } });
    await prisma.lead.update({ where: { id: c.leadId }, data: { statut: "CONTACTE" } });
    const normal = await controle.controlerCoherence();
    const etendu = await controle.controlerCoherence({ etendu: true });
    assert.ok(etendu.dossiersControles > normal.dossiersControles);
    assert.ok(!normal.incoherences.some((i) => i.code === "STATUT_DU_LEAD" && i.dossierId === c.dossierId));
    const statut = etendu.incoherences.find((i) => i.code === "STATUT_DU_LEAD" && i.dossierId === c.dossierId)!;
    assert.equal(statut.correction, "Aligner le lead sur « PERDU »");
    assert.equal((await avecActeur(LUCAS, () => controle.appliquerCorrection(statut))).corrigee, true);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: c.leadId } })).statut, "PERDU");
    assert.match((await traces(c.dossierId))[0].contenu, /lead aligné sur « PERDU » \(il était « CONTACTE »\)/);
  });

  test("les corrections qui changent l'étape sont figées et toutes sensibles ; chaque code a sa ligne dans docs/COHERENCE.md", () => {
    assert.deepEqual([...controle.CORRECTIONS_QUI_CHANGENT_L_ETAPE].sort(), [
      "ACCORD_SANS_SIGNATURE",
      "DATE_CHANTIER_EN_SIGNE",
      "DEVIS_ACCEPTE_AVANT_SIGNE",
      "DEVIS_ENVOYE_SANS_DEVIS_ACTIF",
      "DEVIS_ENVOYE_SANS_ENVOI",
      "DEVIS_GMAIL_NON_ENREGISTRE",
      "DEVIS_VISIBLE_NON_NOTIFIE",
      "ETAPE_ET_SOLDE",
      "PAIEMENT_AVANT_SIGNATURE",
      "PROJET_VALIDE_INCOMPLET",
      "PROJET_VALIDE_SANS_AVANCER",
    ]);
    for (const code of controle.CORRECTIONS_QUI_CHANGENT_L_ETAPE) assert.ok(controle.CORRECTIONS_SENSIBLES.has(code), `${code} change l'étape : sensible`);
    assert.ok(controle.CORRECTIONS_SENSIBLES.has("AVENANT_NON_PROPOSE"), "un mail part chez le client");
    for (const sur of ["ATTENTE_ACCORD_SANS_DEVIS", "ESPACE_ACTIF_DOSSIER_CLOS", "STATUT_DU_LEAD", "MAIN_DECALEE"] as const) assert.ok(!controle.CORRECTIONS_SENSIBLES.has(sur), sur);
    const doc = readFileSync(path.join(process.cwd(), "docs", "COHERENCE.md"), "utf8");
    for (const code of controle.CODES_INCOHERENCE) assert.ok(doc.includes(`| \`${code}\``), `docs/COHERENCE.md § 5 : ${code}`);
  });
});
