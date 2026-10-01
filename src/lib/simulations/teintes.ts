import { existsSync, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { genererAmbiance, typeImage, type AppelAmbiance, type FormatAmbiance, type QualiteAmbiance, type SourceEdition } from "./generation";
import { JETONS_IMAGE_EDITION, estimerAppel, lireChoix, modeleEdition, releverCouts, sortieParDefaut, PLAFOND_DEFAUT } from "./ambiances";
import { ecartContours } from "./planches";
import { PRIX } from "./prix";
import { CATALOGUE_DEFAUT, lireCatalogue, vignetteLocale, type Revetement } from "./vignettes";

/**
 * Les teintes fidèles des photos du site (mission 19, complément du 01/10/2026) — `scripts/teintes-ambiances.ts`.
 * Chaque photo d'ambiance affichera les références de ses revêtements : ce qu'on voit doit être ce que le client
 * recevra. Pour chaque surface de chaque photo choisie (`scripts/teintes-site-v2.json`) :
 *  - MESURE : la couleur médiane d'une ou plusieurs zones bien éclairées (rectangles en % de l'image), après correction
 *    de la balance des blancs sur un blanc de la scène : gains par canal en lumière linéaire qui ramènent ce blanc au
 *    blanc du catalogue `blanc_cible` (#F2F2F2, Statuary White) — la dominante ET l'exposition (une surface claire
 *    photographiée paraît plus sombre que sa vignette ; c'est sa clarté relative au blanc voisin qui compte). Le blanc
 *    est le quart le plus lumineux de sa zone (un objet blanc éclairé comme les surfaces, pas un blanc à l'ombre). Une
 *    scène sans vrai blanc (mur crème) a `exposition: false` : sa dominante est seulement neutralisée, à sa luminance ;
 *    comparée au hex de la référence du catalogue du site (`coverswap/src/data/revetements.json`) en ΔE 2000 ;
 *  - au-dessus de `seuil_delta_e` (12) — ou si la liste le demande (`forcer`, avec la raison) — la surface est à RECALER : édition (`gpt-image-2.5-sunburst`, `/images/edits`)
 *    avec la photo puis la vignette réelle de chaque référence à recaler (champ `image` du catalogue, téléchargée dans
 *    `<sortie>/vignettes/`), `essais_par_image` essais `<sortie>/teintes/<nom>-teinte-<k>.png`. Chaque essai est
 *    remesuré (toutes les surfaces, pour voir aussi ce qui aurait dérivé) et ses contours comparés à la photo
 *    (`ecartContours`, 0 = identiques) ;
 *  - l'essai recommandé : le plus fidèle sur les surfaces recalées (pire ΔE), puis le moins d'écart de contours ;
 *  - aucun essai fidèle : on propose la référence du catalogue la plus proche de la couleur ACTUELLE, même famille ;
 *  - une surface sans référence imposée (`plus_proche`) prend la référence la plus proche de sa couleur mesurée dans
 *    le filtre donné (famille, mot du nom, teinte claire) — « le chêne le plus proche », « le blanc uni le plus proche ».
 * Sorties : `<sortie>/teintes/mesures.json` et la planche `<sortie>/planches/teintes.jpg` (une ligne par image : la
 * photo et ses zones numérotées, pour chaque surface la zone, la vignette et le ΔE avant/après, puis les essais).
 * Le plafond de dépense vaut pour toute la mission : ce qui est déjà compté dans GenerationImage depuis `--depuis`
 * (début de la mission 19) + chaque appel estimé ≤ `--plafond` (30 $), sinon arrêt net. Une image déjà faite n'est
 * jamais refaite. Clé `OPENAI_API_KEY` jamais affichée.
 */

export const LISTE_TEINTES_DEFAUT = () => path.resolve(process.cwd(), "scripts", "teintes-site-v2.json");
export { CATALOGUE_DEFAUT } from "./vignettes";
/** Début de la mission 19 (les lignes GenerationImage d'avant sont la mission 16). */
export const DEBUT_MISSION_19 = "2026-09-30T18:00:00Z";

/* ── Couleur : sRGB, Lab (D65), ΔE 2000 ── */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export const versLineaire = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const versSrgb = (l: number) => {
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
};

export function hexVersRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Couleur mal écrite : ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbVersHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function rgbVersLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(versLineaire);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE 2000 (CIEDE2000, kL = kC = kH = 1). */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (bb: number, ap: number) => {
    if (bb === 0 && ap === 0) return 0;
    const t = Math.atan2(bb, ap) / rad;
    return t < 0 ? t + 360 : t;
  };
  const h1p = h(b1, a1p);
  const h2p = h(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hpm = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export const deltaE = (a: Rgb, b: Rgb) => deltaE2000(rgbVersLab(a), rgbVersLab(b));

/* ── La liste et le catalogue ── */

const zone = z.tuple([z.number().min(0).max(100), z.number().min(0).max(100), z.number().gt(0).max(100), z.number().gt(0).max(100)]);
export type Zone = z.infer<typeof zone>;
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const schemaSurface = z
  .object({
    /** En français : la surface telle que le site la nomme (« meubles bas et tiroirs »). */
    surface: z.string().min(1),
    /** En anglais : la même surface pour la consigne d'édition (« the lower cabinets and drawer fronts »). */
    en: z.string().min(1),
    ref: z.string().min(1).nullable(),
    /** Sans référence imposée : la plus proche de la couleur mesurée parmi ce filtre du catalogue. */
    plus_proche: z.object({ famille: z.string().min(1), mot: z.string().min(1).optional(), clair: z.boolean().optional() }).strict().optional(),
    /** La référence de la direction artistique, quand l'étiquette en a changé (relevé du 01/10/2026 : on garde la photo, on change l'étiquette). */
    prevue: z.string().min(1).optional(),
    /** Recaler même sous le seuil : la raison (ex. un écart relevé à l'œil par Lucas). */
    forcer: z.string().min(1).optional(),
    zones: z.array(zone).min(1),
  })
  .strict()
  .refine((s) => (s.ref === null) === (s.plus_proche !== undefined), { message: "une surface a soit `ref`, soit `ref: null` et `plus_proche`" });

const schemaImageTeintes = z
  .object({
    nom: z.string().regex(/^[a-z0-9-]+$/),
    /** La photo retenue, relative à la sortie, quand ce n'est pas l'essai choisi `<nom>-<n>.png` (ex. un essai recalé). */
    fichier: z.string().min(1).optional(),
    blanc: z.object({ objet: z.string().min(1), zone, exposition: z.boolean().optional() }).strict(), surfaces: z.array(schemaSurface).min(1).max(4) })
  .strict();

const schemaListeTeintes = z
  .object({ seuil_delta_e: z.number().positive(), essais_par_image: z.number().int().min(1).max(10), blanc_cible: hex, images: z.array(schemaImageTeintes).min(1) })
  .strict();

export type SurfaceTeinte = z.infer<typeof schemaSurface>;
export type ImageTeintes = z.infer<typeof schemaImageTeintes>;
export type ListeTeintes = z.infer<typeof schemaListeTeintes>;

export function lireListeTeintes(texte: string): ListeTeintes {
  const liste = schemaListeTeintes.parse(JSON.parse(texte));
  const noms = new Set<string>();
  for (const i of liste.images) {
    if (noms.has(i.nom)) throw new Error(`Liste des teintes : ${i.nom} en double.`);
    noms.add(i.nom);
  }
  return liste;
}

export { lireCatalogue, type Revetement } from "./vignettes";

/** Le filtre `plus_proche` : la famille, un mot du nom ou des tags, une teinte claire (L* ≥ 80, C* ≤ 12). */
export function dansLeFiltre(r: Revetement, filtre: NonNullable<SurfaceTeinte["plus_proche"]>): boolean {
  if (r.famille !== filtre.famille) return false;
  if (filtre.mot) {
    const mot = filtre.mot.toLowerCase();
    if (!r.nom.toLowerCase().includes(mot) && !(r.tags ?? []).some((t) => t.toLowerCase().includes(mot))) return false;
  }
  if (filtre.clair) {
    const [L, a, b] = rgbVersLab(hexVersRgb(r.hex));
    if (L < 80 || Math.hypot(a, b) > 12) return false;
  }
  return true;
}

/** La référence du catalogue la plus proche d'une couleur parmi celles qui passent le filtre. */
export function plusProche(couleur: Rgb, catalogue: Revetement[], filtre: (r: Revetement) => boolean): { ref: Revetement; deltaE: number } | null {
  let meilleur: { ref: Revetement; deltaE: number } | null = null;
  for (const r of catalogue) {
    if (!filtre(r)) continue;
    const d = deltaE(couleur, hexVersRgb(r.hex));
    if (!meilleur || d < meilleur.deltaE) meilleur = { ref: r, deltaE: d };
  }
  return meilleur;
}

/* ── Mesure ── */

const sharpModule = async () => (await import("sharp")).default;

/** Les pixels RGB (sans alpha) d'une zone en % d'une image. */
async function pixelsZone(fichier: string, z: Zone): Promise<Buffer> {
  const sharp = await sharpModule();
  const meta = await sharp(fichier).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const left = Math.max(0, Math.min(W - 1, Math.round((z[0] / 100) * W)));
  const top = Math.max(0, Math.min(H - 1, Math.round((z[1] / 100) * H)));
  const width = Math.max(1, Math.min(W - left, Math.round((z[2] / 100) * W)));
  const height = Math.max(1, Math.min(H - top, Math.round((z[3] / 100) * H)));
  return sharp(fichier).removeAlpha().extract({ left, top, width, height }).raw().toBuffer();
}

const mediane = (valeurs: number[]) => {
  const t = [...valeurs].sort((a, b) => a - b);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

/** La médiane par canal de pixels RGB, après des gains par canal en lumière linéaire. */
export function medianeCorrigee(pixels: Buffer[], gains: Rgb = [1, 1, 1]): Rgb {
  const canaux: number[][] = [[], [], []];
  for (const p of pixels) for (let i = 0; i + 2 < p.length; i += 3) for (let c = 0; c < 3; c++) canaux[c].push(versSrgb(versLineaire(p[i + c]) * gains[c]));
  return canaux.map(mediane) as Rgb;
}

/**
 * Les gains de la balance des blancs : le blanc de la scène ramené au blanc du catalogue ; sans `exposition`, rendu
 * seulement neutre à sa propre luminance (un blanc cassé ne dit rien de l'exposition).
 */
export function gainsBlanc(blancScene: Rgb, blancCible: Rgb, exposition = true): Rgb {
  const lin = blancScene.map(versLineaire);
  const Y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  return [0, 1, 2].map((c) => (exposition ? versLineaire(blancCible[c]) : Y) / Math.max(1e-4, lin[c])) as Rgb;
}

/** Le blanc d'une zone : la médiane par canal du quart de ses pixels le plus lumineux (la partie éclairée de l'objet). */
export function blancDeZone(pixels: Buffer): Rgb {
  const lum: { y: number; i: number }[] = [];
  for (let i = 0; i + 2 < pixels.length; i += 3) lum.push({ y: 0.2126 * versLineaire(pixels[i]) + 0.7152 * versLineaire(pixels[i + 1]) + 0.0722 * versLineaire(pixels[i + 2]), i });
  lum.sort((a, b) => b.y - a.y);
  const garde = lum.slice(0, Math.max(1, Math.ceil(lum.length / 4)));
  const canaux: number[][] = [[], [], []];
  for (const { i } of garde) for (let c = 0; c < 3; c++) canaux[c].push(pixels[i + c]);
  return canaux.map(mediane) as Rgb;
}

export type Mesure = { brute: Rgb; corrigee: Rgb };

/** Mesure les surfaces d'une image : la balance des blancs sur la zone `blanc`, puis la médiane corrigée de chaque surface. */
export async function mesurerImage(fichier: string, image: Pick<ImageTeintes, "blanc" | "surfaces">, blancCible: Rgb): Promise<{ blancScene: Rgb; gains: Rgb; surfaces: Mesure[] }> {
  const blancScene = blancDeZone(await pixelsZone(fichier, image.blanc.zone));
  const gains = gainsBlanc(blancScene, blancCible, image.blanc.exposition !== false);
  const surfaces: Mesure[] = [];
  for (const s of image.surfaces) {
    const pixels = await Promise.all(s.zones.map((z) => pixelsZone(fichier, z)));
    surfaces.push({ brute: medianeCorrigee(pixels), corrigee: medianeCorrigee(pixels, gains) });
  }
  return { blancScene, gains, surfaces };
}

/* ── Consigne d'édition ── */

/**
 * La consigne de recalage (traduction fidèle de celle de Lucas : « changer uniquement la couleur et la texture des
 * surfaces citées pour reproduire exactement la vignette, sous la lumière de la scène, sans rien toucher d'autre »).
 * L'image 1 est la photo ; les images 2, 3… sont les vignettes, dans l'ordre des surfaces citées.
 */
export function consigneRecalage(surfaces: { en: string; ref: Revetement }[]): string {
  const lignes = surfaces.map((s, i) => `- ${s.en}: reproduce exactly reference image ${i + 2} (${s.ref.nom} ${s.ref.id}).`);
  return [
    "Image 1 is a photograph of a room. Change ONLY the color and the surface texture of these surfaces:",
    ...lignes,
    "Each surface must look exactly like its reference swatch, as that material would appear under the existing light of this scene.",
    "Do not change anything else: same framing and camera, same geometry, same furniture, same handles, same objects, same light, shadows and reflections. Photorealistic, no text, no logo.",
  ].join("\n");
}

/* ── Le lancement ── */

export type OptionsTeintes = {
  liste: string;
  catalogue: string;
  sortie: string;
  choix: Map<string, number>;
  recaler: boolean;
  estimer: boolean;
  essai: boolean;
  plafond: number;
  depuis: Date;
  qualite: QualiteAmbiance;
  essais: number | null;
  seulement: string[];
  seuil: number | null;
};

export function lireArgumentsTeintes(argv: string[]): OptionsTeintes {
  const o: OptionsTeintes = { liste: LISTE_TEINTES_DEFAUT(), catalogue: CATALOGUE_DEFAUT(), sortie: sortieParDefaut(), choix: new Map(), recaler: false, estimer: false, essai: false, plafond: PLAFOND_DEFAUT, depuis: new Date(DEBUT_MISSION_19), qualite: "high", essais: null, seulement: [], seuil: null };
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${cle} : valeur manquante.`);
      return v;
    };
    if (cle === "--liste") o.liste = path.resolve(valeur());
    else if (cle === "--catalogue") o.catalogue = path.resolve(valeur());
    else if (cle === "--sortie") o.sortie = path.resolve(valeur());
    else if (cle === "--choix") {
      const v = valeur();
      o.choix = lireChoix(existsSync(v) ? readFileSync(v, "utf8").split(/\r?\n/).filter(Boolean).join(",") : v);
    } else if (cle === "--recaler") o.recaler = true;
    else if (cle === "--estimer") o.estimer = true;
    else if (cle === "--essai") o.essai = true;
    else if (cle === "--plafond") {
      o.plafond = Number(valeur());
      if (!(o.plafond > 0)) throw new Error("--plafond : un nombre de dollars positif.");
    } else if (cle === "--depuis") {
      o.depuis = new Date(valeur());
      if (Number.isNaN(o.depuis.getTime())) throw new Error("--depuis : une date ISO.");
    } else if (cle === "--qualite") {
      const q = valeur() as QualiteAmbiance;
      if (!["low", "medium", "high", "xhigh", "max"].includes(q)) throw new Error("--qualite : low | medium | high | xhigh | max.");
      o.qualite = q;
    } else if (cle === "--essais") {
      o.essais = Number(valeur());
      if (!Number.isInteger(o.essais) || o.essais < 1 || o.essais > 10) throw new Error("--essais : un entier de 1 à 10.");
    } else if (cle === "--seulement") o.seulement = valeur().split(",").map((s) => s.trim()).filter(Boolean);
    else if (cle === "--seuil") {
      o.seuil = Number(valeur());
      if (!(o.seuil > 0)) throw new Error("--seuil : un ΔE positif.");
    } else throw new Error(`Option inconnue : ${cle}`);
  }
  return o;
}

const FORMATS: Record<string, FormatAmbiance> = { "1536x1024": "1536x1024", "1024x1536": "1024x1536", "1024x1024": "1024x1024" };

/** Le coût estimé d'un recalage : une édition + les vignettes en images d'entrée supplémentaires. */
export function estimerRecalage(format: FormatAmbiance, vignettes: number, qualite: QualiteAmbiance, modele = modeleEdition()): number {
  const prix = PRIX[modele] ?? PRIX["gpt-image-1"];
  return estimerAppel({ mode: "edition", format }, qualite, modele) + (vignettes * JETONS_IMAGE_EDITION * prix.image) / 1_000_000;
}

export type ResultatSurface = {
  surface: string;
  ref: string;
  nom: string;
  hex: string;
  /** La référence a été choisie par `plus_proche` (aucune imposée). */
  choisie: boolean;
  /** La référence de la direction artistique, si l'étiquette en a changé. */
  prevue: string | null;
  mesure: string;
  brute: string;
  deltaE: number;
  aRecaler: boolean;
  /** Recalage demandé par la liste sous le seuil : la raison. */
  force: string | null;
  /** La référence la plus proche de la couleur actuelle, même famille (proposée si aucun essai n'est fidèle). */
  procheMemeFamille: { ref: string; nom: string; hex: string; deltaE: number } | null;
};

export type ResultatEssai = { essai: number; fichier: string; deltaE: number[]; ecartContours: number; fidele: boolean };

export type ResultatImage = {
  nom: string;
  fichier: string;
  blanc: { objet: string; mesure: string };
  surfaces: ResultatSurface[];
  essais: ResultatEssai[];
  /** Le meilleur essai fidèle (toutes les surfaces recalées sous le seuil ; le plus petit pire ΔE, puis le moins d'écart de contours). */
  recommande: number | null;
};

export type BilanTeintes = { images: ResultatImage[]; estimeDollars: number; depenseDollars: number; dejaDollars: number; plafondAtteint: boolean; echecs: string[]; planche: string | null; mesures: string | null };

const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

/** La vignette réelle d'une référence dans `<sortie>/vignettes/<id>.<ext>` (téléchargée une fois). */
const vignette = (ref: Revetement, sortie: string) => vignetteLocale(ref, path.join(sortie, "vignettes"));

/** Une image unie (mode `--essai`) à la place d'une édition : aucune requête réseau. */
const appelEssai: AppelAmbiance = async (demande) => {
  const sharp = await sharpModule();
  const [w, h] = demande.size.split("x").map(Number);
  const png = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 130, b: 110 } } }).png().toBuffer();
  return { ok: true, b64: png.toString("base64"), usage: { texte: 0, image: 0, sortie: 0 } };
};

export async function executerTeintes(argv: string[], journal: (ligne: string) => void = console.log): Promise<BilanTeintes> {
  const o = lireArgumentsTeintes(argv);
  const liste = lireListeTeintes(await fs.readFile(o.liste, "utf8"));
  const catalogue = lireCatalogue(await fs.readFile(o.catalogue, "utf8"));
  const parId = new Map(catalogue.map((r) => [r.id, r]));
  const seuil = o.seuil ?? liste.seuil_delta_e;
  const essais = o.essais ?? liste.essais_par_image;
  const blancCible = hexVersRgb(liste.blanc_cible);
  const dossierTeintes = path.join(o.sortie, "teintes");
  const bilan: BilanTeintes = { images: [], estimeDollars: 0, depenseDollars: 0, dejaDollars: 0, plafondAtteint: false, echecs: [], planche: null, mesures: null };
  const images = liste.images.filter((i) => o.seulement.length === 0 || o.seulement.includes(i.nom));
  if (o.seulement.length) for (const n of o.seulement) if (!images.some((i) => i.nom === n)) throw new Error(`--seulement : ${n} absent de la liste.`);

  // 1. Mesure des photos choisies.
  for (const image of images) {
    const n = o.choix.get(image.nom);
    if (!n && !image.fichier) throw new Error(`${image.nom} : essai choisi inconnu (--choix ${image.nom}=<n>).`);
    const fichier = image.fichier ? path.join(o.sortie, image.fichier) : path.join(o.sortie, `${image.nom}-${n}.png`);
    if (!existsSync(fichier)) throw new Error(`${image.nom} : ${fichier} absent.`);
    const mesure = await mesurerImage(fichier, image, blancCible);
    const surfaces: ResultatSurface[] = image.surfaces.map((s, k) => {
      const m = mesure.surfaces[k];
      let ref: Revetement | undefined;
      if (s.ref) {
        ref = parId.get(s.ref);
        if (!ref) throw new Error(`${image.nom} : référence ${s.ref} absente du catalogue.`);
      } else {
        const trouvee = plusProche(m.corrigee, catalogue, (r) => dansLeFiltre(r, s.plus_proche!));
        if (!trouvee) throw new Error(`${image.nom} : aucune référence du catalogue pour ${JSON.stringify(s.plus_proche)}.`);
        ref = trouvee.ref;
      }
      const d = deltaE(m.corrigee, hexVersRgb(ref.hex));
      const famille = ref.famille;
      const proche = plusProche(m.corrigee, catalogue, (r) => r.famille === famille);
      return {
        surface: s.surface,
        ref: ref.id,
        nom: ref.nom,
        hex: ref.hex.toUpperCase(),
        choisie: !s.ref,
        prevue: s.prevue ?? null,
        mesure: rgbVersHex(m.corrigee),
        brute: rgbVersHex(m.brute),
        deltaE: arrondi(d),
        aRecaler: d > seuil || Boolean(s.forcer),
        force: d > seuil ? null : (s.forcer ?? null),
        procheMemeFamille: proche ? { ref: proche.ref.id, nom: proche.ref.nom, hex: proche.ref.hex.toUpperCase(), deltaE: arrondi(proche.deltaE) } : null,
      };
    });
    bilan.images.push({ nom: image.nom, fichier, blanc: { objet: image.blanc.objet, mesure: rgbVersHex(mesure.blancScene) }, surfaces, essais: [], recommande: null });
    journal(`${image.nom} (${image.fichier ?? `essai ${n}`}, blanc : ${image.blanc.objet} ${rgbVersHex(mesure.blancScene)})`);
    for (const s of surfaces) journal(`  ${s.aRecaler ? (s.force ? "À RECALER (demandé)" : "À RECALER") : "fidèle   "} ${s.surface} → ${s.ref} ${s.nom}${s.choisie ? " (la plus proche)" : ""} : mesuré ${s.mesure} vs ${s.hex}, ΔE ${s.deltaE}`);
  }
  for (const r of bilan.images) for (const s of r.surfaces) await vignette(parId.get(s.ref)!, o.sortie);

  // 2. Le plan des recalages et son coût.
  type Appel = { image: ImageTeintes; resultat: ResultatImage; essai: number; format: FormatAmbiance; aRecaler: ResultatSurface[] };
  const aFaire: Appel[] = [];
  const sharp = await sharpModule();
  for (const [i, resultat] of bilan.images.entries()) {
    const aRecaler = resultat.surfaces.filter((s) => s.aRecaler);
    if (aRecaler.length === 0) continue;
    const meta = await sharp(resultat.fichier).metadata();
    const format = FORMATS[`${meta.width}x${meta.height}`];
    if (!format) throw new Error(`${resultat.nom} : format ${meta.width}x${meta.height} non pris en charge.`);
    for (let k = 1; k <= essais; k++) {
      if (existsSync(path.join(dossierTeintes, `${resultat.nom}-teinte-${k}.png`))) continue;
      aFaire.push({ image: images[i], resultat, essai: k, format, aRecaler });
    }
  }
  bilan.estimeDollars = Math.round(aFaire.reduce((s, a) => s + estimerRecalage(a.format, a.aRecaler.length, o.qualite), 0) * 100) / 100;
  const nbImages = new Set(aFaire.map((a) => a.resultat.nom)).size;
  journal(`Recalage : ${nbImages} image(s), ${aFaire.length} édition(s) à faire (${modeleEdition()}, qualité ${o.qualite}) ; estimé ≈ ${dollars(bilan.estimeDollars)} (estimation interne prudente : la phase 1 a coûté ~4 fois moins).`);

  // 3. Les éditions (seulement avec --recaler).
  if (o.recaler && !o.estimer && aFaire.length > 0) {
    if (!o.essai) {
      journal(`OPENAI_API_KEY : ${process.env.OPENAI_API_KEY ? "présente" : "absente"}.`);
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente de l'environnement : rien n'est lancé.");
    }
    bilan.dejaDollars = (await releverCouts(o.depuis)).totalDollars;
    journal(`Déjà dépensé depuis ${o.depuis.toISOString()} : ${dollars(bilan.dejaDollars)} ; plafond de la mission ${dollars(o.plafond)}.`);
    await fs.mkdir(dossierTeintes, { recursive: true });
    let fideliteHaute = true;
    for (const [i, a] of aFaire.entries()) {
      const estime = estimerRecalage(a.format, a.aRecaler.length, o.qualite);
      if (bilan.dejaDollars + bilan.depenseDollars + estime > o.plafond) {
        bilan.plafondAtteint = true;
        journal(`PLAFOND : ${dollars(bilan.dejaDollars + bilan.depenseDollars)} + ≈ ${dollars(estime)} dépasseraient ${dollars(o.plafond)} — arrêt net, ${aFaire.length - i} édition(s) non lancée(s).`);
        break;
      }
      const octets = await fs.readFile(a.resultat.fichier);
      const source: SourceEdition = { octets, type: typeImage(octets), nom: path.basename(a.resultat.fichier) };
      const references: SourceEdition[] = [];
      for (const s of a.aRecaler) {
        const f = await vignette(parId.get(s.ref)!, o.sortie);
        const png = await sharp(f).resize(512, 512, { fit: "cover" }).png().toBuffer();
        references.push({ octets: png, type: "image/png", nom: `${s.ref}.png` });
      }
      const prompt = consigneRecalage(a.aRecaler.map((s) => ({ en: a.image.surfaces.find((x) => x.surface === s.surface)!.en, ref: parId.get(s.ref)! })));
      const modele = o.essai ? "essai" : modeleEdition();
      const r = await genererAmbiance({ prompt, format: a.format, qualite: o.qualite, source, references, fideliteHaute }, o.essai ? { appel: appelEssai, modele, journal } : { modele, journal });
      const etiquette = `[${i + 1}/${aFaire.length}] ${a.resultat.nom}-teinte-${a.essai}`;
      if (!r.ok) {
        bilan.echecs.push(`${a.resultat.nom}-teinte-${a.essai} : ${r.raison}`);
        journal(`${etiquette} : ÉCHEC (${r.raison}).`);
        if (r.raison === "service-indisponible" || r.raison === "config") break;
        continue;
      }
      // Refusé une fois (HTTP 400, non facturé) : plus envoyé pour la suite du lancement.
      if (r.fideliteRetiree) fideliteHaute = false;
      await fs.writeFile(path.join(dossierTeintes, `${a.resultat.nom}-teinte-${a.essai}.png`), r.image);
      bilan.depenseDollars = Math.round((bilan.depenseDollars + r.coutDollars) * 10_000) / 10_000;
      journal(`${etiquette} : ${dollars(r.coutDollars)} en ${Math.round(r.dureeMs / 1000)} s (cumul ${dollars(bilan.depenseDollars)}).`);
    }
  }

  // 4. Mesure des essais présents, recommandation.
  for (const [i, resultat] of bilan.images.entries()) {
    for (let k = 1; k <= essais; k++) {
      const fichier = path.join(dossierTeintes, `${resultat.nom}-teinte-${k}.png`);
      if (!existsSync(fichier)) continue;
      const m = await mesurerImage(fichier, images[i], blancCible);
      const d = resultat.surfaces.map((s, j) => arrondi(deltaE(m.surfaces[j].corrigee, hexVersRgb(s.hex))));
      const ecart = arrondi(await ecartContours(resultat.fichier, fichier));
      const fidele = resultat.surfaces.every((s, j) => d[j] <= seuil || (!s.aRecaler && d[j] <= s.deltaE + 3));
      resultat.essais.push({ essai: k, fichier, deltaE: d, ecartContours: ecart, fidele });
    }
    // Le plus fidèle sur les surfaces recalées ; à égalité (au dixième), le moins de contours déplacés.
    const pire = (e: ResultatEssai) => Math.max(...resultat.surfaces.map((s, j) => (s.aRecaler ? e.deltaE[j] : 0)));
    const fideles = resultat.essais.filter((e) => e.fidele).sort((a, b) => pire(a) - pire(b) || a.ecartContours - b.ecartContours);
    resultat.recommande = fideles[0]?.essai ?? null;
  }

  // 5. Le relevé et la planche.
  await fs.mkdir(dossierTeintes, { recursive: true });
  bilan.mesures = path.join(dossierTeintes, "mesures.json");
  await fs.writeFile(bilan.mesures, JSON.stringify({ seuil, blanc_cible: liste.blanc_cible, images: bilan.images }, null, 2));
  bilan.planche = path.join(o.sortie, "planches", "teintes.jpg");
  await plancheTeintes(bilan.images, zonesDe(liste), o.sortie, seuil, bilan.planche);
  if (o.seulement.length === 0) await plancheCompositions(bilan.images, parId, o.sortie, path.join(o.sortie, "planches", "compositions.jpg"));
  journal(`Relevé : ${bilan.mesures} ; planche : ${bilan.planche}.`);
  if (o.recaler) {
    const releve = await releverCouts(o.depuis);
    journal(`Coût réel relu dans GenerationImage depuis le début de la mission 19 : ${dollars(releve.totalDollars)} (${releve.parPhase.map((p) => `${p.phase} ${p.statut} × ${p.lignes} = ${dollars(p.dollars)}`).join(" ; ")}).`);
  }
  return bilan;
}

/* ── La planche de teintes ── */

const H_LIGNE = 360;
const H_PHOTO = 240;
const MARGE = 20;
const COTE = 96;
const L_SURFACE = 2 * COTE + 12 + 210;
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function vignetteDe(fichier: string, l: number, h: number): Promise<Buffer> {
  const sharp = await sharpModule();
  return sharp(fichier).resize(l, h, { fit: "cover" }).png().toBuffer();
}

/** Une ligne par image : la photo et ses zones numérotées, chaque surface (zone, vignette, ΔE avant/après), les essais. */
export async function plancheTeintes(images: ResultatImage[], zonesParImage: ZonesPlanche, sortie: string, seuil: number, fichier: string): Promise<void> {
  const sharp = await sharpModule();
  const couches: { input: Buffer; left: number; top: number }[] = [];
  let largeurMax = 0;
  for (const [ligne, r] of images.entries()) {
    const y0 = ligne * H_LIGNE + MARGE;
    const meta = await sharp(r.fichier).metadata();
    const l = Math.round(((meta.width ?? 1) * H_PHOTO) / (meta.height ?? 1));
    // La photo, ses zones et son blanc.
    const zones = zonesParImage.get(r.nom) ?? { blanc: null, surfaces: [] };
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${H_PHOTO}">`;
    const rect = (z: Zone, couleur: string, texte: string) =>
      `<rect x="${(z[0] / 100) * l}" y="${(z[1] / 100) * H_PHOTO}" width="${Math.max(2, (z[2] / 100) * l)}" height="${Math.max(2, (z[3] / 100) * H_PHOTO)}" fill="none" stroke="${couleur}" stroke-width="2"/><text x="${(z[0] / 100) * l + 2}" y="${(z[1] / 100) * H_PHOTO - 3}" font-family="Arial" font-weight="700" font-size="14" fill="${couleur}" stroke="#000" stroke-width="0.6">${texte}</text>`;
    if (zones.blanc) svg += rect(zones.blanc, "#FFFFFF", "B");
    zones.surfaces.forEach((zs, k) => zs.forEach((z) => (svg += rect(z, "#FF2BD6", String(k + 1)))));
    svg += `</svg>`;
    const photo = await sharp(r.fichier).resize(l, H_PHOTO).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    couches.push({ input: photo, left: MARGE, top: y0 + 36 });
    let x = MARGE + l + MARGE;
    const titre = `${r.nom} — blanc de référence : ${r.blanc.objet}${r.recommande ? ` — recalage recommandé : essai ${r.recommande}` : r.essais.length ? " — aucun essai fidèle" : r.surfaces.some((s) => s.aRecaler) ? " — recalage à lancer" : " — fidèle, rien à recaler"}`;
    couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="30"><text x="0" y="22" font-family="Arial" font-weight="700" font-size="20" fill="#FFFFFF">${echapper(titre)}</text></svg>`), left: MARGE, top: y0 });
    // Chaque surface.
    for (const [k, s] of r.surfaces.entries()) {
      const zoneSurface = zones.surfaces[k]?.[0];
      if (zoneSurface) {
        const W = meta.width ?? 1;
        const H = meta.height ?? 1;
        const left = Math.round((zoneSurface[0] / 100) * W);
        const top = Math.round((zoneSurface[1] / 100) * H);
        const width = Math.max(1, Math.min(W - left, Math.round((zoneSurface[2] / 100) * W)));
        const height = Math.max(1, Math.min(H - top, Math.round((zoneSurface[3] / 100) * H)));
        const crop = await sharp(r.fichier).removeAlpha().extract({ left, top, width, height }).resize(COTE, COTE, { fit: "cover" }).png().toBuffer();
        couches.push({ input: crop, left: x, top: y0 + 60 });
      }
      const fv = path.join(sortie, "vignettes");
      const fichierVignette = existsSync(fv) ? (await fs.readdir(fv)).find((f) => f.startsWith(`${s.ref}.`)) : undefined;
      if (fichierVignette) couches.push({ input: await vignetteDe(path.join(fv, fichierVignette), COTE, COTE), left: x + COTE + 12, top: y0 + 60 });
      // Pastilles : mesuré (corrigé) et hex du catalogue.
      const pastilles = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * COTE + 12}" height="26"><rect x="0" y="0" width="${COTE}" height="22" fill="${s.mesure}"/><rect x="${COTE + 12}" y="0" width="${COTE}" height="22" fill="${s.hex}"/></svg>`;
      couches.push({ input: Buffer.from(pastilles), left: x, top: y0 + 60 + COTE + 6 });
      const apres = r.essais.map((e) => `${e.essai} : ${String(e.deltaE[k]).replace(".", ",")}`).join("  ·  ");
      const couleurDe = (d: number) => (d > seuil ? "#FF6B6B" : "#7BE07B");
      const lignes = [
        `<tspan x="0" dy="0" font-weight="700">${k + 1}. ${echapper(s.surface)}</tspan>`,
        `<tspan x="0" dy="20">${echapper(`${s.ref} ${s.nom}${s.choisie ? " (la plus proche)" : ""}`)}</tspan>`,
        `<tspan x="0" dy="20">mesuré ${s.mesure} · catalogue ${s.hex}</tspan>`,
        `<tspan x="0" dy="22" font-weight="700" fill="${couleurDe(s.deltaE)}">ΔE avant : ${String(s.deltaE).replace(".", ",")}${s.force ? ` — recalée à la demande` : ""}</tspan>`,
        r.essais.length ? `<tspan x="0" dy="20" fill="#DDDDDD">après (essai : ΔE) ${echapper(apres)}</tspan>` : "",
        s.procheMemeFamille && s.procheMemeFamille.ref !== s.ref ? `<tspan x="0" dy="20" fill="#BBBBBB">${echapper(`plus proche (même famille) : ${s.procheMemeFamille.ref} ${s.procheMemeFamille.nom}, ΔE ${String(s.procheMemeFamille.deltaE).replace(".", ",")}`)}</tspan>` : "",
      ].join("");
      const texte = `<svg xmlns="http://www.w3.org/2000/svg" width="${L_SURFACE}" height="${H_LIGNE - 60}"><text x="0" y="14" font-family="Arial" font-size="15" fill="#FFFFFF">${lignes}</text></svg>`;
      couches.push({ input: Buffer.from(texte), left: x, top: y0 + 60 + COTE + 40 });
      x += L_SURFACE + MARGE;
    }
    // Les essais de recalage.
    for (const e of r.essais) {
      const m = await sharp(e.fichier).metadata();
      const le = Math.round(((m.width ?? 1) * H_PHOTO) / (m.height ?? 1));
      const etiquette = `<svg xmlns="http://www.w3.org/2000/svg" width="${le}" height="${H_PHOTO}"><rect x="8" y="8" rx="10" width="64" height="64" fill="#000" fill-opacity="0.66"/><text x="40" y="58" text-anchor="middle" font-family="Arial" font-weight="700" font-size="48" fill="#FFF">${e.essai}</text><rect x="0" y="${H_PHOTO - 28}" width="${le}" height="28" fill="#000" fill-opacity="0.6"/><text x="8" y="${H_PHOTO - 9}" font-family="Arial" font-size="15" fill="${e.fidele ? "#7BE07B" : "#FF6B6B"}">${e.fidele ? "fidèle" : "non fidèle"} · contours ${String(e.ecartContours).replace(".", ",")}</text></svg>`;
      couches.push({ input: await sharp(e.fichier).resize(le, H_PHOTO).composite([{ input: Buffer.from(etiquette) }]).png().toBuffer(), left: x, top: y0 + 36 });
      x += le + MARGE;
    }
    largeurMax = Math.max(largeurMax, x);
  }
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: Math.max(largeurMax, 1800 + 2 * MARGE), height: images.length * H_LIGNE + 2 * MARGE, channels: 3, background: { r: 34, g: 34, b: 34 } } })
    .composite(couches)
    .jpeg({ quality: 86 })
    .toFile(fichier);
}

/** Les zones de chaque image (le blanc, puis celles de chaque surface), pour les dessiner sur la planche. */
export type ZonesPlanche = Map<string, { blanc: Zone | null; surfaces: Zone[][] }>;
export const zonesDe = (liste: ListeTeintes): ZonesPlanche => new Map(liste.images.map((i) => [i.nom, { blanc: i.blanc.zone, surfaces: i.surfaces.map((s) => s.zones) }]));

/**
 * La liste finale des compositions : une ligne par photo retenue, chaque surface avec la vignette réelle de sa
 * référence, son nom, sa référence et son ΔE mesuré (et la référence de la direction artistique quand l'étiquette a
 * changé).
 */
export async function plancheCompositions(images: ResultatImage[], parId: Map<string, Revetement>, sortie: string, fichier: string): Promise<void> {
  const sharp = await sharpModule();
  const H = 220;
  const V = 120;
  const LS = 300;
  const couches: { input: Buffer; left: number; top: number }[] = [];
  let largeur = 0;
  for (const [ligne, r] of images.entries()) {
    const y0 = MARGE + ligne * (H + MARGE);
    const meta = await sharp(r.fichier).metadata();
    const l = Math.round(((meta.width ?? 1) * (H - 30)) / (meta.height ?? 1));
    couches.push({ input: await sharp(r.fichier).resize(l, H - 30).png().toBuffer(), left: MARGE, top: y0 + 30 });
    couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="28"><text x="0" y="20" font-family="Arial" font-weight="700" font-size="18" fill="#FFFFFF">${echapper(`${r.nom}${r.fichier.includes(`${path.sep}teintes${path.sep}`) ? " (essai recalé)" : ""}`)}</text></svg>`), left: MARGE, top: y0 });
    let x = MARGE + Math.max(l, 290) + MARGE;
    for (const s of r.surfaces) {
      const ref = parId.get(s.ref);
      const fv = path.join(sortie, "vignettes");
      const f = ref && existsSync(fv) ? (await fs.readdir(fv)).find((n) => n.startsWith(`${ref.id}.`)) : undefined;
      if (f) couches.push({ input: await sharp(path.join(fv, f)).resize(V, V, { fit: "cover" }).png().toBuffer(), left: x, top: y0 + 30 });
      const lignes = [
        `<tspan x="0" dy="0" font-weight="700">${echapper(s.surface)}</tspan>`,
        `<tspan x="0" dy="20">${echapper(`${s.nom} · ${s.ref}`)}</tspan>`,
        `<tspan x="0" dy="20" fill="#CCCCCC">ΔE ${String(s.deltaE).replace(".", ",")}${s.prevue && s.prevue !== s.ref ? ` · prévue : ${echapper(s.prevue)}` : ""}</tspan>`,
      ].join("");
      couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LS}" height="70"><text x="0" y="15" font-family="Arial" font-size="15" fill="#FFFFFF">${lignes}</text></svg>`), left: x, top: y0 + 30 + V + 6 });
      x += LS + MARGE;
    }
    largeur = Math.max(largeur, x);
  }
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: Math.max(largeur, 960), height: MARGE + images.length * (H + MARGE), channels: 3, background: { r: 34, g: 34, b: 34 } } })
    .composite(couches)
    .jpeg({ quality: 86 })
    .toFile(fichier);
}
