import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m16-2-"));

/**
 * Mission 16 (partie 2) — les images d'ambiance du site, générées par `scripts/generer-ambiances.ts` que
 * l'orchestrateur lance une fois : la liste du dépôt (≤ 12, une réserve, consignes d'honnêteté dans chaque prompt),
 * `--essai` (N fichiers, N lignes `GenerationImage` phase `ambiance`, aucune requête réseau), `--max` qui coupe,
 * `--estimer` qui ne fait rien, une image déjà là jamais refaite, le rendu « après » de l'ouverture (`--rendu`) par le
 * moteur V2 simulé (`definirGenerateurEssai`, `definirVisionEssai`), le coût d'un échec compté comme le crédit
 * épuisé des rendus, et le coût réel relu dans `GenerationImage` en fin de lancement (`releverCouts` : le chiffre du
 * rapport, par phase). `fetch` est remplacé pendant tout le fichier : une requête réseau fait échouer le test.
 */

let prisma: typeof import("@/lib/prisma").default;
let ambiances: typeof import("@/lib/simulations/ambiances");
let generation: typeof import("@/lib/simulations/generation");
let sharp: typeof import("sharp");

const REFERENCES_CATALOGUE = [
  { id: "K1", nom: "Black Mat", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/k1.jpg", tags: ["noir"], hex: "#232220" },
  { id: "MK15", nom: "Raw Travertine", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/mk15.jpg", tags: ["pierre"], hex: "#CDBCAD" },
  { id: "AA01", nom: "Beige Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/essai/aa01.jpg", tags: ["chêne"], hex: "#B49063" },
];
const NOMS_CONCEPTION = ["ouverture-cuisine-avant", "piece-cuisine", "piece-salle-de-bain", "piece-meubles", "piece-murs", "piece-pro", "pro-hotel", "pro-restaurant", "pro-commerce", "etape-photo", "etape-pose", "ouverture-salle-de-bain-avant"];

const fetchOrigine = globalThis.fetch;
let requetes: string[] = [];
let journal: string[] = [];
const dossier = (nom: string) => mkdtempSync(path.join(tmpdir(), `coverswap-m16-2-${nom}-`));
const lancer = (argv: string[]) => ambiances.executerAmbiances(argv, (ligne) => journal.push(ligne));
const lignesAmbiance = () => prisma.generationImage.findMany({ where: { phase: "ambiance" }, orderBy: { createdAt: "asc" } });

before(async () => {
  process.env.OPENAI_API_KEY = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const adresse = String(entree instanceof Request ? entree.url : entree);
    // La planche (satori) charge son moteur de mise en page par une adresse `data:` : ce n'est pas le réseau.
    if (adresse.startsWith("data:")) return fetchOrigine(entree, init);
    requetes.push(adresse);
    throw new Error("requête réseau interdite dans ce test");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  ambiances = await import("@/lib/simulations/ambiances");
  generation = await import("@/lib/simulations/generation");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES_CATALOGUE);
  // Échantillons déjà en cache : aucun appel au stockage de Cover Styl'.
  const echantillons = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(echantillons, { recursive: true });
  for (const [i, r] of REFERENCES_CATALOGUE.entries()) await fs.writeFile(path.join(echantillons, `${r.id}.jpg`), await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 40 + i * 60, g: 50, b: 60 } } }).jpeg().toBuffer());
});
beforeEach(() => {
  requetes = [];
  journal = [];
  process.env.OPENAI_API_KEY = "";
});
after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("la liste du dépôt (scripts/ambiances.json)", () => {
  test("douze entrées au plus, celles de la conception dans l'ordre, une seule réserve ; honnêteté dans chaque prompt ; ≈ 2,3 $", async () => {
    const liste = ambiances.lireListeAmbiances(await fs.readFile(path.join(process.cwd(), "scripts", "ambiances.json"), "utf8"));
    assert.ok(liste.length <= ambiances.MAX_AMBIANCES);
    assert.deepEqual(liste.map((a) => a.nom), NOMS_CONCEPTION);
    assert.deepEqual(liste.filter((a) => a.reserve).map((a) => a.nom), ["ouverture-salle-de-bain-avant"]);
    const carres = liste.filter((a) => a.format === "1024x1024").map((a) => a.nom);
    assert.deepEqual(carres, ["piece-cuisine", "piece-salle-de-bain", "piece-meubles", "piece-murs", "piece-pro"]);
    assert.ok(liste.filter((a) => !carres.includes(a.nom)).every((a) => a.format === "1536x1024"));
    for (const a of liste) {
      for (const consigne of [/\bNo people\b/, /\bno hands\b/, /\bno faces\b/, /\bno text\b/, /\bno logos\b/, /\bno brand names\b/, /\bPhotorealistic\b/]) assert.match(a.prompt, consigne, `${a.nom} : ${consigne}`);
      assert.match(a.prompt, /daylight/, a.nom);
    }
    const horsReserve = ambiances.choisirAmbiances(liste, { seulement: null, sauf: [] });
    assert.equal(horsReserve.length, 11);
    const estime = ambiances.estimerCoutAmbiances(horsReserve);
    assert.ok(estime >= 2.2 && estime <= 2.5, `≈ ${estime} $`);
  });

  test("une liste invalide est refusée avant tout appel (nom, format, double, plus de douze, emoji)", () => {
    const une = { nom: "piece-essai", format: "1024x1024", prompt: "Photorealistic interior photograph of a room, daylight, no people, no text, no logos, a long enough prompt." };
    assert.equal(ambiances.lireListeAmbiances(JSON.stringify([une])).length, 1);
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify([{ ...une, nom: "Pièce Essai" }])));
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify([{ ...une, format: "2048x2048" }])));
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify([une, une])), /double/);
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ ...une, nom: `piece-${i}` })))));
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify([{ ...une, prompt: `${une.prompt} \u{1F3E0}` }])), /Emoji/);
    assert.throws(() => ambiances.lireListeAmbiances(JSON.stringify([{ ...une, couleur: "rouge" }])));
  });
});

describe("les options", () => {
  test("options inconnues, --max hors bornes, zones hors pièce ou qui se recouvrent, --piece sans --rendu : refusés", () => {
    assert.throws(() => ambiances.lireArguments(["--vite"]), /inconnue/);
    assert.throws(() => ambiances.lireArguments(["--max", "13"]), /--max/);
    assert.throws(() => ambiances.lireArguments(["--max", "0"]), /--max/);
    assert.throws(() => ambiances.lireArguments(["--sortie"]), /valeur/);
    assert.throws(() => ambiances.lireArguments(["--rendu", "a.png", "--piece", "cuisine", "--zones", "meuble-vasque:K1"]), /n'appartient pas/);
    assert.throws(() => ambiances.lireArguments(["--rendu", "a.png", "--piece", "cuisine", "--zones", "facades-cuisine:K1,meubles-hauts:K1"]), /recouvrent/);
    assert.throws(() => ambiances.lireArguments(["--rendu", "a.png", "--piece", "garage", "--zones", "meubles-hauts:K1"]), /--piece/);
    assert.throws(() => ambiances.lireArguments(["--piece", "cuisine"]), /--rendu/);
    const o = ambiances.lireArguments(["--sortie=x", "--max", "3", "--seulement", "piece-cuisine,piece-murs", "--rendu", "d/ouverture-cuisine-avant.png", "--piece", "cuisine", "--zones", "meubles-hauts:K1, meubles-bas:K1,plan-de-travail:MK15"]);
    assert.deepEqual([o.max, o.seulement, o.rendu?.piece, o.rendu?.zones], [3, ["piece-cuisine", "piece-murs"], "cuisine", [{ zone: "meubles-hauts", ref: "K1" }, { zone: "meubles-bas", ref: "K1" }, { zone: "plan-de-travail", ref: "MK15" }]]);
    assert.equal(ambiances.nomApres("d/ouverture-cuisine-avant.png"), "ouverture-cuisine-apres");
    assert.equal(ambiances.nomApres("photo.jpg"), "photo-apres");
  });

  test("--seulement prend aussi les réserves ; --sauf retire ; un nom inconnu arrête tout", async () => {
    const liste = ambiances.lireListeAmbiances(await fs.readFile(path.join(process.cwd(), "scripts", "ambiances.json"), "utf8"));
    assert.deepEqual(ambiances.choisirAmbiances(liste, { seulement: ["ouverture-salle-de-bain-avant", "piece-pro"], sauf: [] }).map((a) => a.nom), ["piece-pro", "ouverture-salle-de-bain-avant"]);
    assert.equal(ambiances.choisirAmbiances(liste, { seulement: null, sauf: ["etape-pose", "etape-photo"] }).length, 9);
    assert.throws(() => ambiances.choisirAmbiances(liste, { seulement: ["piece-garage"], sauf: [] }), /inconnue/);
    assert.throws(() => ambiances.choisirAmbiances(liste, { seulement: null, sauf: ["etape-poser"] }), /inconnue/);
  });
});

describe("--essai : les ambiances sans réseau", () => {
  test("N fichiers PNG aux formats demandés, N lignes GenerationImage (CRM, ambiance, sans dossier, 0 $) ; relancé : rien refait", async () => {
    const sortie = dossier("essai");
    const avant = (await lignesAmbiance()).length;
    const bilan = await lancer(["--essai", "--sortie", sortie, "--seulement", "piece-cuisine,pro-hotel,piece-murs"]);
    assert.deepEqual(bilan.ecrites.map((e) => e.nom), ["piece-cuisine", "piece-murs", "pro-hotel"]);
    assert.deepEqual(readdirSync(sortie).sort(), ["piece-cuisine.png", "piece-murs.png", "pro-hotel.png"]);
    const meta = await sharp(path.join(sortie, "pro-hotel.png")).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", 1536, 1024]);
    assert.deepEqual([(await sharp(path.join(sortie, "piece-cuisine.png")).metadata()).width, (await sharp(path.join(sortie, "piece-cuisine.png")).metadata()).height], [1024, 1024]);
    const lignes = (await lignesAmbiance()).slice(avant);
    assert.equal(lignes.length, 3);
    for (const l of lignes) assert.deepEqual([l.origine, l.phase, l.statut, l.modele, l.dossierId, l.coutDollars, l.echantillons], ["CRM", "ambiance", "REUSSI", "essai", null, 0, 0]);
    assert.deepEqual(lignes.map((l) => l.taille), ["1024x1024", "1024x1024", "1536x1024"]);
    assert.equal(bilan.totalDollars, 0);
    assert.deepEqual(requetes, []);
    assert.ok(journal.some((l) => l.startsWith("Mode essai")));
    // Le coût réel du lancement, relu dans GenerationImage et affiché en dernière ligne (le chiffre du rapport).
    assert.deepEqual(bilan.releve, { lignes: 3, totalDollars: 0, parPhase: [{ phase: "ambiance", statut: "REUSSI", lignes: 3, dollars: 0 }] });
    assert.match(journal.at(-1) ?? "", /^Coût réel relu dans GenerationImage \(base de DATABASE_URL.*ambiance 0,00 \$ × 3 — total 0,00 \$\.$/);

    const encore = await lancer(["--essai", "--sortie", sortie, "--seulement", "piece-cuisine,pro-hotel,piece-murs"]);
    assert.equal(encore.releve, null, "rien de lancé : rien à relire");
    assert.deepEqual([encore.ecrites.length, encore.sautees.length], [0, 3]);
    assert.ok(encore.sautees.every((s) => s.raison.startsWith("déjà là")));
    assert.equal((await lignesAmbiance()).length, avant + 3);
  });

  test("--max coupe : deux appels au plus, les suivantes notées « --max atteint », la réserve jamais", async () => {
    const sortie = dossier("max");
    const avant = (await lignesAmbiance()).length;
    const bilan = await lancer(["--essai", "--sortie", sortie, "--max", "2"]);
    assert.deepEqual(bilan.ecrites.map((e) => e.nom), ["ouverture-cuisine-avant", "piece-cuisine"]);
    assert.equal(bilan.sautees.length, 9);
    assert.ok(bilan.sautees.every((s) => s.raison === "--max 2 atteint"));
    assert.ok(!bilan.sautees.some((s) => s.nom === "ouverture-salle-de-bain-avant"));
    assert.equal(readdirSync(sortie).length, 2);
    assert.equal((await lignesAmbiance()).length, avant + 2);
    assert.deepEqual(requetes, []);
  });

  test("--estimer : le plan et le coût, ni dossier, ni fichier, ni ligne ; sans --essai ni clé : rien n'est lancé", async () => {
    const sortie = path.join(dossier("estimer"), "pas-cree");
    const avant = await prisma.generationImage.count();
    const bilan = await lancer(["--estimer", "--sortie", sortie]);
    assert.ok(bilan.estimeDollars >= 2.2 && bilan.estimeDollars <= 2.5, `${bilan.estimeDollars}`);
    assert.equal(bilan.releve, null);
    assert.equal(existsSync(sortie), false);
    assert.ok(journal.some((l) => l.startsWith("Coût estimé")));
    assert.ok(!journal.some((l) => l.includes("OPENAI_API_KEY")));
    await assert.rejects(lancer(["--sortie", sortie]), /OPENAI_API_KEY absente/);
    assert.ok(journal.includes("OPENAI_API_KEY : absente."));
    assert.equal(existsSync(sortie), false);
    assert.equal(await prisma.generationImage.count(), avant);
    assert.deepEqual(requetes, []);
  });
});

describe("--rendu : l'« après » de l'ouverture par le moteur V2", () => {
  test("en essai, par le générateur et la vision simulés : moteur V2, planche, fichier « -apres » superposable, jamais écrasé", async () => {
    const sortie = dossier("rendu");
    const photo = path.join(sortie, "ouverture-cuisine-avant.png");
    await fs.writeFile(photo, await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 170, g: 130, b: 90 } } }).png().toBuffer());
    const argv = ["--essai", "--sortie", sortie, "--rendu", photo, "--piece", "cuisine", "--zones", "meubles-hauts:K1,meubles-bas:K1,plan-de-travail:MK15"];
    const avant = await prisma.generationImage.count({ where: { phase: { in: ["analyse", "controle"] } } });
    const bilan = await lancer(argv);
    assert.ok(bilan.rendu, JSON.stringify(bilan.echecs));
    assert.equal(bilan.rendu.fichier, path.join(sortie, "ouverture-cuisine-apres.jpg"));
    assert.deepEqual([bilan.rendu.moteur, bilan.rendu.tentatives, bilan.rendu.score, bilan.rendu.coutDollars], ["V2", 1, 10, 0]);
    const meta = await sharp(bilan.rendu.fichier).metadata();
    assert.deepEqual([meta.width, meta.height], [1536, 1024]);
    // L'image unie du générateur simulé : la preuve que la génération est passée par lui, pas par OpenAI.
    const stats = await sharp(bilan.rendu.fichier).stats();
    assert.ok(stats.channels.every((c) => c.stdev < 2), "image unie attendue");
    // Analyse et contrôle passés par la vision simulée : comptés, à 0 $.
    const vision = await prisma.generationImage.findMany({ where: { phase: { in: ["analyse", "controle"] } }, orderBy: { createdAt: "asc" } });
    assert.equal(vision.length, avant + 2);
    assert.ok(vision.slice(avant).every((l) => l.origine === "CRM" && l.statut === "REUSSI" && l.coutDollars === 0));
    // Le relevé final compte aussi l'analyse (que la ligne « Rendu écrit » laisse à part) : le coût complet du rendu.
    assert.deepEqual(bilan.releve?.parPhase.map((g) => [g.phase, g.statut, g.lignes]), [["analyse", "REUSSI", 1], ["controle", "REUSSI", 1]]);
    assert.match(journal.at(-1) ?? "", /^Coût réel relu dans GenerationImage .*analyse 0,00 \$ × 1 · controle 0,00 \$ × 1 — total 0,00 \$\.$/);
    // L'analyse simulée n'est pas rangée sous l'empreinte de la vraie photo : le vrai rendu lancé ensuite ne la reprendra pas.
    const { empreintePhoto } = await import("@/lib/simulateur/analyses");
    assert.equal(await prisma.analysePhoto.count({ where: { empreinte: empreintePhoto(await fs.readFile(photo)) } }), 0);
    assert.ok((await prisma.analysePhoto.count()) >= 1);
    // Les remplaçants sont retirés après le script ; aucune requête réseau.
    assert.equal(generation.generateurEnVigueur(), generation.genererRendu);
    assert.deepEqual(requetes, []);
    assert.equal(await prisma.generationImage.count({ where: { phase: "rendu" } }), 0);

    const encore = await lancer(argv);
    assert.equal(encore.rendu?.fichier, path.join(sortie, "ouverture-cuisine-apres-2.jpg"));
    assert.ok(existsSync(path.join(sortie, "ouverture-cuisine-apres.jpg")));
  });

  test("--rendu sans photo : refusé, rien de lancé", async () => {
    await assert.rejects(lancer(["--essai", "--sortie", dossier("sans-photo"), "--rendu", "introuvable.png", "--piece", "cuisine", "--zones", "plan-de-travail:MK15"]), /introuvable/);
  });
});

describe("genererAmbiance : ce que coûte un échec", () => {
  test("crédit épuisé : une ligne ECHEC « service-indisponible » (vue par le compteur du simulateur) ; sans clé ni appel fourni : rien, aucune ligne", async () => {
    const avant = (await lignesAmbiance()).length;
    const refus = await generation.genererAmbiance({ prompt: "x".repeat(100), format: "1024x1024" }, { appel: async () => ({ ok: false, status: 429, texte: "You exceeded your current quota (insufficient_quota)" }), modele: "gpt-image-1" });
    assert.equal(refus.ok, false);
    assert.equal(!refus.ok && refus.raison, "service-indisponible");
    const lignes = (await lignesAmbiance()).slice(avant);
    assert.equal(lignes.length, 1);
    assert.deepEqual([lignes[0].statut, lignes[0].modele, lignes[0].taille], ["ECHEC", "gpt-image-1", "1024x1024"]);
    assert.match(lignes[0].erreur ?? "", /^service-indisponible : HTTP 429/);

    const sansCle = await generation.genererAmbiance({ prompt: "x".repeat(100), format: "1024x1024" });
    assert.deepEqual([sansCle.ok, !sansCle.ok && sansCle.raison], [false, "config"]);
    assert.equal((await lignesAmbiance()).length, avant + 1);
    assert.deepEqual(requetes, []);
  });

  test("réussite : le coût d'après les jetons (grille de gpt-image-1), écrit sur la ligne", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const r = await generation.genererAmbiance({ prompt: "y".repeat(100), format: "1536x1024" }, { appel: async (demande) => (assert.deepEqual([demande.model, demande.quality, demande.size, demande.output_format], ["gpt-image-1", "high", "1536x1024", "png"]), { ok: true, b64: png.toString("base64"), usage: { texte: 100, image: 0, sortie: 6240 } }), modele: "gpt-image-1" });
    assert.ok(r.ok);
    assert.equal(r.coutDollars, generation.coutEnDollars({ texte: 100, image: 0, sortie: 6240 }, "gpt-image-1"));
    assert.ok(r.coutDollars > 0.24 && r.coutDollars < 0.26);
    const ligne = await prisma.generationImage.findUnique({ where: { id: r.generationId! } });
    assert.deepEqual([ligne?.phase, ligne?.statut, ligne?.coutDollars, ligne?.jetonsSortie], ["ambiance", "REUSSI", r.coutDollars, 6240]);
  });
});

describe("releverCouts : le coût réel d'un lancement, relu dans GenerationImage", () => {
  test("lignes CRM sans dossier écrites depuis le début, par phase et statut ; ni celles d'avant, ni un dossier, ni le site", async () => {
    const creer = (data: { origine: string; phase: string; statut?: string; coutDollars: number; dossierId?: string; createdAt?: Date }) => prisma.generationImage.create({ data: { modele: "gpt-image-1", statut: "REUSSI", dureeMs: 1, ...data } });
    await creer({ origine: "CRM", phase: "ambiance", coutDollars: 9, createdAt: new Date(Date.now() - 60_000) });
    const debut = new Date();
    await creer({ origine: "CRM", phase: "ambiance", coutDollars: 0.2512 });
    await creer({ origine: "CRM", phase: "ambiance", coutDollars: 0.1675 });
    await creer({ origine: "CRM", phase: "ambiance", statut: "ECHEC", coutDollars: 0 });
    await creer({ origine: "CRM", phase: "rendu", coutDollars: 0.3597 });
    await creer({ origine: "CRM", phase: "controle", coutDollars: 0.004 });
    await creer({ origine: "CRM", phase: "analyse", coutDollars: 0.006 });
    await creer({ origine: "CRM", phase: "rendu", coutDollars: 5, dossierId: "dossier-essai" });
    await creer({ origine: "SITE", phase: "rendu", coutDollars: 7 });
    const releve = await ambiances.releverCouts(debut);
    assert.deepEqual(releve.parPhase, [
      { phase: "ambiance", statut: "ECHEC", lignes: 1, dollars: 0 },
      { phase: "ambiance", statut: "REUSSI", lignes: 2, dollars: 0.4187 },
      { phase: "rendu", statut: "REUSSI", lignes: 1, dollars: 0.3597 },
      { phase: "analyse", statut: "REUSSI", lignes: 1, dollars: 0.006 },
      { phase: "controle", statut: "REUSSI", lignes: 1, dollars: 0.004 },
    ]);
    assert.deepEqual([releve.lignes, releve.totalDollars], [6, 0.7884]);
  });
});
