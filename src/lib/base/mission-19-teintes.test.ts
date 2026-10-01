import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 19, complément du 01/10/2026 — les teintes fidèles (`scripts/teintes-ambiances.ts`) : ΔE 2000 exact sur les
 * paires de référence de Sharma, balance des blancs (avec et sans exposition), blanc pris sur le quart éclairé de sa
 * zone, liste réelle valide et ses références présentes au catalogue du site, référence « la plus proche » dans un
 * filtre, consigne d'édition fidèle, éditions multipart avec la photo PUIS les vignettes, et un lancement complet en
 * `--essai` (aucune requête OpenAI ; vignettes servies par un `fetch` remplacé) : mesure, recalage des seules images
 * au-dessus du seuil ou demandées, rien de refait au second lancement, relevé et planche écrits.
 */

let teintes: typeof import("@/lib/simulations/teintes");
let generation: typeof import("@/lib/simulations/generation");
let sharp: typeof import("sharp");
const fetchOrigine = globalThis.fetch;
const VIGNETTES = "https://vignettes.essai/";

before(async () => {
  teintes = await import("@/lib/simulations/teintes");
  generation = await import("@/lib/simulations/generation");
  sharp = (await import("sharp")).default;
  // Seules les vignettes du catalogue d'essai et le service d'images factice répondent ; tout autre hôte échoue.
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const adresse = String(entree instanceof Request ? entree.url : entree);
    if (adresse.startsWith(VIGNETTES)) {
      const hex = adresse.slice(VIGNETTES.length).replace(".jpg", "");
      const [r, g, b] = teintes.hexVersRgb(`#${hex}`);
      const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
      return new Response(new Uint8Array(jpg), { status: 200 });
    }
    if (adresse.startsWith("http://openai.essai/")) return routeOpenAI!(adresse, init);
    throw new Error(`Requête interdite pendant les essais : ${adresse}`);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = fetchOrigine;
});
let routeOpenAI: ((adresse: string, init?: RequestInit) => Promise<Response>) | null = null;

describe("couleur", () => {
  test("ΔE 2000 : paires de Sharma, Wu et Dalal (2005)", () => {
    const paires: [[number, number, number], [number, number, number], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ];
    for (const [a, b, attendu] of paires) assert.ok(Math.abs(teintes.deltaE2000(a, b) - attendu) < 1e-3, `${a} / ${b}`);
    assert.equal(teintes.deltaE2000([60, 10, 10], [60, 10, 10]), 0);
  });

  test("sRGB → Lab : blanc, noir, et aller-retour hex", () => {
    const [L, a, b] = teintes.rgbVersLab([255, 255, 255]);
    assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01);
    assert.ok(Math.abs(teintes.rgbVersLab([0, 0, 0])[0]) < 1e-9);
    assert.equal(teintes.rgbVersHex(teintes.hexVersRgb("#616a57")), "#616A57");
    assert.throws(() => teintes.hexVersRgb("616A5"));
  });

  test("balance des blancs : le blanc ramené au blanc cible, ou seulement neutralisé à sa luminance", () => {
    const blanc: [number, number, number] = [200, 180, 160];
    const g = teintes.gainsBlanc(blanc, [242, 242, 242]);
    const corrige = teintes.medianeCorrigee([Buffer.from(blanc)], g).map(Math.round);
    assert.deepEqual(corrige, [242, 242, 242]);
    const n = teintes.medianeCorrigee([Buffer.from(blanc)], teintes.gainsBlanc(blanc, [242, 242, 242], false)).map(Math.round);
    assert.ok(n[0] === n[1] && n[1] === n[2], "neutre");
    assert.ok(Math.abs(teintes.rgbVersLab(n as [number, number, number])[0] - teintes.rgbVersLab(blanc)[0]) < 0.5, "même luminance");
  });

  test("le blanc d'une zone : le quart le plus lumineux, pas l'ombre", () => {
    const pixels = Buffer.from([...Array(6).fill([90, 90, 90]).flat(), ...Array(2).fill([240, 235, 230]).flat()]);
    assert.deepEqual(teintes.blancDeZone(pixels), [240, 235, 230]);
  });
});

describe("liste et catalogue", () => {
  const catalogue = [
    { id: "RM20", nom: "Sage Green", famille: "couleur", image: `${VIGNETTES}616A57.jpg`, hex: "#616A57" },
    { id: "J3", nom: "Ultra White", famille: "couleur", image: `${VIGNETTES}FFFFFF.jpg`, hex: "#FFFFFF" },
    { id: "AG13", nom: "Pale Oak", famille: "bois", image: `${VIGNETTES}E1D4BB.jpg`, hex: "#E1D4BB" },
    { id: "AA02", nom: "Rustic Oak", famille: "bois", image: `${VIGNETTES}8B6B45.jpg`, hex: "#8B6B45", tags: ["chêne"] },
    { id: "D1", nom: "Classic Walnut", famille: "bois", image: `${VIGNETTES}654835.jpg`, hex: "#654835" },
  ];

  test("la liste réelle est valide, et ses références existent au catalogue du site (s'il est là)", async () => {
    const liste = teintes.lireListeTeintes(await fs.readFile(path.join(process.cwd(), "scripts", "teintes-site-v2.json"), "utf8"));
    assert.equal(liste.seuil_delta_e, 12);
    assert.equal(liste.essais_par_image, 3);
    assert.equal(liste.images.length, 15);
    for (const i of liste.images) for (const s of i.surfaces) for (const z of [...s.zones, i.blanc.zone]) assert.ok(z[0] + z[2] <= 100 && z[1] + z[3] <= 100, `${i.nom} : zone hors image`);
    const fichierCatalogue = path.join(process.cwd(), "..", "coverswap", "src", "data", "revetements.json");
    if (!existsSync(fichierCatalogue)) return;
    const ids = new Set(teintes.lireCatalogue(await fs.readFile(fichierCatalogue, "utf8")).map((r) => r.id));
    for (const i of liste.images) for (const s of i.surfaces) if (s.ref) assert.ok(ids.has(s.ref), `${i.nom} : ${s.ref} absente du catalogue`);
  });

  test("validation stricte : ref ou plus_proche, pas les deux ; nom en double refusé", () => {
    const base = { seuil_delta_e: 12, essais_par_image: 3, blanc_cible: "#F2F2F2" };
    const image = (surface: object) => ({ nom: "a", blanc: { objet: "mur", zone: [0, 0, 10, 10] }, surfaces: [{ surface: "s", en: "s", zones: [[0, 0, 5, 5]], ...surface }] });
    assert.throws(() => teintes.lireListeTeintes(JSON.stringify({ ...base, images: [image({ ref: "RM20", plus_proche: { famille: "bois" } })] })));
    assert.throws(() => teintes.lireListeTeintes(JSON.stringify({ ...base, images: [image({ ref: null })] })));
    assert.throws(() => teintes.lireListeTeintes(JSON.stringify({ ...base, images: [image({ ref: "RM20" }), image({ ref: "RM20" })] })), /double/);
    assert.equal(teintes.lireListeTeintes(JSON.stringify({ ...base, images: [image({ ref: "RM20" })] })).images.length, 1);
  });

  test("la plus proche dans un filtre : famille, mot du nom ou des tags, teinte claire", () => {
    const chene = teintes.plusProche([140, 110, 70], catalogue, (r) => teintes.dansLeFiltre(r, { famille: "bois", mot: "oak" }));
    assert.equal(chene?.ref.id, "AA02");
    assert.equal(teintes.plusProche([140, 110, 70], catalogue, (r) => teintes.dansLeFiltre(r, { famille: "bois", mot: "chêne" }))?.ref.id, "AA02");
    assert.equal(teintes.plusProche([240, 240, 245], catalogue, (r) => teintes.dansLeFiltre(r, { famille: "couleur", clair: true }))?.ref.id, "J3");
    assert.equal(teintes.plusProche([1, 2, 3], catalogue, (r) => teintes.dansLeFiltre(r, { famille: "pierre" })), null);
  });

  test("la consigne d'édition : seulement couleur et texture, image 1 = la photo, puis une vignette par surface", () => {
    const c = teintes.consigneRecalage([
      { en: "the wall cabinets", ref: catalogue[2] },
      { en: "the island", ref: catalogue[0] },
    ]);
    assert.match(c, /Change ONLY the color and the surface texture/);
    assert.match(c, /the wall cabinets: reproduce exactly reference image 2 \(Pale Oak AG13\)/);
    assert.match(c, /the island: reproduce exactly reference image 3 \(Sage Green RM20\)/);
    assert.match(c, /under the existing light of this scene/);
    assert.match(c, /Do not change anything else/);
  });

  describe("lancement complet en --essai", () => {
    let sortie: string;
    let liste: string;
    let fichierCatalogue: string;
    const journal: string[] = [];
    const lancer = (argv: string[]) => teintes.executerTeintes([...argv, "--liste", liste, "--catalogue", fichierCatalogue, "--sortie", sortie], (l) => journal.push(l));

    before(async () => {
      sortie = mkdtempSync(path.join(tmpdir(), "coverswap-m19-teintes-"));
      // Deux photos 1536×1024 : un blanc franc en haut, une surface en bas. « fidele » : la surface au teint du
      // catalogue ; « ecart » : une surface bien trop claire.
      const photo = async (nom: string, surface: [number, number, number]) => {
        const haut = await sharp({ create: { width: 1536, height: 512, channels: 3, background: { r: 242, g: 242, b: 242 } } }).png().toBuffer();
        await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: surface[0], g: surface[1], b: surface[2] } } })
          .composite([{ input: haut, left: 0, top: 0 }])
          .png()
          .toFile(path.join(sortie, `${nom}-2.png`));
      };
      await photo("fidele", [0x61, 0x6a, 0x57]);
      await photo("ecart", [0xb0, 0xd0, 0xa0]);
      liste = path.join(sortie, "liste.json");
      const image = (nom: string, forcer?: string) => ({ nom, blanc: { objet: "mur blanc", zone: [10, 10, 30, 20] }, surfaces: [{ surface: "façades", en: "the fronts", ref: "RM20", ...(forcer ? { forcer } : {}), zones: [[10, 70, 30, 20]] }] });
      await fs.writeFile(liste, JSON.stringify({ seuil_delta_e: 12, essais_par_image: 2, blanc_cible: "#F2F2F2", images: [image("fidele"), image("ecart")] }));
      fichierCatalogue = path.join(sortie, "catalogue.json");
      await fs.writeFile(fichierCatalogue, JSON.stringify(catalogue));
    });

    test("--estimer : mesure et plan, aucune édition", async () => {
      const bilan = await lancer(["--choix", "fidele=2,ecart=2", "--estimer"]);
      const [fidele, ecart] = bilan.images;
      assert.equal(fidele.surfaces[0].aRecaler, false);
      assert.ok(fidele.surfaces[0].deltaE < 1);
      assert.equal(ecart.surfaces[0].aRecaler, true);
      assert.ok(ecart.surfaces[0].deltaE > 12);
      assert.ok(bilan.estimeDollars > 0);
      assert.equal(existsSync(path.join(sortie, "teintes", "ecart-teinte-1.png")), false);
      assert.ok(existsSync(path.join(sortie, "vignettes", "RM20.jpg")), "vignette téléchargée");
    });

    test("--recaler --essai : seules les images à recaler, 2 essais, relevé et planche ; rien de refait ensuite", async () => {
      const bilan = await lancer(["--choix", "fidele=2,ecart=2", "--recaler", "--essai"]);
      assert.equal(bilan.echecs.length, 0);
      assert.ok(existsSync(path.join(sortie, "teintes", "ecart-teinte-1.png")));
      assert.ok(existsSync(path.join(sortie, "teintes", "ecart-teinte-2.png")));
      assert.equal(existsSync(path.join(sortie, "teintes", "fidele-teinte-1.png")), false);
      assert.equal(bilan.images[1].essais.length, 2);
      assert.ok(existsSync(path.join(sortie, "planches", "teintes.jpg")));
      const releve = JSON.parse(await fs.readFile(path.join(sortie, "teintes", "mesures.json"), "utf8"));
      assert.equal(releve.images.length, 2);
      const avant = journal.length;
      await lancer(["--choix", "fidele=2,ecart=2", "--recaler", "--essai"]);
      assert.ok(journal.slice(avant).some((l) => /0 édition\(s\) à faire/.test(l)), "rien de refait");
    });

    test("forcer : une surface sous le seuil est recalée à la demande, avec sa raison", async () => {
      const l = JSON.parse(await fs.readFile(liste, "utf8"));
      l.images[0].surfaces[0].forcer = "relevé à l'œil";
      await fs.writeFile(liste, JSON.stringify(l));
      const bilan = await lancer(["--choix", "fidele=2,ecart=2", "--estimer"]);
      assert.equal(bilan.images[0].surfaces[0].aRecaler, true);
      assert.equal(bilan.images[0].surfaces[0].force, "relevé à l'œil");
    });

    test("photo retenue hors choix (`fichier`) et étiquette changée (`prevue`) : mesurées, et la planche des compositions écrite", async () => {
      const l = JSON.parse(await fs.readFile(liste, "utf8"));
      await fs.mkdir(path.join(sortie, "teintes"), { recursive: true });
      await fs.copyFile(path.join(sortie, "fidele-2.png"), path.join(sortie, "teintes", "retenue.png"));
      l.images[1].fichier = "teintes/retenue.png";
      l.images[1].surfaces[0] = { ...l.images[1].surfaces[0], ref: "RM20", prevue: "AG13" };
      delete l.images[0].surfaces[0].forcer;
      await fs.writeFile(liste, JSON.stringify(l));
      const bilan = await lancer(["--choix", "fidele=2", "--estimer"]);
      assert.equal(bilan.images[1].fichier, path.join(sortie, "teintes", "retenue.png"));
      assert.ok(bilan.images[1].surfaces[0].deltaE < 1, "la photo retenue est mesurée, pas l'essai choisi");
      assert.equal(bilan.images[1].surfaces[0].prevue, "AG13");
      assert.ok(existsSync(path.join(sortie, "planches", "compositions.jpg")));
    });

    test("choix manquant ou photo absente : rien n'est lancé", async () => {
      await assert.rejects(lancer(["--choix", "ecart=2"]), /essai choisi inconnu/);
      await assert.rejects(lancer(["--choix", "fidele=3"]), /absent/);
    });
  });
});

describe("édition multipart : la photo puis les vignettes", () => {
  test("le vrai client envoie image[] dans l'ordre, et compte les échantillons", async () => {
    const ancienne = process.env.OPENAI_BASE_URL;
    const cle = process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = "http://openai.essai/v1";
    process.env.OPENAI_API_KEY = "cle-essai";
    let noms: string[] = [];
    routeOpenAI = async (adresse, init) => {
      assert.match(adresse, /\/images\/edits$/);
      const formulaire = init!.body as FormData;
      noms = formulaire.getAll("image[]").map((f) => (f as File).name);
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const piece = (nom: string) => ({ octets: Buffer.from([1]), type: "image/png" as const, nom });
      const r = await generation.genererAmbiance({ prompt: "p", format: "1536x1024", source: piece("photo.png"), references: [piece("AG13.png"), piece("RM20.png")] }, { modele: "gpt-image-2.5-sunburst" });
      assert.equal(r.ok, true);
      assert.deepEqual(noms, ["photo.png", "AG13.png", "RM20.png"]);
    } finally {
      process.env.OPENAI_BASE_URL = ancienne ?? "";
      process.env.OPENAI_API_KEY = cle ?? "";
      routeOpenAI = null;
    }
  });
});
