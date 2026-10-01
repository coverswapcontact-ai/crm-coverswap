import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
const UPLOADS = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-partie-c-"));
process.env.UPLOADS_DIR = UPLOADS;
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — les manques fermés à l'intégration (docs/MCP-COUVERTURE.md, colonne « Test ») : changement
 * d'étape avec paiement (DP13–DP20), encaissement complet et chèque rejeté (T11, DP9, DP75, DP78, F4, F6), devis
 * prérempli d'après l'espace et lignes de section (T10, DP55, DP65, DP67), lien d'espace par mail (DP31, E19),
 * planifier depuis un mail (M21), génération par l'API (S9) et suivi d'une préparation (S3, S10, S11), fichiers
 * (DP58, DP59, DP82, S13, S17, M15, L25, LF22, LF25, X9, X10, DP92), validation (V7, V8), synthèse et mois figés
 * (A24–A28, A30). Pour chaque geste : le même état en base que l'écran (la route de l'écran rejouée sur un jumeau quand
 * elle existe), aperçu et jeton sur tout ce qui est sensible. Base d'essai, noms fictifs, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type Handler = (requete: import("next/server").NextRequest, contexte: { params: Promise<Record<string, string>> }) => Promise<Response>;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let NextRequest: typeof import("next/server").NextRequest;
let sharp: typeof import("sharp");
let session: import("@/lib/assistant/execution").Session;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const AUJOURDHUI = () => new Date().toISOString().slice(0, 10);

const appeler = (nom: string, entree: Record<string, unknown>): Promise<ResultatOutil> => {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session, new Date());
};

/** Aperçu (jeton, rien de fait), puis le même appel avec le jeton. */
async function confirmer(nom: string, entree: Record<string, unknown>, apercu?: RegExp): Promise<{ apercu: ResultatOutil; fait: ResultatOutil }> {
  const premier = await appeler(nom, entree);
  assert.ok(premier.confirmation?.jeton, `aperçu attendu : ${premier.texte}`);
  assert.match(premier.texte, /Rien n'a été fait/);
  if (apercu) assert.match(premier.texte, apercu);
  const fait = await appeler(nom, { ...entree, confirmation: premier.confirmation!.jeton });
  assert.ok(!fait.confirmation, fait.texte);
  assert.doesNotMatch(fait.texte, /^Refusé/, fait.texte);
  return { apercu: premier, fait };
}

/** Le geste de l'écran : la route elle-même, au nom de Lucas. */
async function route(chemin: string, methode: "POST" | "PATCH" | "GET", url: string, corps?: unknown, params: Record<string, string> = {}): Promise<unknown> {
  const handlers = (await import(chemin)) as Record<string, Handler>;
  const requete = new NextRequest(new Request(`http://localhost:3001${url}`, { method: methode, body: corps === undefined ? undefined : JSON.stringify(corps), headers: { "content-type": "application/json" } }));
  const reponse = await avecActeur(LUCAS, () => handlers[methode](requete, { params: Promise.resolve(params) }));
  const lu = await reponse.json().catch(() => null);
  assert.ok(reponse.status < 300, `${methode} ${url} : ${reponse.status} ${JSON.stringify(lu)}`);
  return lu;
}

/** Les écritures métier depuis un instant (journal des modifications), hors mécanique de l'assistant. */
async function ecrituresDepuis(depuis: Date): Promise<string[]> {
  const lignes = await prisma.journalModification.findMany({ where: { horodatage: { gte: depuis }, modele: { notIn: ["AppelOutil", "ConfirmationAssistant", "SessionAssistant"] } }, select: { modele: true } });
  return lignes.map((l) => l.modele);
}

let rang = 0;
async function dossierEssai(nom: string, donnees: Record<string, unknown> = {}) {
  rang++;
  const d = await prisma.dossier.create({ data: { clientNom: `${nom} Essai`, clientAdresse: "3 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: `06130000${String(rang).padStart(2, "0")}`, clientEmail: `${nom.toLowerCase()}@exemple.test`, objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", ...donnees } });
  return d.id;
}
const LIGNES = [{ designation: "Revêtement adhésif — façades", quantite: 4, unite: "ml", prix_unitaire: 100 }];
async function devisEmis(dossierId: string, libelle?: string): Promise<string> {
  const { fait } = await confirmer("generer_document", { dossierId, type: "DEVIS", objet: "Cuisine", lignes: LIGNES, notifier: false, ...(libelle ? { libelle_variante: libelle } : {}) });
  return (fait.donnees as { documentId: string }).documentId;
}
const etatDossier = async (id: string) => {
  const d = await prisma.dossier.findUniqueOrThrow({ where: { id } });
  return { etape: d.etape, motifPerte: d.motifPerte, perteConcurrent: d.perteConcurrent, perteMontantConcurrent: d.perteMontantConcurrent };
};
/** Les paiements d'un dossier (le payeur par défaut est le nom du client, différent d'un jumeau à l'autre : comparé à part). */
const encaissementsDe = async (dossierId: string) => (await prisma.encaissement.findMany({ where: { dossierId }, orderBy: { createdAt: "asc" } })).map((e) => ({ montant: e.montant, moyen: e.moyen, statut: e.statut, reference: e.reference, credite: Boolean(e.crediteLe) }));
const payeursDe = async (dossierId: string) => (await prisma.encaissement.findMany({ where: { dossierId } })).map((e) => e.payeur);

async function image(couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: couleur } }).jpeg().toBuffer();
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
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  NextRequest = (await import("next/server")).NextRequest;
  sharp = (await import("sharp")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai([
    { id: "AA01", nom: "Beige Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/aa01.jpg", tags: ["chêne", "beige"] },
    { id: "AB02", nom: "Cafe Latte", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ab02.jpg", tags: ["couleur", "beige"] },
  ]);
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("changer_etape avec paiement (DP13, DP14, DP16, DP17, DP18, DP20) : la même fonction que la fenêtre de l'écran", () => {
  test("Signé avec le devis accepté (plusieurs devis) et l'acompte reçu, dans la même opération, puis Planifié avec la date du chantier ; jumeau par la route de l'écran", async () => {
    const ecran = await dossierEssai("Signe");
    const outil = await dossierEssai("Signeoutil");
    const [ecranA, ecranB] = [await devisEmis(ecran, "façades seules"), await devisEmis(ecran, "façades + plan")];
    const [outilA, outilB] = [await devisEmis(outil, "façades seules"), await devisEmis(outil, "façades + plan")];
    void ecranA;
    void outilA;
    const acompte = { montant: 120, moyen: "VIREMENT", recuLe: AUJOURDHUI(), reference: "VIR-1" };
    await route("@/app/api/dossiers/[id]/etape/route", "POST", `/api/dossiers/${ecran}/etape`, { vers: "SIGNE", devisAccepteId: ecranB, confirmations: { BON_POUR_ACCORD: true }, acompte }, { id: ecran });
    const { apercu, fait } = await confirmer("changer_etape", { dossierId: outil, vers: "SIGNE", devis_accepte_id: outilB, accord_confirme: true, acompte: { montant: 120, moyen: "VIREMENT", recu_le: AUJOURDHUI(), reference: "VIR-1" } }, /« Signé » : devis accepté .* ; acompte de 120 € par virement/);
    assert.match(fait.texte, /Acompte de 120 € enregistré/);
    void apercu;
    assert.deepEqual(await etatDossier(outil), await etatDossier(ecran));
    assert.deepEqual(await encaissementsDe(outil), await encaissementsDe(ecran));
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: outilB } })).statut, (await prisma.document.findUniqueOrThrow({ where: { id: ecranB } })).statut);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: outilB } })).statut, "ACCEPTE");

    // → Planifié avec la date du chantier (DP19), comme la fenêtre de l'écran.
    const dans = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await route("@/app/api/dossiers/[id]/etape/route", "POST", `/api/dossiers/${ecran}/etape`, { vers: "PLANIFIE", dateChantier: dans }, { id: ecran });
    const planifie = await appeler("changer_etape", { dossierId: outil, vers: "PLANIFIE", date_chantier: dans });
    const confirme = planifie.confirmation ? await appeler("changer_etape", { dossierId: outil, vers: "PLANIFIE", date_chantier: dans, confirmation: planifie.confirmation.jeton }) : planifie;
    assert.match(confirme.texte, /Planifié|planifié/);
    assert.deepEqual(await etatDossier(outil), await etatDossier(ecran));
    const chantier = async (id: string) => (await prisma.dossier.findUniqueOrThrow({ where: { id } })).dateChantier?.toISOString().slice(0, 10);
    assert.equal(await chantier(outil), dans);
    assert.equal(await chantier(outil), await chantier(ecran));
  });

  test("Signé sans acompte (motif), Encaissé avec le solde, jour réel du passage ; Perdu avec le concurrent et son prix", async () => {
    const d = await dossierEssai("Solde");
    await devisEmis(d);
    await confirmer("changer_etape", { dossierId: d, vers: "SIGNE", accord_confirme: true, sans_acompte: { motif: "PAIEMENT_A_LA_FACTURE" } }, /sans acompte \(paiement à la facture/);
    assert.equal((await etatDossier(d)).etape, "SIGNE");
    await prisma.dossier.update({ where: { id: d }, data: { etape: "FACTURE" } });
    await confirmer("generer_document", { dossierId: d, type: "FACTURE", objet: "Cuisine", lignes: LIGNES });
    const hier = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { fait } = await confirmer("changer_etape", { dossierId: d, vers: "ENCAISSE", solde: { montant: 400, moyen: "CHEQUE", recu_le: hier }, survenu_le: hier }, /solde de 400 € par chèque/);
    assert.match(fait.texte, /Solde de 400 € enregistré/);
    assert.equal((await etatDossier(d)).etape, "ENCAISSE");
    assert.deepEqual((await encaissementsDe(d)).map((e) => [e.montant, e.moyen]), [[400, "CHEQUE"]]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: d, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.equal(passage.survenuLe?.toISOString().slice(0, 10), hier);

    const perdu = await dossierEssai("Perdu");
    const ecran = await dossierEssai("Perduecran");
    await route("@/app/api/dossiers/[id]/etape/route", "POST", `/api/dossiers/${ecran}/etape`, { vers: "PERDU", motifPerte: "CONCURRENT", perteConcurrent: "Cuisines du Sud", perteMontantConcurrent: 1800, perteCommentaire: "moins cher" }, { id: ecran });
    await confirmer("changer_etape", { dossierId: perdu, vers: "PERDU", motif_perte: "CONCURRENT", perte_concurrent: "Cuisines du Sud", perte_montant_concurrent: 1800, commentaire: "moins cher" }, /remporté par Cuisines du Sud à 1.800 €/);
    assert.deepEqual(await etatDossier(perdu), await etatDossier(ecran));
    assert.deepEqual((await etatDossier(perdu)).perteConcurrent, "Cuisines du Sud");
  });
});

describe("encaissements (T11, DP9, DP75, F4, DP78, F6)", () => {
  test("saisir_encaissement : pièce réglée, payeur, chèque crédité ; une facture hors CRM (sans dossier) se règle par son numéro", async () => {
    const ecran = await dossierEssai("Piece", { etape: "SIGNE" });
    const outil = await dossierEssai("Pieceoutil", { etape: "SIGNE" });
    const [devisEcran, devisOutil] = [await devisEmis(ecran), await devisEmis(outil)];
    const ligneEcran = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: devisEcran } });
    const ligneOutil = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: devisOutil } });
    await route("@/app/api/dossiers/[id]/encaissements/route", "POST", `/api/dossiers/${ecran}/encaissements`, { paiement: { montant: 120, moyen: "CHEQUE", recuLe: AUJOURDHUI(), crediteLe: AUJOURDHUI(), reference: "CHQ-12" }, numeroDocumentId: ligneEcran.id, payeur: "SCI des Essais" }, { id: ecran });
    await confirmer("saisir_encaissement", { dossierId: outil, montant: 120, moyen: "CHEQUE", recu_le: AUJOURDHUI(), credite_le: AUJOURDHUI(), reference: "CHQ-12", piece: ligneOutil.numero, payeur: "SCI des Essais" }, new RegExp(`imputé sur le devis ${ligneOutil.numero}, payé par SCI des Essais`));
    assert.deepEqual(await encaissementsDe(outil), await encaissementsDe(ecran));
    assert.deepEqual([await payeursDe(outil), await payeursDe(ecran)], [["SCI des Essais"], ["SCI des Essais"]]);
    const affectation = await prisma.affectationEncaissement.findFirstOrThrow({ where: { encaissement: { dossierId: outil } } });
    assert.equal(affectation.numeroDocumentId, ligneOutil.id);

    // Une facture émise hors du CRM, inscrite au registre, sans dossier : réglée par son numéro (F4).
    const hors = await prisma.numeroDocument.create({ data: { cle: "F:2026:901", numero: "F2026-901", famille: "F", annee: 2026, rang: 901, type: "FACTURE", origine: "MANUEL", montant: 250, destinataire: "Client hors CRM", emisLe: new Date() } });
    const { fait } = await confirmer("saisir_encaissement", { montant: 250, moyen: "VIREMENT", recu_le: AUJOURDHUI(), piece: "F2026-901" });
    assert.match(fait.texte, /Encaissement de 250 € enregistré \(F2026-901\)/);
    const e = await prisma.encaissement.findFirstOrThrow({ where: { affectations: { some: { numeroDocumentId: hors.id } } } });
    assert.equal(e.dossierId, null);
  });

  test("annuler_encaissement REJETER : chèque impayé, comme « Chèque rejeté » de l'écran ; un virement ne se rejette pas", async () => {
    const ecran = await dossierEssai("Rejet", { etape: "SIGNE" });
    const outil = await dossierEssai("Rejetoutil", { etape: "SIGNE" });
    const { enregistrerEncaissement } = await import("@/lib/encaissements/service");
    const cheque = async (d: string) => (await avecActeur(LUCAS, () => enregistrerEncaissement({ dossierId: d, paiement: { montant: 80, moyen: "CHEQUE", recuLe: AUJOURDHUI(), reference: null } }))).encaissement.id;
    const [e1, e2] = [await cheque(ecran), await cheque(outil)];
    await route("@/app/api/encaissements/[id]/rejet/route", "POST", `/api/encaissements/${e1}/rejet`, { motif: "SANS_PROVISION", le: AUJOURDHUI() }, { id: e1 });
    await confirmer("annuler_encaissement", { encaissementId: e2, nature: "REJETER", motif: "SANS_PROVISION", le: AUJOURDHUI() }, /Je vais marquer rejeté le chèque de 80 €/);
    const statut = async (id: string) => {
      const e = await prisma.encaissement.findUniqueOrThrow({ where: { id } });
      return [e.statut, e.motifFin, Boolean(e.finLe)];
    };
    assert.deepEqual(await statut(e2), await statut(e1));
    assert.equal((await statut(e2))[0], "REJETE");
    const virement = (await avecActeur(LUCAS, () => enregistrerEncaissement({ dossierId: outil, paiement: { montant: 10, moyen: "VIREMENT", recuLe: AUJOURDHUI(), reference: null } }))).encaissement.id;
    const refus = await appeler("annuler_encaissement", { encaissementId: virement, nature: "REJETER", motif: "SANS_PROVISION", confirmation: (await appeler("annuler_encaissement", { encaissementId: virement, nature: "REJETER", motif: "SANS_PROVISION" })).confirmation!.jeton });
    assert.match(refus.texte, /^Refusé : Seul un chèque se rejette/);
  });
});

describe("generer_document : lignes de section et devis prérempli d'après l'espace (T10, DP55, DP65, DP67)", () => {
  test("une ligne de section se dicte ; le devis prérempli montre ses lignes dans l'aperçu et demande ce qui manque", async () => {
    const d = await dossierEssai("Section");
    const { fait } = await confirmer("generer_document", { dossierId: d, type: "DEVIS", objet: "Cuisine et salle de bain", notifier: false, lignes: [{ section: "Cuisine" }, ...LIGNES, { section: "Salle de bain" }, { designation: "Plan vasque", quantite: 1, unite: "forfait", prix_unitaire: 250 }] }, /\[Cuisine\] ; Revêtement adhésif — façades 4 ml × 100 € ; \[Salle de bain\] ; Plan vasque/);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: (fait.donnees as { documentId: string }).documentId } });
    const lignes = JSON.parse(doc.lignes) as { type: string; libelle?: string }[];
    assert.deepEqual(lignes.map((l) => l.type), ["SECTION", "PRESTATION", "SECTION", "PRESTATION"]);
    assert.equal(doc.totalHt, 650);

    // Prérempli d'après l'espace : le projet du client (famille cuisine, îlot) ; le métré manque → demandé, rien n'est émis.
    const lead = await prisma.lead.create({ data: { prenom: "Prerempli", nom: "Essai", telephone: "0613009999", email: "prerempli@exemple.test", ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
    const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    const { enregistrerPrestations } = await import("@/lib/prestations/dossier");
    const ouvert = await avecActeur(LUCAS, () => ouvrirEspaceDuContact(lead.id));
    await avecActeur(LUCAS, () => enregistrerPrestations(ouvert.dossierId, { CUISINE: ["ilot"] }, "LUCAS"));
    const { devisProposeDuDossier } = await import("@/lib/espace/devis-propose");
    const propose = await devisProposeDuDossier(ouvert.dossierId);
    assert.ok(propose && propose.lignes.length >= 1);
    const ecran = (await route("@/app/api/dossiers/[id]/devis-propose/route", "GET", `/api/dossiers/${ouvert.dossierId}/devis-propose`, undefined, { id: ouvert.dossierId })) as { lignes?: unknown[] } | { propose?: { lignes: unknown[] } };
    assert.ok(JSON.stringify(ecran).includes(propose.lignes[0].designation), "mêmes lignes que l'écran");
    const avant = await prisma.document.count({ where: { dossierId: ouvert.dossierId } });
    const r = await appeler("generer_document", { dossierId: ouvert.dossierId, type: "DEVIS", objet: "Cuisine", depuis_espace: true });
    assert.match(r.texte, new RegExp(`Lignes préremplies : ${propose.lignes[0].designation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(r.texte, /quantité ou son prix : demande-les à Lucas/);
    assert.equal(await prisma.document.count({ where: { dossierId: ouvert.dossierId } }), avant, "rien n'est émis");
  });
});

describe("envoyer_lien_espace (DP31, E19) et planifier depuis un mail (M21)", () => {
  test("objet remplacé ; code par défaut selon l'étape de l'espace ; l'aperçu n'ouvre rien", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Lien", nom: "Essai", telephone: "0613001111", email: "lien@exemple.test", ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
    const depuis = new Date();
    const apercu = await appeler("envoyer_lien_espace", { leadId: lead.id, objet: "Votre espace, Monsieur Essai" });
    assert.match(apercu.texte, /le mail « Votre espace, Monsieur Essai » \(LIEN_ESPACE\)/);
    assert.equal(await prisma.dossier.count({ where: { leadId: lead.id } }), 0, "l'aperçu n'ouvre ni dossier ni espace");
    assert.deepEqual(await ecrituresDepuis(depuis), []);
    const fait = await appeler("envoyer_lien_espace", { leadId: lead.id, objet: "Votre espace, Monsieur Essai", confirmation: apercu.confirmation!.jeton });
    assert.match(fait.texte, /envoyé à lien@exemple\.test \(Lien Essai, LIEN_ESPACE\)/);
    const envoi = await prisma.envoiMail.findFirstOrThrow({ where: { a: "lien@exemple.test" } });
    assert.equal(envoi.objet, "Votre espace, Monsieur Essai");
    // Un projet déjà commencé (simulation déposée) : LIEN_ESPACE_RAPPEL, comme l'écran Espaces hors étape « Photos ».
    const dossier = await prisma.dossier.findFirstOrThrow({ where: { leadId: lead.id } });
    const { deposerSimulationDossier } = await import("@/lib/simulations/dossier");
    await avecActeur(LUCAS, async () => deposerSimulationDossier(dossier.id, new File([new Uint8Array(await image({ r: 9, g: 9, b: 9 }))], "s.jpg", { type: "image/jpeg" }), { titre: "Essai", source: "MANUEL" }));
    const rappel = await appeler("envoyer_lien_espace", { dossierId: dossier.id });
    assert.match(rappel.texte, /\(LIEN_ESPACE_RAPPEL\)/);
  });

  test("planifier avec message_id : l'action va sur le lead du mail, comme le bouton « Planifier » de l'écran Mail", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Mail", nom: "Planifie", telephone: "0613002222", ville: "Lattes", source: "AUTRE" } });
    const m = await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "planifie-1", sens: "ENTRANT", de: "mail.planifie@exemple.test", objet: "Dispo jeudi", recuLe: new Date(), statut: "RATTACHE", leadId: lead.id } });
    const r = await appeler("planifier", { message_id: m.id, action: "Rappeler", quand: "jeudi 14h" });
    assert.match(r.texte, /Rappeler pour Mail Planifie/);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(l.rappelLe?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }), "14:00");
    const orphelin = await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "planifie-2", sens: "ENTRANT", de: "inconnu@exemple.test", objet: "?", recuLe: new Date() } });
    assert.match((await appeler("planifier", { message_id: orphelin.id, action: "Rappeler", quand: "jeudi 14h" })).texte, /rattachez-le d'abord/);
  });
});

describe("fichiers : simulation déposée, PDF d'un document repris, PDF joint, pièce de mail, banc, site, lead (DP58, DP59, DP82, S13, S17, M15, L25, LF22, LF25)", () => {
  test("ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation » ; PDF_DOCUMENT : le PDF d'un document repris (sensible) ; voir_fichiers le joint en entier", async () => {
    const d = await dossierEssai("Fichiers");
    const avant = await prisma.simulationEspace.count({ where: { dossierId: d } });
    const sim = await appeler("ajouter_fichier", { cible: { entite: "DOSSIER", id: d }, type: "SIMULATION", titre: "Façades chêne", description: "Rendu ChatGPT", origine_simulation: "CHATGPT", source: { base64: (await image({ r: 120, g: 90, b: 60 })).toString("base64"), nom: "rendu.jpg" } });
    assert.match(sim.texte, /simulation « Façades chêne » déposée en brouillon/);
    const s = await prisma.simulationEspace.findFirstOrThrow({ where: { dossierId: d }, orderBy: { createdAt: "desc" } });
    assert.deepEqual([await prisma.simulationEspace.count({ where: { dossierId: d } }), s.statut, s.titre, s.source], [avant + 1, "BROUILLON", "Façades chêne", "CHATGPT"]);

    const { enregistrerDocumentExistant } = await import("@/lib/dossiers/documents-existants");
    const repris = await avecActeur(LUCAS, () => enregistrerDocumentExistant(d, { type: "DEVIS", numero: "2025-777", montant: 900, dateEmission: "2025-06-01", statut: "ENVOYE", objet: "Cuisine (repris)", inscrireAuRegistre: true } as never));
    const documentId = repris.documentId;
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).pdfPath, null);
    await confirmer("ajouter_fichier", { cible: { entite: "DOSSIER", id: d }, type: "PDF_DOCUMENT", document_id: documentId, source: { base64: PDF.toString("base64"), nom: "devis-777.pdf" } }, /Je vais importer le PDF .* du devis repris 2025-777/);
    assert.ok((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).pdfPath);

    const vu = await appeler("voir_fichiers", { genre: "documents", cible: { entite: "DOSSIER", id: d }, document_id: `document:${documentId}` });
    assert.equal(vu.documents?.length, 1);
    assert.equal(vu.documents![0].mimeType, "application/pdf");
    assert.equal(Buffer.from(vu.documents![0].base64, "base64").subarray(0, 5).toString(), "%PDF-");
    // Le serveur MCP le rend en ressource embarquée.
    const { construireServeur } = await import("@/lib/mcp/serveur");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const [versClient, versServeur] = InMemoryTransport.createLinkedPair();
    const { mcp } = construireServeur(session);
    await mcp.connect(versServeur);
    const client = new Client({ name: "essai", version: "1.0" });
    await client.connect(versClient);
    const r = (await client.callTool({ name: "voir_fichiers", arguments: { genre: "documents", cible: { entite: "DOSSIER", id: d }, document_id: `document:${documentId}` } })) as { content: { type: string; resource?: { mimeType?: string; blob?: string } }[] };
    const ressource = r.content.find((c) => c.type === "resource");
    assert.equal(ressource?.resource?.mimeType, "application/pdf");
    await client.close();
    await mcp.close();
  });

  test("pièce jointe d'un mail (M15), rendu du banc (S17), générations du site en échec (L25)", async () => {
    const { enregistrerFichier } = await import("@/lib/fichiers/stockage");
    const fichier = await enregistrerFichier("messages", new File([new Uint8Array(PDF)], "facture.pdf", { type: "application/pdf" }));
    const m = await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "piece-1", sens: "ENTRANT", de: "fournisseur@exemple.test", objet: "Facture", recuLe: new Date() } });
    const piece = await prisma.pieceMessage.create({ data: { messageId: m.id, rang: 1, nom: "facture.pdf", typeMime: "application/pdf", taille: PDF.length, partie: "1", statut: "CONSERVEE", fichierId: fichier.id } });
    const vu = await appeler("voir_fichiers", { genre: "piece_mail", message_id: m.id, piece: piece.id });
    assert.equal(vu.documents?.[0]?.mimeType, "application/pdf", vu.texte);

    const d = await dossierEssai("Banc");
    const chemin = "banc/cas-essai/v2-planche-1.jpg";
    mkdirSync(path.join(UPLOADS, "banc", "cas-essai"), { recursive: true });
    writeFileSync(path.join(UPLOADS, chemin), await image({ r: 200, g: 180, b: 160 }));
    const rendu = await prisma.renduBanc.create({ data: { campagneId: "c1", cas: "cas-essai", variante: "v2-planche", dossierId: d, photoId: "photo-absente", piece: "cuisine", statut: "PRET", chemin, promptTexte: "Prompt du banc : façades en chêne clair.", score: 82 } });
    const banc = await appeler("voir_fichiers", { genre: "banc", rendu_id: rendu.id });
    assert.match(banc.texte, /Banc — cas cas-essai, variante v2-planche, pret.*contrôle 82\/100/);
    assert.match(banc.texte, /Prompt du banc : façades en chêne clair\./);
    assert.equal(banc.images?.length, 1);

    await prisma.travailSimulation.create({ data: { parcoursId: "p-echec", projet: "cuisine", statut: "ECHEC", erreurRaison: "photo-refusee", erreurMessage: "Photo trop sombre", termineLe: new Date() } });
    const site = await appeler("voir_fichiers", { genre: "site", jours: 7, sans_images: true });
    assert.match(site.texte, /Générations du site sur 7 jours : 0 en cours, 1 en échec :\n- .* — echec : photo-refusee \(Photo trop sombre\)/);
  });

  test("documents d'un lead : PDF de ses simulations du site (LF22) et devis de l'ancien CRM (LF25)", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Ancien", nom: "Crm", telephone: "0613003333", ville: "Lattes", source: "AUTRE" } });
    const simulation = await prisma.simulation.create({ data: { leadId: lead.id, referenceChoisie: "AB02", prixDevis: 1500 } });
    const devis = await prisma.devis.create({ data: { leadId: lead.id, numero: "DEV-2024-001", statut: "ACCEPTE", reference: "K1", expiresAt: new Date("2024-12-31"), mlTotal: 6, prixMatiere: 400, prixVente: 1800, margeNette: 1000, acompte30: 540, solde70: 1260 } });
    const liste = await appeler("voir_fichiers", { genre: "documents", cible: { entite: "LEAD", id: lead.id } });
    assert.match(liste.texte, new RegExp(`PDF avant / après de la simulation .*\\[simulation_pdf:${simulation.id}\\]`));
    assert.match(liste.texte, new RegExp(`Ancien CRM — devis DEV-2024-001, 1.800 € \\(accepte\\).*\\[ancien_devis:${devis.id}\\]`));
    const pdf = await appeler("voir_fichiers", { genre: "documents", cible: { entite: "LEAD", id: lead.id }, document_id: `simulation_pdf:${simulation.id}` });
    assert.equal(pdf.documents?.[0]?.mimeType, "application/pdf", pdf.texte);
    const ancien = await appeler("voir_fichiers", { genre: "documents", cible: { entite: "LEAD", id: lead.id }, document_id: `ancien_devis:${devis.id}` });
    assert.equal(ancien.documents?.[0]?.mimeType, "application/pdf", ancien.texte);
  });
});

describe("simulateur : génération par l'API sous confirmation (S9), suivi d'une préparation (S3, S10, S11)", () => {
  test("mode API : l'aperçu dit le coût et n'écrit rien ; confirmé, la préparation part en file ; voir_fichiers preparations la suit", async () => {
    const d = await dossierEssai("Api", { etape: "SIMULATION" });
    const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
    await avecActeur(LUCAS, async () => ajouterPhoto(d, new File([new Uint8Array(await image({ r: 180, g: 170, b: 160 }))], "avant.jpg", { type: "image/jpeg" }), false));
    const vue = await appeler("voir_fichiers", { genre: "preparations", cible: { entite: "DOSSIER", id: d } });
    assert.match(vue.texte, /Simulateur — Api Essai : type suggéré .* ; 1 photo avant/);
    assert.match(vue.texte, /Aucune préparation récente\./);
    const depuis = new Date();
    const entree = { dossierId: d, mode: "API", teintes: [{ zone: "meubles hauts", teinte: "AB02" }] };
    const apercu = await appeler("preparer_simulation", entree);
    assert.ok(apercu.confirmation, apercu.texte);
    assert.match(apercu.texte, /Coût estimé ≈ \d+,\d\d \$ d'images OpenAI/);
    assert.deepEqual(await ecrituresDepuis(depuis), [], "l'aperçu n'écrit rien");
    assert.equal(await prisma.preparationSimulation.count({ where: { dossierId: d } }), 0);
    const fait = await appeler("preparer_simulation", { ...entree, confirmation: apercu.confirmation.jeton });
    assert.match(fait.texte, /Génération par l'API lancée/);
    const p = await prisma.preparationSimulation.findFirstOrThrow({ where: { dossierId: d } });
    assert.deepEqual([p.mode, p.statut], ["API", "EN_COURS"]);
    const suivi = await appeler("voir_fichiers", { genre: "preparations", preparation_id: p.id, sans_images: true });
    assert.match(suivi.texte, /Génération par l'API du .* — en_cours/);
  });
});

describe("dépense avec son justificatif (X9, X10, DP92)", () => {
  test("creer DEPENSE avec justificatif : comme « Enregistrer la dépense » (formulaire + fichier) ; le même justificatif est refusé, « forcer » passe outre", async () => {
    const d = await dossierEssai("Depense", { etape: "CHANTIER" });
    const { fait } = { fait: await appeler("creer", { entite: "DEPENSE", cible: { dossierId: d }, champs: { montant: 64.9, fournisseur: "Leroy Merlin", categorie: "FOURNITURES", payee_le: AUJOURDHUI(), justificatif: { base64: PDF.toString("base64"), nom: "ticket.pdf" } } }) };
    assert.match(fait.texte, /Dépense enregistrée : 64,9 € chez Leroy Merlin .*rattachée au chantier .*Justificatif attaché\./);
    const depense = await prisma.depense.findFirstOrThrow({ where: { fournisseur: "Leroy Merlin", dossierId: d } });
    assert.ok(depense.justificatifId);
    const doublon = await appeler("creer", { entite: "DEPENSE", champs: { montant: 64.9, fournisseur: "Leroy Merlin", categorie: "FOURNITURES", hors_chantier: true, justificatif: { base64: PDF.toString("base64"), nom: "ticket.pdf" } } });
    assert.match(doublon.texte, /^Refusé : Ce justificatif est déjà attaché à la dépense/);
    const force = await appeler("creer", { entite: "DEPENSE", champs: { montant: 64.9, fournisseur: "Leroy Merlin", categorie: "FOURNITURES", hors_chantier: true, forcer: true, justificatif: { base64: PDF.toString("base64"), nom: "ticket.pdf" } } });
    assert.match(force.texte, /Dépense enregistrée/);
  });
});

describe("validation : réessayer une exécution en échec (V7), tout valider en lot (V8)", () => {
  test("en_lot : seules les propositions validables en lot passent (comme « Tout valider »), la sensible reste ; reessayer relance une exécution en échec", async () => {
    const d = await dossierEssai("Valide");
    const { proposer } = await import("@/lib/validation/service");
    const agent = { acteur: "AGENT:mail" };
    const note1 = await avecActeur(agent, () => proposer({ type: "NOTE_DOSSIER", titre: "Note 1", contenu: { dossierId: d, texte: "Une" }, dossierId: d }));
    const note2 = await avecActeur(agent, () => proposer({ type: "NOTE_DOSSIER", titre: "Note 2", contenu: { dossierId: d, texte: "Deux" }, dossierId: d }));
    const mail = await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance à valider", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "valide@exemple.test", objet: "Votre devis", texte: "Bonjour", documentIds: [] }), dossierId: d } });
    const lot = await appeler("valider_proposition", { propositionIds: [note1.id, note2.id, mail.id], en_lot: true });
    assert.match(lot.texte, /2 propositions validées en lot\./);
    assert.match(lot.texte, new RegExp(`Laissées \\(à valider une par une\\) : ${mail.id}`));
    const statuts = await prisma.proposition.findMany({ where: { id: { in: [note1.id, note2.id, mail.id] } }, select: { id: true, statut: true } });
    assert.deepEqual(Object.fromEntries(statuts.map((p) => [p.id, p.statut])), { [note1.id]: "EXECUTEE", [note2.id]: "EXECUTEE", [mail.id]: "EN_ATTENTE" });

    // Une exécution en échec (envoi tombé) : « Réessayer » la remet en file.
    const echec = await prisma.proposition.create({ data: { type: "NOTE_DOSSIER", auteur: "AGENT:mail", titre: "Note en échec", contenu: JSON.stringify({ dossierId: d, texte: "Trois" }), dossierId: d, statut: "ECHEC", erreurExecution: "base occupée", decidePar: "HUMAIN:lucas@coverswap.fr", decideLe: new Date() } });
    const { mettreEnFile } = await import("@/lib/taches/file");
    await mettreEnFile({ type: "EXECUTION_PROPOSITION", cle: `proposition:${echec.id}`, charge: { propositionId: echec.id } });
    await prisma.tache.update({ where: { cle: `proposition:${echec.id}` }, data: { statut: "ECHEC_DEFINITIF", derniereErreur: "base occupée" } });
    const r = await appeler("valider_proposition", { propositionIds: [echec.id], reessayer: true });
    assert.match(r.texte, /Relancé : Note en échec/);
    assert.notEqual((await prisma.proposition.findUniqueOrThrow({ where: { id: echec.id } })).statut, "ECHEC");
    const pasEnEchec = await appeler("valider_proposition", { propositionIds: [mail.id], reessayer: true, confirmation: (await appeler("valider_proposition", { propositionIds: [mail.id], reessayer: true })).confirmation?.jeton });
    assert.match(pasEnEchec.texte, /Pas relancé : .*Seule une exécution en échec peut être relancée/);
  });
});

describe("analytique synthese : export, pseudonymes, rédaction, agent et qualité, mois figés (A24–A28, A30)", () => {
  test("la synthèse de la période (chiffres clés et version rédigée), en pseudonymes ; la liste des mois figés et un mois figé", async () => {
    const r = await appeler("analytique", { synthese: { anonyme: true }, du: "2026-09-01", au: "2026-09-30" });
    assert.match(r.texte, /^Synthèse .*\(2026-09-01 → 2026-09-30\), pseudonymes :/);
    assert.match(r.texte, /Version rédigée \(l'export texte\) :/);
    const { lireSynthese } = await import("@/lib/synthese/requete");
    const ecran = await lireSynthese("2026-09-01", "2026-09-30", true);
    assert.ok(r.texte.includes(ecran.redaction.split("\n")[0]), "la version rédigée est celle de l'écran");
    assert.deepEqual(Object.keys((r.donnees as Record<string, unknown>)).sort(), ["alertes", "references", "synthese"]);
    assert.ok(r.liens?.some((l) => l.href.endsWith("/api/synthese/export?du=2026-09-01&au=2026-09-30&anonyme=1")));
    const { figerMoisEcoules } = await import("@/lib/synthese/instantanes");
    const { figes } = await figerMoisEcoules(new Date("2026-10-02T10:00:00Z"));
    const liste = await appeler("analytique", { synthese: { mois_figes: true } });
    if (figes.length === 0) {
      assert.match(liste.texte, /mois figé|Aucun mois figé/);
      return;
    }
    assert.match(liste.texte, new RegExp(`${figes[0]} \\(figé le`));
    const mois = await appeler("analytique", { synthese: { mois_fige: figes[0] } });
    assert.match(mois.texte, new RegExp(`^Mois figé ${figes[0]} \\(figé le .*, intègre\\)`));
  });
});
