import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m15-2-"));

/**
 * Mission 15 (partie 2) — le moteur de prompt branché sur le CRM : analyse de la photo (vision simulée) mise en cache
 * par empreinte et réutilisée, zone non visible refusée (409) avant de dépenser, contrôle du rendu sous le seuil →
 * seconde tentative avec le défaut rappelé et la meilleure gardée, budget IA dépassé → analyse sautée, V1 inchangé,
 * `repererTypeSurface` ramené au type du CRM, bibliothèque migrée. OpenAI est SIMULÉ (générateur et vision injectés) :
 * aucun appel réseau, aucune image générée. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/simulate/route");
let routeAnalyse: typeof import("@/app/api/simulate/analyse/route");
let routeZones: typeof import("@/app/api/site/simulateur/route");
let generation: typeof import("@/lib/simulations/generation");
let vision: typeof import("@/lib/simulateur/moteur/vision");
let analyses: typeof import("@/lib/simulateur/analyses");
let analysePhoto: typeof import("@/lib/simulateur/moteur/analyse-photo");
let executeur: typeof import("@/lib/taches/executeur");
let preparation: typeof import("@/lib/simulateur/preparation");
let assistant: typeof import("@/lib/simulateur/preparation-assistant");
let bibliotheque: typeof import("@/lib/simulateur/bibliotheque");
let migration: typeof import("@/lib/base/migrations/mission-15-partie-2");
let planche: typeof import("@/lib/simulateur/moteur/planche");
let sharp: typeof import("sharp");

const SECRET = "secret-partage-des-essais-2";
const REFERENCES_CATALOGUE = [
  { id: "AB02", nom: "Creamy", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ab02.jpg", tags: ["crème"], hex: "#EDE6D6" },
  { id: "D1", nom: "Classic Walnut", famille: "bois", categorie: "Dark", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/d1.jpg", tags: ["noyer"] },
  { id: "MK15", nom: "Raw Travertine", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/mk15.jpg", tags: ["pierre"] },
];
const SWATCHES = REFERENCES_CATALOGUE.map((r) => r.image);
const REFERENCES = [
  { zone: "meubles-hauts", libelle: "Meubles hauts", ref: "AB02", nom: "Creamy" },
  { zone: "meubles-bas", libelle: "Meubles bas", ref: "D1", nom: "Classic Walnut" },
  { zone: "plan-de-travail", libelle: "Plan de travail", ref: "MK15", nom: "Raw Travertine" },
];
const PROMPT_SITE = "TASK: TEXTURE REPLACEMENT ON A REAL PHOTOGRAPH (prompt signé du site, essai)";

let PHOTO_JPEG: Buffer;
let PHOTO_DATA_URL: string;
let RENDU_JPEG: Buffer;

const ANALYSE_JSON = {
  description: "A narrow galley kitchen seen from the doorway: black matt fronts on both sides, a walnut-look worktop and a window at the far end.",
  zones_visibles: { "meubles-hauts": { visible: true, description: "upper units on the left" }, "meubles-bas": { visible: true, description: "base units under the worktop" }, "plan-de-travail": { visible: true, description: "walnut-look worktop" }, credence: { visible: false, description: "" } },
  objets: ["a kettle", "a fruit bowl", "the stainless hood"],
  lumiere: { source: "daylight from the far window", direction: "from behind the units", temperature: "neutral", dominante: "none" },
  format: "paysage",
  qualite_photo: { verdict: "bonne", conseil: "" },
};

let appelsVision: { schema: string; images: number; texte: string }[] = [];
let scoresControle: number[] = [];
let appelsGenerateur: import("@/lib/simulations/generation").EntreeGeneration[] = [];

function signer(exp: number, parcoursId: string, prompt = PROMPT_SITE, swatchUrls = SWATCHES): string {
  return crypto.createHmac("sha256", SECRET).update(`${prompt}\n${swatchUrls.join(",")}\n${exp}\np:${parcoursId}`).digest("hex");
}
let numeroParcours = 0;
const parcours = () => `bbbbbbbb-1502-4000-8000-${String(++numeroParcours).padStart(12, "0")}`;
const requete = (chemin: string, corps: unknown, ip = "203.0.113.2", methode = "POST") => new NextRequest(`http://localhost${chemin}`, { method: methode, body: JSON.stringify(corps), headers: { "content-type": "application/json", "x-forwarded-for": ip } });
function corpsValide(parcoursId: string, extra: Record<string, unknown> = {}) {
  const exp = Date.now() + 60_000;
  return { prompt: PROMPT_SITE, swatchUrls: SWATCHES, sig: signer(exp, parcoursId), exp, parcoursId, projet: "cuisine", references: REFERENCES, page: "/simulateur", photo_base64: PHOTO_DATA_URL, asynchrone: true, ...extra };
}
const travailDe = (id: string) => prisma.travailSimulation.findUniqueOrThrow({ where: { id } });
let horlogeParametres = Date.now() - 3_600_000;
/** Une ligne de Parametre ne se modifie jamais : chaque valeur est une ligne datée, la plus récente l'emporte. */
async function poserParametre(cle: string, valeur: string | number) {
  horlogeParametres += 1000;
  await prisma.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: new Date(horlogeParametres) } });
}
const DEFAUTS: Record<string, string | number> = { SIMULATEUR_MOTEUR: "V1", SIMULATEUR_PLANCHE: "OUI", IA_BUDGET_MENSUEL: 1000 };
async function retirerParametre(cle: string) {
  await poserParametre(cle, DEFAUTS[cle]);
}
async function viderLaFile() {
  await executeur.attendreTachesLongues();
  await prisma.tache.updateMany({ where: { statut: "EN_ATTENTE" }, data: { statut: "ANNULEE", termineLe: new Date() } });
}
async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg({ quality: 80 }).toBuffer();
}

before(async () => {
  process.env.SIMULATE_TOKEN_SECRET = SECRET;
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[cle];
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  route = await import("@/app/api/simulate/route");
  routeAnalyse = await import("@/app/api/simulate/analyse/route");
  routeZones = await import("@/app/api/site/simulateur/route");
  generation = await import("@/lib/simulations/generation");
  vision = await import("@/lib/simulateur/moteur/vision");
  analyses = await import("@/lib/simulateur/analyses");
  analysePhoto = await import("@/lib/simulateur/moteur/analyse-photo");
  executeur = await import("@/lib/taches/executeur");
  preparation = await import("@/lib/simulateur/preparation");
  assistant = await import("@/lib/simulateur/preparation-assistant");
  bibliotheque = await import("@/lib/simulateur/bibliotheque");
  migration = await import("@/lib/base/migrations/mission-15-partie-2");
  planche = await import("@/lib/simulateur/moteur/planche");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/taches/traitements")).enregistrerTousLesTraitements();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES_CATALOGUE);
  // Échantillons déjà en cache : aucun appel au stockage de Cover Styl'.
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "AB02.jpg"), await image(200, 200, { r: 237, g: 230, b: 214 }));
  await fs.writeFile(path.join(dossier, "D1.jpg"), await image(200, 200, { r: 107, g: 74, b: 50 }));
  await fs.writeFile(path.join(dossier, "MK15.jpg"), await image(200, 200, { r: 201, g: 187, b: 166 }));
  PHOTO_JPEG = await image(1200, 900, { r: 120, g: 110, b: 100 });
  PHOTO_DATA_URL = `data:image/jpeg;base64,${PHOTO_JPEG.toString("base64")}`;
  RENDU_JPEG = await image(1536, 1024, { r: 90, g: 80, b: 70 });

  generation.definirGenerateurEssai(async (entree) => {
    appelsGenerateur.push(entree);
    return { ok: true, image: RENDU_JPEG, type: "image/jpeg", avant: null, taille: "1536x1024", dureeMs: 1500, usage: { texte: 100, image: 200, sortie: 300 }, coutDollars: 0.21, generationId: null };
  });
  vision.definirVisionEssai(async (demande) => {
    appelsVision.push({ schema: demande.schema.nom, images: demande.images.length, texte: demande.texte });
    if (demande.schema.nom === "analyse_photo") return { texte: JSON.stringify(ANALYSE_JSON), jetonsEntree: 1200, jetonsSortie: 300 };
    const score = scoresControle.shift() ?? 9;
    return { texte: JSON.stringify({ score, defauts: score < 7 ? [{ type: "objet-disparu", detail: "the kettle disappeared from the worktop" }] : [] }), jetonsEntree: 1500, jetonsSortie: 80 };
  });
});
beforeEach(() => {
  appelsVision = [];
  appelsGenerateur = [];
  scoresControle = [];
});
after(async () => {
  generation.definirGenerateurEssai(null);
  vision.definirVisionEssai(null);
  await prisma.$disconnect();
});

describe("bibliothèque ChatGPT : migration vers le moteur studio (avant toute pose par défaut)", () => {
  test("une version « Moteur studio » posée sur un prompt jamais modifié, un prompt modifié par Lucas laissé tel quel ; rejouable", async () => {
    const { promptsParDefautGeneres } = await import("@/lib/simulateur/moteur/generer-prompts");
    const ANCIEN = `Image 1 is a photo of my client's kitchen. Image 2 is a reference board. ${"x".repeat(250)} [zone:comptoir-habillage] {{teinte}} {{etiquette}} [/zone] [zone:comptoir-plateau] {{teinte}} {{etiquette}} [/zone]`;
    // Les prompts sont déjà posés (démarrage) avec le texte du moteur. Un prompt « d'avant » : sa version en service est
    // l'ancien texte, signé CoverSwap ; un prompt que Lucas a modifié : une version de sa main.
    await bibliotheque.poserPromptsParDefaut();
    const bar0 = await prisma.promptSimulation.findUniqueOrThrow({ where: { typeSurface: "bar" }, include: { versions: true } });
    await prisma.promptSimulationVersion.create({ data: { promptId: bar0.id, numero: bar0.versions.length + 1, texte: ANCIEN, note: "Version d'origine : bar ou comptoir (ancienne).", auteur: "CoverSwap (version d'origine)" } });
    await prisma.promptSimulation.update({ where: { id: bar0.id }, data: { versionCourante: bar0.versions.length + 1 } });
    await bibliotheque.enregistrerVersion("meuble-tv", { texte: `${promptsParDefautGeneres()["meuble-tv"].texte}\nRetouche de Lucas.`, note: "Ma retouche" });
    const bilan = await migration.poserVersionsStudio(prisma);
    assert.deepEqual(bilan, { posees: 1, laissees: 1 }, "les huit autres, déjà au texte du moteur, ne sont pas touchés");
    const bar = await bibliotheque.lirePrompt("bar");
    assert.equal(bar.texte, promptsParDefautGeneres().bar.texte, "le texte du moteur est en service");
    assert.deepEqual([bar.versionCourante, bar.versions[0].note, bar.versions[1].note], [bar0.versions.length + 2, promptsParDefautGeneres().bar.note, "Version d'origine : bar ou comptoir (ancienne)."], "l'ancienne version reste dans l'historique");
    const tv = await bibliotheque.lirePrompt("meuble-tv");
    assert.equal(tv.versions[0].note, "Ma retouche", "modifié par Lucas : laissé tel quel");
    assert.deepEqual(await migration.poserVersionsStudio(prisma), { posees: 0, laissees: 1 }, "rejouable");
  });
});

describe("analyse de la photo : cache par empreinte, route publique, budget", () => {
  test("obtenirAnalyse : un seul appel vision pour la même photo, compté dans GenerationImage (phase analyse) et AppelIa", async () => {
    const premiere = await analyses.obtenirAnalyse(PHOTO_JPEG, "cuisine");
    assert.equal(premiere.statut, "PRETE");
    assert.equal(premiere.analyse?.description, ANALYSE_JSON.description);
    assert.equal(premiere.analyse?.format, "paysage", "format mesuré sur la photo, pas demandé au modèle");
    assert.deepEqual(appelsVision.map((a) => [a.schema, a.images]), [["analyse_photo", 1]]);
    assert.match(appelsVision[0].texte, /"meubles-hauts"|- meubles-hauts/, "les zones de la pièce sont demandées");
    const seconde = await analyses.obtenirAnalyse(PHOTO_JPEG, "cuisine");
    assert.equal(seconde.statut, "PRETE");
    assert.equal(appelsVision.length, 1, "réutilisée : aucun second appel");
    const ligne = await prisma.generationImage.findFirstOrThrow({ where: { phase: "analyse" }, orderBy: { createdAt: "desc" } });
    assert.deepEqual([ligne.modele, ligne.statut, ligne.jetonsTexte, ligne.jetonsSortie], ["gpt-4.1-mini", "REUSSI", 1200, 300]);
    assert.ok(ligne.coutDollars && ligne.coutDollars > 0 && ligne.coutDollars < 0.01);
    const appel = await prisma.appelIa.findFirstOrThrow({ where: { usage: "VISION_ANALYSE_PHOTO" } });
    assert.ok(appel.coutEuros! > 0 && appel.coutEuros! < ligne.coutDollars!, "le budget IA (euros) reçoit la dépense vision");
    assert.equal((await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: premiere.empreinte } })).piece, "cuisine");
  });

  test("POST /api/simulate/analyse → 202 + tâche ANALYSE_PHOTO ; GET ?e=&p= → PRETE avec l'analyse ; autre parcours → 404 ; 10 par jour et par adresse", async () => {
    await viderLaFile();
    const p = parcours();
    const autrePhoto = await image(1000, 750, { r: 30, g: 40, b: 50 });
    const dataUrl = `data:image/jpeg;base64,${autrePhoto.toString("base64")}`;
    const ip = "203.0.113.20";
    const reponse = await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: dataUrl }, ip));
    assert.equal(reponse.status, 202);
    const corps = (await reponse.json()) as { ok: boolean; empreinte: string; statut: string };
    assert.deepEqual([corps.ok, corps.statut, corps.empreinte], [true, "EN_COURS", analyses.empreintePhoto(autrePhoto)]);
    const ligne = await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: corps.empreinte } });
    assert.deepEqual([ligne.statut, ligne.parcoursId, ligne.piece], ["EN_COURS", p, "cuisine"]);
    assert.ok(ligne.photoPath && existsSync(path.join(process.env.UPLOADS_DIR!, ligne.photoPath)), "la photo attend sur le volume");
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: `analyse-photo:${corps.empreinte}` } })).type, "ANALYSE_PHOTO");
    const enCours = await routeAnalyse.GET(new NextRequest(`http://localhost/api/simulate/analyse?e=${corps.empreinte}&p=${p}`));
    assert.equal(((await enCours.json()) as { statut: string }).statut, "EN_COURS");
    assert.equal((await routeAnalyse.GET(new NextRequest(`http://localhost/api/simulate/analyse?e=${corps.empreinte}&p=${parcours()}`))).status, 404, "un autre parcours ne voit rien");

    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    assert.equal(appelsVision.length, 1);
    const prete = (await (await routeAnalyse.GET(new NextRequest(`http://localhost/api/simulate/analyse?e=${corps.empreinte}&p=${p}`))).json()) as { statut: string; analyse: { objets: string[] } | null };
    assert.equal(prete.statut, "PRETE");
    assert.deepEqual(prete.analyse?.objets, ANALYSE_JSON.objets);
    assert.equal((await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: corps.empreinte } })).photoPath, null, "photo effacée après l'analyse");
    assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, ligne.photoPath!)), false);
    // L'appel vision lancé par le site est compté au site (ventilation du compteur par origine).
    assert.equal((await prisma.generationImage.findFirstOrThrow({ where: { phase: "analyse" }, orderBy: { createdAt: "desc" } })).origine, "SITE");
    // La même photo redemandée : prête tout de suite (200), sans tâche ni appel.
    const deja = await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: dataUrl }, ip));
    assert.equal(deja.status, 200);
    assert.equal(((await deja.json()) as { statut: string }).statut, "PRETE");
    assert.equal(appelsVision.length, 1);
    // Limite : 10 analyses par adresse et par jour, comptées SEULEMENT quand une analyse est mise en file (une faite ici :
    // la relecture de la même photo n'a rien coûté). Neuf photos de plus → 202 ; la onzième → 429.
    const nouvellePhoto = async (i: number) => `data:image/jpeg;base64,${(await image(300 + i, 200, { r: i, g: 0, b: 0 })).toString("base64")}`;
    for (let i = 0; i < 9; i++) assert.equal((await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: await nouvellePhoto(i) }, ip))).status, 202, `analyse ${i + 2}`);
    const refus = await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: await nouvellePhoto(20) }, ip));
    assert.equal(refus.status, 429);
    assert.equal(((await refus.json()) as { reason: string }).reason, "ip-quota");
    // À quota atteint : une analyse déjà prête répond encore 200, une photo refusée 400 (aucune des deux ne consomme).
    assert.equal((await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: dataUrl }, ip))).status, 200);
    const refusee = await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "cuisine", photo_base64: "data:image/jpeg;base64,AAAA" }, ip));
    assert.deepEqual([refusee.status, ((await refusee.json()) as { reason: string }).reason], [400, "photo-refusee"]);
    assert.equal((await routeAnalyse.POST(requete("/api/simulate/analyse", { parcoursId: p, projet: "garage", photo_base64: dataUrl }, ip))).status, 400, "pièce inconnue : 400, pas 429");
    assert.equal((await routeAnalyse.POST(new NextRequest("http://localhost/api/simulate/analyse", { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "https://pirate.example" } }))).status, 403);
    await viderLaFile();
  });

  test("plafond global : 400 analyses par jour pour tout le site, puis 429 « global » ; le jour suivant repart de zéro", async () => {
    const { LIMITE_ANALYSES, analyseAutorisee } = await import("@/lib/acces/limite-site");
    const unAutreJour = Date.now() + 3 * 86_400_000;
    for (let i = 0; i < LIMITE_ANALYSES.global; i++) assert.deepEqual(analyseAutorisee(`198.51.100.${i % 200}.${Math.floor(i / 200)}`, unAutreJour), { ok: true }, `analyse ${i + 1}`);
    assert.deepEqual(analyseAutorisee("198.51.100.250", unAutreJour), { ok: false, raison: "global" });
    assert.deepEqual(analyseAutorisee("198.51.100.250", unAutreJour + 86_400_000), { ok: true }, "le lendemain, les compteurs repartent");
    // Retour au jour réel pour la suite (les compteurs par adresse repartent aussi).
    assert.deepEqual(analyseAutorisee("198.51.100.251"), { ok: true });
  });

  test("budget IA du mois dépassé : l'analyse est sautée avec une raison, jamais la génération bloquée ; le site ne lit qu'un code", async () => {
    await poserParametre("IA_BUDGET_MENSUEL", 0.001);
    await prisma.appelIa.create({ data: { usage: "ESSAI", modele: "essai", coutEuros: 0.5, dureeMs: 1, statut: "REUSSI" } });
    try {
      const photo = await image(900, 900, { r: 200, g: 200, b: 200 });
      const resultat = await analysePhoto.analyserPhoto(photo, "cuisine");
      assert.equal(resultat.ok, false);
      assert.equal(!resultat.ok && resultat.raison, "budget");
      assert.equal(appelsVision.length, 0, "aucun appel");
      const p = parcours();
      const etat = await analyses.obtenirAnalyse(photo, "cuisine", { parcoursId: p });
      assert.deepEqual([etat.statut, etat.analyse], ["SAUTEE", null]);
      // Le CRM garde le détail (montant du budget) ; le visiteur ne reçoit que le code « budget ».
      const ligne = await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: etat.empreinte } });
      assert.match(ligne.raison ?? "", /^budget : Budget IA du mois atteint .*€/);
      const suivi = await analyses.suivreAnalyseSite(etat.empreinte, p);
      assert.deepEqual([suivi?.ok && suivi.statut, suivi?.ok && suivi.raison], ["SAUTEE", "budget"]);
      assert.doesNotMatch(JSON.stringify(suivi), /€|OPENAI_API_KEY|Budget IA/);
      assert.equal(analyses.codeRaisonSite("erreur : OpenAI HTTP 500 : {\"error\":…}"), "erreur");
      assert.equal(analyses.codeRaisonSite("cle : OPENAI_API_KEY absente : analyse sautée."), "cle");
      assert.equal(analyses.codeRaisonSite("n'importe quoi"), "erreur");
      assert.equal(analyses.codeRaisonSite(null), null);
    } finally {
      await retirerParametre("IA_BUDGET_MENSUEL");
    }
  });
});

describe("POST /api/simulate : zone non visible et références", () => {
  test("une zone choisie que l'analyse ne voit pas → 409 « zone-non-visible » avec la liste, sans rien consommer ; sinon 202", async () => {
    await analyses.obtenirAnalyse(PHOTO_JPEG, "cuisine");
    const p = parcours();
    const refus = await route.POST(requete("/api/simulate", corpsValide(p, { references: [...REFERENCES, { zone: "credence", libelle: "Crédence", ref: "AB02", nom: "Creamy" }] })));
    assert.equal(refus.status, 409);
    const corps = (await refus.json()) as { reason: string; zones: string[]; error: string };
    assert.deepEqual([corps.reason, corps.zones], ["zone-non-visible", ["credence"]]);
    assert.match(corps.error, /Cette zone n'est pas visible sur votre photo : Crédence/);
    assert.equal(await prisma.travailSimulation.count({ where: { parcoursId: p } }), 0, "rien créé");
    // « Façades (toutes) » est visible si les meubles hauts ou bas le sont.
    const ok = await route.POST(requete("/api/simulate", corpsValide(p, { references: [{ zone: "facades-cuisine", libelle: "Façades (toutes)", ref: "AB02", nom: "Creamy" }] })));
    assert.equal(ok.status, 202);
    await viderLaFile();
  });

  test("références hors des échantillons signés : refusées en V2 seulement (400), après une relecture du catalogue ; catalogue périmé réparé par le site → acceptées", async () => {
    const { definirCatalogueEssai } = await import("@/lib/simulateur/catalogue");
    const exp = Date.now() + 60_000;
    const corpsIncoherent = (p: string) => corpsValide(p, { references: [{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "D1", nom: "Classic Walnut" }], swatchUrls: [SWATCHES[0]], sig: signer(exp, p, PROMPT_SITE, [SWATCHES[0]]), exp });
    // V1 (défaut) : le prompt et les adresses signés suffisent, les références ne sont pas confrontées.
    await viderLaFile();
    assert.equal((await route.POST(requete("/api/simulate", corpsIncoherent(parcours())))).status, 202);
    await viderLaFile();
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const refus = await route.POST(requete("/api/simulate", corpsIncoherent(parcours())));
      assert.equal(refus.status, 400);
      assert.equal(((await refus.json()) as { reason: string }).reason, "references");
      // Le CRM a en cache l'ancienne adresse de D1 (le site l'a renommée à sa réparation hebdomadaire) : le site signe la
      // nouvelle ; le CRM relit son catalogue une fois avant de refuser, et laisse passer.
      const ancien = REFERENCES_CATALOGUE.map((r) => (r.id === "D1" ? { ...r, image: "https://ssi.s3.fr-par.scw.cloud/essai/d1-ancienne-adresse.jpg" } : r));
      definirCatalogueEssai(ancien, { auRechargement: REFERENCES_CATALOGUE });
      const p = parcours();
      const accepte = await route.POST(requete("/api/simulate", corpsValide(p, { references: [{ zone: "meubles-bas", libelle: "Meubles bas", ref: "D1", nom: "Classic Walnut" }] })));
      assert.equal(accepte.status, 202, "catalogue relu : la nouvelle adresse est bien celle signée");
      assert.equal((await prisma.travailSimulation.count({ where: { parcoursId: p } })), 1);
    } finally {
      definirCatalogueEssai(REFERENCES_CATALOGUE);
      await retirerParametre("SIMULATEUR_MOTEUR");
      await viderLaFile();
    }
  });

  test("cinq zones → 400 « trop-de-zones », avant le quota et sans rien créer", async () => {
    const p = parcours();
    const cinq = [{ zone: "facades-cuisine", libelle: "Façades (toutes)", ref: "AB02", nom: "Creamy" }, ...REFERENCES, { zone: "credence", libelle: "Crédence", ref: "AB02", nom: "Creamy" }];
    const refus = await route.POST(requete("/api/simulate", corpsValide(p, { references: cinq })));
    assert.equal(refus.status, 400);
    const corps = (await refus.json()) as { reason: string; error: string };
    assert.equal(corps.reason, "trop-de-zones");
    assert.match(corps.error, /Au plus 4 zones/);
    assert.equal(await prisma.travailSimulation.count({ where: { parcoursId: p } }), 0);
  });

  test("GET /api/site/simulateur : les pièces et zones de la source unique, sans consigne", async () => {
    const corps = (await routeZones.GET().json()) as { version: number; zonesMax: number; pieces: { id: string; zones: { id: string; libelle: string }[] }[] };
    assert.equal(corps.zonesMax, 4);
    assert.deepEqual(corps.pieces.map((p) => p.id), ["cuisine", "salle-de-bain", "meubles", "mur-plafond", "professionnel"]);
    assert.ok(corps.pieces[1].zones.some((z) => z.id === "tablier-baignoire"));
  });
});

describe("génération V2 du site : analyse, planche, contrôle, seconde tentative", () => {
  test("contrôle sous le seuil → seconde tentative avec le défaut dans FINAL CHECK, la meilleure gardée ; tout est relisible sur la SimulationSite", async () => {
    await viderLaFile();
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const p = parcours();
      scoresControle = [5, 9];
      const reponse = await route.POST(requete("/api/simulate", corpsValide(p)));
      assert.equal(reponse.status, 202);
      const { travailId } = (await reponse.json()) as { travailId: string };
      assert.equal((await travailDe(travailId)).photoEmpreinte, analyses.empreintePhoto(PHOTO_JPEG));
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
      const t = await travailDe(travailId);
      assert.deepEqual([t.statut, t.etape, t.moteur, t.erreurRaison], ["PRETE", "rendu", "V2", null]);
      assert.equal(appelsGenerateur.length, 2, "deux tentatives");
      assert.deepEqual(appelsVision.map((a) => a.schema), ["controle_rendu", "controle_rendu"], "l'analyse était déjà en cache ; deux contrôles");
      const [premiere, seconde] = appelsGenerateur;
      assert.ok(premiere.planche && premiere.planche.length > 1000 && !premiere.swatches, "la planche étiquetée est jointe (paramètre OUI)");
      assert.equal(premiere.qualite, "medium", "le site génère en medium");
      assert.match(premiere.prompt, /^ROLE\n/);
      assert.match(premiere.prompt, /THE KITCHEN IN IMAGE 1\nA narrow galley kitchen/, "la description de l'analyse");
      assert.doesNotMatch(premiere.prompt, /In the previous attempt/);
      assert.match(seconde.prompt, /In the previous attempt, the kettle disappeared from the worktop: do not repeat it/);
      const simulation = await prisma.simulationSite.findUniqueOrThrow({ where: { id: t.simulationSiteId! } });
      assert.deepEqual([simulation.moteur, simulation.scoreControle, simulation.tentatives, simulation.promptTexte], ["V2", 9, 2, seconde.prompt], "la meilleure des deux (9) et son prompt");
      assert.match(simulation.directionArtistique ?? "", /Warm timber cabinetry/);
      assert.equal(JSON.parse(simulation.analyse ?? "{}").description, ANALYSE_JSON.description);
      assert.deepEqual(JSON.parse(simulation.defautsControle ?? "[]"), []);
      assert.equal(simulation.photoEmpreinte, analyses.empreintePhoto(PHOTO_JPEG));
      assert.match(simulation.imageAfterPath ?? "", /apres\.jpg$/, "rendu JPEG");
      assert.equal(t.promptTexte, seconde.prompt, "le travail garde le prompt réellement donné au modèle");
      const suivi = (await (await route.GET(new NextRequest(`http://localhost/api/simulate?id=${travailId}&p=${p}`))).json()) as { statut: string; image: string };
      assert.equal(suivi.statut, "PRETE");
      assert.match(suivi.image, /^data:image\/jpeg;base64,/);
      // Les deux contrôles de ce rendu du site sont comptés au site, pas au CRM.
      const controles = await prisma.generationImage.findMany({ where: { phase: "controle" }, orderBy: { createdAt: "desc" }, take: 2, select: { origine: true } });
      assert.deepEqual(controles.map((c) => c.origine), ["SITE", "SITE"]);
      // La planche jointe au modèle porte le libellé de la pièce, pas son identifiant.
      assert.match(premiere.prompt, /Image 2 is the labelled sample board/);
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });

  test("plus assez de temps avant la fin de la tâche : la seconde tentative n'est pas lancée, la première est gardée", async () => {
    const { genererAvecMoteur, BUDGET_SECONDE_TENTATIVE_MS } = await import("@/lib/simulations/pipeline");
    assert.ok(BUDGET_SECONDE_TENTATIVE_MS > 200_000 && BUDGET_SECONDE_TENTATIVE_MS < 300_000, "un rendu (180 s), son contrôle (40 s) et une marge");
    scoresControle = [5, 9];
    const reglages = { moteur: "V2" as const, planche: true, qualiteSite: "medium" as const, qualiteEspace: "high" as const, seuilControle: 7 };
    const resultat = await genererAvecMoteur({ photo: PHOTO_JPEG, piece: "cuisine", zones: [{ zone: "meubles-hauts", ref: "AB02" }], origine: "SITE", reglages, echeance: Date.now() + 30_000 });
    assert.ok(resultat.ok);
    assert.deepEqual([resultat.ok && resultat.tentatives, resultat.ok && resultat.scoreControle, appelsGenerateur.length], [1, 5, 1], "sous le seuil, mais la première est gardée");
    // Avec du temps devant soi, la seconde part.
    scoresControle = [5, 9];
    appelsGenerateur = [];
    const avecTemps = await genererAvecMoteur({ photo: PHOTO_JPEG, piece: "cuisine", zones: [{ zone: "meubles-hauts", ref: "AB02" }], origine: "SITE", reglages, echeance: Date.now() + 480_000 });
    assert.deepEqual([avecTemps.ok && avecTemps.tentatives, avecTemps.ok && avecTemps.scoreControle, appelsGenerateur.length], [2, 9, 2]);
  });

  test("V2 sans planche (paramètre NON) : les échantillons bruts du cache, un par film, « Image 2 » cité ; contrôle bon du premier coup → une seule tentative", async () => {
    await viderLaFile();
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    await poserParametre("SIMULATEUR_PLANCHE", "NON");
    try {
      const p = parcours();
      scoresControle = [8];
      const { travailId } = (await (await route.POST(requete("/api/simulate", corpsValide(p, { references: [{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "AB02", nom: "Creamy" }, { zone: "meubles-bas", libelle: "Meubles bas", ref: "AB02", nom: "Creamy" }] })))).json()) as { travailId: string };
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
      assert.equal(appelsGenerateur.length, 1);
      const [appel] = appelsGenerateur;
      assert.equal(appel.swatches?.length, 1, "un même film sur deux zones : un seul échantillon joint");
      assert.equal(appel.planche, null);
      assert.match(appel.prompt, /Image 2 is a flat, front-lit sample/);
      assert.match(appel.prompt, /- Image 2 \(AB02 — Creamy\) goes on the wall units/);
      const simulation = await prisma.simulationSite.findUniqueOrThrow({ where: { id: (await travailDe(travailId)).simulationSiteId! } });
      assert.deepEqual([simulation.scoreControle, simulation.tentatives], [8, 1]);
      assert.match(simulation.directionArtistique ?? "", /One material, one gesture/);
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
      await retirerParametre("SIMULATEUR_PLANCHE");
    }
  });

  test("V1 (défaut) : le prompt signé du site part tel quel, échantillons par adresse, aucune analyse ni contrôle", async () => {
    await viderLaFile();
    const p = parcours();
    const { travailId } = (await (await route.POST(requete("/api/simulate", corpsValide(p)))).json()) as { travailId: string };
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.moteur, t.promptTexte], ["PRETE", "V1", PROMPT_SITE]);
    assert.equal(appelsGenerateur.length, 1);
    assert.deepEqual([appelsGenerateur[0].prompt, appelsGenerateur[0].swatchUrls, appelsGenerateur[0].planche ?? null, appelsGenerateur[0].swatches ?? null], [PROMPT_SITE, SWATCHES, null, null]);
    assert.equal(appelsVision.length, 0, "ni analyse ni contrôle en V1");
    const simulation = await prisma.simulationSite.findUniqueOrThrow({ where: { id: t.simulationSiteId! } });
    assert.deepEqual([simulation.moteur, simulation.scoreControle, simulation.tentatives, simulation.directionArtistique], ["V1", null, 1, null]);
  });
});

describe("espace client et CRM : le même pipeline", () => {
  async function dossierAvecPhoto(nom: string) {
    const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
    const dossier = await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33611223344", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
    const photo = await ajouterPhoto(dossier.id, new File([new Uint8Array(PHOTO_JPEG)], "cuisine.jpg", { type: "image/jpeg" }));
    return { dossierId: dossier.id, photoId: photo.id };
  }

  test("mode API en V2 : analyse réutilisée depuis la photo du dossier, planche, contrôle ; brouillon avec moteur, score, prompt, direction artistique ; étape écrite", async () => {
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const { dossierId, photoId } = await dossierAvecPhoto("Cuisine Moteur");
      scoresControle = [9];
      const prep = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "cuisine", mode: "API", zones: [{ zone: "meubles-bas", ref: "D1" }, { zone: "plan-de-travail", ref: "MK15" }] });
      assert.deepEqual([prep.statut, prep.moteur, prep.coutEstime], ["EN_COURS", "V2", 0.47], "deux échantillons en high : 1,7 × 0,276");
      assert.match(prep.directionArtistique ?? "", /the worktop is the visual anchor/);
      const { simulationId } = await preparation.executerGenerationApi(prep.id);
      assert.equal(appelsGenerateur.length, 1);
      assert.equal(appelsGenerateur[0].qualite, "high", "le CRM génère en high");
      assert.deepEqual(appelsVision.map((a) => a.schema), ["analyse_photo", "controle_rendu"], "la photo cadrée du dossier est nouvelle : une analyse, puis un contrôle");
      // Les appels vision du CRM sont comptés au CRM (le générateur d'essai, lui, n'écrit pas de ligne « rendu »).
      assert.deepEqual((await prisma.generationImage.findMany({ where: { preparationId: prep.id }, select: { origine: true, phase: true }, orderBy: { createdAt: "asc" } })).map((g) => `${g.phase}:${g.origine}`), ["analyse:CRM", "controle:CRM"]);
      const simulation = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: simulationId! } });
      assert.deepEqual([simulation.source, simulation.statut, simulation.moteur, simulation.scoreControle, simulation.tentatives], ["API", "BROUILLON", "V2", 9, 1]);
      assert.match(simulation.promptTexte ?? "", /^ROLE\n/);
      assert.match(simulation.chemin, /\.jpg$/);
      assert.ok(simulation.coutDollars! > 0.21, "le coût comprend le contrôle");
      const relue = await preparation.lirePreparation(prep.id);
      assert.deepEqual([relue.statut, relue.etape, relue.scoreControle, relue.sousSeuil, relue.tentatives], ["TERMINEE", "rendu", 9, false, 1]);
      assert.equal(relue.prompt, simulation.promptTexte, "le prompt donné au modèle est lisible sur la préparation (ResultatPreparation)");
      // Une seconde préparation sur la même photo réutilise l'analyse.
      appelsVision = [];
      const prep2 = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "credence", mode: "API", zones: [{ zone: "credence", ref: "AB02" }] });
      await preparation.executerGenerationApi(prep2.id);
      assert.deepEqual(appelsVision.map((a) => a.schema), ["controle_rendu"]);
      // Le seuil vient de Paramètres : à 9, un 9/10 n'est pas sous le seuil ; à 8… un 7/10 le serait (pastille ambre).
      await poserParametre("SIMULATEUR_SEUIL_CONTROLE", "9");
      assert.equal((await preparation.lirePreparation(prep.id)).sousSeuil, false);
      await prisma.preparationSimulation.update({ where: { id: prep2.id }, data: { scoreControle: 7 } });
      assert.equal((await preparation.lirePreparation(prep2.id)).sousSeuil, true);
      await poserParametre("SIMULATEUR_SEUIL_CONTROLE", "7");
      assert.equal((await preparation.lirePreparation(prep2.id)).sousSeuil, false);
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });

  test("tâche reprise après un redéploiement (préparation déjà démarrée) : ECHEC « interrompue », OpenAI jamais rappelé", async () => {
    const { dossierId, photoId } = await dossierAvecPhoto("Reprise Coupee");
    const prep = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "credence", mode: "API", zones: [{ zone: "credence", ref: "AB02" }] });
    // La première exécution a posé son étape, puis le processus a été coupé : la tâche est réclamée à nouveau.
    await prisma.preparationSimulation.update({ where: { id: prep.id }, data: { etape: "rendu" } });
    assert.deepEqual(await preparation.executerGenerationApi(prep.id), { simulationId: null });
    const relue = await preparation.lirePreparation(prep.id);
    assert.equal(relue.statut, "ECHEC");
    assert.match(relue.erreur ?? "", /interrompue par une mise à jour/);
    assert.deepEqual([appelsGenerateur.length, appelsVision.length], [0, 0], "rien n'est repayé");
    // Une préparation jamais démarrée passe, elle, normalement.
    const prep2 = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "credence", mode: "API", zones: [{ zone: "credence", ref: "AB02" }] });
    assert.ok((await preparation.executerGenerationApi(prep2.id)).simulationId);
    assert.equal(appelsGenerateur.length, 1);
  });

  test("simulation faite sur le site (V2) → fiche du dossier : prompt, direction artistique et contrôle lisibles, sans espace puis dans l'espace", async () => {
    await viderLaFile();
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const p = parcours();
      // La personne a déjà laissé ses coordonnées pendant ce parcours : la simulation rejoint sa fiche à la fin de la tâche.
      const lead = await prisma.lead.create({ data: { nom: "Fiche", prenom: "Moteur", telephone: "0600001502", email: "fiche.moteur@example.test", ville: "Lattes", source: "SITE_SIMULATEUR", parcoursId: p } });
      scoresControle = [8];
      const { travailId } = (await (await route.POST(requete("/api/simulate", corpsValide(p)))).json()) as { travailId: string };
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
      const t = await travailDe(travailId);
      assert.equal(t.statut, "PRETE");
      const site = await prisma.simulationSite.findUniqueOrThrow({ where: { id: t.simulationSiteId! } });
      assert.deepEqual([site.leadId, site.moteur, site.scoreControle], [lead.id, "V2", 8]);
      assert.ok(site.simulationId && site.promptTexte, "rattachée au contact, prompt gardé");
      // Le dossier ouvert depuis le contact : la simulation y est rangée. Sans espace, elle se montre quand même, avec ses traces.
      const { ouvrirDossierDuLead } = await import("@/lib/dossiers/depuis-lead");
      const { dossierId } = await ouvrirDossierDuLead(lead.id, { motif: "SIMULATION", silencieux: true });
      const { listerSimulationsDossier } = await import("@/lib/simulations/dossier");
      const sansEspace = await listerSimulationsDossier(dossierId);
      assert.equal(sansEspace.espace, null);
      const horsEspace = sansEspace.simulations.find((s) => s.horsEspace)!;
      assert.deepEqual([horsEspace.source, horsEspace.moteur, horsEspace.scoreControle, horsEspace.sousSeuil, horsEspace.tentatives, horsEspace.promptTexte], ["SITE", "V2", 8, false, 1, site.promptTexte]);
      assert.match(horsEspace.directionArtistique ?? "", /Warm timber cabinetry/);
      assert.deepEqual(horsEspace.zones.map((z) => z.ref), ["AB02", "D1", "MK15"]);
      // L'espace ouvert : la SimulationEspace créée porte les mêmes traces (fiche du dossier et `voir_simulations`).
      const { ouvrirEspace } = await import("@/lib/espace/liens");
      await ouvrirEspace(dossierId);
      const avecEspace = await listerSimulationsDossier(dossierId);
      const rangee = avecEspace.simulations.find((s) => s.source === "SITE" && !s.horsEspace)!;
      assert.deepEqual([rangee.statut, rangee.moteur, rangee.scoreControle, rangee.tentatives, rangee.promptTexte, rangee.directionArtistique], ["PUBLIEE", "V2", 8, 1, site.promptTexte, site.directionArtistique]);
      const ligne = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: rangee.id } });
      assert.equal(JSON.parse(ligne.analyse ?? "{}").description, ANALYSE_JSON.description);
      assert.equal(ligne.defautsControle, "[]");
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });

  test("repererTypeSurface : « salle de bain », « mobilier », « pro » → un type du CRM avec un prompt ; les murs sont refusés clairement", async () => {
    await bibliotheque.poserPromptsParDefaut();
    for (const [dit, attendu] of [["salle de bain", "plan-vasque"], ["espace-salle-de-bain", "plan-vasque"], ["mobilier", "dressing"], ["pro", "bar"], ["Cuisine", "cuisine"]] as const) {
      const type = assistant.repererTypeSurface(dit, "CUISINE", []);
      assert.equal(type.id, attendu, dit);
      assert.ok((await bibliotheque.promptCourant(type.id)).texte.length > 200, `prompt trouvé pour ${dit}`);
    }
    assert.equal(assistant.repererTypeSurface("meubles", "MEUBLES", ["meuble-tv"]).id, "meuble-tv", "les zones du projet affinent");
    assert.throws(() => assistant.repererTypeSurface("espace-murs", "CUISINE", []), /murs et le plafond n'ont pas de prompt ChatGPT/);
  });


  test("planche : une tuile par zone, dimensions selon le nombre, PNG", async () => {
    const tuile = await image(200, 200, { r: 100, g: 100, b: 100 });
    const png = await planche.construirePlanche([{ etiquette: "A · Meubles hauts", ref: "AB02", nom: "Creamy", resume: "uni · blanc cassé chaud · mat", image: tuile }, { etiquette: "B · Plan de travail", ref: "MK15", nom: "Raw Travertine", image: tuile }], "CoverSwap · Cuisine");
    const meta = await sharp(png).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", 1600, 1000]);
    assert.deepEqual(planche.dimensionsPlanche(4), { largeur: 1600, hauteur: 1720, cote: 580, parLigne: 2 });
  });
});
