import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m15-4-"));

/**
 * Mission 15 (partie 4) — le site n'est plus qu'un client du CRM : POST /api/simulate reçoit les sélections signées
 * (plus de prompt), relit zones et références, le moteur construit la consigne ; l'ancien corps asynchrone reste
 * accepté, le contrat synchrone est retiré ; la photo HEIC est convertie par POST /api/simulate/photo ; les vignettes
 * du catalogue se lisent par GET /api/site/echantillons/<ref> ; l'entonnoir du simulateur se calcule depuis les
 * événements. OpenAI et le décodeur HEIC sont SIMULÉS : aucun appel réseau, aucune image générée. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/simulate/route");
let routePhoto: typeof import("@/app/api/simulate/photo/route");
let routeEchantillons: typeof import("@/app/api/site/echantillons/[ref]/route");
let contrat: typeof import("@/lib/site/contrat-simulate");
let conversion: typeof import("@/lib/site/conversion-photo");
let evenements: typeof import("@/lib/site/evenements");
let generation: typeof import("@/lib/simulations/generation");
let analyses: typeof import("@/lib/simulateur/analyses");
let executeur: typeof import("@/lib/taches/executeur");
let routesPubliques: typeof import("@/lib/acces/routes-publiques");
let sharp: typeof import("sharp");

const SECRET = "secret-partage-des-essais-4";
const CATALOGUE = [
  { id: "NE31", nom: "Chêne clair", famille: "bois", categorie: "Wood", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ne31.jpg", tags: ["chêne"] },
  { id: "AB02", nom: "Creamy", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ab02.jpg", tags: ["crème"], hex: "#EDE6D6" },
  { id: "D1", nom: "Classic Walnut", famille: "bois", categorie: "Dark", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/d1.jpg", tags: ["noyer"] },
];
let PHOTO_DATA_URL: string;
let PHOTO_JPEG: Buffer;
let RENDU_JPEG: Buffer;
let appels: import("@/lib/simulations/generation").EntreeGeneration[] = [];

let numeroParcours = 0;
const parcours = () => `cccccccc-1504-4000-8000-${String(++numeroParcours).padStart(12, "0")}`;
const requete = (chemin: string, corps: unknown, ip = "203.0.113.4") => new NextRequest(`http://localhost${chemin}`, { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json", "x-forwarded-for": ip } });

type Selection = { surface: string; ref: string };
function corpsSelections(parcoursId: string, selections: Selection[], extra: Record<string, unknown> = {}, projet = "cuisine") {
  const exp = Date.now() + 60_000;
  const sig = contrat.signatureSelections(SECRET, { parcoursId, projet, selections, exp });
  return { asynchrone: true, projet, selections, sig, exp, parcoursId, photo_base64: PHOTO_DATA_URL, page: "/simulateur", source: "instagram", campagne: null, ...extra };
}
const travailDe = (id: string) => prisma.travailSimulation.findUniqueOrThrow({ where: { id } });
/** Le corps n'est lu que si le statut n'est pas celui attendu (un corps lu deux fois est « unusable »). */
async function exigerStatut(reponse: Response, attendu: number): Promise<void> {
  if (reponse.status !== attendu) assert.fail(`HTTP ${reponse.status} au lieu de ${attendu} : ${await reponse.text()}`);
}
async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg({ quality: 80 }).toBuffer();
}
async function viderLaFile() {
  await executeur.attendreTachesLongues();
  await prisma.tache.updateMany({ where: { statut: "EN_ATTENTE" }, data: { statut: "ANNULEE", termineLe: new Date() } });
}

before(async () => {
  process.env.SIMULATE_TOKEN_SECRET = SECRET;
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  route = await import("@/app/api/simulate/route");
  routePhoto = await import("@/app/api/simulate/photo/route");
  routeEchantillons = await import("@/app/api/site/echantillons/[ref]/route");
  contrat = await import("@/lib/site/contrat-simulate");
  conversion = await import("@/lib/site/conversion-photo");
  evenements = await import("@/lib/site/evenements");
  generation = await import("@/lib/simulations/generation");
  analyses = await import("@/lib/simulateur/analyses");
  executeur = await import("@/lib/taches/executeur");
  routesPubliques = await import("@/lib/acces/routes-publiques");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/taches/traitements")).enregistrerTousLesTraitements();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(CATALOGUE);
  // Échantillons déjà en cache : aucun appel au stockage de Cover Styl'.
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "NE31.jpg"), await image(640, 640, { r: 201, g: 178, b: 143 }));
  await fs.writeFile(path.join(dossier, "AB02.jpg"), await image(640, 640, { r: 237, g: 230, b: 214 }));
  await fs.writeFile(path.join(dossier, "D1.jpg"), await image(640, 640, { r: 107, g: 74, b: 50 }));
  PHOTO_JPEG = await image(1200, 900, { r: 120, g: 110, b: 100 });
  PHOTO_DATA_URL = `data:image/jpeg;base64,${PHOTO_JPEG.toString("base64")}`;
  RENDU_JPEG = await image(1536, 1024, { r: 90, g: 80, b: 70 });
  generation.definirGenerateurEssai(async (entree) => {
    appels.push(entree);
    return { ok: true, image: RENDU_JPEG, type: "image/jpeg", avant: null, taille: "1536x1024", dureeMs: 1500, usage: { texte: 100, image: 200, sortie: 300 }, coutDollars: 0.21, generationId: null };
  });
});

after(async () => {
  generation.definirGenerateurEssai(null);
  conversion.definirDecodeurHeicEssai(null);
  await prisma.$disconnect();
});

describe("POST /api/simulate — le site, simple client (sélections signées)", () => {
  test("chaîne signée : une ligne par élément, dans l'ordre reçu, préfixée v2", () => {
    const chaine = contrat.chaineSigneeSelections({ parcoursId: "p", projet: "cuisine", selections: [{ surface: "credence", ref: "NE31" }, { surface: "meubles-bas", ref: "D1" }], exp: 42 });
    assert.equal(chaine, "v2\np\ncuisine\ncredence:NE31,meubles-bas:D1\n42");
    const sig = contrat.signatureSelections("s", { parcoursId: "p", projet: "cuisine", selections: [], exp: 1 });
    assert.ok(contrat.signatureValide("s", sig, sig));
    assert.equal(contrat.signatureValide("s", "zz", sig), false);
    assert.equal(contrat.signatureValide("s", "", sig), false);
  });

  test("sélections signées → 202 ; zones et références relues par le CRM (libellé de la source unique, nom du catalogue), pas de prompt ; la tâche génère avec la consigne du moteur et les échantillons du cache", async () => {
    await viderLaFile();
    appels = [];
    const p = parcours();
    const reponse = await route.POST(requete("/api/simulate", corpsSelections(p, [{ surface: "credence", ref: "NE31" }, { surface: "meubles-bas", ref: "D1" }])));
    await exigerStatut(reponse, 202);
    const { travailId, attenteEstimeeS } = (await reponse.json()) as { travailId: string; attenteEstimeeS: number };
    assert.ok(travailId && attenteEstimeeS >= 15);
    const t = await travailDe(travailId);
    assert.equal(t.promptTexte, null, "aucun prompt du site");
    assert.equal(t.swatchUrls, "[]");
    assert.deepEqual(JSON.parse(t.references), [
      { zone: "credence", libelle: "Crédence", ref: "NE31", nom: "Chêne clair" },
      { zone: "meubles-bas", libelle: "Meubles bas", ref: "D1", nom: "Classic Walnut" },
    ]);
    assert.deepEqual([t.projet, t.page, t.source, t.statut], ["cuisine", "/simulateur", "instagram", "EN_ATTENTE"]);
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    const fini = await travailDe(travailId);
    assert.equal(fini.statut, "PRETE");
    assert.equal(fini.moteur, "V1");
    assert.equal(appels.length, 1);
    assert.ok(appels[0].prompt && appels[0].prompt.length > 200, "la consigne est construite par le CRM");
    assert.match(appels[0].prompt, /KITCHEN BACKSPLASH|BASE UNITS/);
    assert.equal(appels[0].swatches?.length, 2, "deux films distincts, lus dans le cache");
    assert.equal(appels[0].swatchUrls?.length ?? 0, 0, "rien à télécharger");
    assert.ok(fini.promptTexte && fini.promptTexte.length > 200, "le prompt donné au modèle est gardé sur le travail");
  });

  test("refus avant tout coût : signature d'un autre contenu, zone hors pièce, cinq zones, zones incompatibles, référence inconnue, sélections illisibles, pièce inconnue, expiration, contrat synchrone", async () => {
    appels = [];
    const p = parcours();
    const lire = async (corps: unknown) => {
      const r = await route.POST(requete("/api/simulate", corps));
      return { status: r.status, ...((await r.json()) as { reason?: string; error?: string }) };
    };
    // Signée pour une autre référence : 401.
    const falsifie = corpsSelections(p, [{ surface: "credence", ref: "NE31" }]);
    falsifie.selections = [{ surface: "credence", ref: "D1" }];
    assert.deepEqual([(await lire(falsifie)).status, (await lire(falsifie)).reason], [401, "bad-signature"]);
    // L'ancienne chaîne (prompt) ne signe pas des sélections.
    const exp = Date.now() + 60_000;
    const ancienneSig = crypto.createHmac("sha256", SECRET).update(`PROMPT\n\n${exp}\np:${p}`).digest("hex");
    assert.equal((await lire({ asynchrone: true, projet: "cuisine", selections: [{ surface: "credence", ref: "NE31" }], sig: ancienneSig, exp, parcoursId: p, photo_base64: PHOTO_DATA_URL })).status, 401);
    const zone = await lire(corpsSelections(p, [{ surface: "plan-vasque", ref: "NE31" }]));
    assert.deepEqual([zone.status, zone.reason], [400, "zone-inconnue"]);
    const cinq = await lire(corpsSelections(p, [{ surface: "meubles-hauts", ref: "NE31" }, { surface: "meubles-bas", ref: "NE31" }, { surface: "plan-de-travail", ref: "NE31" }, { surface: "credence", ref: "NE31" }, { surface: "facades-cuisine", ref: "NE31" }]));
    assert.deepEqual([cinq.status, cinq.reason], [400, "trop-de-zones"]);
    const incompatibles = await lire(corpsSelections(p, [{ surface: "facades-cuisine", ref: "NE31" }, { surface: "meubles-hauts", ref: "AB02" }]));
    assert.deepEqual([incompatibles.status, incompatibles.reason], [400, "surfaces-incompatibles"]);
    assert.match(incompatibles.error ?? "", /couvrent les mêmes meubles/);
    const inconnue = await lire(corpsSelections(p, [{ surface: "credence", ref: "ZZZ99" }]));
    assert.deepEqual([inconnue.status, inconnue.reason], [400, "reference-inconnue"]);
    const vide = await lire(corpsSelections(p, []));
    assert.deepEqual([vide.status, vide.reason], [400, "aucune-zone"]);
    const illisible = await lire({ ...corpsSelections(p, [{ surface: "credence", ref: "NE31" }]), selections: [{ surface: 12 }] });
    assert.deepEqual([illisible.status, illisible.reason], [400, "bad-request"]);
    const piece = await lire(corpsSelections(p, [{ surface: "credence", ref: "NE31" }], {}, "garage"));
    assert.deepEqual([piece.status, piece.reason], [400, "projet"]);
    const expire = await lire({ ...corpsSelections(p, [{ surface: "credence", ref: "NE31" }]), exp: Date.now() - 1 });
    assert.deepEqual([expire.status, expire.reason], [401, "expired"]);
    // Le contrat synchrone d'avant la partie 1 n'existe plus.
    const synchrone = await lire({ ...corpsSelections(p, [{ surface: "credence", ref: "NE31" }]), asynchrone: undefined });
    assert.deepEqual([synchrone.status, synchrone.reason], [400, "contrat"]);
    assert.equal(appels.length, 0, "rien n'a été généré");
    assert.equal(await prisma.travailSimulation.count({ where: { parcoursId: p } }), 0, "aucun travail créé");
  });

  test("ancien corps asynchrone (prompt signé) : encore accepté le temps du déploiement du site, prompt gardé tel quel", async () => {
    await viderLaFile();
    const p = parcours();
    const exp = Date.now() + 60_000;
    const prompt = "TASK: TEXTURE REPLACEMENT (prompt signé de l'ancien site)";
    const swatchUrls = [CATALOGUE[0].image];
    const sig = crypto.createHmac("sha256", SECRET).update(`${prompt}\n${swatchUrls.join(",")}\n${exp}\np:${p}`).digest("hex");
    const reponse = await route.POST(requete("/api/simulate", { asynchrone: true, prompt, swatchUrls, sig, exp, parcoursId: p, projet: "cuisine", references: [{ zone: "credence", libelle: "Crédence", ref: "NE31", nom: "Chêne clair" }], photo_base64: PHOTO_DATA_URL }));
    await exigerStatut(reponse, 202);
    const { travailId } = (await reponse.json()) as { travailId: string };
    const t = await travailDe(travailId);
    assert.equal(t.promptTexte, prompt);
    assert.deepEqual(JSON.parse(t.swatchUrls), swatchUrls);
  });

  test("zone choisie que l'analyse connue de la photo ne voit pas → 409 « zone-non-visible » avec la liste, rien de créé", async () => {
    const p = parcours();
    const empreinte = analyses.empreintePhoto(PHOTO_JPEG);
    const analyse = { description: "A kitchen.", zones_visibles: { "meubles-hauts": { visible: true, description: "left" }, "meubles-bas": { visible: true, description: "under" }, "plan-de-travail": { visible: true, description: "top" }, credence: { visible: false, description: "" } }, objets: ["a kettle"], lumiere: { source: "window", direction: "left", temperature: "neutral", dominante: "none" }, format: "paysage", qualite_photo: { verdict: "bonne", conseil: "" } };
    await prisma.analysePhoto.upsert({ where: { empreinte }, create: { empreinte, piece: "cuisine", parcoursId: p, statut: "PRETE", json: JSON.stringify(analyse) }, update: { piece: "cuisine", statut: "PRETE", json: JSON.stringify(analyse), archiveLe: null } });
    const refus = await route.POST(requete("/api/simulate", corpsSelections(p, [{ surface: "credence", ref: "NE31" }, { surface: "meubles-bas", ref: "D1" }])));
    assert.equal(refus.status, 409);
    const corps = (await refus.json()) as { reason: string; zones: string[]; error: string };
    assert.deepEqual([corps.reason, corps.zones], ["zone-non-visible", ["credence"]]);
    assert.match(corps.error, /Crédence/);
    assert.equal(await prisma.travailSimulation.count({ where: { parcoursId: p } }), 0);
    // Les zones visibles passent.
    assert.equal((await route.POST(requete("/api/simulate", corpsSelections(p, [{ surface: "meubles-bas", ref: "D1" }])))).status, 202);
    // Rien ne se supprime : l'analyse d'essai est archivée (elle ne compte plus comme « connue »).
    await prisma.analysePhoto.update({ where: { empreinte }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
    await viderLaFile();
  });
});

describe("POST /api/simulate/photo — la photo préparée par le CRM", () => {
  const multipart = (parcoursId: string | null, fichier: Blob | null, nom = "photo.jpg", options: { ip?: string; origin?: string } = {}) => {
    const formulaire = new FormData();
    if (parcoursId) formulaire.set("parcoursId", parcoursId);
    if (fichier) formulaire.set("photo", fichier, nom);
    const headers: Record<string, string> = { "x-forwarded-for": options.ip ?? "203.0.113.44" };
    if (options.origin) headers.origin = options.origin;
    return new NextRequest("http://localhost/api/simulate/photo", { method: "POST", body: formulaire, headers });
  };

  test("un JPEG lisible : orienté, réduit à 1600 px, rendu en data URL JPEG ; convertie = false", async () => {
    const grande = await image(2400, 1800, { r: 50, g: 60, b: 70 });
    const reponse = await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(grande)], { type: "image/jpeg" })));
    await exigerStatut(reponse, 200);
    const corps = (await reponse.json()) as { ok: boolean; photo_base64: string; largeur: number; hauteur: number; convertie: boolean };
    assert.deepEqual([corps.ok, corps.largeur, corps.hauteur, corps.convertie], [true, 1600, 1200, false]);
    assert.match(corps.photo_base64, /^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(corps.photo_base64.split(",")[1], "base64")).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [1600, 1200, "jpeg"]);
  });

  test("un HEIC (boîte ftyp) est décodé en pixels bruts (RGBA) passés à sharp, puis la même réduction ; convertie = true ; un HEIC indécodable → 400 « format »", async () => {
    const enteteHeic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(120, 1)]);
    assert.ok(conversion.estHeic(enteteHeic));
    assert.ok(conversion.estHeic(Buffer.alloc(200, 1), "IMG_0001.HEIC"));
    assert.equal(conversion.estHeic(PHOTO_JPEG, "photo.jpg", "image/jpeg"), false);
    let decodages = 0;
    conversion.definirDecodeurHeicEssai(async () => {
      decodages++;
      // Ce que heic-decode rend : largeur, hauteur, pixels RGBA — aucun JPEG intermédiaire.
      const { data, info } = await sharp(await image(3000, 2000, { r: 10, g: 20, b: 30 })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { largeur: info.width, hauteur: info.height, data };
    });
    const reponse = await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(enteteHeic)], { type: "image/heic" }), "IMG_0001.HEIC"));
    await exigerStatut(reponse, 200);
    const corps = (await reponse.json()) as { largeur: number; hauteur: number; convertie: boolean };
    assert.deepEqual([corps.largeur, corps.hauteur, corps.convertie, decodages], [1600, 1067, true, 1]);
    conversion.definirDecodeurHeicEssai(async () => {
      throw new Error("format non reconnu");
    });
    const refus = await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(enteteHeic)], { type: "image/heic" }), "IMG_0002.HEIC"));
    assert.equal(refus.status, 400);
    assert.equal(((await refus.json()) as { reason: string }).reason, "format");
    conversion.definirDecodeurHeicEssai(null);
  });

  test("refus : origine étrangère 403, parcours manquant 400, photo manquante 400, plus de 25 Mo 400 « trop-lourde », octets illisibles 400 « illisible »", async () => {
    assert.equal((await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(PHOTO_JPEG)]), "p.jpg", { origin: "https://pirate.example" }))).status, 403);
    assert.equal((await routePhoto.POST(multipart(null, new Blob([new Uint8Array(PHOTO_JPEG)])))).status, 400);
    assert.equal((await routePhoto.POST(multipart(parcours(), null))).status, 400);
    const lourde = await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(conversion.POIDS_MAX_PHOTO + 1)], { type: "image/jpeg" })));
    assert.deepEqual([lourde.status, ((await lourde.json()) as { reason: string }).reason], [400, "trop-lourde"]);
    const illisible = await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(Buffer.alloc(500, 7))], { type: "image/jpeg" })));
    assert.deepEqual([illisible.status, ((await illisible.json()) as { reason: string }).reason], [400, "illisible"]);
  });

  test("limite : 20 conversions par adresse et par 10 min, puis 429", async () => {
    const ip = "203.0.113.99";
    for (let i = 0; i < 20; i++) assert.equal((await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(PHOTO_JPEG)], { type: "image/jpeg" }), "p.jpg", { ip }))).status, 200, `conversion ${i + 1}`);
    assert.equal((await routePhoto.POST(multipart(parcours(), new Blob([new Uint8Array(PHOTO_JPEG)], { type: "image/jpeg" }), "p.jpg", { ip }))).status, 429);
  });

  test("plafond global : plusieurs adresses ne dépassent pas la limite du site ; les conversions se font une à la fois", async () => {
    const t = Date.now();
    const limites = { parIp: 5, global: 2 };
    assert.equal(conversion.conversionRefusee("10.0.0.1", t, limites, "essai-conv"), null);
    assert.equal(conversion.conversionRefusee("10.0.0.2", t, limites, "essai-conv"), null);
    assert.equal(conversion.conversionRefusee("10.0.0.3", t, limites, "essai-conv"), "global");
    assert.equal(conversion.conversionRefusee("10.0.0.3", t + 11 * 60_000, limites, "essai-conv"), null, "la fenêtre glisse");
    assert.deepEqual(conversion.LIMITE_CONVERSIONS, { parIp: 20, global: 60 });
    // Sérialisation : la seconde conversion ne commence qu'après la fin de la première.
    const ordre: string[] = [];
    conversion.definirDecodeurHeicEssai(async () => {
      ordre.push("debut");
      await new Promise((r) => setTimeout(r, 30));
      ordre.push("fin");
      const { data, info } = await sharp(await image(200, 100, { r: 1, g: 2, b: 3 })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { largeur: info.width, hauteur: info.height, data };
    });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(120, 1)]);
    const [a, b] = await Promise.all([conversion.preparerPhotoSite(heic, "a.heic"), conversion.preparerPhotoSite(heic, "b.heic")]);
    conversion.definirDecodeurHeicEssai(null);
    assert.deepEqual([a.ok, b.ok], [true, true]);
    assert.deepEqual(ordre, ["debut", "fin", "debut", "fin"]);
  });
});

describe("GET /api/site/echantillons/<ref> — vignettes pour le simulateur public", () => {
  const lire = (ref: string, l?: string) => routeEchantillons.GET(new NextRequest(`http://localhost/api/site/echantillons/${ref}${l ? `?l=${l}` : ""}`), { params: Promise.resolve({ ref }) });

  test("l'échantillon entier, puis la vignette de 320 px (cache public d'une semaine), depuis le cache du volume", async () => {
    const entier = await lire("NE31");
    assert.equal(entier.status, 200);
    assert.equal(entier.headers.get("content-type"), "image/jpeg");
    assert.match(entier.headers.get("cache-control") ?? "", /public, max-age=604800/);
    assert.equal((await sharp(Buffer.from(await entier.arrayBuffer())).metadata()).width, 640);
    const vignette = await lire("NE31", "320");
    assert.equal(vignette.status, 200);
    const meta = await sharp(Buffer.from(await vignette.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [320, 320]);
    assert.ok((await fs.stat(path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons", "v320", "NE31.jpg"))).size > 0, "vignette gardée sur le volume");
  });

  test("référence inconnue → 404 ; référence mal formée → 400 ; rien d'autre n'est lisible", async () => {
    assert.equal((await lire("ZZZ99")).status, 404);
    assert.equal((await lire("..%2Fcatalogue.json")).status, 400);
    assert.equal((await lire("a".repeat(30))).status, 400);
  });

  test("routes publiques : la photo (exacte) et les échantillons (préfixe) ; /api/simulate/autre reste protégée", () => {
    assert.ok(routesPubliques.estRoutePublique("/api/simulate/photo"));
    assert.ok(routesPubliques.estRoutePublique("/api/site/echantillons/NE31"));
    assert.equal(routesPubliques.estRoutePublique("/api/simulate/autre"), false);
    assert.equal(routesPubliques.estRoutePublique("/api/site/echantillons"), false);
  });
});

describe("événements du site — l'entonnoir du simulateur", () => {
  test("nouveaux types acceptés ; entonnoir emboîté avec les abandons ; les anciens noms comptent encore", () => {
    for (const type of ["PIECE_CHOISIE", "PHOTO_CHARGEE", "GENERATION_LANCEE", "RESULTAT_VU"]) assert.ok(evenements.estTypeEvenementSite(type), type);
    const e = (parcoursId: string, type: string) => ({ parcoursId, type });
    const entonnoir = evenements.calculerEntonnoir([
      e("a", "PIECE_CHOISIE"), e("a", "PHOTO_CHARGEE"), e("a", "GENERATION_LANCEE"), e("a", "RESULTAT_VU"), e("a", "DEVIS_DEMANDE"),
      e("b", "PIECE_CHOISIE"), e("b", "PHOTO_CHARGEE"), e("b", "GENERATION_LANCEE"),
      e("c", "PIECE_CHOISIE"),
      // Ancien site : anciens noms.
      e("d", "PIECE_CHOISIE"), e("d", "SIMULATION_PHOTO"), e("d", "SIMULATION_LANCEE"), e("d", "SIMULATION_RESULTAT"),
      // Une demande de devis sans pièce choisie n'entre pas dans l'entonnoir du simulateur.
      e("z", "DEVIS_DEMANDE"), e("z", "RESULTAT_VU"),
    ]);
    assert.deepEqual(entonnoir.etapes.map((x) => [x.cle, x.parcours, x.abandons]), [
      ["piece", 4, null],
      ["photo", 3, 1],
      ["generation", 3, 0],
      ["resultat", 2, 1],
      ["contact", 1, 1],
    ]);
  });

  test("entonnoirSite lit la base sur la période ; la synthèse compte GENERATION_LANCEE et RESULTAT_VU comme les anciens", async () => {
    const jour = new Date().toISOString().slice(0, 10);
    const p = parcours();
    for (const type of ["PIECE_CHOISIE", "PHOTO_CHARGEE", "GENERATION_LANCEE", "RESULTAT_VU"] as const) await evenements.enregistrerEvenementSite({ parcoursId: p, type, page: "/simulateur", source: "meta" });
    const entonnoir = await evenements.entonnoirSite(7);
    assert.ok(entonnoir.etapes.find((x) => x.cle === "resultat")!.parcours >= 1);
    // Les anciens noms (site d'avant la partie 4) sont rangés sous les nouveaux : une seule ligne par étape.
    const ancien = parcours();
    for (const type of ["SIMULATION_PHOTO", "SIMULATION_LANCEE", "SIMULATION_RESULTAT"] as const) await evenements.enregistrerEvenementSite({ parcoursId: ancien, type, page: "/simulateur", source: "meta" });
    const s = await evenements.syntheseSite(jour, jour);
    const generations = s.parType.find((l) => l.cle === "GENERATION_LANCEE");
    const resultats = s.parType.find((l) => l.cle === "RESULTAT_VU");
    assert.ok((generations?.valeur ?? 0) >= 2 && (resultats?.valeur ?? 0) >= 2, "anciens et nouveaux additionnés");
    assert.equal(s.parType.some((l) => ["SIMULATION_PHOTO", "SIMULATION_LANCEE", "SIMULATION_RESULTAT"].includes(l.cle)), false, "plus de ligne à l'ancien nom");
    assert.equal(s.tauxCompletionSimulateur !== null && s.tauxCompletionSimulateur > 0, true);
    assert.ok(s.parSource.find((l) => l.cle === "meta")!.simulations >= 2, "GENERATION_LANCEE et SIMULATION_LANCEE comptées par source");
    // La phrase « Site : … » de la synthèse rédigée lit les nouveaux noms (elle annonçait 0 depuis le renommage).
    const calcul = await import("@/lib/synthese/calcul");
    const references = await import("@/lib/synthese/references");
    const redaction = await import("@/lib/synthese/redaction");
    const synthese = await calcul.calculerSynthese(jour, jour);
    const texte = redaction.redigerSynthese(synthese, await references.referencesDe(synthese, true));
    assert.match(texte, new RegExp(`Site : .*, ${generations!.valeur} simulations lancées, ${resultats!.valeur} résultats vus`));
  });
});
