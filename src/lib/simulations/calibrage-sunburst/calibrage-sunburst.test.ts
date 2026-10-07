import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

/**
 * Calibrage Sunburst (consigne du 07/10, mission 23, phase S0) — pré-compensation des teintes, masque automatique et son
 * harnais, budget de la campagne. Images SYNTHÉTIQUES faites ici par sharp (aucune photo de client) ; aucun appel
 * réseau : la réponse du modèle vision est écrite à la main.
 */

let pc: typeof import("./precompensation");
let ma: typeof import("./masque-auto");
let bu: typeof import("./budget");
let teintes: typeof import("../teintes");
let sharp: typeof import("sharp");

before(async () => {
  pc = await import("./precompensation");
  ma = await import("./masque-auto");
  bu = await import("./budget");
  teintes = await import("../teintes");
  sharp = (await import("sharp")).default;
});

const lab = (hex: string) => teintes.rgbVersLab(teintes.hexVersRgb(hex));

describe("pré-compensation des teintes", () => {
  test("décalage : signes et sens (trop foncé, trop gris, trop froid) ; pas d'angle de teinte pour un blanc", () => {
    const cible = lab("#B59C7E");
    const d = pc.decalageDe([cible[0] - 6, cible[1] - 2, cible[2] - 7], cible);
    assert.ok(d.dL < 0 && d.da < 0 && d.db < 0 && d.dC < 0);
    assert.notEqual(d.dh, null);
    assert.equal(pc.sensDuDecalage(d), "trop foncé, trop gris, trop froid, trop vert");
    assert.equal(pc.decalageDe(lab("#F4F3F1"), lab("#FFFFFF")).dh, null);
    assert.equal(pc.sensDuDecalage({ dL: 1, da: 0.5, db: -1, dC: 1.9 }), "juste");
  });

  test("familles du calibrage : celles de la mission 24, bois coupés en clairs et foncés", () => {
    const attendu: [string, string, "uni" | "bois" | "pierre", string][] = [
      ["K4", "#97876D", "uni", "beiges"], ["NE55", "#B59C7E", "uni", "beiges"], ["M7", "#C2B7A3", "uni", "beiges"],
      ["J4", "#F4F3F1", "uni", "blancs"], ["N3", "#F1E4D3", "uni", "blancs"], ["J3", "#FFFFFF", "uni", "blancs"],
      ["K1", "#232220", "uni", "sombres"], ["M9", "#2B2E37", "uni", "sombres"], ["NF13", "#23342E", "uni", "sombres"],
      ["RM30", "#A4A38F", "uni", "sourds"], ["RM21", "#4D583A", "uni", "sourds"], ["NE24", "#A9A49E", "pierre", "sourds"],
      ["AA17", "#B1946F", "bois", "bois clairs"], ["AA01", "#B49063", "bois", "bois clairs"], ["AA14", "#6B5138", "bois", "bois foncés"], ["AA05", "#362318", "bois", "bois foncés"],
    ];
    for (const [ref, hex, classe, famille] of attendu) assert.equal(pc.familleCalibrage(hex, classe), famille, ref);
  });

  test("cible d'entrée : décalée dans le sens inverse (a, b en entier, clarté à moitié), et la sortie retombe sur le catalogue", () => {
    const catalogue = lab("#B59C7E");
    const decalage = { dL: -6, da: -2, db: -6 };
    const c = pc.cibleEntree("#B59C7E", decalage);
    assert.match(c.hex, /^#[0-9A-F]{6}$/);
    assert.ok(Math.abs(c.lab[0] - (catalogue[0] + 3)) < 0.6, `L ${c.lab[0]}`);
    assert.ok(Math.abs(c.lab[1] - (catalogue[1] + 2)) < 0.6, `a ${c.lab[1]}`);
    assert.ok(Math.abs(c.lab[2] - (catalogue[2] + 6)) < 0.6, `b ${c.lab[2]}`);
    assert.equal(c.reductionGamut, 0);
    assert.equal(c.bornee, false);
    assert.ok(c.ecartAuCatalogue > 2);
    // Un modèle qui décale toujours de la même façon rend, depuis la cible, le catalogue (en a et b).
    const sortie: [number, number, number] = [c.lab[0] + decalage.dL, c.lab[1] + decalage.da, c.lab[2] + decalage.db];
    assert.ok(teintes.deltaE2000([catalogue[0], sortie[1], sortie[2]], catalogue) < 0.8);
    // Gain réglable : rien à compenser → le catalogue lui-même.
    assert.equal(pc.cibleEntree("#B59C7E", { dL: 0, da: 0, db: 0 }).hex, "#B59C7E");
    assert.ok(Math.abs(pc.cibleEntree("#B59C7E", decalage, { gainClarte: 1 }).lab[0] - (catalogue[0] + 6)) < 0.6);
  });

  test("gamut : une cible hors sRGB perd de la saturation, jamais sa clarté ni son angle de teinte", () => {
    const c = pc.cibleEntree("#F8210F", { dL: 0, da: -30, db: -10 });
    assert.ok(c.reductionGamut > 0, `réduction ${c.reductionGamut}`);
    assert.ok(pc.dansLeGamut(c.lab));
    assert.ok(Math.abs(c.lab[0] - c.voulu[0]) < 0.8, `L ${c.lab[0]} / ${c.voulu[0]}`);
    const angle = (l: number[]) => (Math.atan2(l[2], l[1]) * 180) / Math.PI;
    assert.ok(Math.abs(angle(c.lab) - angle(c.voulu)) < 1.5);
    const bornee = pc.cibleEntree("#B59C7E", { dL: -80, da: -40, db: -40 });
    assert.equal(bornee.bornee, true);
    assert.ok(bornee.ecartAuCatalogue <= pc.ECART_ENTREE_MAX + 0.5, `${bornee.ecartAuCatalogue}`);
  });

  test("tour suivant : la cible précédente moins le décalage qui reste", () => {
    const t1 = pc.cibleEntree("#97876D", { dL: -6, da: 0.5, db: -5 });
    const t2 = pc.ajusterCible("#97876D", t1.hex, { dL: 0, da: 0, db: 2 });
    assert.ok(Math.abs(t2.lab[2] - (t1.lab[2] - 2)) < 0.6);
    assert.ok(Math.abs(t2.lab[1] - t1.lab[1]) < 0.6);
    assert.equal(pc.ajusterCible("#97876D", t1.hex, { dL: 0, da: 0, db: 0 }).hex, t1.hex);
  });

  test("référence et description compensées : le moteur décrit la cible (hex en mots), le fil du bois reste celui de la vignette", () => {
    const ref = { ref: "AA17", nom: "Beige Line Oak", famille: "bois", categorie: "Medium", finition: "Soft", tags: ["chêne"], hex: "#B1946F", couleur: { hex: "#B1946F", clarte: 63.1, chroma: 24.2, teinte: 77, contraste: 6 } };
    const cible = pc.cibleEntree("#B1946F", { dL: -5, da: 2, db: -4 });
    const r = pc.referenceCompensee(ref, cible.hex);
    assert.equal(r.hex, cible.hex);
    assert.equal(r.couleur?.contraste, 6);
    const avant = pc.descriptionCompensee(ref, "#B1946F", "meubles-bas");
    const apres = pc.descriptionCompensee(ref, cible.hex, "meubles-bas");
    assert.ok(apres.includes(cible.hex) && !apres.includes("#B1946F"), apres);
    assert.ok(avant.includes("#B1946F"));
    // Même phrase de fil (le nom « Line » la fixe), même finition : seule la couleur change.
    assert.equal(apres.replace(/base tone [^;]*;/, ""), avant.replace(/base tone [^;]*;/, ""));
    assert.throws(() => pc.referenceCompensee(ref, "beige"));
  });

  test("planche : l'aplat est peint au hex ; le nuancier en vraie texture garde le fil et tombe sur la cible", async () => {
    const aplat = await pc.tuileAplat("#A08A6E", 64);
    const { data } = await sharp(aplat).raw().toBuffer({ resolveWithObject: true });
    assert.ok(teintes.deltaE([data[0], data[1], data[2]], teintes.hexVersRgb("#A08A6E")) < 1);
    // Un faux bois : des bandes claires et foncées.
    const L = 128;
    const brut = Buffer.alloc(L * L * 3);
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      const v = Math.sin(x / 3) > 0.3 ? 30 : 0;
      brut.set([150 + v, 120 + v, 80 + v], (y * L + x) * 3);
    }
    const vignette = await sharp(brut, { raw: { width: L, height: L, channels: 3 } }).png().toBuffer();
    const t = await pc.tuileRecoloree(vignette, "#C4A57E", L);
    assert.ok(t.ecart < 1.5, `écart ${t.ecart}`);
    const ecartType = async (img: Buffer) => {
      const { data: d } = await sharp(img).greyscale().raw().toBuffer({ resolveWithObject: true });
      const m = d.reduce((s, v) => s + v, 0) / d.length;
      return Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / d.length);
    };
    const fil = await ecartType(t.image);
    assert.ok(fil > 0.6 * (await ecartType(vignette)), `fil ${fil}`);
  });
});

describe("masque automatique et harnais", () => {
  test("réponse du modèle : sommets bornés et arrondis au demi-pour-cent ; polygones dégénérés écartés", () => {
    const lu = ma.lireReponseMasque({ facades: [{ libelle: "base run", polygone: [[10.26, 40], [52.1, 40.4], [52, 80], [-3, 120]] }, { libelle: "trait", polygone: [[1, 1], [2, 2]] }, { libelle: "plat", polygone: [[5, 5], [10, 10], [15, 15]] }], absente: false });
    assert.ok(lu);
    assert.equal(lu.facades.length, 1);
    assert.deepEqual(lu.facades[0].polygone, [[10.5, 40], [52, 40.5], [52, 80], [0, 100]]);
    assert.equal(ma.lireReponseMasque({ absente: true }), null);
    assert.equal(ma.lireReponseMasque("texte"), null);
    assert.deepEqual(ma.lireReponseMasque({ facades: [], absente: true }), { facades: [], absente: true });
  });

  test("demande : zone en mots du simulateur, grille de 5 %, schéma strict", () => {
    const t = ma.texteMasque("meubles-bas");
    assert.match(t, /BASE UNITS/);
    assert.match(t, /every 5 %/);
    const s = ma.schemaMasque() as { required: string[]; additionalProperties: boolean };
    assert.deepEqual(s.required, ["facades", "absente"]);
    assert.equal(s.additionalProperties, false);
    const svg = ma.grilleSvg(400, 300);
    assert.equal((svg.match(/<line /g) ?? []).length, 38);
    assert.match(svg, />50<\/text>/);
  });

  test("rasterisation et IoU : identiques → 1 ; décalé d'une case de grille → recouvrement mesuré, façade manquée comptée", () => {
    const W = 200;
    const H = 100;
    const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const dessin = ma.rasteriser([rect(10, 20, 50, 60)], W, H);
    assert.equal(dessin.reduce((s, v) => s + v, 0), 80 * 40);
    const memes = ma.comparerMasques(dessin, dessin, [dessin]);
    assert.deepEqual([memes.iou, memes.manquee, memes.debordee, memes.pireFacade], [1, 0, 0, 0]);
    const decale = ma.rasteriser([rect(15, 20, 55, 60)], W, H);
    const c = ma.comparerMasques(decale, dessin, [ma.rasteriser([rect(10, 20, 30, 60)], W, H), ma.rasteriser([rect(30, 20, 50, 60)], W, H)]);
    assert.equal(c.iou, Math.round((70 / 90) * 1000) / 1000);
    assert.equal(c.manquee, 0.125);
    assert.equal(c.debordee, 0.125);
    assert.deepEqual(c.manqueeParFacade, [0.25, 0]);
    assert.equal(c.pireFacade, 0.25);
    assert.equal(ma.aire(rect(10, 20, 50, 60)), 1600);
  });

  test("barre de S1 : IoU médian ≥ 0,8 et aucune façade manquée à plus de 15 %", () => {
    const c = (iou: number, pire: number) => ({ iou, manquee: 0, debordee: 0, manqueeParFacade: [pire], pireFacade: pire });
    assert.equal(ma.critereS1([c(0.85, 0.1), c(0.82, 0.05), c(0.7, 0.12)]).passe, true);
    const echec = ma.critereS1([c(0.85, 0.1), c(0.75, 0.05), c(0.7, 0.3)]);
    assert.equal(echec.passe, false);
    assert.equal(echec.raisons.length, 2);
    assert.equal(ma.critereS1([]).passe, false);
  });

  test("masque troué : une poignée dans la façade reste hors du repeint ; un grain de moins de 40 px est ignoré", async () => {
    const W = 120;
    const H = 80;
    const brut = Buffer.alloc(W * H * 3, 180);
    const peindre = (x0: number, y0: number, l: number, h: number, v: number) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) brut.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3);
    };
    peindre(40, 20, 4, 30, 40); // poignée : 120 px
    peindre(90, 50, 3, 3, 40); // grain : 9 px
    const photo = await sharp(brut, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const m = await ma.masqueTroueDepuisPolygones(photo, [[[10, 10], [90, 10], [90, 90], [10, 90]]]);
    const i = (x: number, y: number) => y * W + x;
    assert.equal(m.zone[i(42, 30)], 1);
    assert.equal(m.peindre[i(42, 30)], 0, "la poignée n'est pas repeinte");
    assert.equal(m.peindre[i(91, 51)], 1, "le grain est repeint");
    assert.equal(m.peindre[i(20, 60)], 1);
    assert.equal(m.peindre[i(5, 5)], 0, "hors zone");
    assert.ok(m.trous >= 120);
    const png = await ma.masqueOpenAI(m.peindre, m.largeur, m.hauteur);
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[i(20, 60) * 4 + 3], 0);
    assert.equal(data[i(42, 30) * 4 + 3], 255);
  });

  test("coût d'un appel vision estimé avant l'appel (règles de jetons d'image publiées)", () => {
    assert.equal(ma.jetonsImage("gpt-4.1-mini", 1024, 768), Math.ceil(32 * 24 * 1.62));
    assert.equal(ma.jetonsImage("gpt-4.1-mini", 1024, 1536), Math.ceil(1536 * 1.62));
    assert.ok(ma.jetonsImage("gpt-4.1-mini", 2048, 2048) <= Math.ceil(1536 * 1.62));
    assert.equal(ma.jetonsImage("gpt-4.1", 1024, 768), 85 + 170 * 4);
    assert.equal(ma.jetonsImage("gpt-4.1", 1024, 768, "low"), 85);
    const mini = ma.estimerCoutVision("gpt-4.1-mini", 1024, 768, "meubles-bas");
    const fort = ma.estimerCoutVision("gpt-4.1", 1024, 768, "meubles-bas");
    assert.ok(mini.dollars > 0.0005 && mini.dollars < 0.005, `${mini.dollars}`);
    assert.ok(fort.dollars > mini.dollars * 2);
    assert.equal(ma.coutVision("gpt-4.1-mini", 1_000_000, 0), 0.4);
    assert.throws(() => ma.estimerCoutVision("gpt-9", 10, 10, "meubles-bas"));
  });
});

describe("budget de la campagne", () => {
  const appel = (j: import("./budget").Journal, cle: string, cout: number, erreur: string | null = null, estimation = 0.0435) =>
    bu.inscrireAppel(j, { le: "2026-10-07T18:00:00Z", phase: "S2", enveloppe: "E2", type: "rendu", modele: "gpt-image-2.5-sunburst", cle, estimation, cout, usage: null, erreur });

  test("quatre enveloppes : 10 / 60 / 15 / 15 % de 2,30 $", () => {
    const j = bu.journalVide();
    const plafonds = (["E1", "E2", "E3", "E4"] as const).map((e) => bu.plafondEnveloppe(j, e));
    assert.deepEqual(plafonds, [0.23, 1.38, 0.345, 0.345]);
    assert.equal(Math.round(plafonds.reduce((s, p) => s + p, 0) * 1000) / 1000, bu.BUDGET_DOLLARS);
    assert.equal(bu.enveloppeDe("S3"), "E3");
  });

  test("plafond relu avant chaque appel : l'enveloppe, puis le total", () => {
    let j = bu.journalVide();
    for (let k = 0; k < 31; k++) j = appel(j, `t${k}`, 0.0435).journal;
    assert.equal(bu.depenseEnveloppe(j, "E2"), 1.3485);
    assert.equal(bu.autoriserAppel(j, "E2", 0.0435, "suivant").ok, false);
    assert.equal(bu.autoriserAppel(j, "E3", 0.0435, "autre").ok, true);
    assert.match(bu.ligneCumul(j, "E2"), /CUMUL 1\.3485 \$ \/ 2\.3 \$/);
    assert.equal(bu.autoriserAppel(bu.journalVide(), "E1", 0, "x").ok, false);
  });

  test("un appel à plus du double de son estimation arrête tout", () => {
    const { journal, arret } = appel(bu.journalVide(), "a", 0.09);
    assert.equal(arret, true);
    const refus = bu.autoriserAppel(journal, "E2", 0.0435, "b");
    assert.equal(refus.ok, false);
    assert.equal(appel(bu.journalVide(), "a", 0.08).arret, false);
  });

  test("un appel raté n'est rejoué qu'une fois ; un appel réussi n'est pas refait sous la même clé", () => {
    let j = appel(bu.journalVide(), "p04-K4-t1", 0, "HTTP 500").journal;
    assert.equal(bu.autoriserAppel(j, "E2", 0.0435, "p04-K4-t1").ok, true);
    j = appel(j, "p04-K4-t1", 0, "HTTP 500").journal;
    assert.equal(bu.autoriserAppel(j, "E2", 0.0435, "p04-K4-t1").ok, false);
    const ok = appel(bu.journalVide(), "p06-M7-t1", 0.043).journal;
    assert.equal(bu.autoriserAppel(ok, "E2", 0.0435, "p06-M7-t1").ok, false);
  });

  test("report d'une enveloppe : justification écrite, jamais plus que ce qui reste", () => {
    const j = bu.journalVide();
    assert.throws(() => bu.reporter(j, "E1", "E2", 0.1, "trop court"));
    assert.throws(() => bu.reporter(j, "E1", "E2", 0.3, "Le masque automatique a coûté moins que prévu : le reste va aux beiges."));
    const r = bu.reporter(j, "E1", "E2", 0.1, "Le masque automatique a coûté moins que prévu : le reste va aux beiges.");
    assert.equal(bu.plafondEnveloppe(r, "E2"), 1.48);
    assert.equal(bu.plafondEnveloppe(r, "E1"), 0.13);
    const t = bu.totalPhase(appel(r, "x", 0.04).journal, "S2");
    assert.deepEqual([t.appels, t.rendus, t.cout], [1, 1, 0.04]);
  });
});
