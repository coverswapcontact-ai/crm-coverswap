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
  test("122 images, 256 essais : 56 générations (22 avants, 12 repères, 10 ambiances, 12 pictos), 66 après à échantillons", async () => {
    const liste = ambiances.lireListeImages(await fs.readFile(LISTE_S2, "utf8"));
    assert.equal(liste.serie, "2");
    assert.equal(liste.plafond, 20);
    assert.equal(liste.images.length, 122);
    assert.equal(liste.images.reduce((t, i) => t + ambiances.essaisDe(i, liste), 0), 256);
    const par = (serie: string, mode: string) => liste.images.filter((i) => i.serie === serie && i.mode === mode).length;
    assert.deepEqual([par("quotidien", "generation"), par("quotidien", "edition"), par("reperes", "generation"), par("ambiances", "generation"), par("pictos", "generation")], [22, 66, 12, 10, 12]);
    for (const i of liste.images.filter((x) => x.mode === "edition")) {
      assert.ok(i.source?.endsWith("-avant") && i.echantillons?.length, i.nom);
      assert.deepEqual(Object.values(i.composition ?? {}).filter((r) => i.echantillons!.includes(r)).length > 0, true, `${i.nom} : composition et échantillons`);
    }
    assert.ok(liste.images.filter((i) => i.serie === "pictos").every((i) => i.fond === "transparent"));
  });

  test("--estimer : le plan, la sortie de la série et le coût recalé sur le coût réel, sans appel ni fichier", async () => {
    const sortie = dossier("estimer");
    const bilan = await lancer(["--liste", LISTE_S2, "--estimer", "--phase", "1", "--sortie", sortie]);
    assert.equal(demandes.length, 0);
    assert.ok(journal.some((l) => l.startsWith("Phase 1 (générations) : 56 image(s), 124 appel(s)")), journal.join("\n"));
    assert.ok(bilan.estimeDollars > 5 && bilan.estimeDollars < 6.5, `${bilan.estimeDollars}`);
    assert.ok(journal.some((l) => /plafond de la série 20,00 \$, déjà dépensé/.test(l)));
    assert.equal(existsSync(path.join(sortie, "quotidien")), false);
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
