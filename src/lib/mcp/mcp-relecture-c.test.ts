import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-relecture-c-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — relecture adverse : les défauts trouvés après l'intégration du catalogue, un test chacun.
 * - Un jeton de confirmation ne sert qu'une fois, même sur deux appels simultanés.
 * - Un jeton vaut pour CE que l'aperçu a montré : « annuler_modification » sans identifiant (« la dernière ») et
 *   « publier » sans ids (« les brouillons du dossier ») sont refusés si la cible a changé entre-temps.
 * - « noter_appel » PAS_INTERESSE (perte) est sensible, comme « changer_etape » PERDU.
 * - « traiter_mail » RATTACHER à un lead passe par la fonction de service (plus d'écriture brute).
 * - Défaire « rendre un devis visible » le dit : l'envoi et l'étape restent.
 * Base d'essai, noms fictifs, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let session: import("@/lib/assistant/execution").Session;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const appeler = (nom: string, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(catalogue.outilParNom(nom)!, { commande: "relecture adverse", ...entree }, session, new Date());

let rang = 0;
async function dossier(nom: string, donnees: Record<string, unknown> = {}) {
  rang += 1;
  const c = await prisma.client.create({ data: { nom, source: "ENTRANT", premierContactLe: new Date() } });
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `06009${String(rang).padStart(5, "0")}`, objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", montantEstime: 5000, clientId: c.id, ...donnees } });
}
const jpeg = async (r: number) => {
  const sharp = (await import("sharp")).default;
  return new File([new Uint8Array(await sharp({ create: { width: 320, height: 240, channels: 3, background: { r, g: 100, b: 100 } } }).jpeg().toBuffer())], "photo.jpg", { type: "image/jpeg" });
};

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
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "relecture", utilisateur: "essai@local" });
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("le jeton de confirmation", () => {
  test("deux confirmations simultanées avec le même jeton : une seule passe, l'autre est refusée", async () => {
    const d = await dossier("Jeton Double");
    const entree = { entite: "DOSSIER", id: d.id, champs: { montant_estime: 7100 } };
    const apercu = await appeler("modifier", entree);
    const jeton = apercu.confirmation?.jeton;
    assert.ok(jeton, apercu.texte);
    const [a, b] = await Promise.all([appeler("modifier", { ...entree, confirmation: jeton }), appeler("modifier", { ...entree, confirmation: jeton })]);
    const refuses = [a, b].filter((r) => /déjà servi/.test(r.texte));
    assert.equal(refuses.length, 1, `une seule exécution attendue :\n${a.texte}\n---\n${b.texte}`);
    assert.equal(await prisma.appelOutil.count({ where: { outil: "modifier", statut: "FAIT", commande: "relecture adverse", parametres: { contains: d.id } } }), 1);
  });

  test("annuler_modification sans identifiant : le jeton vaut pour la modification de l'aperçu, pas pour une plus récente", async () => {
    const premier = await dossier("Annule Premier");
    const second = await dossier("Annule Second");
    const modifier = async (id: string, montant: number) => {
      const entree = { entite: "DOSSIER", id, champs: { montant_estime: montant } };
      const a = await appeler("modifier", entree);
      return appeler("modifier", { ...entree, confirmation: a.confirmation!.jeton });
    };
    await modifier(premier.id, 6100);
    const apercu = await appeler("annuler_modification", {});
    assert.match(apercu.texte, /Je vais annuler la modification/);
    const jeton = apercu.confirmation?.jeton;
    assert.ok(jeton, apercu.texte);
    // Entre l'aperçu et le « oui » de Lucas, une autre modification sensible devient « la dernière ».
    await modifier(second.id, 9900);
    const refus = await appeler("annuler_modification", { confirmation: jeton });
    assert.match(refus.texte, /^Refusé : Ce que l'action vise a changé depuis l'aperçu/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: second.id } })).montantEstime, 9900, "la modification plus récente n'est pas défaite");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: premier.id } })).montantEstime, 6100);
    assert.equal(await prisma.modificationDossier.count({ where: { dossierId: { in: [premier.id, second.id] }, annuleeLe: { not: null } } }), 0);
    // Un nouvel aperçu montre la bonne, et son jeton passe.
    const nouveau = await appeler("annuler_modification", {});
    const fait = await appeler("annuler_modification", { confirmation: nouveau.confirmation!.jeton });
    assert.match(fait.texte, /Modification annulée chez Annule Second/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: second.id } })).montantEstime, 5000);
  });

  test("publier sans ids (les brouillons du dossier) : une simulation déposée après l'aperçu ne part pas avec le jeton", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Pauline", nom: "Portee", telephone: "0614099901", email: "pauline.portee@exemple.test", ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
    const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    const { dossierId } = await ouvrirEspaceDuContact(lead.id);
    const { deposerSimulationDossier } = await import("@/lib/simulations/dossier");
    const vue = await deposerSimulationDossier(dossierId, await jpeg(90), { titre: "Montrée", source: "MANUEL" });
    const entree = { quoi: "SIMULATION", cible: { dossierId } };
    const apercu = await appeler("publier", entree);
    assert.match(apercu.texte, /Montrée/);
    const tardive = await deposerSimulationDossier(dossierId, await jpeg(30), { titre: "Tardive", source: "MANUEL" });
    const refus = await appeler("publier", { ...entree, confirmation: apercu.confirmation!.jeton });
    assert.match(refus.texte, /^Refusé : Ce que l'action vise a changé/);
    const statuts = await prisma.simulationEspace.findMany({ where: { id: { in: [vue.id, tardive.id] } }, select: { statut: true } });
    assert.deepEqual(statuts.map((s) => s.statut), ["BROUILLON", "BROUILLON"], "rien n'est publié");
  });
});

describe("noter_appel « pas intéressé » : la perte demande confirmation", () => {
  test("sans jeton rien n'est fait ; sans motif, pas d'aperçu ; avec le jeton, le dossier est perdu", async () => {
    const d = await dossier("Appel Perdu");
    const sansMotif = await appeler("noter_appel", { dossierId: d.id, issue: "PAS_INTERESSE" });
    assert.ok(!sansMotif.confirmation);
    assert.match(sansMotif.texte, /exige un motif/);
    const entree = { dossierId: d.id, issue: "PAS_INTERESSE", motif_perte: "PRIX", texte: "Trop cher pour lui" };
    const apercu = await appeler("noter_appel", entree);
    assert.match(apercu.texte, /son dossier passe en « Perdu »/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).etape, "DEVIS_ENVOYE", "rien n'est fait sans jeton");
    const fait = await appeler("noter_appel", { ...entree, confirmation: apercu.confirmation!.jeton });
    assert.doesNotMatch(fait.texte, /^Refusé|a échoué/, fait.texte);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).etape, "PERDU");
  });
});

describe("traiter_mail RATTACHER à un lead : par la fonction de service", () => {
  test("le fil entier rejoint le lead, classé client, à trier", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Lea", nom: "Fil", telephone: "0614099902", ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
    const messages = await Promise.all([1, 2].map((n) => prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: `relecture-fil-${n}`, filCanal: "fil-relecture", sens: "ENTRANT", de: "lea.fil@exemple.test", objet: "Ma cuisine", recuLe: new Date(), dansBoite: true } })));
    const r = await appeler("traiter_mail", { geste: "RATTACHER", messageIds: [messages[0].id], leadId: lead.id });
    assert.match(r.texte, /2 messages rattachés au lead Lea Fil/);
    const relus = await prisma.message.findMany({ where: { filCanal: "fil-relecture" }, select: { leadId: true, classe: true, statut: true } });
    assert.deepEqual(relus.map((m) => [m.leadId, m.classe, m.statut]), [[lead.id, "CLIENT", "A_TRIER"], [lead.id, "CLIENT", "A_TRIER"]]);
    const { rattacherAuLead } = await import("@/lib/mail/rattachement");
    await assert.rejects(rattacherAuLead(messages[0].id, "lead-inconnu"), /Lead introuvable/);
  });
});

describe("annuler « rendre un devis visible » : ce qui reste est dit", () => {
  test("le devis est remasqué, et la réponse dit que l'envoi et l'étape restent", async () => {
    const d = await dossier("Devis Visible", { etape: "SIMULATION" });
    const { enregistrerDocumentExistant } = await import("@/lib/dossiers/documents-existants");
    const repris = (await enregistrerDocumentExistant(d.id, { type: "DEVIS", numero: "2025-871", montant: 900, dateEmission: "2025-05-02", statut: "ENVOYE", objet: "Repris", inscrireAuRegistre: true } as never)) as { documentId?: string; document?: { id: string } };
    const documentId = repris.documentId ?? repris.document!.id;
    await prisma.document.update({ where: { id: documentId }, data: { visibleEspace: false } });
    const entree = { entite: "DOCUMENT", id: documentId, champs: { visible_espace: true } };
    const apercu = await appeler("modifier", entree);
    const fait = await appeler("modifier", { ...entree, confirmation: apercu.confirmation!.jeton });
    const modificationId = (fait.donnees as { modifications: string[] }).modifications[0];
    const annule = await appeler("annuler_modification", { modification_id: modificationId });
    assert.match(annule.texte, /Modification annulée/);
    assert.match(annule.texte, /garde l'étape « Devis envoyé »/);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).visibleEspace, false);
  });
});

describe("instructions du serveur et prompt « point du matin »", () => {
  test("ne citent que des outils du catalogue, et ne disent plus que « supprimer » archive", async () => {
    const { INSTRUCTIONS, TEXTE_POINT_DU_MATIN } = await import("@/lib/mcp/serveur");
    const { OUTILS_RETIRES } = await import("@/lib/assistant/retraits");
    const noms = new Set(catalogue.CATALOGUE.map((o) => o.nom));
    for (const texte of [INSTRUCTIONS, TEXTE_POINT_DU_MATIN]) {
      const cites = [...texte.matchAll(/« ([a-z]+(?:_[a-z]+)+|[a-z]+) »/g)].map((m) => m[1]).filter((n) => /_/.test(n) || noms.has(n) || n in OUTILS_RETIRES);
      assert.deepEqual(cites.filter((n) => !noms.has(n)), [], `noms inconnus du catalogue : ${cites.join(", ")}`);
    }
    assert.doesNotMatch(INSTRUCTIONS, /« supprimer » archive/);
    assert.match(INSTRUCTIONS, /« archiver »/);
  });
});

describe("annuler le prix d'une sous-partie qui n'avait pas de tarif : défait vraiment", () => {
  test("le tarif créé par la modification est retiré ; la sous-partie revient à « aucun tarif »", async () => {
    const tarifs = await import("@/lib/prestations/tarifs");
    const ligne = (await tarifs.tarifsDesPrestations()).find((l) => !l.presetId);
    assert.ok(ligne, "une sous-partie sans tarif");
    const actifs = () => prisma.presetTarif.count({ where: { actif: true } });
    const avant = await actifs();
    const entree = { entite: "SOUS_PARTIE", id: ligne.cle, champs: { prix_unitaire: 55 } };
    const apercu = await appeler("modifier", entree);
    const fait = await appeler("modifier", { ...entree, confirmation: apercu.confirmation!.jeton });
    assert.equal(await actifs(), avant + 1, "la modification crée un tarif");
    const id = (fait.donnees as { modifications: string[] }).modifications[0];
    const apercuAnnulation = await appeler("annuler_modification", { modification_id: id });
    const annule = apercuAnnulation.confirmation ? await appeler("annuler_modification", { modification_id: id, confirmation: apercuAnnulation.confirmation.jeton }) : apercuAnnulation;
    assert.match(annule.texte, /est retiré \(archivé ; « restaurer » TARIF le remet\)/, annule.texte);
    const apres = (await tarifs.tarifsDesPrestations()).find((l) => l.cle === ligne.cle)!;
    assert.deepEqual({ presetId: apres.presetId, prixUnitaire: apres.prixUnitaire }, { presetId: null, prixUnitaire: null }, "plus aucun tarif ne la chiffre");
    assert.equal(await actifs(), avant, "le tarif créé n'est plus actif");
  });
});
