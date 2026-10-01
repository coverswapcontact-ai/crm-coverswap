import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Photos, série 2 (01/10/2026) — le script de la mission 19 avec la liste `scripts/photos-serie-2.json` : essais par
 * entrée, échantillons (les vignettes réelles jointes après la source, dans l'ordre), sortie
 * `<sortie>/serie-2/<sous-série>/`, coûts notés `serie-2` / `serie-2-edition` et plafond de la série compté à part.
 * Le service d'images est simulé (`definirAppelAmbianceEssai`) ; les vignettes viennent d'un dossier préparé ou d'un
 * `fetch` remplacé : aucune requête réseau réelle.
 */
let prisma: typeof import("@/lib/prisma").default;
let ambiances: typeof import("@/lib/simulations/ambiances");
let generation: typeof import("@/lib/simulations/generation");
let sharp: typeof import("sharp");

const LISTE_S2 = path.join(process.cwd(), "scripts", "photos-serie-2.json");
const fetchOrigine = globalThis.fetch;
const VIGNETTES = "https://vignettes.essai/";
let requetesInterdites: string[] = [];
let journal: string[] = [];
type Demande = import("@/lib/simulations/generation").DemandeAmbiance;
let demandes: Demande[] = [];

const dossier = (nom: string) => mkdtempSync(path.join(tmpdir(), `coverswap-s2-${nom}-`));
const lancer = (argv: string[]) => ambiances.executerAmbiances(argv, (ligne) => journal.push(ligne));

async function petitPng(graine: number): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: (graine * 37) % 256, g: (graine * 91) % 256, b: 90 } } }).png().toBuffer();
}

function simuler() {
  generation.definirAppelAmbianceEssai(async (demande) => {
    demandes.push({ ...demande });
    return { ok: true, b64: (await petitPng(demandes.length)).toString("base64"), usage: { texte: 200, image: demande.image ? 1536 + 1024 * (demande.references?.length ?? 0) : 0, sortie: 1372 } };
  });
}

/** Une petite liste de série : un avant, son après à deux échantillons, un picto. */
async function petiteListe(racine: string): Promise<{ liste: string; catalogue: string }> {
  const prompt = (t: string) => `${t} — an ordinary lived-in French kitchen, realistic photograph, straight verticals, natural daylight, no text, no logos.`;
  const liste = {
    serie: 2,
    plafond_dollars: 20,
    images: [
      { nom: "cuisine-essai-avant", serie: "quotidien", piece: "cuisine", mode: "generation", format: "1536x1024", essais: 2, etiquette: "Ambiance", usages: ["avant-apres"], prompt: prompt("Before") },
      { nom: "cuisine-essai-apres-bois", serie: "quotidien", piece: "cuisine", mode: "edition", format: "1536x1024", essais: 2, source: "cuisine-essai-avant", echantillons: ["AA17", "NE31"], composition: { facades: "AA17", plan: "NE31" }, etiquette: "Ambiance", prompt: prompt("Edit this exact photo") },
      { nom: "picto-essai", serie: "pictos", mode: "generation", format: "1024x1024", essais: 3, fond: "transparent", etiquette: "Illustration", prompt: prompt("A small isometric icon") },
    ],
  };
  const fichier = path.join(racine, "liste.json");
  await fs.writeFile(fichier, JSON.stringify(liste));
  const catalogue = path.join(racine, "catalogue.json");
  await fs.writeFile(catalogue, JSON.stringify([
    { id: "AA17", nom: "Beige Line Oak", famille: "bois", image: `${VIGNETTES}AA17.jpg`, hex: "#C9A97E" },
    { id: "NE31", nom: "Statuary White", famille: "pierre", image: `${VIGNETTES}NE31.jpg`, hex: "#F2F2F2" },
  ]));
  return { liste: fichier, catalogue };
}

before(async () => {
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_BASE_URL = "http://openai.essai/v1";
  process.env.OPENAI_IMAGE_MODEL_GENERATION = "";
  process.env.OPENAI_IMAGE_MODEL_EDITION = "";
  process.env.TACHES_DESACTIVEES = "1";
  sharp = (await import("sharp")).default;
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const adresse = String(entree instanceof Request ? entree.url : entree);
    if (adresse.startsWith(VIGNETTES)) return new Response(new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c9a97e" } }).jpeg().toBuffer()), { status: 200 });
    if (adresse.startsWith("data:")) return fetchOrigine(entree, init);
    requetesInterdites.push(adresse);
    throw new Error("requête réseau interdite dans ce test");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  ambiances = await import("@/lib/simulations/ambiances");
  generation = await import("@/lib/simulations/generation");
});
beforeEach(() => {
  requetesInterdites = [];
  journal = [];
  demandes = [];
  process.env.OPENAI_API_KEY = "sk-essai-factice";
});
afterEach(() => {
  generation.definirAppelAmbianceEssai(null);
  assert.deepEqual(requetesInterdites, [], "aucune requête réseau réelle");
});
after(async () => {
  globalThis.fetch = fetchOrigine;
  process.env.OPENAI_API_KEY = "";
  await prisma.$disconnect();
});

describe("la liste réelle (scripts/photos-serie-2.json)", () => {
  test("v2 (budget 10 $) : 70 images, 140 essais ; priorité 1 les 18 avants et leurs 36 après, 2 les 8 photos utiles, 3 les 8 pictos", async () => {
    const liste = ambiances.lireListeImages(await fs.readFile(LISTE_S2, "utf8"));
    assert.equal(liste.serie, "2");
    assert.equal(liste.plafond, 10);
    assert.equal(liste.images.length, 70);
    assert.equal(liste.images.reduce((t, i) => t + ambiances.essaisDe(i, liste), 0), 140);
    const par = (priorite: number, serie: string, mode: string) => liste.images.filter((i) => i.priorite === priorite && i.serie === serie && i.mode === mode).length;
    assert.deepEqual([par(1, "quotidien", "generation"), par(1, "quotidien", "edition"), par(2, "enrichissement", "generation"), par(2, "ambiances", "generation"), par(3, "pictos", "generation")], [18, 36, 6, 2, 8]);
    for (const i of liste.images.filter((x) => x.mode === "edition")) {
      assert.ok(i.source?.endsWith("-avant") && i.echantillons?.length, i.nom);
      assert.deepEqual(Object.values(i.composition ?? {}), i.echantillons, `${i.nom} : une vignette par surface, dans l'ordre`);
    }
    assert.ok(liste.images.filter((i) => i.serie === "pictos").every((i) => i.fond === "transparent"));
  });

  test("--estimer et --priorite : le plan d'une priorité, la sortie de la série et le coût recalé, sans appel ni fichier", async () => {
    const sortie = dossier("estimer");
    const bilan = await lancer(["--liste", LISTE_S2, "--estimer", "--phase", "1", "--sortie", sortie]);
    assert.equal(demandes.length, 0);
    assert.ok(journal.some((l) => l.startsWith("Phase 1 (générations) : 34 image(s), 68 appel(s)")), journal.join("\n"));
    assert.ok(bilan.estimeDollars > 3 && bilan.estimeDollars < 3.3, `${bilan.estimeDollars}`);
    assert.ok(journal.some((l) => /plafond de la série 10,00 \$, déjà dépensé/.test(l)));
    assert.equal(existsSync(path.join(sortie, "quotidien")), false);
    journal = [];
    await lancer(["--liste", LISTE_S2, "--estimer", "--phase", "1", "--priorite", "3", "--sortie", sortie]);
    assert.ok(journal.some((l) => l.startsWith("Phase 1 (générations) : 8 image(s), 16 appel(s)")), journal.join("\n"));
  });
});

describe("le lancement d'une série", () => {
  test("phase 1 puis phase 2 : essais par entrée, sous-dossiers, vignettes jointes dans l'ordre, coûts « serie-2 »", async () => {
    simuler();
    const racine = dossier("lancement");
    const { liste, catalogue } = await petiteListe(racine);
    const sortie = path.join(racine, "photos");
    const vignettes = path.join(racine, "vignettes");
    const avantLignes = await prisma.generationImage.count({ where: { phase: { in: ["serie-2", "serie-2-edition"] } } });

    await lancer(["--liste", liste, "--phase", "1", "--sortie", sortie, "--catalogue", catalogue, "--vignettes", vignettes]);
    assert.equal(demandes.length, 2 + 3, "2 essais pour l'avant, 3 pour le picto");
    assert.ok(existsSync(path.join(sortie, "quotidien", "cuisine-essai-avant-2.png")));
    assert.ok(existsSync(path.join(sortie, "pictos", "picto-essai-3.png")));
    assert.equal(demandes.filter((d) => d.background === "transparent").length, 3);

    demandes = [];
    const bilan = await lancer(["--liste", liste, "--phase", "2", "--choix", "cuisine-essai-avant=2", "--sortie", sortie, "--catalogue", catalogue, "--vignettes", vignettes]);
    assert.equal(demandes.length, 2);
    for (const d of demandes) {
      assert.equal(d.image?.nom, "cuisine-essai-avant-2.png", "la source : l'avant retenu");
      assert.deepEqual(d.references?.map((r) => r.nom), ["AA17.png", "NE31.png"], "puis les vignettes, dans l'ordre de la liste");
    }
    assert.ok(existsSync(path.join(vignettes, "AA17.jpg")), "vignette téléchargée une fois, gardée");
    assert.ok(existsSync(path.join(sortie, "quotidien", "cuisine-essai-apres-bois-1.png")));
    const lignes = await prisma.generationImage.findMany({ where: { phase: { in: ["serie-2", "serie-2-edition"] } } });
    assert.equal(lignes.length - avantLignes, 7);
    assert.ok(lignes.some((l) => l.phase === "serie-2-edition" && l.echantillons === 3), "source + deux échantillons");
    assert.ok(bilan.totalDollars > 0);
  });

  test("le plafond de la série compte ce qui est déjà dépensé pour elle (pas les autres phases)", async () => {
    simuler();
    const racine = dossier("plafond");
    const { liste, catalogue } = await petiteListe(racine);
    const deja = await ambiances.depenseDeLaSerie("serie-2");
    await prisma.generationImage.create({ data: { origine: "CRM", modele: "gpt-image-2.5-flare", phase: "ambiance", statut: "REUSSI", dureeMs: 1, coutDollars: 50 } });
    const bilan = await lancer(["--liste", liste, "--phase", "1", "--sortie", path.join(racine, "photos"), "--catalogue", catalogue, "--plafond", String(deja + 0.08)]);
    assert.equal(demandes.length, 1, "une seule génération tient sous le plafond restant (les 50 $ « ambiance » ne comptent pas)");
    assert.equal(bilan.plafondAtteint, true);
    assert.ok(journal.some((l) => /^PLAFOND : .* déjà dépensés pour la série 2/.test(l)), journal.join("\n"));
  });

  test("un échantillon absent du catalogue : rien n'est lancé", async () => {
    simuler();
    const racine = dossier("absent");
    const { liste } = await petiteListe(racine);
    const catalogue = path.join(racine, "vide.json");
    await fs.writeFile(catalogue, JSON.stringify([{ id: "AA17", nom: "Beige Line Oak", famille: "bois", image: `${VIGNETTES}AA17.jpg`, hex: "#C9A97E" }]));
    await assert.rejects(lancer(["--liste", liste, "--phase", "2", "--choix", "cuisine-essai-avant=1", "--sortie", path.join(racine, "photos"), "--catalogue", catalogue]), /échantillon NE31 absent du catalogue/);
    assert.equal(demandes.length, 0);
  });

  test("validation : des échantillons sur une génération, ou une liste sans essais, sont refusés", () => {
    const base = { nom: "a", mode: "generation", format: "1536x1024", etiquette: "Ambiance", prompt: "x".repeat(100) };
    assert.throws(() => ambiances.lireListeImages(JSON.stringify({ serie: 2, images: [{ ...base, essais: 2, echantillons: ["K1"] }] })), /échantillons/);
    assert.throws(() => ambiances.lireListeImages(JSON.stringify({ serie: 2, images: [base] })), /essais/);
    assert.equal(ambiances.lireListeImages(JSON.stringify({ serie: 2, images: [{ ...base, essais: 2 }] })).essais, 2);
  });
});

describe("la bibliothèque (calage, teintes, réétiquetage)", () => {
  test("mesure d'une composition : fidèle, réétiquetée vers la plus proche de la même famille, ou teinte non garantie", async () => {
    const bibliotheque = await import("@/lib/simulations/bibliotheque");
    const racine = dossier("biblio");
    // Haut blanc (le blanc de la scène), gauche vert sauge exact, droite un vert bien plus clair, bas un rose vif.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="100" fill="#F2F2F2"/><rect y="100" width="200" height="100" fill="#616A57"/><rect x="200" y="100" width="200" height="100" fill="#9DAA90"/><rect y="200" width="400" height="100" fill="#FF00AA"/></svg>`;
    const fichier = path.join(racine, "essai.png");
    await sharp(Buffer.from(svg)).png().toFile(fichier);
    const catalogue = new Map(
      [
        { id: "RM20", nom: "Sage Green", famille: "couleur", image: "x", hex: "#616A57" },
        { id: "RM30", nom: "Pastel Olive Green", famille: "couleur", image: "x", hex: "#A4A38F" },
        { id: "NH12", nom: "Terracotta Stucco", famille: "beton", image: "x", hex: "#AF9584" },
      ].map((r) => [r.id, r])
    );
    const mesure = { blanc: { objet: "haut", zone: [10, 5, 80, 20] as [number, number, number, number] }, surfaces: { gauche: [[5, 40, 40, 20]] as [number, number, number, number][], droite: [[55, 40, 40, 20]] as [number, number, number, number][], bas: [[10, 72, 80, 20]] as [number, number, number, number][] } };
    const r = await bibliotheque.mesurerComposition(fichier, { gauche: "RM20", droite: "RM20", bas: "NH12" }, mesure, catalogue, 12, "#F2F2F2");
    assert.equal(r.gauche.statut, "fidele");
    assert.ok(r.gauche.deltaE < 1);
    assert.equal(r.droite.statut, "reetiquetee");
    assert.equal(r.droite.ref, "RM30", "la plus proche de la même famille");
    assert.ok(r.droite.deltaEAffichee <= 12 && r.droite.deltaE > 12);
    assert.equal(r.bas.statut, "teinte non garantie", "aucune référence du béton n'en est proche");
  });

  test("l'essai retenu : sans rejet, puis le moins de surfaces non garanties, de réétiquetages, puis le plus petit pire ΔE", async () => {
    const { meilleurEssai } = await import("@/lib/simulations/bibliotheque");
    const s = (statut: "fidele" | "reetiquetee" | "teinte non garantie", d: number) => ({ prevue: "A", ref: "A", nom: "a", deltaE: d, deltaEAffichee: d, mesure: "#000000", statut });
    const e = (essai: number, rejet: string | null, ...surfaces: ReturnType<typeof s>[]) => ({ essai, fichier: `${essai}.png`, ecartContours: 5, rejet, surfaces: Object.fromEntries(surfaces.map((x, i) => [`s${i}`, x])) });
    assert.equal(meilleurEssai([e(1, "calage", s("fidele", 1)), e(2, null, s("reetiquetee", 4))])?.essai, 2);
    assert.equal(meilleurEssai([e(1, null, s("teinte non garantie", 20)), e(2, null, s("reetiquetee", 9))])?.essai, 2);
    assert.equal(meilleurEssai([e(1, null, s("fidele", 9)), e(2, null, s("fidele", 3))])?.essai, 2);
    assert.equal(meilleurEssai([e(1, "calage")]), null);
  });
});
