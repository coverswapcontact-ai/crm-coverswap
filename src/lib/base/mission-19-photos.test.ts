import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 19 — les photos du site, refaites avec GPT Image 2.5 (`scripts/generer-ambiances.ts`, liste
 * `scripts/photos-site-v2.json`) : validation stricte de la liste réelle, trois essais `-1/-2/-3` par image, phase 1
 * (générations) et phase 2 (éditions depuis l'essai CHOISI de la source), fond transparent, plafond de dépense vérifié
 * avant chaque appel, `--estimer` sans rien toucher, image déjà là jamais refaite, modèles réglables par variable
 * d'environnement, prix de gpt-image-2.5, planches de choix et de contours sans appel payant.
 * Le générateur et l'éditeur sont simulés (`definirAppelAmbianceEssai`) ; le vrai client HTTP n'est exercé que contre
 * un `fetch` remplacé pendant TOUT le fichier : une requête qui sortirait vers un autre hôte fait échouer le test.
 *
 * Note : la liste compte 24 générations (dont 9 pictos) et 6 éditions ; etape-photo est déjà une édition (source
 * ouverture-cuisine-avant) : la phase 1 compte donc 24 images × 3 essais = 72 appels.
 */

let prisma: typeof import("@/lib/prisma").default;
let ambiances: typeof import("@/lib/simulations/ambiances");
let generation: typeof import("@/lib/simulations/generation");
let prix: typeof import("@/lib/simulations/prix");
let sharp: typeof import("sharp");

const LISTE_V2 = path.join(process.cwd(), "scripts", "photos-site-v2.json");
const OPENAI_FACTICE = "http://openai.essai/v1";
const fetchOrigine = globalThis.fetch;
let requetesInterdites: string[] = [];
let routeOpenAI: ((adresse: string, init?: RequestInit) => Promise<Response>) | null = null;
let journal: string[] = [];
type Demande = import("@/lib/simulations/generation").DemandeAmbiance;
let demandes: Demande[] = [];

const dossier = (nom: string) => mkdtempSync(path.join(tmpdir(), `coverswap-m19-${nom}-`));
const lancer = (argv: string[]) => ambiances.executerAmbiances(argv, (ligne) => journal.push(ligne));
const lignes = (phase: string) => prisma.generationImage.findMany({ where: { phase }, orderBy: { createdAt: "asc" } });

/** Un PNG de 16 px, d'une teinte tirée du compteur : chaque réponse simulée a des octets différents. */
async function petitPng(graine: number): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: (graine * 37) % 256, g: (graine * 91) % 256, b: (graine * 53) % 256 } } }).png().toBuffer();
}

/** Le générateur ET l'éditeur simulés : note chaque demande, rend un petit PNG et des jetons (coût réglable). */
function simuler(usage = { texte: 500, image: 0, sortie: 4000 }) {
  generation.definirAppelAmbianceEssai(async (demande) => {
    demandes.push({ ...demande });
    return { ok: true, b64: (await petitPng(demandes.length)).toString("base64"), usage: { ...usage, image: demande.image ? 1500 : 0 } };
  });
}

/** Une scène simple (fond, deux « meubles ») : pour les planches et les contours. */
async function scene(largeur: number, hauteur: number, options: { decalage?: number; teinte?: string } = {}): Promise<Buffer> {
  const d = options.decalage ?? 0;
  const t = options.teinte ?? "#8a5a2b";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><rect width="100%" height="100%" fill="#e8e2d8"/><rect x="${200 + d}" y="300" width="420" height="500" fill="${t}"/><rect x="${900 + d}" y="200" width="380" height="260" fill="${t}"/><rect x="0" y="820" width="${largeur}" height="12" fill="#555"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

before(async () => {
  process.env.OPENAI_API_KEY = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.OPENAI_BASE_URL = OPENAI_FACTICE;
  process.env.OPENAI_IMAGE_MODEL_GENERATION = "";
  process.env.OPENAI_IMAGE_MODEL_EDITION = "";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.TACHES_DESACTIVEES = "1";
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const adresse = String(entree instanceof Request ? entree.url : entree);
    if (adresse.startsWith("data:")) return fetchOrigine(entree, init);
    if (routeOpenAI && adresse.startsWith(`${OPENAI_FACTICE}/images/`)) return routeOpenAI(adresse, init);
    requetesInterdites.push(adresse);
    throw new Error("requête réseau interdite dans ce test");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  ambiances = await import("@/lib/simulations/ambiances");
  generation = await import("@/lib/simulations/generation");
  prix = await import("@/lib/simulations/prix");
});
beforeEach(() => {
  requetesInterdites = [];
  routeOpenAI = null;
  journal = [];
  demandes = [];
  process.env.OPENAI_API_KEY = "sk-essai-factice";
});
afterEach(() => {
  generation.definirAppelAmbianceEssai(null);
  process.env.OPENAI_IMAGE_MODEL_GENERATION = "";
  process.env.OPENAI_IMAGE_MODEL_EDITION = "";
  assert.deepEqual(requetesInterdites, [], "aucune requête réseau réelle");
});
after(async () => {
  globalThis.fetch = fetchOrigine;
  process.env.OPENAI_API_KEY = "";
  await prisma.$disconnect();
});

describe("la liste réelle (scripts/photos-site-v2.json)", () => {
  test("30 images, 3 essais ; 24 générations dont 9 pictos transparents, 6 éditions aux sources existantes et antérieures", async () => {
    const liste = ambiances.lireListeImages(await fs.readFile(LISTE_V2, "utf8"));
    assert.equal(liste.ancienFormat, false);
    assert.equal(liste.essais, 3);
    assert.equal(liste.images.length, 30);
    assert.equal(new Set(liste.images.map((i) => i.nom)).size, 30);
    const generations = liste.images.filter((i) => i.mode === "generation");
    const editions = liste.images.filter((i) => i.mode === "edition");
    assert.equal(generations.length, 24);
    assert.equal(editions.length, 6);
    const transparents = liste.images.filter((i) => i.fond === "transparent");
    assert.equal(transparents.length, 9);
    assert.ok(transparents.every((i) => i.mode === "generation" && i.format === "1024x1024" && i.etiquette === "Illustration"));
    for (const e of editions) {
      const rang = liste.images.findIndex((i) => i.nom === e.source);
      assert.ok(rang >= 0 && rang < liste.images.indexOf(e), `${e.nom} ← ${e.source}`);
    }
    assert.equal(editions.find((e) => e.nom === "etape-photo")?.source, "ouverture-cuisine-avant");
  });

  test("validation stricte : double, source manquante / inconnue / plus bas / elle-même, génération avec source, format, fond, champ inconnu", () => {
    const prompt = "Photorealistic interior photograph of a room, daylight, no people, no text, no logos, a long enough prompt.";
    const gen = { nom: "a", mode: "generation", format: "1024x1024", etiquette: "Ambiance", prompt };
    const ed = { nom: "b", mode: "edition", source: "a", format: "1024x1024", etiquette: "Ambiance", prompt };
    const lire = (images: object[], essais = 3) => ambiances.lireListeImages(JSON.stringify({ essais_par_image: essais, images }));
    assert.equal(lire([gen, ed]).images.length, 2);
    assert.equal(lire([gen, { ...ed, fond: "transparent" }]).images[1].fond, "transparent");
    assert.throws(() => lire([gen, gen]), /double/);
    assert.throws(() => lire([gen, { ...ed, source: undefined }]), /demande une source/);
    assert.throws(() => lire([gen, { ...ed, source: "z" }]), /inconnue/);
    assert.throws(() => lire([ed, gen]), /plus bas/);
    assert.throws(() => lire([gen, { ...ed, source: "b" }]), /propre source/);
    assert.throws(() => lire([{ ...gen, source: "a" }]), /n'a pas de source/);
    assert.throws(() => lire([{ ...gen, format: "2048x2048" }]));
    assert.throws(() => lire([{ ...gen, fond: "blanc" }]));
    assert.throws(() => lire([{ ...gen, mode: "retouche" }]));
    assert.throws(() => lire([{ ...gen, couleur: "rouge" }]));
    assert.throws(() => lire([gen], 0));
  });

  test("options : --phase, --choix, --essais, --qualite, --plafond ; plus de limite de 12 ; sortie par défaut hors dépôt", () => {
    const o = ambiances.lireArguments(["--phase", "2", "--choix", "ouverture-cuisine-apres=2, etude-meubles-apres=1", "--essais", "2", "--qualite", "xhigh", "--plafond", "12,5", "--max", "40", "--fidelite-haute"]);
    assert.deepEqual([o.phase, [...o.choix], o.essais, o.qualite, o.plafond, o.max, o.fideliteHaute], [2, [["ouverture-cuisine-apres", 2], ["etude-meubles-apres", 1]], 2, "xhigh", 12.5, 40, true]);
    const defaut = ambiances.lireArguments([]);
    assert.deepEqual([defaut.phase, defaut.qualite, defaut.plafond, defaut.max, defaut.essais, defaut.fideliteHaute], [null, "high", 30, null, null, false]);
    assert.equal(defaut.liste, LISTE_V2);
    assert.equal(defaut.sortie, path.join(homedir(), "coverswap-photos"));
    assert.throws(() => ambiances.lireArguments(["--phase", "3"]), /--phase/);
    assert.throws(() => ambiances.lireArguments(["--choix", "a=0"]), /--choix/);
    assert.throws(() => ambiances.lireArguments(["--choix", "a"]), /--choix/);
    assert.throws(() => ambiances.lireArguments(["--qualite", "ultra"]), /--qualite/);
    assert.throws(() => ambiances.lireArguments(["--plafond", "-1"]), /--plafond/);
  });

  test("une liste v2 sans --phase, un --choix inconnu ou hors des essais : refusés avant tout appel", async () => {
    simuler();
    const sortie = dossier("refus");
    await assert.rejects(lancer(["--sortie", sortie]), /--phase/);
    await assert.rejects(lancer(["--sortie", sortie, "--phase", "2", "--choix", "piece-garage=1"]), /inconnue/);
    await assert.rejects(lancer(["--sortie", sortie, "--phase", "2", "--choix", "ouverture-cuisine-apres=4"]), /3 essai/);
    assert.equal(demandes.length, 0);
    assert.equal(readdirSync(sortie).length, 0);
  });
});

describe("phase 1 : les générations", () => {
  test("24 images × 3 essais = 72 appels (sans etape-photo), noms -1/-2/-3, gpt-image-2.5-flare en high, fond transparent des pictos", async () => {
    simuler();
    const sortie = dossier("phase1");
    const avant = (await lignes("ambiance")).length;
    const bilan = await lancer(["--phase", "1", "--sortie", sortie]);
    assert.equal(demandes.length, 72);
    assert.equal(bilan.appels, 72);
    assert.equal(bilan.ecrites.length, 72);
    assert.ok(!bilan.ecrites.some((e) => e.nom === "etape-photo"));
    assert.equal(new Set(bilan.ecrites.map((e) => e.nom)).size, 24);
    const fichiers = readdirSync(sortie).sort();
    assert.equal(fichiers.length, 72);
    assert.ok(fichiers.every((f) => /^[a-z0-9-]+-[123]\.png$/.test(f)), fichiers.join(" "));
    assert.ok(fichiers.includes("ouverture-cuisine-apres-1.png") && fichiers.includes("ouverture-cuisine-apres-3.png") && fichiers.includes("picto-cuisine-2.png"));
    assert.ok(demandes.every((d) => d.model === "gpt-image-2.5-flare" && d.quality === "high" && d.output_format === "png" && !d.image && !d.input_fidelity));
    const transparentes = demandes.filter((d) => d.background === "transparent");
    assert.equal(transparentes.length, 27);
    assert.ok(transparentes.every((d) => d.size === "1024x1024"));
    // Les coûts : une ligne GenerationImage par appel, phase ambiance, au prix de gpt-image-2.5.
    const nouvelles = (await lignes("ambiance")).slice(avant);
    assert.equal(nouvelles.length, 72);
    assert.ok(nouvelles.every((l) => l.origine === "CRM" && l.statut === "REUSSI" && l.modele === "gpt-image-2.5-flare" && l.dossierId === null));
    assert.equal(nouvelles[0].coutDollars, prix.coutEnDollars({ texte: 500, image: 0, sortie: 4000 }, "gpt-image-2.5-flare"));
    assert.equal(bilan.releve?.parPhase.find((g) => g.phase === "ambiance")?.lignes, 72);
    assert.match(journal.at(-1) ?? "", /^Coût réel relu dans GenerationImage/);
  });

  test("une image déjà là n'est pas refaite : seuls les essais manquants partent", async () => {
    simuler();
    const sortie = dossier("deja");
    await fs.writeFile(path.join(sortie, "piece-cuisine-2.png"), await petitPng(999));
    const bilan = await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "piece-cuisine"]);
    assert.deepEqual(bilan.ecrites.map((e) => e.essai), [1, 3]);
    assert.deepEqual(bilan.sautees, [{ nom: "piece-cuisine", essai: 2, raison: "déjà là (piece-cuisine-2.png)" }]);
    assert.equal(demandes.length, 2);
    const encore = await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "piece-cuisine"]);
    assert.equal(encore.appels, 0);
    assert.equal(encore.releve, null);
    assert.equal(demandes.length, 2);
  });

  test("--essais 1 et --max : une limite d'appels, sans plafond de nombre", async () => {
    simuler();
    const sortie = dossier("max");
    const bilan = await lancer(["--phase", "1", "--sortie", sortie, "--essais", "1", "--max", "13"]);
    assert.equal(demandes.length, 13);
    assert.equal(bilan.sautees.filter((s) => s.raison === "--max 13 atteint").length, 11);
    assert.ok(readdirSync(sortie).every((f) => f.endsWith("-1.png")));
  });

  test("les modèles se règlent par OPENAI_IMAGE_MODEL_GENERATION / OPENAI_IMAGE_MODEL_EDITION (le simulateur n'en voit rien)", async () => {
    simuler();
    process.env.OPENAI_IMAGE_MODEL_GENERATION = "modele-generation-essai";
    process.env.OPENAI_IMAGE_MODEL_EDITION = "modele-edition-essai";
    assert.deepEqual([ambiances.modeleGeneration(), ambiances.modeleEdition()], ["modele-generation-essai", "modele-edition-essai"]);
    assert.equal(generation.modeleImage(), process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
    const sortie = dossier("modeles");
    await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "pro-hotel", "--essais", "1"]);
    await fs.writeFile(path.join(sortie, "pro-restaurant-apres-1.png"), await petitPng(5));
    await lancer(["--phase", "2", "--sortie", sortie, "--seulement", "pro-restaurant-avant", "--essais", "1", "--choix", "pro-restaurant-apres=1"]);
    assert.deepEqual(demandes.map((d) => d.model), ["modele-generation-essai", "modele-edition-essai"]);
    process.env.OPENAI_IMAGE_MODEL_GENERATION = "";
    process.env.OPENAI_IMAGE_MODEL_EDITION = "";
    assert.deepEqual([ambiances.modeleGeneration(), ambiances.modeleEdition()], ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
  });
});

describe("phase 2 : les éditions depuis l'essai choisi", () => {
  test("sans --choix : rien n'est lancé, chaque édition dit quelle source choisir", async () => {
    simuler();
    const sortie = dossier("sans-choix");
    const bilan = await lancer(["--phase", "2", "--sortie", sortie]);
    assert.equal(demandes.length, 0);
    assert.equal(bilan.appels, 0);
    assert.equal(bilan.releve, null);
    assert.equal(bilan.bloquees.length, 6);
    assert.ok(bilan.bloquees.every((b) => /non choisie : ajouter --choix [a-z-]+=<1 à 3>/.test(b.raison)));
    assert.ok(journal.some((l) => l.startsWith("Non lancée : etape-photo — source ouverture-cuisine-avant non choisie")));
    assert.equal(readdirSync(sortie).length, 0);
  });

  test("avec --choix : 6 éditions × 3, les « avant » d'abord puis etape-photo, chacune reçoit l'essai CHOISI de sa source", async () => {
    simuler();
    const sortie = dossier("choix");
    const sources = ["ouverture-cuisine-apres", "etude-salle-de-bain-apres", "etude-meubles-apres", "meubles-dressing-apres", "pro-restaurant-apres"];
    for (const [i, s] of sources.entries()) for (const n of [1, 2, 3]) await fs.writeFile(path.join(sortie, `${s}-${n}.png`), await petitPng(100 + i * 10 + n));
    const choix = { "ouverture-cuisine-apres": 2, "etude-salle-de-bain-apres": 1, "etude-meubles-apres": 3, "meubles-dressing-apres": 1, "pro-restaurant-apres": 2, "ouverture-cuisine-avant": 3 };
    const avant = (await lignes("ambiance-edition")).length;
    const bilan = await lancer(["--phase", "2", "--sortie", sortie, "--choix", Object.entries(choix).map(([n, k]) => `${n}=${k}`).join(",")]);
    assert.equal(demandes.length, 18, JSON.stringify(bilan.bloquees));
    assert.deepEqual([...new Set(bilan.ecrites.map((e) => e.nom))], ["ouverture-cuisine-avant", "etude-salle-de-bain-avant", "etude-meubles-avant", "meubles-dressing-avant", "pro-restaurant-avant", "etape-photo"]);
    assert.ok(demandes.every((d) => d.model === "gpt-image-2.5-sunburst" && d.quality === "high" && d.image && d.input_fidelity === undefined));
    // L'image reçue est l'essai choisi, octet pour octet — y compris pour etape-photo, dont la source vient d'être éditée.
    const attendues = [
      ...["ouverture-cuisine-apres-2", "etude-salle-de-bain-apres-1", "etude-meubles-apres-3", "meubles-dressing-apres-1", "pro-restaurant-apres-2"].flatMap((f) => [f, f, f]),
      "ouverture-cuisine-avant-3",
      "ouverture-cuisine-avant-3",
      "ouverture-cuisine-avant-3",
    ];
    for (const [i, d] of demandes.entries()) {
      assert.equal(d.image?.nom, `${attendues[i]}.png`);
      assert.ok(d.image?.octets.equals(await fs.readFile(path.join(sortie, `${attendues[i]}.png`))), `${i} : ${attendues[i]}`);
    }
    assert.deepEqual(demandes.map((d) => d.size).slice(9, 12), ["1024x1536", "1024x1536", "1024x1536"]);
    const nouvelles = (await lignes("ambiance-edition")).slice(avant);
    assert.equal(nouvelles.length, 18);
    assert.ok(nouvelles.every((l) => l.modele === "gpt-image-2.5-sunburst" && l.echantillons === 1 && l.origine === "CRM"));
    assert.equal(bilan.releve?.parPhase.find((g) => g.phase === "ambiance-edition")?.lignes, 18);
  });

  test("un essai choisi absent de la sortie : l'édition n'est pas lancée (message), les autres partent", async () => {
    simuler();
    const sortie = dossier("absente");
    await fs.writeFile(path.join(sortie, "etude-meubles-apres-1.png"), await petitPng(3));
    const bilan = await lancer(["--phase", "2", "--sortie", sortie, "--choix", "etude-meubles-apres=1,pro-restaurant-apres=2", "--essais", "1"]);
    assert.deepEqual(bilan.ecrites.map((e) => e.nom), ["etude-meubles-avant"]);
    assert.ok(bilan.bloquees.some((b) => b.nom === "pro-restaurant-avant" && /pro-restaurant-apres-2 absent/.test(b.raison)));
    assert.equal(demandes.length, 1);
  });
});

describe("le vrai client HTTP, contre un fetch simulé", () => {
  test("génération : JSON vers /images/generations avec background transparent ; édition : multipart vers /images/edits, sans input_fidelity", async () => {
    const recues: { adresse: string; corps: unknown }[] = [];
    const png = await petitPng(7);
    routeOpenAI = async (adresse, init) => {
      recues.push({ adresse, corps: init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 600, input_tokens_details: { text_tokens: 600, image_tokens: 0 }, output_tokens: 4160 } }), { status: 200 });
    };
    const sortie = dossier("http");
    await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "picto-murs", "--essais", "1"]);
    assert.equal(recues[0].adresse, `${OPENAI_FACTICE}/images/generations`);
    const json = recues[0].corps as Record<string, unknown>;
    assert.deepEqual([json.model, json.size, json.quality, json.background, json.output_format, json.n, "image" in json, "input_fidelity" in json], ["gpt-image-2.5-flare", "1024x1024", "high", "transparent", "png", 1, false, false]);

    await fs.writeFile(path.join(sortie, "etude-meubles-apres-2.png"), await scene(1536, 1024));
    await lancer(["--phase", "2", "--sortie", sortie, "--seulement", "etude-meubles-avant", "--essais", "1", "--choix", "etude-meubles-apres=2"]);
    assert.equal(recues[1].adresse, `${OPENAI_FACTICE}/images/edits`);
    const formulaire = recues[1].corps as FormData;
    assert.deepEqual([formulaire.get("model"), formulaire.get("size"), formulaire.get("quality"), formulaire.get("output_format"), formulaire.has("input_fidelity"), formulaire.has("background")], ["gpt-image-2.5-sunburst", "1536x1024", "high", "png", false, false]);
    const image = formulaire.get("image[]") as File;
    assert.equal(image.name, "etude-meubles-apres-2.png");
    assert.ok(Buffer.from(await image.arrayBuffer()).equals(await fs.readFile(path.join(sortie, "etude-meubles-apres-2.png"))));
    assert.ok(existsSync(path.join(sortie, "etude-meubles-avant-1.png")));
  });

  test("--fidelite-haute : input_fidelity envoyé ; un 400 « unknown parameter » → refait une fois sans, journalisé, plus envoyé ensuite", async () => {
    const formulaires: FormData[] = [];
    const png = await petitPng(8);
    routeOpenAI = async (_adresse, init) => {
      const f = init?.body as FormData;
      formulaires.push(f);
      if (f.has("input_fidelity")) return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'input_fidelity'.", type: "invalid_request_error", param: "input_fidelity" } }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 2000, input_tokens_details: { text_tokens: 500, image_tokens: 1500 }, output_tokens: 6240 } }), { status: 200 });
    };
    const sortie = dossier("fidelite");
    await fs.writeFile(path.join(sortie, "pro-restaurant-apres-1.png"), await petitPng(9));
    const bilan = await lancer(["--phase", "2", "--sortie", sortie, "--seulement", "pro-restaurant-avant", "--essais", "2", "--choix", "pro-restaurant-apres=1", "--fidelite-haute"]);
    assert.deepEqual(formulaires.map((f) => f.get("input_fidelity")), ["high", null, null]);
    assert.equal(bilan.ecrites.length, 2);
    assert.ok(journal.some((l) => l.includes("refuse input_fidelity (HTTP 400) : appel refait une fois sans")));
    assert.ok(journal.some((l) => l.startsWith("input_fidelity n'est plus envoyé")));
    assert.equal(bilan.ecrites[0].coutDollars, prix.coutEnDollars({ texte: 500, image: 1500, sortie: 6240 }, "gpt-image-2.5-sunburst"));
  });
});

describe("le plafond de dépense", () => {
  test("estimation de l'appel au-dessus du plafond : arrêt net AVANT l'appel", async () => {
    simuler();
    const sortie = dossier("plafond-0");
    const bilan = await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "piece-cuisine", "--plafond", "0.05"]);
    assert.equal(demandes.length, 0);
    assert.equal(bilan.plafondAtteint, true);
    assert.ok(journal.some((l) => /^PLAFOND : 0,00 \$ déjà dépensés \+ ≈ 0,06 \$ pour piece-cuisine-1 dépasseraient 0,05 \$ — arrêt net, 3 appel\(s\) non lancé\(s\)/.test(l)), journal.join("\n"));
    assert.equal(readdirSync(sortie).length, 0);
  });

  test("coût réel déjà dépensé + estimation du suivant > plafond : on s'arrête après deux appels", async () => {
    simuler({ texte: 500, image: 0, sortie: 10_000 }); // ≈ 0,30 $ réels par appel, ≈ 0,13 $ estimés
    const sortie = dossier("plafond");
    const bilan = await lancer(["--phase", "1", "--sortie", sortie, "--seulement", "piece-cuisine,piece-murs", "--plafond", "0.5"]);
    assert.equal(demandes.length, 2);
    assert.equal(bilan.plafondAtteint, true);
    assert.ok(bilan.totalDollars > 0.5);
    assert.equal(readdirSync(sortie).length, 2);
  });
});

describe("--estimer", () => {
  test("phase 1 : le plan (images, essais, formats) et le coût prévu, sans appel, ni fichier, ni ligne", async () => {
    simuler();
    const sortie = path.join(dossier("estimer"), "pas-cree");
    const avant = await prisma.generationImage.count();
    const bilan = await lancer(["--estimer", "--phase", "1", "--sortie", sortie]);
    assert.equal(demandes.length, 0);
    assert.equal(existsSync(sortie), false);
    assert.equal(await prisma.generationImage.count(), avant);
    assert.equal(bilan.releve, null);
    assert.ok(bilan.estimeDollars > 3.5 && bilan.estimeDollars < 3.8, `${bilan.estimeDollars} (recalé sur le coût réel : la phase 1 a coûté 3,57 $)`);
    assert.ok(journal.some((l) => l.startsWith("Phase 1 (générations) : 24 image(s), 72 appel(s) (gpt-image-2.5-flare, qualité high)")));
    assert.ok(journal.some((l) => l === "Formats : 1536x1024 × 24, 1024x1536 × 3, 1024x1024 × 45."));
    assert.ok(journal.some((l) => l.startsWith("Hypothèses de l'estimation")));
    assert.ok(!journal.some((l) => l.includes("OPENAI_API_KEY")));
  });

  test("phase 2 avec toutes les sources choisies : 18 appels d'édition estimés, rien de lancé", async () => {
    simuler();
    const sortie = path.join(dossier("estimer2"), "pas-cree");
    const bilan = await lancer(["--estimer", "--phase", "2", "--sortie", sortie, "--choix", "ouverture-cuisine-apres=1,etude-salle-de-bain-apres=1,etude-meubles-apres=1,meubles-dressing-apres=1,pro-restaurant-apres=1,ouverture-cuisine-avant=1"]);
    assert.equal(demandes.length, 0);
    assert.equal(existsSync(sortie), false);
    assert.equal(bilan.bloquees.length, 0);
    assert.equal(bilan.estimeDollars, Math.round(18 * ambiances.estimerAppel({ mode: "edition", format: "1536x1024" }) * 100) / 100);
    assert.ok(journal.some((l) => l.startsWith("Phase 2 (éditions) : 6 image(s), 18 appel(s) (gpt-image-2.5-sunburst")));
  });
});

describe("prix de gpt-image-2.5", () => {
  test("coutEnDollars reconnaît flare, sunburst, leurs alias datés et gpt-image-2 (texte 5 $, image 8 $, sortie 30 $ / M)", () => {
    const usage = { texte: 500, image: 1500, sortie: 6240 };
    const attendu = Math.round(((500 * 5 + 1500 * 8 + 6240 * 30) / 1_000_000) * 10_000) / 10_000;
    for (const modele of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst-2026-09-08", "gpt-image-2"]) {
      assert.equal(prix.coutEnDollars(usage, modele), attendu, modele);
      assert.deepEqual(prix.PRIX[modele], { texte: 5, image: 8, sortie: 30 });
    }
    assert.notEqual(prix.coutEnDollars(usage, "gpt-image-1"), attendu);
    // Estimation d'un appel (recalée sur le coût réel de la mission 19) : high 1536x1024 ≈ 1 372 jetons de sortie +
    // 500 de texte (+ 1 536 d'image pour la source d'une édition, + 1 024 par échantillon joint).
    const appel = (i: Parameters<typeof ambiances.estimerAppel>[0]) => Math.round(ambiances.estimerAppel(i) * 10_000) / 10_000;
    assert.equal(appel({ mode: "generation", format: "1536x1024" }), 0.0437);
    assert.equal(appel({ mode: "edition", format: "1536x1024" }), 0.0559);
    assert.equal(appel({ mode: "edition", format: "1536x1024", echantillons: ["NH22", "AA17"] }), 0.0723);
    assert.equal(appel({ mode: "generation", format: "1024x1024" }), 0.0552);
  });
});

describe("--planches : les planches de choix, sans appel payant", () => {
  test("phase 1 : essais côte à côte (damier pour un picto transparent) ; phase 2 : source en premier + contours et écart par essai", async () => {
    simuler();
    process.env.OPENAI_API_KEY = ""; // aucune clé nécessaire
    const sortie = dossier("planches");
    for (const n of [1, 2, 3]) await fs.writeFile(path.join(sortie, `piece-cuisine-${n}.png`), await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 60 * n, g: 90, b: 120 } } }).png().toBuffer());
    for (const n of [1, 2]) await fs.writeFile(path.join(sortie, `picto-cuisine-${n}.png`), await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    const avant = await prisma.generationImage.count();
    const bilan1 = await lancer(["--planches", "--phase", "1", "--sortie", sortie, "--seulement", "piece-cuisine,picto-cuisine,piece-murs"]);
    assert.deepEqual(bilan1.planches.map((p) => [p.nom, p.largeur, p.hauteur]), [
      ["piece-cuisine", 3 * 512 + 4 * 24, 512 + 48],
      ["picto-cuisine", 2 * 512 + 3 * 24, 512 + 48],
    ]);
    const meta = await sharp(path.join(sortie, "planches", "piece-cuisine.jpg")).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 1632, 560]);
    // Le damier : la zone transparente du picto n'est pas unie.
    const zone = await sharp(path.join(sortie, "planches", "picto-cuisine.jpg")).extract({ left: 24 + 200, top: 24 + 200, width: 200, height: 200 }).stats();
    assert.ok(zone.channels[0].stdev > 5, `damier attendu (écart-type ${zone.channels[0].stdev})`);
    assert.ok(journal.some((l) => l === "piece-murs : aucun essai dans la sortie, pas de planche."));

    // Phase 2 : la source choisie, trois essais d'édition (identique, recoloré, meuble déplacé).
    await fs.writeFile(path.join(sortie, "ouverture-cuisine-apres-2.png"), await scene(1536, 1024));
    await fs.writeFile(path.join(sortie, "ouverture-cuisine-avant-1.png"), await scene(1536, 1024));
    await fs.writeFile(path.join(sortie, "ouverture-cuisine-avant-2.png"), await scene(1536, 1024, { teinte: "#c89b3c" }));
    await fs.writeFile(path.join(sortie, "ouverture-cuisine-avant-3.png"), await scene(1536, 1024, { decalage: 90 }));
    journal = [];
    const bilan2 = await lancer(["--planches", "--phase", "2", "--sortie", sortie, "--seulement", "ouverture-cuisine-avant", "--choix", "ouverture-cuisine-apres=2"]);
    const [choix, contours] = bilan2.planches;
    assert.deepEqual([choix.nom, choix.largeur, choix.hauteur], ["ouverture-cuisine-avant", 4 * 768 + 5 * 24, 560]);
    assert.deepEqual([contours.nom, contours.largeur, contours.hauteur], ["ouverture-cuisine-avant-contours", 3 * 768 + 4 * 24, 560]);
    assert.ok(existsSync(path.join(sortie, "planches", "ouverture-cuisine-avant-contours.jpg")));
    const [identique, recolore, deplace] = contours.scores!.map((s) => s.ecart);
    assert.equal(identique, 0);
    assert.ok(recolore < 5, `recoloré : ${recolore}`);
    assert.ok(deplace > recolore + 10, `déplacé ${deplace} > recoloré ${recolore}`);
    assert.ok(journal.some((l) => /^ouverture-cuisine-avant : contours contre ouverture-cuisine-apres-2\.png → essai 1 écart 0,0 · essai 2 écart [\d,]+ · essai 3 écart [\d,]+ \(plus petit = mieux\)/.test(l)), journal.join("\n"));

    assert.equal(demandes.length, 0);
    assert.equal(await prisma.generationImage.count(), avant);
    assert.equal(bilan2.releve, null);
  });
});
