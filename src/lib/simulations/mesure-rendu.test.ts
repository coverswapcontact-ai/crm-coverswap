import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/**
 * Mission 23 (L2a) — la mesure automatique d'un rendu (`mesure-rendu.ts`) et d'un jeu d'essai (`mesure-jeu.ts`), sur
 * des images SYNTHÉTIQUES faites ici par sharp (aucune photo de client, aucun réseau) : un aplat connu décalé de ΔE ≈ 6,
 * un dégradé d'éclairage, un faux bois devenu aplat ou changé de teinte, un rendu décalé de 30 px, deux surfaces de
 * deux teintes, une scène sans vrai blanc, le temps à 1024 px ; puis un petit jeu au format du zip de L1.
 */

let mr: typeof import("./mesure-rendu");
let mj: typeof import("./mesure-jeu");
let teintes: typeof import("./teintes");
let sharp: typeof import("sharp");
const DOSSIER = mkdtempSync(path.join(tmpdir(), "coverswap-mesure-rendu-"));

before(async () => {
  mr = await import("./mesure-rendu");
  mj = await import("./mesure-jeu");
  teintes = await import("./teintes");
  sharp = (await import("sharp")).default;
});
after(() => rmSync(DOSSIER, { recursive: true, force: true }));

const W = 1024;
const H = 683;
type Rgb = [number, number, number];
/** Une couleur par pixel (x, y) → RGB. */
type Peintre = (x: number, y: number) => Rgb;
type Rect = [number, number, number, number];
const dans = (r: Rect, x: number, y: number) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

let compteur = 0;
async function image(peintre: Peintre, largeur = W, hauteur = H): Promise<string> {
  const brut = Buffer.alloc(largeur * hauteur * 3);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const c = peintre(x, y);
      const i = 3 * (y * largeur + x);
      brut[i] = Math.max(0, Math.min(255, Math.round(c[0])));
      brut[i + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      brut[i + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
    }
  const fichier = path.join(DOSSIER, `image-${++compteur}.png`);
  await sharp(brut, { raw: { width: largeur, height: hauteur, channels: 3 } }).png().toFile(fichier);
  return fichier;
}

const hex = (h: string) => teintes.hexVersRgb(h) as Rgb;
// La pièce : un mur gris moyen (pas un candidat blanc), un cadre blanc #F2F2F2 (le blanc de la scène), un sol sombre.
const MUR: Rgb = [140, 138, 135];
const BLANC: Rgb = [242, 242, 242];
const SOL: Rgb = [70, 60, 50];
const CADRE: Rect = [40, 40, 160, 120];
const FACADE: Rect = [300, 300, 450, 300];
const piece = (facade: Peintre, cadre: Rgb | null = BLANC, mur: Rgb = MUR): Peintre => (x, y) => {
  if (cadre && dans(CADRE, x, y)) return cadre;
  if (dans(FACADE, x, y)) return facade(x, y);
  if (y >= 640) return SOL;
  return mur;
};
const uni = (c: Rgb): Peintre => () => c;
/** Faux bois : des rayures verticales irrégulières de ±amp autour de la teinte (période 6 à 9 px). */
const fauxBois = (c: Rgb, amp = 18): Peintre => (x) => {
  const v = amp * Math.sin(x * 0.9) * (0.6 + 0.4 * Math.sin(x * 0.13));
  return [c[0] + v, c[1] + v, c[2] + v];
};
const ref = (r: string, h: string, classe: "uni" | "bois" | "pierre" = "uni") => ({ ref: r, nom: r, hex: h, classe });

describe("mesure d'un rendu : masque, ΔE 2000, texture, respect", () => {
  test("Lab de libvips = rgbVersLab de teintes.ts à 0,05 près", async () => {
    const couleurs: Rgb[] = [[255, 255, 255], [0, 0, 0], [164, 163, 143], [97, 106, 87], [43, 46, 55], [227, 218, 209], [200, 30, 30], [10, 200, 10], [30, 30, 220], [128, 128, 128]];
    const lab = await mr.labImage(Buffer.from(couleurs.flat()), couleurs.length, 1);
    couleurs.forEach((c, i) => {
      const attendu = teintes.rgbVersLab(c);
      assert.ok(Math.abs(lab.L[i] - attendu[0]) < 0.05 && Math.abs(lab.a[i] - attendu[1]) < 0.05 && Math.abs(lab.b[i] - attendu[2]) < 0.05, `${c} : ${lab.L[i]} ${lab.a[i]} ${lab.b[i]} contre ${attendu}`);
    });
  });

  test("un aplat connu décalé de ΔE ≈ 6 : le masque est retrouvé, le ΔE mesuré à ±1", async () => {
    // RM30 Pastel Olive Green (#A4A38F) rendu trop vert et trop clair (#A6B095), sur une façade d'abord beige foncé.
    const avant = await image(piece(uni([120, 100, 80])));
    const rendu = await image(piece(uni(hex("#A6B095"))));
    const attendu = teintes.deltaE(hex("#A6B095"), hex("#A4A38F"));
    assert.ok(attendu > 5 && attendu < 7, `ΔE de l'énoncé : ${attendu}`);
    const m = await mr.mesurerRendu(avant, rendu, [ref("RM30", "#A4A38F")]);
    assert.equal(m.masque.douteux, false, m.masque.raisons.join(" ; "));
    assert.equal(m.balance.mode, "blanc");
    const s = m.surfaces[0];
    assert.equal(s.trouvee, true);
    const aire = (FACADE[2] * FACADE[3]) / (W * H);
    assert.ok(Math.abs(s.part - aire) / aire < 0.1, `part ${s.part} contre ${aire}`);
    assert.ok(Math.abs(s.deltaE! - attendu) <= 1, `ΔE ${s.deltaE} contre ${attendu}`);
    // La dérive a le bon signe : plus clair (L > 0) et plus saturé (C* > 0), plus vert (a < 0).
    assert.ok(s.derive!.L > 0 && s.derive!.C > 0 && s.derive!.a < 0, JSON.stringify(s.derive));
    assert.equal(s.texture.perdue, false);
    assert.ok(m.respect.contoursHorsMasque < 5, `contours hors masque ${m.respect.contoursHorsMasque}`);
    assert.equal(m.respect.partHorsZones, null);
  });

  test("un dégradé d'éclairage sur la surface : la médiane reste juste", async () => {
    const avant = await image(piece(uni([120, 100, 80])));
    const Y = hex("#7A8A6A");
    // ±15 % d'éclairage en lumière linéaire, de gauche à droite (symétrique : la médiane est au centre).
    const degrade: Peintre = (x) => {
      const k = 0.85 + (0.3 * (x - FACADE[0])) / (FACADE[2] - 1);
      return Y.map((c) => teintes.versSrgb(teintes.versLineaire(c) * k)) as Rgb;
    };
    const m = await mr.mesurerRendu(avant, await image(piece(degrade)), [ref("X", "#7A8A6A")]);
    const s = m.surfaces[0];
    assert.equal(s.trouvee, true);
    assert.ok(s.deltaE! <= 1.5, `ΔE ${s.deltaE} (mesuré ${s.mesure})`);
    assert.equal(s.texture.perdue, false);
  });

  test("un faux bois remplacé par un aplat : texture perdue", async () => {
    const avant = await image(piece(fauxBois([150, 110, 70])));
    const m = await mr.mesurerRendu(avant, await image(piece(uni([200, 170, 130]))), [ref("BOIS", "#C8AA82", "bois")]);
    assert.equal(m.surfaces[0].trouvee, true);
    assert.equal(m.surfaces[0].texture.attendue, "bois");
    assert.equal(m.surfaces[0].texture.perdue, true, `texture ${m.surfaces[0].texture.mesuree}`);
  });

  test("un faux bois remplacé par un faux bois d'une autre teinte : texture gardée", async () => {
    const avant = await image(piece(fauxBois([150, 110, 70])));
    const m = await mr.mesurerRendu(avant, await image(piece(fauxBois([200, 170, 130]))), [ref("BOIS", "#C8AA82", "bois")]);
    const s = m.surfaces[0];
    assert.equal(s.trouvee, true);
    assert.equal(s.texture.perdue, false, `texture ${s.texture.mesuree}`);
    assert.ok(s.texture.mesuree! > mr.SEUIL_TEXTURE * 2);
    assert.ok(s.deltaE! < 3, `ΔE ${s.deltaE}`);
  });

  test("un rendu décalé de 30 px : masque douteux, avec sa raison", async () => {
    // Une pièce chargée de contours : des blocs de couleurs différentes, comme des meubles et des objets.
    const blocs: Peintre = (x, y) => {
      const i = Math.floor(x / 64) + 17 * Math.floor(y / 48);
      return [60 + ((i * 53) % 170), 60 + ((i * 97) % 170), 60 + ((i * 31) % 170)];
    };
    const avant = await image(blocs);
    const rendu = await image((x, y) => (dans(FACADE, x, y) ? hex("#A4A38F") : blocs(Math.max(0, x - 30), y)));
    const m = await mr.mesurerRendu(avant, rendu, [ref("RM30", "#A4A38F")]);
    assert.equal(m.masque.douteux, true);
    assert.ok(m.masque.raisons.some((r) => /contours|couvre/.test(r)), m.masque.raisons.join(" ; "));
  });

  test("deux surfaces de deux teintes : deux composantes, deux ΔE", async () => {
    const HAUT: Rect = [300, 60, 450, 180];
    const deux = (haut: Rgb, bas: Rgb): Peintre => (x, y) => (dans(CADRE, x, y) ? BLANC : dans(HAUT, x, y) ? haut : dans(FACADE, x, y) ? bas : y >= 640 ? SOL : MUR);
    const avant = await image(deux([120, 100, 80], [120, 100, 80]));
    const rendu = await image(deux(hex("#E3DAD1"), hex("#2B2E37")));
    const m = await mr.mesurerRendu(avant, rendu, [{ ...ref("NH26", "#E3DAD1"), zones: [[29, 8, 45, 27]] }, { ...ref("M9", "#2B2E37"), zones: [[29, 43, 45, 45]] }]);
    assert.equal(m.surfaces.length, 2);
    for (const s of m.surfaces) {
      assert.equal(s.trouvee, true, s.ref);
      assert.ok(s.deltaE! < 2, `${s.ref} ΔE ${s.deltaE}`);
    }
    assert.ok(m.surfaces[0].part > 0.08 && m.surfaces[0].part < 0.14, `haut ${m.surfaces[0].part}`);
    assert.ok(m.surfaces[1].part > 0.15 && m.surfaces[1].part < 0.23, `bas ${m.surfaces[1].part}`);
    assert.equal(m.composantes.filter((c) => !c.horsDemande).length, 2);
    // Les zones demandées sont connues : rien n'a changé ailleurs.
    assert.ok(m.respect.partHorsZones !== null && m.respect.partHorsZones < 0.05, `hors zones ${m.respect.partHorsZones}`);
  });

  test("une photo sans vrai blanc : la dominante seulement, pas l'exposition", async () => {
    // Un mur crème (pas un neutre), aucun cadre blanc : le blanc n'est pas ramené à #F2F2F2.
    const creme: Rgb = [235, 222, 196];
    const avant = await image(piece(uni([120, 100, 80]), null, creme));
    const Y = hex("#7A8A6A");
    const m = await mr.mesurerRendu(avant, await image(piece(uni(Y), null, creme)), [ref("X", "#7A8A6A")]);
    assert.equal(m.balance.mode, "dominante");
    const s = m.surfaces[0];
    // La luminance de la scène est gardée : la clarté mesurée reste celle du rendu, à la dominante près.
    const Lmesure = teintes.rgbVersLab(hex(s.mesure!))[0];
    const Lbrute = teintes.rgbVersLab(hex(s.brute!))[0];
    assert.ok(Math.abs(Lmesure - Lbrute) < 3, `L ${Lmesure} contre ${Lbrute}`);
    // Avec un vrai blanc mais à l'ombre (#C8C8C8), l'exposition est corrigée : la surface est mesurée plus claire.
    const ombre = await mr.mesurerRendu(await image(piece(uni([120, 100, 80]), [200, 200, 200])), await image(piece(uni(Y), [200, 200, 200])), [ref("X", "#7A8A6A")]);
    assert.equal(ombre.balance.mode, "blanc");
    assert.ok(ombre.surfaces[0].derive!.L > 5, `L ${ombre.surfaces[0].derive!.L}`);
  });

  test("le temps : moins d'une seconde à 1024 px (meilleur de trois)", async () => {
    const avant = await image(piece(fauxBois([150, 110, 70])));
    const rendu = await image(piece(fauxBois([110, 120, 90])));
    let meilleur = Infinity;
    for (let k = 0; k < 3; k++) meilleur = Math.min(meilleur, (await mr.mesurerRendu(avant, rendu, [ref("A", "#6E785A", "bois")])).dureeMs);
    assert.ok(meilleur < 1000, `${meilleur} ms`);
  });
});

describe("classes et familles de teinte, analyse d'erreur", () => {
  test("classe de texture d'après le profil du catalogue", () => {
    assert.equal(mr.classeTexture({ id: "RM30", nom: "Pastel Olive Green", famille: "couleur", categorie: "Color", tags: [] } as never), "uni");
    assert.equal(mr.classeTexture({ nom: "Original Oak", famille: "bois", categorie: "Natural", tags: [] }), "bois");
    assert.equal(mr.classeTexture({ nom: "Creamy", famille: "bois", categorie: "Painted", tags: ["peint"] }), "uni");
    assert.equal(mr.classeTexture({ nom: "Onyx Gold", famille: "pierre", categorie: "Stone", tags: [] }), "pierre");
    assert.equal(mr.classeTexture({ nom: "Grey Concrete", famille: "beton", tags: [] }), "pierre");
  });

  test("familles : uni clair, sombre, désaturé ; bois clair, foncé ; pierre", () => {
    assert.equal(mr.familleTeinte("#A4A38F", "uni"), "uni désaturé");
    assert.equal(mr.familleTeinte("#616A57", "uni"), "uni désaturé");
    assert.equal(mr.familleTeinte("#E3DAD1", "uni"), "uni clair");
    assert.equal(mr.familleTeinte("#2B2E37", "uni"), "uni sombre");
    assert.equal(mr.familleTeinte("#C0392B", "uni"), "uni sombre");
    assert.equal(mr.familleTeinte("#F4D03F", "uni"), "uni clair");
    assert.equal(mr.familleTeinte("#C8AA82", "bois"), "bois clair");
    assert.equal(mr.familleTeinte("#583D29", "bois"), "bois foncé");
    assert.equal(mr.familleTeinte("#DCD7CE", "pierre"), "pierre");
  });

  test("analyse par famille : tous, par moteur, par modèle ; médiane, 90e centile, dérive moyenne", () => {
    const d = (L: number, C: number) => ({ L, a: -1, b: 2, C });
    const lignes = mr.analyserParFamille([
      { famille: "uni désaturé", moteur: "V1", modele: "gpt-image-1", deltaE: 6, derive: d(4, 3) },
      { famille: "uni désaturé", moteur: "V1", modele: "gpt-image-1", deltaE: 2, derive: d(2, 1) },
      { famille: "uni désaturé", moteur: "V2", modele: "inconnu", deltaE: 4, derive: d(0, -1) },
      { famille: "bois clair", moteur: "V1", modele: "gpt-image-1", deltaE: 8, derive: d(-3, 0) },
    ]);
    const tous = lignes.find((l) => l.famille === "uni désaturé" && l.groupe === "tous")!;
    assert.deepEqual([tous.n, tous.deltaEMedian, tous.deltaE90, tous.derive.L, tous.derive.C], [3, 4, 5.6, 2, 1]);
    assert.equal(lignes.find((l) => l.famille === "uni désaturé" && l.groupe === "moteur V1")!.n, 2);
    assert.equal(lignes.find((l) => l.famille === "uni désaturé" && l.groupe === "modèle inconnu")!.n, 1);
    assert.equal(lignes[0].famille, "uni désaturé");
    assert.equal(mr.centile([], 90), 0);
  });
});

describe("mesure d'un jeu d'essai dézippé (format du zip de L1)", () => {
  test("mesures.json et planches à côté du jeu, analyse par famille ; refus dans le dépôt", async () => {
    const racine = mkdtempSync(path.join(tmpdir(), "coverswap-mesure-jeu-"));
    try {
      const jeu = path.join(racine, "jeu");
      await fs.mkdir(jeu, { recursive: true });
      await fs.writeFile(path.join(jeu, "manifest.json"), JSON.stringify({ format: 1, nExporte: 2 }));
      const catalogue = path.join(racine, "catalogue.json");
      await fs.writeFile(
        catalogue,
        JSON.stringify([
          { id: "RM30", nom: "Pastel Olive Green", famille: "couleur", categorie: "Color", image: "https://exemple.essai/rm30.jpg", hex: "#A4A38F", tags: [] },
          { id: "AA14", nom: "Original Oak", famille: "bois", categorie: "Natural", image: "https://exemple.essai/aa14.jpg", hex: "#6B5138", tags: [] },
        ]),
      );
      const avant = await image(piece(uni([120, 100, 80])));
      const cas = [
        { id: "aaaaaaaaaaaa", zones: [{ zone: "meubles-bas", libelle: "Meubles bas", ref: "RM30", nom: "Pastel Olive Green" }], rendu: await image(piece(uni(hex("#A6B095")))), moteur: "V1", modele: "gpt-image-1" },
        { id: "bbbbbbbbbbbb", zones: [{ zone: "meubles-bas", libelle: "Meubles bas", ref: "AA14", nom: "Original Oak" }, { zone: "credence", libelle: "Crédence", ref: "INCONNUE", nom: "?" }], rendu: await image(piece(fauxBois([120, 90, 60]))), moteur: "V1", modele: null },
      ];
      for (const c of cas) {
        await fs.mkdir(path.join(jeu, c.id));
        await fs.copyFile(avant, path.join(jeu, c.id, "avant.png"));
        await fs.copyFile(c.rendu, path.join(jeu, c.id, "rendu.png"));
        await fs.writeFile(path.join(jeu, c.id, "meta.json"), JSON.stringify({ id: c.id, origine: "site", zones: c.zones, moteur: c.moteur, modele: c.modele, scoreControle: 7, exemple: false, fichiers: { avant: "avant.png", rendu: "rendu.png" } }));
      }
      const lignes: string[] = [];
      const bilan = await mj.executerMesureJeu([jeu, "--planches", "--catalogue", catalogue], (l) => lignes.push(l));
      assert.equal(bilan.sortie, path.join(racine, "mesures.json"));
      assert.equal(bilan.erreurs, 0);
      assert.equal(bilan.planches, 2);
      assert.ok(existsSync(path.join(racine, "planches", "aaaaaaaaaaaa.jpg")));
      const lu = JSON.parse(readFileSync(bilan.sortie, "utf8"));
      assert.equal(lu.cas.length, 2);
      assert.equal(lu.cas[0].mesure.detail, undefined);
      assert.deepEqual(lu.cas[1].refsInconnues, ["INCONNUE"]);
      assert.equal(lu.cas[1].familles.AA14, "bois foncé");
      assert.ok(lu.analyse.some((l: { famille: string; groupe: string }) => l.famille === "uni désaturé" && l.groupe === "modèle gpt-image-1"));
      assert.ok(lu.analyse.some((l: { famille: string; groupe: string }) => l.famille === "bois foncé" && l.groupe === "modèle inconnu"));
      assert.ok(lignes.some((l) => l.includes("Analyse par famille")));
      // Les photos et leurs mesures ne vont jamais dans le dépôt.
      assert.throws(() => mj.lireArgumentsMesureJeu([jeu, "--sortie", path.join(process.cwd(), "mesures.json")]), /dans le dépôt/);
      assert.throws(() => mj.lireArgumentsMesureJeu([path.join(process.cwd(), "jeu")]), /dans le dépôt/);
      assert.throws(() => mj.lireArgumentsMesureJeu([]), /Usage/);
      await assert.rejects(mj.executerMesureJeu([racine, "--catalogue", catalogue], () => undefined), /manifest\.json absent/);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});
