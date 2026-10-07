import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, promises as fs, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 23 (L4a) — la campagne de calibrage (`banc/calibrage.ts`, `scripts/calibrer.ts`) et les variantes du prompt
 * (`moteur/variantes.ts`, `teinte-en-mots.ts`, planche neutre). Générateur d'images et vision SIMULÉS, images
 * SYNTHÉTIQUES faites ici par sharp, dossiers temporaires : aucun appel OpenAI, aucun réseau, aucune photo de client.
 */

let cal: typeof import("./calibrage");
let moteur: typeof import("@/lib/simulateur/moteur");
let mots: typeof import("@/lib/simulateur/moteur/teinte-en-mots");
let essaiLocal: typeof import("@/lib/acces/essai-local");
let prisma: typeof import("@/lib/prisma").default;
let sharp: typeof import("sharp");
const TEMP = mkdtempSync(path.join(tmpdir(), "coverswap-calibrage-"));
const UPLOADS = path.join(TEMP, "uploads");

const CATALOGUE = [
  { id: "RM30", nom: "Pastel Olive Green", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/rm30.jpg", tags: ["couleur"], hex: "#A4A38F" },
  { id: "AA17", nom: "Beige Line Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/essai/aa17.jpg", tags: ["chêne", "beige", "ligné"], hex: "#B1946F" },
  { id: "NE38", nom: "Silver And Grey Lined", famille: "textile", categorie: "Textile", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ne38.jpg", tags: ["textile"], hex: "#A49D93" },
];

const W = 1536;
const H = 1024;
type Rgb = [number, number, number];
/** Une pièce synthétique : mur gris, cadre blanc (le blanc de la scène), sol sombre, une façade de la couleur donnée. */
async function piece(facade: Rgb): Promise<Buffer> {
  const rect = (l: number, h: number, c: Rgb) => sharp({ create: { width: l, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 140, g: 138, b: 135 } } })
    .composite([
      { input: await rect(260, 190, [242, 242, 242]), left: 60, top: 60 },
      { input: await rect(900, 380, facade), left: 360, top: 480 },
      { input: await rect(W, 120, [70, 60, 50]), left: 0, top: H - 120 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

type Appel = { modele?: string; phase?: string; prompt: string; qualite?: string; planche: boolean };
/** Le générateur simulé : la façade repeinte, une ligne GenerationImage comme le vrai (coût donné), les appels gardés. */
function generateurEssai(options: { cout?: number | ((n: number) => number); echecs?: number; rendu?: Rgb } = {}) {
  const appels: Appel[] = [];
  const generateur: import("@/lib/simulations/generation").Generateur = async (e) => {
    appels.push({ modele: e.modele, phase: e.phase, prompt: e.prompt, qualite: e.qualite, planche: !!e.planche });
    const n = appels.length;
    if (n <= (options.echecs ?? 0)) {
      await prisma.generationImage.create({ data: { origine: e.origine, modele: e.modele ?? "?", phase: e.phase ?? "rendu", statut: "ECHEC", erreur: "surcharge : HTTP 502", dureeMs: 5, echantillons: 1 } });
      return { ok: false, dureeMs: 5, status: 502, raison: "surcharge", message: "HTTP 502 simulé" };
    }
    const cout = typeof options.cout === "function" ? options.cout(n) : (options.cout ?? 0.05);
    const ligne = await prisma.generationImage.create({ data: { origine: e.origine, modele: e.modele ?? "?", phase: e.phase ?? "rendu", statut: "REUSSI", dureeMs: 5, echantillons: 1, coutDollars: cout } });
    return { ok: true, image: await piece(options.rendu ?? [166, 176, 149]), type: "image/jpeg", avant: e.photo, taille: "1536x1024", dureeMs: 5, usage: { texte: 1, image: 1, sortie: 1 }, coutDollars: cout, generationId: ligne.id };
  };
  return { generateur, appels };
}

let numeroDossier = 0;
/** Un dossier de calibrage neuf (hors du dépôt) : jeu synthétique de 2 photos, cas.json de 5 cas (4 du banc + 1 « choix »). */
async function dossierCalibrage(): Promise<string> {
  const dossier = path.join(TEMP, `calibrage-${++numeroDossier}`);
  const photos = ["0123456789ab", "ba9876543210"];
  for (const [i, id] of photos.entries()) {
    await fs.mkdir(path.join(dossier, "jeu", "export", id), { recursive: true });
    // Deux photos différentes (empreintes différentes), et différentes d'un dossier à l'autre : chaque essai repart sans analyse.
    await fs.writeFile(path.join(dossier, "jeu", "export", id, "avant.jpg"), await piece([200 + i, 195 + numeroDossier, 185]));
  }
  const cas = {
    version: 1,
    jeu: "jeu/export",
    photos: photos.map((id, i) => ({ id, description: `photo d'essai ${i + 1}`, piece: "cuisine" })),
    teintes: [
      { ref: "RM30", nom: "Pastel Olive Green", role: "olive grisé", hex: "#A4A38F", lab: [66.6, -3.2, 10.5] },
      { ref: "AA17", nom: "Beige Line Oak", role: "bois clair", hex: "#B1946F", lab: [63.1, 5.5, 23.6] },
    ],
    cas: [
      { id: "c01", photo: photos[0], teinte: "RM30", zones: [{ zone: "meubles-bas", ref: "RM30" }], client: true, choix: false },
      { id: "c02", photo: photos[0], teinte: "AA17", zones: [{ zone: "meubles-bas", ref: "AA17" }], client: false, choix: false },
      { id: "c03", photo: photos[1], teinte: "RM30", zones: [{ zone: "facades-cuisine", ref: "RM30" }], client: false, choix: false },
      { id: "c04", photo: photos[1], teinte: "AA17", zones: [{ zone: "facades-cuisine", ref: "AA17" }], client: true, choix: false },
      { id: "x01", photo: photos[1], teinte: null, zones: [{ zone: "facades-cuisine", ref: "NE38" }], client: true, choix: true },
    ],
  };
  await fs.mkdir(path.join(dossier, "banc"), { recursive: true });
  await fs.writeFile(path.join(dossier, "banc", "cas.json"), JSON.stringify(cas, null, 2));
  return dossier;
}

const lignes: string[] = [];
const journal = (l: string) => void lignes.push(l);
const PAYANT = { ...process.env, CALIBRAGE_23_PAYANT: "1" };
const lancer = (argv: string[], dependances: import("./calibrage").DependancesCalibrage = {}) => cal.executerCalibrage([...argv, "--uploads", UPLOADS], { journal, env: PAYANT, ...dependances });
const ligneCalibrage = () => prisma.generationImage.findMany({ where: { phase: "calibrage-23" }, orderBy: { createdAt: "asc" } });

before(async () => {
  process.env.TACHES_DESACTIVEES = "1";
  process.env.OPENAI_API_KEY = "";
  process.env.UPLOADS_DIR = UPLOADS;
  cal = await import("./calibrage");
  moteur = await import("@/lib/simulateur/moteur");
  mots = await import("@/lib/simulateur/moteur/teinte-en-mots");
  essaiLocal = await import("@/lib/acces/essai-local");
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  await fs.mkdir(path.join(UPLOADS, "simulateur", "echantillons"), { recursive: true });
  await fs.writeFile(path.join(UPLOADS, "simulateur", "catalogue.json"), JSON.stringify(CATALOGUE));
  for (const r of CATALOGUE) {
    const [R, G, B] = [1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16));
    await fs.writeFile(path.join(UPLOADS, "simulateur", "echantillons", `${r.id}.jpg`), await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: R, g: G, b: B } } }).jpeg().toBuffer());
  }
  // La vision simulée : une analyse valide, un contrôle 9/10, quelques jetons (coût minuscule, noté).
  (await import("@/lib/simulateur/moteur/vision")).definirVisionEssai(async (demande) => ({
    texte: JSON.stringify(
      demande.schema.nom === "analyse_photo"
        ? { description: "Test mode kitchen.", zones_visibles: {}, objets: [], lumiere: { source: "daylight", direction: "from the left", temperature: "neutral", dominante: "none" }, format: "paysage", qualite_photo: { verdict: "bonne", conseil: "" } }
        : { score: 9, defauts: [] }
    ),
    jetonsEntree: 1000,
    jetonsSortie: 100,
  }));
});
beforeEach(() => {
  lignes.length = 0;
});
after(async () => {
  (await import("@/lib/simulateur/moteur/vision")).definirVisionEssai(null);
  rmSync(TEMP, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("options, base et modèle : les gardes avant tout appel", () => {
  test("gpt-image-1 refusé ; sunburst par défaut ; plafond 4,50 $ au plus ; dossier refusé dans le dépôt", () => {
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P1", "--modele", "gpt-image-1"]), /exclu/);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P1", "--modele", "gpt-image-1-mini"]), /exclu/);
    assert.equal(cal.lireOptionsCalibrage(["--phase", "P1"]).modele, "gpt-image-2.5-sunburst");
    assert.equal(cal.lireOptionsCalibrage(["--phase", "p2"]).phase, "P2");
    assert.equal(cal.lireOptionsCalibrage(["--phase", "P1"]).plafond, 4.5);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P1", "--plafond", "4.6"]), /non dépassable/);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P1", "--dossier", path.join(process.cwd(), "tmp")]), /dans le dépôt/);
    assert.throws(() => cal.lireOptionsCalibrage([]), /Usage/);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P3", "--variantes", "retouche,ordre"]), /à côté de retouche/);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P4", "--variante", "inventee"]), /Variante inconnue/);
    assert.throws(() => cal.lireOptionsCalibrage(["--phase", "P1", "--en-plus"]), /Option inconnue/);
    // Le banc rejoué avec un nouveau modèle ne reprend pas les rendus de sunburst.
    assert.equal(cal.cleRendu("c01", "actuel", "medium"), "c01|actuel|medium");
    assert.equal(cal.cleRendu("c01", "actuel", "medium", "gpt-image-3-essai"), "c01|actuel|medium|gpt-image-3-essai");
  });

  test("la base visée doit être locale : Turso, Railway, le volume /data ou une URL distante sont refusés, avant tout", async () => {
    assert.doesNotThrow(() => cal.verifierBaseLocale({ DATABASE_URL: "file:./dev.db" }));
    assert.throws(() => cal.verifierBaseLocale({ DATABASE_URL: "file:./dev.db", TURSO_DATABASE_URL: "libsql://x.turso.io" }), /distante/);
    assert.throws(() => cal.verifierBaseLocale({ DATABASE_URL: "file:/data/prod.db" }), /production/);
    assert.throws(() => cal.verifierBaseLocale({ DATABASE_URL: "file:./dev.db", RAILWAY_ENVIRONMENT: "production" }), /Railway/);
    assert.throws(() => cal.verifierBaseLocale({ DATABASE_URL: "postgres://hote/base" }), /local/);
    const dossier = await dossierCalibrage();
    const { generateur, appels } = generateurEssai();
    await assert.rejects(cal.executerCalibrage(["--phase", "P1", "--dossier", dossier], { journal, generateur, env: { ...PAYANT, DATABASE_URL: "libsql://distante.turso.io" } }), /refuse de tourner/);
    assert.equal(appels.length, 0);
  });

  test("--estimer : le plan et le coût annoncés, aucun appel, aucune ligne ; sans CALIBRAGE_23_PAYANT=1 : refusé", async () => {
    const dossier = await dossierCalibrage();
    const { generateur, appels } = generateurEssai();
    const bilan = await lancer(["--phase", "P1", "--dossier", dossier, "--estimer"], { generateur });
    // 5 rendus × (0,05 + 0,005) + 2 analyses de photo × 0,005.
    assert.equal(bilan.estimeDollars, 0.285);
    assert.equal(appels.length, 0);
    assert.equal((await ligneCalibrage()).length, 0);
    assert.ok(lignes.some((l) => /Estimation : 5 × \(rendu 0,05 \$ \+ contrôle 0,005 \$\) \+ 2 analyse\(s\) de photo × 0,005 \$ = 0,285 \$/.test(l)), lignes.join("\n"));
    assert.ok(lignes.some((l) => /plafond 4,50 \$/.test(l)));
    // P3 avant P1 : 8 cas × 3 variantes estimés, sans appel.
    const p3 = await lancer(["--phase", "P3", "--dossier", dossier, "--estimer"], { generateur });
    assert.equal(p3.estimeDollars, 1.32);
    await assert.rejects(cal.executerCalibrage(["--phase", "P1", "--dossier", dossier, "--uploads", UPLOADS], { journal, generateur, env: { ...process.env, CALIBRAGE_23_PAYANT: "" } }), /Lancement payant refusé/);
    assert.equal(appels.length, 0);
  });
});

describe("le lancement (générateur et vision simulés)", () => {
  test("P1 : sunburst passé explicitement, chaque appel en phase calibrage-23, garde levée pour OpenAI seulement puis rétablie, notes et rendus hors du dépôt", async () => {
    const dossier = await dossierCalibrage();
    const { generateur, appels } = generateurEssai();
    const bilan = await lancer(["--phase", "P1", "--dossier", dossier], { generateur });
    assert.equal(bilan.arret, null, lignes.join("\n"));
    assert.equal(bilan.reussis, 5);
    assert.equal(appels.length, 5);
    assert.ok(appels.every((a) => a.modele === "gpt-image-2.5-sunburst" && a.phase === "calibrage-23" && a.qualite === "medium" && a.planche));
    const notees = await ligneCalibrage();
    // 5 rendus + 5 contrôles + 2 analyses (une par photo), toutes en phase calibrage-23 : la vision a été levée de la garde.
    assert.equal(notees.length, 12);
    assert.deepEqual([...new Set(notees.map((l) => l.modele))].sort(), ["gpt-4.1-mini", "gpt-image-2.5-sunburst"]);
    assert.equal(await prisma.generationImage.count({ where: { phase: { in: ["analyse", "controle"] }, createdAt: { gte: notees[0].createdAt } } }), 0);
    assert.equal(essaiLocal.gardeLevee("openai-vision"), false, "garde rétablie après la commande");
    assert.equal(essaiLocal.gardeLevee("openai-images"), false);
    assert.notEqual(process.env.CRM_ESSAI_LOCAL, "1");
    const resultats = JSON.parse(readFileSync(path.join(dossier, "banc", "resultats.json"), "utf8")) as import("./calibrage").Resultats;
    const r = resultats.rendus["c01|actuel|medium"];
    assert.ok(r.ok && r.note && r.fichier && r.corrige && r.avant);
    assert.ok(existsSync(path.join(dossier, "banc", "rendus", r.fichier)) && existsSync(path.join(dossier, "banc", "rendus", r.corrige)));
    assert.ok(typeof r.note.deltaEMedian === "number" && typeof r.note.deltaECorrigeMedian === "number");
    assert.equal(r.scoreControle, 9);
    assert.ok(r.coutDollars >= 0.05 && r.coutDollars < 0.06, String(r.coutDollars));
    assert.ok(lignes.some((l) => /^Coût réel relu dans GenerationImage \(phase calibrage-23/.test(l)));
    // Relancée : rien n'est refait.
    const encore = await lancer(["--phase", "P1", "--dossier", dossier], { generateur });
    assert.equal(encore.lances, 0);
    assert.equal(appels.length, 5);
    // Le bilan, puis les planches à l'aveugle (P2 : actuel medium contre low) avec la clé à part.
    const p2 = await lancer(["--phase", "P2", "--dossier", dossier], { generateur });
    assert.equal(p2.reussis, 3);
    assert.ok(appels.slice(5).every((a) => a.qualite === "low"));
    await lancer(["--aveugle", "P2", "--dossier", dossier, "--graine", "7"]);
    const cle = JSON.parse(readFileSync(path.join(dossier, "banc", "aveugle", "P2", "cle.json"), "utf8")) as { cle: Record<string, Record<string, string>> };
    assert.deepEqual(Object.keys(cle.cle).sort(), ["c01", "c04", "x01"]);
    assert.deepEqual(Object.values(cle.cle.c01).sort(), ["actuel|low", "actuel|medium"]);
    assert.ok(existsSync(path.join(dossier, "banc", "aveugle", "P2", "c01.jpg")));
  });

  test("le plafond est relu dans GenerationImage avant chaque appel : dépense antérieure comprise, arrêt avant de le franchir", async () => {
    const dossier = await dossierCalibrage();
    const { generateur, appels } = generateurEssai();
    // Une phase à part pour cet essai (GenerationImage ne se modifie ni ne s'efface) ; une dépense antérieure de 0,05 $.
    const phaseNotee = "calibrage-23-essai-plafond";
    await prisma.generationImage.create({ data: { origine: "CRM", modele: "gpt-image-2.5-sunburst", phase: phaseNotee, statut: "REUSSI", dureeMs: 1, coutDollars: 0.05 } });
    // 0,05 déjà + 0,06 prévus (rendu, contrôle, analyse) ≤ 0,17 : c01 ; ≈ 0,10 + 0,055 ≤ 0,17 : c02 ; ≈ 0,15 + 0,06 > 0,17 : arrêt avant c03.
    const bilan = await lancer(["--phase", "P1", "--dossier", dossier, "--plafond", "0.17"], { generateur, phaseNotee });
    assert.equal(appels.length, 2, lignes.join("\n"));
    assert.match(bilan.arret ?? "", /^ARRÊT avant c03\|actuel\|medium/);
    const total = (await prisma.generationImage.findMany({ where: { phase: phaseNotee } })).reduce((s, l) => s + (l.coutDollars ?? 0), 0);
    assert.ok(total <= 0.17, String(total));
    const rien = await lancer(["--phase", "P1", "--dossier", await dossierCalibrage(), "--plafond", "0.1"], { generateur, phaseNotee });
    assert.match(rien.arret ?? "", /^ARRÊT avant c01/);
    assert.equal(appels.length, 2, "aucun appel quand le premier franchirait le plafond");
  });

  test("un rendu en échec (5xx) est rejoué une fois, jamais deux ; un appel qui coûte plus du double de son estimation arrête tout", async () => {
    const dossier = await dossierCalibrage();
    const repris = generateurEssai({ echecs: 1 });
    const phaseNotee = "calibrage-23-essai-reprise";
    const b1 = await lancer(["--phase", "P1", "--dossier", dossier, "--cas", "c01"], { generateur: repris.generateur, phaseNotee });
    assert.equal(repris.appels.length, 2);
    assert.equal(b1.reussis, 1);
    const resultats = JSON.parse(readFileSync(path.join(dossier, "banc", "resultats.json"), "utf8")) as import("./calibrage").Resultats;
    assert.equal(resultats.rendus["c01|actuel|medium"].appels, 2);

    const abandonne = generateurEssai({ echecs: 5 });
    const b2 = await lancer(["--phase", "P1", "--dossier", dossier, "--cas", "c02"], { generateur: abandonne.generateur, phaseNotee });
    assert.equal(abandonne.appels.length, 2, "une seule reprise");
    assert.equal(b2.echecs, 1);
    assert.ok(lignes.some((l) => /rejoué une fois : abandonné/.test(l)));

    const cher = generateurEssai({ cout: (n) => (n === 1 ? 0.11 : 0.05) });
    const b3 = await lancer(["--phase", "P1", "--dossier", dossier], { generateur: cher.generateur, phaseNotee });
    assert.equal(cher.appels.length, 1, "arrêt après l'appel anormal");
    assert.match(b3.arret ?? "", /plus du double de son estimation/);
  });
});

describe("P3 et P4 : règles écrites avant P1", () => {
  const note = (de: number, apres: number, L = 1, ch = 3): import("./calibrage").NoteRendu => ({ douteux: false, raisonsDouteux: [], surfaces: [{ ref: "X", deltaE: de, chromatique: ch, derive: { L, a: 0, b: 0, C: 0 }, texturePerdue: false, etat: "corrigee", raison: null, deltaECorrige: apres }], deltaEMedian: de, chromatiqueMedian: ch, texturesPerdues: 0, contoursHorsMasque: 5, partHorsDemande: 0.01, deltaECorrigeMedian: apres, aRegenerer: 0, corrigee: true });
  const cas = (n: number): import("./calibrage").UnCas[] => Array.from({ length: n }, (_, i) => ({ id: `c${String(i + 1).padStart(2, "0")}`, photo: "0123456789ab", teinte: "RM30", zones: [{ zone: "meubles-bas" as const, ref: "RM30" }], client: false, choix: false }));
  const rendu = (c: string, variante: import("@/lib/simulateur/moteur").VarianteMoteur, n: import("./calibrage").NoteRendu, phase: "P1" | "P3" = "P1") => ({ cle: `${c}|${variante}|medium`, phase, cas: c, variante, qualite: "medium" as const, modele: "gpt-image-2.5-sunburst", ok: true, erreur: null, appels: 1, coutDollars: 0.055, dureeMs: 1, scoreControle: 9, fichier: "x.jpg", corrige: "x-corrige.jpg", avant: "a.jpg", note: n, le: "" });

  test("les 8 pires cas par ΔE médian après correction ; la règle des deux variantes ; P4 seulement si le gain atteint 3", () => {
    const liste = cas(10);
    const resultats: import("./calibrage").Resultats = { version: 1, rendus: {} };
    liste.forEach((c, i) => (resultats.rendus[`${c.id}|actuel|medium`] = rendu(c.id, "actuel", note(10, i + 1, 6, 2))));
    const pires = cal.choisirPires(liste, resultats);
    assert.deepEqual(pires.map((c) => c.id), ["c10", "c09", "c08", "c07", "c06", "c05", "c04", "c03"]);
    // |ΔL| médian 6 ≥ ΔE à clarté égale 2 : la planche neutre et l'ordre.
    assert.deepEqual(cal.variantesP3(liste, resultats).variantes, ["planche-neutre", "ordre"]);
    liste.forEach((c, i) => (resultats.rendus[`${c.id}|actuel|medium`] = rendu(c.id, "actuel", note(10, i + 1, 1, 4))));
    assert.deepEqual(cal.variantesP3(liste, resultats).variantes, ["ordre", "ordre-fin"]);
    const plan = cal.planDePhase("P3", { version: 1, jeu: "j", photos: [{ id: "0123456789ab", description: "", piece: "cuisine" }], teintes: [], cas: liste }, resultats, { variantes: null, variante: null, cas: null });
    assert.equal(plan.elements.length, 24);
    assert.deepEqual([...new Set(plan.elements.map((e) => e.variante))], ["retouche", "ordre", "ordre-fin"]);
    // P3 : retouche gagne 2,5 (pas assez), ordre 3,5 → P4 avec ordre.
    for (const c of pires) {
      const base = resultats.rendus[`${c.id}|actuel|medium`].note!.deltaECorrigeMedian!;
      resultats.rendus[`${c.id}|retouche|medium`] = rendu(c.id, "retouche", note(9, base - 2.5), "P3");
      resultats.rendus[`${c.id}|ordre|medium`] = rendu(c.id, "ordre", note(9, base - 3.5), "P3");
    }
    const m = cal.meilleureVariante(pires, ["retouche", "ordre"], resultats);
    assert.equal(m.variante, "ordre");
    assert.equal(m.gain, 3.5);
    assert.equal(m.p4, true);
    assert.equal(cal.meilleureVariante(pires, ["retouche"], resultats).p4, false);
    assert.ok(cal.bilanDePhase("P3", { version: 1, jeu: "j", photos: [], teintes: [], cas: liste }, resultats).some((l) => /Meilleure : ordre \(gain 3.5 ≥ 3\) → P4 autorisée/.test(l)));
  });
});

describe("variantes du prompt : construites par le moteur, jamais le prompt par défaut", () => {
  const ref = (id: string, nom: string, famille: string, hex: string, tags = [famille]) => ({ ref: id, nom, famille, categorie: "Color", finition: "Soft", tags, hex, couleur: null });
  const RM30 = ref("RM30", "Pastel Olive Green", "couleur", "#A4A38F");
  const AA17 = ref("AA17", "Beige Line Oak", "bois", "#B1946F");

  test("aucun prompt par défaut modifié : la bibliothèque ChatGPT et le prompt V2 sont figés (empreintes d'avant la mission 23)", async () => {
    const { PROMPTS_PAR_DEFAUT } = await import("@/lib/simulateur/prompts-defaut");
    const { promptsParDefautGeneres } = await import("@/lib/simulateur/moteur/generer-prompts");
    assert.equal(createHash("sha256").update(JSON.stringify(PROMPTS_PAR_DEFAUT)).digest("hex"), "37b6b0fe3e583c14083bebac85b9fe7194d5cf4bc7a687b3d522fdad7243da65");
    assert.deepEqual(promptsParDefautGeneres(), PROMPTS_PAR_DEFAUT);
    const ref2 = (id: string, nom: string, famille: string, hex: string) => ({ ref: id, nom, famille, categorie: "Color", finition: "Soft", tags: [famille], hex, couleur: null });
    const entrees = [
      { piece: "cuisine" as const, zones: moteur.etiquettesPour([{ zone: "meubles-bas" as const, reference: ref2("RM30", "Pastel Olive Green", "couleur", "#A4A38F") }, { zone: "plan-de-travail" as const, reference: ref2("AA17", "Beige Line Oak", "bois", "#B1946F") }]), analyse: null, format: "paysage" as const, mode: "api-planche" as const },
      { piece: "cuisine" as const, zones: moteur.etiquettesPour([{ zone: "facades-cuisine" as const, reference: ref2("N3", "Porcelain", "couleur", "#F1E4D3") }]), analyse: null, format: "portrait" as const, mode: "api-swatches" as const, defautsPrecedents: ["a handle moved"] },
      { piece: "salle-de-bain" as const, zones: moteur.etiquettesPour([{ zone: "meuble-vasque" as const, reference: ref2("AA14", "Original Oak", "bois", "#6B5138") }]), analyse: null, format: "carre" as const, mode: "chatgpt" as const },
    ];
    // Empreinte relevée sur le moteur d'avant L4a (même entrée, code de 8b263aa) : le prompt V2 par défaut n'a pas bougé.
    assert.equal(createHash("sha256").update(entrees.map((e) => moteur.construirePrompt(e).texte).join("\n=====\n")).digest("hex"), "ff5274a4c9a37b1d75f9c1a4ed90dddf9f1616fb7bb29fe1f4f5a4f586565954");
    for (const e of entrees) assert.equal(moteur.construirePrompt({ ...e, variante: "actuel" }).texte, moteur.construirePrompt(e).texte);
  });

  test("retouche, ordre, ordre-fin, planche-neutre : une seule chose change à la fois", () => {
    const entree = { piece: "cuisine" as const, zones: moteur.etiquettesPour([{ zone: "meubles-bas" as const, reference: RM30 }]), analyse: null, format: "paysage" as const, mode: "api-planche" as const };
    const actuel = moteur.construirePrompt(entree);
    assert.equal(actuel.variante, "actuel");
    const retouche = moteur.construirePrompt({ ...entree, variante: "retouche" }).texte;
    assert.match(retouche, /^EDIT Image 1, do not create a new image\./);
    assert.match(retouche, /a medium-light, muted, dusty, greyish olive \(#A4A38F\) — closer to grey than to green, NOT fresh green, mint or pistachio/);
    assert.match(retouche, /SURFACES TO CHANGE, ONE BY ONE\n- the base units, tall units and island fronts → Sample A \(RM30 "Pastel Olive Green"\)/);
    assert.match(retouche, /STAYS IDENTICAL\n- the framing/);
    assert.match(retouche, /the wall units \(upper cabinets\)/, "les zones non choisies restent identiques");
    assert.ok(retouche.endsWith("Compare with the sample before you output; if greener or brighter, desaturate toward grey."), retouche.slice(-200));
    assert.equal(moteur.contientEmoji(retouche), false);
    // Les surfaces nommées une à une par l'analyse quand elle les voit ; une façade « toutes » se déplie.
    const analyse = { description: "", zones_visibles: { "meubles-bas": { visible: true, description: "six grey drawers under the sink" }, "meubles-hauts": { visible: true, description: "two white wall cabinets" } }, objets: ["a kettle"], lumiere: { source: "", direction: "", temperature: "", dominante: "" }, format: "paysage" as const, qualite_photo: { verdict: "bonne" as const, conseil: "" } };
    const deplie = moteur.construirePrompt({ ...entree, zones: moteur.etiquettesPour([{ zone: "facades-cuisine" as const, reference: AA17 }]), analyse, variante: "retouche" }).texte;
    assert.match(deplie, /- the wall units \(upper cabinets\) \(two white wall cabinets\) → Sample A/);
    assert.match(deplie, /- the base units[^\n]*\(six grey drawers under the sink\) → Sample A/);
    assert.match(deplie, /every object \(a kettle\)/);
    assert.ok(deplie.endsWith("Compare with the sample before you output; if darker or greyer, lighten it toward the sample's warm tone."));

    const ordre = moteur.construirePrompt({ ...entree, variante: "ordre" }).texte;
    const ordreFin = moteur.construirePrompt({ ...entree, variante: "ordre-fin" }).texte;
    const ligne = actuel.blocs.REALISME.split("\n")[1];
    assert.ok(ordre.startsWith(`COLOUR — READ THIS FIRST\n${ligne}\n\n${actuel.texte.slice(0, 20)}`));
    assert.equal(ordre.slice(ordre.indexOf("ROLE\n")), actuel.texte, "le reste du prompt, mot pour mot");
    assert.ok(ordreFin.startsWith(actuel.texte) && ordreFin.endsWith(`COLOUR — CHECK IT AGAIN BEFORE YOU OUTPUT\n${ligne}`));

    const neutre = moteur.construirePrompt({ ...entree, variante: "planche-neutre" });
    assert.match(neutre.blocs.IMAGES, /neutral mid-grey sheet[\s\S]*pure white reference square/);
    const sansImages = (p: typeof neutre) => (Object.keys(p.blocs) as (keyof typeof p.blocs)[]).filter((b) => b !== "IMAGES").map((b) => p.blocs[b]);
    assert.deepEqual(sansImages(neutre), sansImages(actuel), "seule la phrase de la planche change");
  });

  test("la teinte en mots, lue dans le Lab du catalogue : RM30, un taupe, un blanc cassé, un bois, un bleu", () => {
    const t = (id: string, nom: string, famille: string, hex: string, tags?: string[]) => mots.teinteEnMots({ nom, famille, categorie: "", tags: tags ?? [famille], hex })!;
    const rm30 = t("RM30", "Pastel Olive Green", "couleur", "#A4A38F");
    assert.equal(rm30.famille, "uni désaturé");
    assert.equal(rm30.saturation, "muted, dusty, greyish");
    assert.equal(rm30.teinte, "olive");
    assert.match(rm30.pieges, /closer to grey than to green, NOT fresh green, mint or pistachio/);
    assert.equal(rm30.consigneFin, "compare with the sample before you output; if greener or brighter, desaturate toward grey");
    const taupe = t("NE55", "Caffe Latte", "couleur", "#B59C7E");
    assert.match(taupe.teinte, /taupe/);
    assert.match(taupe.pieges, /NOT yellow beige/);
    const greige = t("K7", "Cream Grey", "couleur", "#C1B4A4");
    assert.match(greige.teinte, /greige/);
    assert.match(greige.consigneFin, /more colourful, yellower or brighter, desaturate toward grey/);
    const blanc = t("N3", "Porcelain", "couleur", "#F1E4D3");
    assert.equal(blanc.clarte, "very light");
    assert.match(blanc.teinte, /warm off-white/);
    assert.match(blanc.pieges, /NOT yellow or butter cream/);
    const bois = t("AA17", "Beige Line Oak", "bois", "#B1946F", ["chêne"]);
    assert.equal(bois.famille, "bois clair");
    assert.match(bois.teinte, /wood/);
    assert.match(bois.consigneFin, /if darker or greyer, lighten/);
    const bleu = t("NH24", "Deep Ocean", "couleur", "#3A596D");
    assert.match(bleu.teinte, /blue/);
    assert.match(bleu.pieges, /NOT turquoise/);
    assert.equal(mots.teinteEnMots({ nom: "x", famille: "couleur", categorie: "", tags: [], hex: null }), null);
  });

  test("la planche neutre : vignettes plus grandes, gris neutre, mire blanche", async () => {
    const planche = await import("@/lib/simulateur/moteur/planche");
    const tuile = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 164, g: 163, b: 143 } } }).jpeg().toBuffer();
    const png = await planche.construirePlanche([{ etiquette: "A · Meubles bas", ref: "RM30", nom: "Pastel Olive Green", image: tuile }], "CoverSwap · Cuisine", { neutre: true });
    const d = planche.dimensionsPlancheNeutre(1);
    assert.ok(d.cote > planche.dimensionsPlanche(1).cote);
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [d.largeur, d.hauteur]);
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    assert.deepEqual(px(10, info.height - 10), [128, 128, 128], "fond gris neutre");
    assert.deepEqual(px(info.width - 56 - 60, 40 + 60), [255, 255, 255], "mire blanche en haut à droite");
  });
});
