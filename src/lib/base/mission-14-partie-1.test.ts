import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p1-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

/**
 * Mission 14 (29/09/2026), partie 1 — qui a la main. Un devis visible, émis ou
 * déposé, met le dossier en « Devis envoyé » et la main au client (délai de
 * relance lancé) ; un message du client sans réponse m'épingle la main
 * (« Répondre à … ») ; l'objet suit la famille validée sauf s'il a été écrit à
 * la main ; l'espace et le dossier lisent la même étape. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let compte: typeof import("@/lib/espace/compte");
let messages: typeof import("@/lib/espace/messages");
let validations: typeof import("@/lib/espace/validations");
let etapes: typeof import("@/lib/espace/etapes");
let suivi: typeof import("@/lib/espace/suivi");
let simulations: typeof import("@/lib/simulations/dossier");
let documents: typeof import("@/lib/dossiers/documents");
let depot: typeof import("@/lib/dossiers/depot-document");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let main: typeof import("@/lib/dossiers/main");
let dates: typeof import("@/lib/dossiers/dates");
let relances: typeof import("@/lib/relances/service");
let rattachement: typeof import("@/lib/mail/rattachement");
let boite: typeof import("@/lib/mail/boite");
let v2: typeof import("@/lib/mail/v2");
let commercial: typeof import("@/lib/commercial/pilotage");
let execution: typeof import("@/lib/assistant/execution");
let outilsRelances: typeof import("@/lib/assistant/outils/relances");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-1");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const MIGRATION = { acteur: "MIGRATION:qui-a-la-main-14-1", origine: "essai" };
const JOUR = 86_400_000;
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const PDF = Buffer.from("%PDF-1.4\n% devis d'essai\n").toString("base64");

async function contact(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, permanentId: ouvert.permanent.id, nom: `${prenom} Essai` };
}
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
// Des numéros distincts à coup sûr (un tirage au hasard pouvait en donner deux égaux : contrainte unique type + numéro).
let rangNumero = 500;
const numero = () => `2026-${rangNumero++}`;
// Un devis écrit directement en base n'est pas au registre : la génération (max du registre + 1) pourrait reprendre son
// numéro. Il prend donc le sien dans une autre plage.
let rangDirect = 900;
const numeroDirect = () => `2026-${rangDirect++}`;

async function simulationPubliee(dossierId: string, titre: string) {
  const vue = await simulations.deposerSimulationDossier(dossierId, new File([new Uint8Array(JPEG)], `${titre}.jpg`, { type: "image/jpeg" }), { titre, preparationId: null });
  await prisma.simulationEspace.update({ where: { id: vue.id }, data: { zones: JSON.stringify([{ zone: "meuble-vasque", libelle: "Meuble vasque", ref: "CT68", nom: "Brown Ebony" }]) } });
  await avecActeur(LUCAS, () => simulations.publierSimulations(dossierId, [vue.id], { prevenir: false }));
  return vue.id;
}

/** Le devis déposé comme par l'outil « deposer_document » (un PDF fait ailleurs). */
function deposer(dossierId: string, extra: Record<string, unknown> = {}) {
  return avecActeur(LUCAS, () =>
    depot.deposerDocument(dossierId, depot.schemaDepotDocument.parse({ type: "DEVIS", numero: numero(), montant: 630, libelle: "Meuble vasque", inscrire_au_registre: true, source: { contenu_base64: PDF, nom: "devis.pdf" }, ...extra }))
  );
}

/** Un mail du client (ou ma réponse), tracé dans le dossier par la vraie fonction de rattachement. */
async function mail(dossierId: string, sens: "ENTRANT" | "SORTANT", fil: string, recuLe = new Date()) {
  const d = await dossierDe(dossierId);
  const m = await prisma.message.create({
    data: { canal: "EMAIL", compte: "boite@coverswap.test", identifiantCanal: `essai-${Math.random().toString(36).slice(2)}`, filCanal: fil, sens, de: sens === "ENTRANT" ? "client@exemple.test" : "boite@coverswap.test", a: JSON.stringify([sens === "ENTRANT" ? "boite@coverswap.test" : "client@exemple.test"]), objet: "Votre devis", recuLe, classe: "CLIENT", clientId: d.clientId },
  });
  assert.equal(await rattachement.tracerMailDansDossier(m.id, dossierId), true);
  return m.id;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  compte = await import("@/lib/espace/compte");
  messages = await import("@/lib/espace/messages");
  validations = await import("@/lib/espace/validations");
  etapes = await import("@/lib/espace/etapes");
  suivi = await import("@/lib/espace/suivi");
  simulations = await import("@/lib/simulations/dossier");
  documents = await import("@/lib/dossiers/documents");
  depot = await import("@/lib/dossiers/depot-document");
  dossiers = await import("@/lib/dossiers/dossiers");
  main = await import("@/lib/dossiers/main");
  dates = await import("@/lib/dossiers/dates");
  relances = await import("@/lib/relances/service");
  rattachement = await import("@/lib/mail/rattachement");
  boite = await import("@/lib/mail/boite");
  v2 = await import("@/lib/mail/v2");
  commercial = await import("@/lib/commercial/pilotage");
  execution = await import("@/lib/assistant/execution");
  outilsRelances = await import("@/lib/assistant/outils/relances");
  migration = await import("@/lib/base/migrations/mission-14-partie-1");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("R1 : un devis visible, émis ou déposé, c'est « Devis envoyé »", () => {
  test("le cas du 29/09 : simulation validée, sans e-mail, devis déposé → Devis envoyé, chez le client, « Devis à signer », relance datée du dépôt", async () => {
    const c = await contact("Baptiste");
    const simulationId = await simulationPubliee(c.dossierId, "Brown Ebony");
    await service.choisirSimulation(await espaceDe(c.espaceId), simulationId, "Celle-ci");
    await main.recalculerMain(c.dossierId);
    let d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["SIMULATION", "MOI", "Simulation validée : faire le devis"]);
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).etape, "ATTENTE_DEVIS");

    // Déposé aujourd'hui, daté de trois jours plus tôt.
    const emisLe = dates.jourParis(new Date(Date.now() - 3 * JOUR));
    const depose = await deposer(c.dossierId, { date_emission: emisLe });
    assert.equal(depose.nature, "DOCUMENT");
    d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["DEVIS_ENVOYE", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal(d.prochaineAction, "Attendre l'accord du client sur le devis");
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(passage.contenu, /Simulation → Devis envoyé : devis .+ déposé, visible dans son espace/);
    const repris = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DOCUMENT_REPRIS" } });
    assert.deepEqual(JSON.parse(repris.metadata).type, "DEVIS");

    // L'espace et le dossier disent la même chose.
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).etape, "DEVIS");
    const ligne = (await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!;
    assert.deepEqual([ligne.etape, ligne.attente.qui, ligne.attente.libelle], ["DEVIS", "CLIENT", "Devis envoyé : en attente de sa réponse"]);

    // Dans les relances : pas d'adresse, prochaine date = dépôt + délai (pas émission + délai).
    const { delai, devis } = await relances.listerRelances();
    const aRelancer = devis.find((x) => x.dossierId === c.dossierId);
    assert.ok(aRelancer, "présent dans voir_relances");
    assert.equal(aRelancer.adresse, null);
    const document = await prisma.document.findUniqueOrThrow({ where: { id: depose.nature === "DOCUMENT" ? depose.documentId : "" } });
    assert.equal(aRelancer.prochaineProposableLe, new Date(document.createdAt.getTime() + delai * JOUR).toISOString());
    const session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
    const vue = await execution.executerOutil(outilsRelances.outilVoirRelances as unknown as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>, {}, session);
    assert.match(vue.texte, new RegExp(`${c.nom} : devis ${document.numero} .*pas d'adresse e-mail`));
  });

  test("un devis déposé masqué ne bouge rien (ni étape, ni espace, ni relance) ; rendu visible, il est envoyé", async () => {
    const c = await contact("Octave");
    const simulationId = await simulationPubliee(c.dossierId, "Chêne");
    await service.choisirSimulation(await espaceDe(c.espaceId), simulationId, "");
    const depose = await deposer(c.dossierId, { visible_espace: false });
    assert.equal(depose.nature, "DOCUMENT");
    const documentId = depose.nature === "DOCUMENT" ? depose.documentId : "";
    let d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main], ["SIMULATION", "MOI"]);
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).etape, "ATTENTE_DEVIS", "un devis masqué n'est pas « le devis » de l'espace");
    assert.ok(!(await relances.listerRelances()).devis.some((x) => x.dossierId === c.dossierId));

    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, documentId, { visibleEspace: true }));
    d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["DEVIS_ENVOYE", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).etape, "DEVIS");
  });

  test("dossier repris en Simulation avec son devis déjà envoyé : « Devis envoyé » à la fin de la reprise (passage de nature « reprise »), chez le client", async () => {
    const reprise = await import("@/lib/dossiers/reprise");
    const repris = await avecActeur(LUCAS, () =>
      reprise.reprendreDossier(reprise.schemaReprise.parse({ dossier: { clientNom: "Atelier Essai", source: "RECOMMANDATION" }, etape: "SIMULATION", documents: [{ type: "DEVIS", numero: numero(), dateEmission: dates.jourParis(new Date(Date.now() - 5 * JOUR)), montant: 800, inscrireAuRegistre: true }] }))
    );
    const d = await dossierDe(repris.id);
    assert.deepEqual([d.etape, d.main], ["DEVIS_ENVOYE", "CLIENT"]);
    const dernier = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: repris.id, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(dernier.contenu, /Simulation → Devis envoyé : devis déjà envoyé \(reprise\)/);
  });

  test("repris en Chantier avec un devis accepté et une variante restée « envoyée » : la main reste à l'étape (à moi), pas « Devis envoyé »", async () => {
    const reprise = await import("@/lib/dossiers/reprise");
    const il = (jours: number) => dates.jourParis(new Date(Date.now() - jours * JOUR));
    const repris = await avecActeur(LUCAS, () =>
      reprise.reprendreDossier(
        reprise.schemaReprise.parse({
          dossier: { clientNom: "Chantier Essai", source: "RECOMMANDATION" },
          etape: "CHANTIER",
          dates: { etapeDepuisLe: il(5) },
          documents: [
            { type: "DEVIS", numero: numero(), dateEmission: il(20), montant: 800, statut: "ACCEPTE", inscrireAuRegistre: true },
            { type: "DEVIS", numero: numero(), dateEmission: il(20), montant: 900, statut: "ENVOYE", inscrireAuRegistre: true },
          ],
        })
      )
    );
    const d = await dossierDe(repris.id);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["CHANTIER", "MOI", "Étape « Chantier »"]);
    const drapeaux = (await prisma.dossierEvenement.findMany({ where: { dossierId: repris.id, type: "DOCUMENT_REPRIS" } })).map((e) => JSON.parse(e.metadata).reprise);
    assert.deepEqual(drapeaux, [true, true], "écrits pendant la reprise : datés de leur émission");
  });

  test("anciens événements (sans type) : un devis accepté ou un dossier déjà planifié ne rendent pas la main au client", async () => {
    const c = await contact("Ulysse");
    const le = new Date(Date.now() - 10 * JOUR);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "PLANIFIE" } });
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Signé → Planifié (dossier repris)", metadata: JSON.stringify({ de: "SIGNE", vers: "PLANIFIE", nature: "SUIVANTE" }), survenuLe: le } });
    for (const statut of ["ACCEPTE", "ENVOYE"]) {
      const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: numeroDirect(), dateEmission: le, objet: "Cuisine", lignes: "[]", totalHt: 900, statut, origine: "REPRISE" } });
      await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "DOCUMENT_REPRIS", direction: "INTERNE", contenu: `Devis ${devis.numero} du ${dates.jourParis(le)} rattaché (émis avant le CRM) : 900,00 €`, metadata: JSON.stringify({ documentId: devis.id, numero: devis.numero, origine: "REPRISE" }), survenuLe: le } });
    }
    await prisma.dossierEvenement.updateMany({ where: { dossierId: c.dossierId, type: { notIn: ["CHANGEMENT_ETAPE", "DOCUMENT_REPRIS"] } }, data: { createdAt: new Date(le.getTime() - JOUR) } });
    const calcul = await main.calculerMain(c.dossierId);
    assert.deepEqual([calcul?.qui, calcul?.motif], ["MOI", "Étape « Planifié »"]);
  });

  test("le seul devis masqué, puis annulé : la main n'attend plus sa réponse ; ni « Mes documents » ni PDF pour le client", async () => {
    const c = await contact("Irene");
    // L'espace ouvert il y a deux jours (un geste à moins d'une minute du passage l'emporterait sur l'étape).
    await prisma.dossierEvenement.updateMany({ where: { dossierId: c.dossierId }, data: { createdAt: new Date(Date.now() - 2 * JOUR) } });
    const { document: devis } = await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 3, unite: "ml", prixUnitaire: 140 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Devis envoyé : en attente de sa réponse");
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanentId } });
    assert.ok((await compte.documentsDuClient(permanent)).some((x) => x.id === devis.id));

    const masque = await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: false }));
    assert.equal(masque.passage, null);
    const d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["DEVIS_ENVOYE", "CLIENT", "Étape « Devis envoyé »"], "l'étape ne recule pas ; le motif ne parle plus d'un devis qu'il ne voit pas");
    assert.ok(!(await compte.documentsDuClient(permanent)).some((x) => x.id === devis.id), "masqué : absent de « Mes documents »");
    await assert.rejects(compte.pdfPourLeClient(permanent, devis.id), /introuvable/i);
    await assert.rejects(compte.pdfDuProjetPourLeClient(await espaceDe(c.espaceId), devis.id), /introuvable/i);

    const rendu = await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: true }));
    assert.equal(rendu.passage, null, "déjà en « Devis envoyé » : pas de passage");
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Devis envoyé : en attente de sa réponse");
    await avecActeur(LUCAS, () => documents.annulerDevis(c.dossierId, devis.id, "erreur de métrage"));
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Étape « Devis envoyé »", "annulé : il n'attend plus sa réponse");
  });
});

describe("R2 : un message du client sans réponse, c'est à moi", () => {
  test("règle : épinglée quel que soit le geste plus récent ; personne sur un dossier perdu ; sans nom : « Répondre au client »", () => {
    const le = (minutes: number) => new Date(Date.UTC(2026, 8, 29, 10, minutes));
    const publie = { type: "ESPACE_SIMULATION_DEPOSEE", direction: "SORTANT", metadata: "{}", contenu: "", le: le(30) };
    const epinglee = main.mainSelonFaits({ etape: "DEVIS_ENVOYE", evenements: [publie], messageSansReponse: { le: le(10) }, nom: "Nina Essai" });
    assert.deepEqual([epinglee.qui, epinglee.motif, epinglee.le?.toISOString()], ["MOI", "Répondre à Nina Essai", le(10).toISOString()]);
    assert.equal(main.mainSelonFaits({ etape: "PERDU", evenements: [], messageSansReponse: { le: le(10) }, nom: "Nina Essai" }).qui, null);
    assert.equal(main.mainSelonFaits({ etape: "SIGNE", evenements: [], messageSansReponse: { le: le(10) } }).motif, "Répondre au client");
    assert.equal(main.estMotifRepondre("Répondre à Nina Essai"), true);
    assert.equal(main.estMotifRepondre("Répondre au client"), true);
    assert.equal(main.estMotifRepondre("Mail du client reçu"), false);
  });

  test("un mail rattaché → « Répondre à … » partout ; une publication ne la reprend pas ; ma réponse par mail la rend au client", async () => {
    const c = await contact("Gaspard");
    await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Salle de bain", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 2, unite: "ml", prixUnitaire: 150 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    let d = await dossierDe(c.dossierId);
    assert.deepEqual([d.etape, d.main], ["DEVIS_ENVOYE", "CLIENT"]);

    await mail(c.dossierId, "ENTRANT", "fil-gaspard", new Date(Date.now() - 60_000));
    d = await dossierDe(c.dossierId);
    assert.deepEqual([d.main, d.mainMotif], ["MOI", `Répondre à ${c.nom}`]);
    const affaire = (await commercial.pilotageCommercial()).affaires.find((a) => a.dossierId === c.dossierId)!;
    assert.deepEqual([affaire.groupe, affaire.action, affaire.main], ["REPONDRE", `Répondre à ${c.nom}`, "MOI"]);
    assert.equal((await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!.attente.libelle, `Répondre à ${c.nom}`);

    // Un geste plus récent qui, d'habitude, passe la main au client : elle reste épinglée.
    await simulationPubliee(c.dossierId, "Béton");
    assert.equal((await dossierDe(c.dossierId)).mainMotif, `Répondre à ${c.nom}`);

    await mail(c.dossierId, "SORTANT", "fil-gaspard");
    d = await dossierDe(c.dossierId);
    assert.deepEqual([d.main, d.mainMotif], ["CLIENT", "Mail envoyé : en attente de sa réponse"]);
  });

  test("un message dans l'espace → épinglée ; ma réponse dans l'espace la rend ; un mail rangé ou traité sans réponse ne l'épingle plus", async () => {
    const c = await contact("Maelle");
    await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 4, unite: "ml", prixUnitaire: 120 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanentId } });
    await compte.envoyerMessage(permanent, await espaceDe(c.espaceId), "Bonjour, peut-on décaler la pose ?");
    assert.deepEqual([(await dossierDe(c.dossierId)).main, (await dossierDe(c.dossierId)).mainMotif], ["MOI", `Répondre à ${c.nom}`]);
    await avecActeur(LUCAS, () => messages.repondreDansLEspace(c.dossierId, "Bonjour, oui : je vous appelle demain pour caler la date."));
    assert.deepEqual([(await dossierDe(c.dossierId)).main, (await dossierDe(c.dossierId)).mainMotif], ["CLIENT", "Réponse envoyée dans son espace : en attente de son retour"]);

    // Un mail sans réponse, puis rangé : « pas de réponse à faire ».
    const range = await mail(c.dossierId, "ENTRANT", "fil-maelle-1");
    assert.equal((await dossierDe(c.dossierId)).mainMotif, `Répondre à ${c.nom}`);
    await avecActeur(LUCAS, () => v2.rangerMail(range, "Pas de réponse à faire"));
    assert.deepEqual([(await dossierDe(c.dossierId)).main, (await dossierDe(c.dossierId)).mainMotif], ["CLIENT", "Réponse envoyée dans son espace : en attente de son retour"]);

    // Un autre, archivé (traité) : pareil.
    const traite = await mail(c.dossierId, "ENTRANT", "fil-maelle-2");
    assert.equal((await dossierDe(c.dossierId)).main, "MOI");
    await avecActeur(LUCAS, () => boite.archiverFil(traite));
    assert.equal((await dossierDe(c.dossierId)).main, "CLIENT");
    // Désarchivé : de nouveau à traiter, de nouveau épinglé.
    await avecActeur(LUCAS, () => boite.archiverFil(traite, false));
    assert.equal((await dossierDe(c.dossierId)).mainMotif, `Répondre à ${c.nom}`);
  });

  test("un mail déplacé dans un autre dossier du client : l'ancien n'est plus épinglé, le nouveau l'est", async () => {
    const c = await contact("Romeo");
    await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 2, unite: "ml", prixUnitaire: 150 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const recu = await mail(c.dossierId, "ENTRANT", "fil-romeo");
    const a = await dossierDe(c.dossierId);
    assert.equal(a.mainMotif, `Répondre à ${c.nom}`);
    const b = await prisma.dossier.create({ data: { clientId: a.clientId, clientNom: a.clientNom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: a.clientTelephone, objet: "Dressing", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
    await avecActeur(LUCAS, () => rattachement.rattacherALaMain(recu, a.clientId!, b.id));
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Devis envoyé : en attente de sa réponse", "l'ancien dossier est relu");
    assert.equal((await dossierDe(b.id)).mainMotif, `Répondre à ${c.nom}`);
  });

  test("contrôle de cohérence, même définition que la main : un mail rangé ne lève rien ; une main affichée « chez le client » face à un mail sans réponse, si", async () => {
    const controle = await import("@/lib/coherence/controle");
    const c = await contact("Theo");
    await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 2, unite: "ml", prixUnitaire: 150 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const range = await mail(c.dossierId, "ENTRANT", "fil-theo-1", new Date(Date.now() - 3 * JOUR));
    assert.equal((await dossierDe(c.dossierId)).main, "MOI");
    await avecActeur(LUCAS, () => v2.rangerMail(range, "Pas de réponse à faire"));
    assert.equal((await dossierDe(c.dossierId)).main, "CLIENT");
    const codes = async () => (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId).map((i) => i.code);
    assert.deepEqual(await codes(), [], "rangé : « pas de réponse à faire », rien à signaler");

    await mail(c.dossierId, "ENTRANT", "fil-theo-2", new Date(Date.now() - 3 * JOUR));
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { main: "CLIENT" } });
    assert.deepEqual((await codes()).sort(), ["MAIL_SANS_REPONSE", "MAIN_DECALEE"]);
  });
});

describe("R3 : l'objet suit la famille validée, sauf écrit à la main", () => {
  test("validé : l'objet du lead cède ; revalidé autrement : il suit encore ; écrit par Lucas : il ne bouge plus", async () => {
    const c = await contact("Lison", { typeProjet: "CUISINE" });
    assert.equal((await dossierDe(c.dossierId)).objet, "Recouvrement de cuisine");

    await service.enregistrerProjet(await espaceDe(c.espaceId), { familles: { SDB: ["meuble-vasque"] }, precisions: "" });
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    assert.equal((await dossierDe(c.dossierId)).objet, "Recouvrement de salle de bains : meuble vasque");

    await service.enregistrerProjet(await espaceDe(c.espaceId), { familles: { CUISINE: ["facades-hautes", "plan-de-travail"] }, tailles: { CUISINE: { repere: "en-l", valeur: 5 } }, precisions: "" });
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    assert.equal((await dossierDe(c.dossierId)).objet, "Recouvrement de cuisine : façades hautes, plan de travail");

    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, dossiers.schemaModification.parse({ objet: "Cuisine de la maison de Sète" })));
    assert.ok((await dossierDe(c.dossierId)).objetManuelLe, "écrit à la main : noté");
    await service.enregistrerProjet(await espaceDe(c.espaceId), { familles: { SDB: ["plan-vasque"] }, precisions: "" });
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    assert.equal((await dossierDe(c.dossierId)).objet, "Cuisine de la maison de Sète");
  });

  test("objetDepuisProjet : une famille et 1 à 3 prestations nommées ; au-delà ou plusieurs familles, le format d'avant", async () => {
    const { objetDepuisProjet } = await import("@/lib/dossiers/objet");
    assert.equal(objetDepuisProjet({ familles: { SDB: ["meuble-vasque"] } }), "Recouvrement de salle de bains : meuble vasque");
    assert.equal(objetDepuisProjet({ familles: { MEUBLES: ["meuble-tv", "autre-meuble"] } }), "Recouvrement de mobilier : meuble TV", "« Autre meuble » ne nomme rien ; « TV » garde ses capitales");
    assert.equal(objetDepuisProjet({ familles: { MEUBLES: ["autre-meuble"] } }), "Recouvrement de mobilier");
    assert.equal(objetDepuisProjet({ familles: { SDB: [] } }), "Recouvrement de salle de bains");
    assert.equal(objetDepuisProjet({ familles: { CUISINE: ["facades-hautes", "facades-basses", "plan-de-travail", "credence"] } }), "Recouvrement de cuisine");
    assert.equal(objetDepuisProjet({ familles: { CUISINE: ["credence"], MEUBLES: [] } }), "Recouvrement : cuisine, mobilier");
    assert.equal(objetDepuisProjet(null), "");
  });
});

describe("R4 : l'étape du dossier fixe la frontière du devis dans l'espace", () => {
  test("Simulation + devis : pas « Devis à signer » ; Devis envoyé : « Devis à signer » ou « en préparation » ; Signé : paiement", () => {
    const base = { photos: 1, projet: true, simulationsCrm: 0, simulationsSite: 0, choix: true, devis: false, accord: false, acompteRecu: false, etapeDossier: "SIMULATION" };
    assert.equal(etapes.etapeEspace({ ...base, devis: true }), "ATTENTE_DEVIS");
    assert.equal(etapes.etapeEspace({ ...base, choix: false, devis: true }), "SIMULATIONS");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "DEVIS_ENVOYE", devis: true }), "DEVIS");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "RELANCE", devis: true }), "DEVIS");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "DEVIS_ENVOYE" }), "ATTENTE_DEVIS");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "SIGNE", devis: true }), "ACOMPTE");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "SIGNE", devis: true, accord: true, acompteRecu: true }), "CHANTIER");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "EN_PAUSE", devis: true }), "DEVIS", "en pause : l'ordre d'avant");
  });
});

describe("migration qui-a-la-main-14-1", () => {
  test("un dossier resté en Simulation avec un devis déposé est corrigé, l'objet suit le projet validé (sauf écrit à la main) ; rejouée, elle ne change plus rien", async () => {
    // Écrit directement en base, comme avant la règle : devis repris, étape Simulation, « Préparer le devis ».
    const a = await contact("Anatole");
    await prisma.dossier.update({ where: { id: a.dossierId }, data: { etape: "SIMULATION", prochaineAction: "Préparer le devis (simulation choisie)" } });
    const devis = await prisma.document.create({ data: { dossierId: a.dossierId, type: "DEVIS", numero: numeroDirect(), dateEmission: new Date(Date.now() - 2 * JOUR), objet: "Meuble vasque", lignes: "[]", totalHt: 630, statut: "ENVOYE", origine: "REPRISE" } });
    await prisma.dossierEvenement.create({ data: { dossierId: a.dossierId, type: "DOCUMENT_REPRIS", direction: "INTERNE", contenu: `Devis ${devis.numero} du 27/09/2026 rattaché (émis avant le CRM) : 630,00 €`, metadata: JSON.stringify({ documentId: devis.id, numero: devis.numero, origine: "REPRISE" }), survenuLe: devis.dateEmission } });
    await prisma.dossierEvenement.create({ data: { dossierId: a.dossierId, type: "ESPACE_SIMULATION_CHOISIE", direction: "ENTRANT", contenu: "Simulation validée", survenuLe: new Date(Date.now() - 3 * JOUR) } });
    await main.recalculerMain(a.dossierId);

    // Projet validé dans l'espace, objet resté celui du lead ; et un autre dont Lucas a écrit l'objet.
    const b = await contact("Berenice", { typeProjet: "CUISINE" });
    const e = await contact("Edgar", { typeProjet: "CUISINE" });
    for (const x of [b, e]) {
      await prisma.dossier.update({ where: { id: x.dossierId }, data: { prestations: JSON.stringify({ SDB: ["meuble-vasque"] }) } });
      await prisma.espaceClient.update({ where: { id: x.espaceId }, data: { projetValideLe: new Date() } });
    }
    await avecActeur(LUCAS, () => prisma.dossier.update({ where: { id: e.dossierId }, data: { objet: "Salle d'eau de l'étage" } }));

    // Lucas a ramené celui-ci en Simulation (retour en arrière) alors que son devis était émis : il y reste.
    const r = await contact("Rosalie");
    await avecActeur(LUCAS, () =>
      documents.genererDocument(r.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 2, unite: "ml", prixUnitaire: 150 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const transitions = await import("@/lib/dossiers/transitions");
    await avecActeur(LUCAS, () => transitions.changerEtape(r.dossierId, { vers: "SIMULATION" }));
    assert.equal((await dossierDe(r.dossierId)).etape, "SIMULATION");

    // Objet vide rempli par une validation que Lucas a faite depuis le CRM (sa session) : ce n'est pas « à la main ».
    const v = await contact("Victor");
    await prisma.dossier.update({ where: { id: v.dossierId }, data: { objet: "" } });
    await service.enregistrerProjet(await espaceDe(v.espaceId), { familles: { SDB: ["meuble-vasque"] }, precisions: "" });
    const espaceV = await espaceDe(v.espaceId);
    await avecActeur(LUCAS, () => validations.validerProjet(espaceV, "LUCAS"));
    assert.equal((await dossierDe(v.dossierId)).objet, "Recouvrement de salle de bains : meuble vasque");

    const premier = await avecActeur(MIGRATION, () => migration.migrationQuiALaMain14.executer(prisma));
    const da = await dossierDe(a.dossierId);
    assert.deepEqual([da.etape, da.prochaineAction, da.main], ["DEVIS_ENVOYE", "Attendre l'accord du client sur le devis", "CLIENT"]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: a.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(passage.contenu, /Simulation → Devis envoyé : Devis déjà envoyé : rattrapage \(mission 14\)/);
    assert.equal((await dossierDe(b.dossierId)).objet, "Recouvrement de salle de bains : meuble vasque");
    const de = await dossierDe(e.dossierId);
    assert.deepEqual([de.objet, Boolean(de.objetManuelLe)], ["Salle d'eau de l'étage", true]);
    assert.ok(premier.etapesCorrigees >= 1 && premier.actionsCorrigees >= 1 && premier.objetsCorriges >= 1 && premier.objetsManuels >= 1 && premier.retoursGardes >= 1, JSON.stringify(premier));
    assert.equal((await dossierDe(r.dossierId)).etape, "SIMULATION", "le retour en arrière de Lucas est gardé");
    assert.equal((await dossierDe(v.dossierId)).objetManuelLe, null, "l'objet de la famille posé par la validation n'est pas « écrit à la main »");

    const second = await avecActeur(MIGRATION, () => migration.migrationQuiALaMain14.executer(prisma));
    assert.deepEqual([second.etapesCorrigees, second.actionsCorrigees, second.objetsManuels, second.objetsCorriges, second.mainsChangees], [0, 0, 0, 0, 0], JSON.stringify(second));
  });
});
