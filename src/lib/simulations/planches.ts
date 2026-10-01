import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Les planches de choix des photos du site (mission 19) — sans aucun appel payant, à partir des essais déjà écrits
 * dans la sortie de `scripts/generer-ambiances.ts` :
 *  - `planche` : les essais côte à côte, numérotés 1-2-3 en gros (et, pour une édition, la source choisie en premier,
 *    étiquetée « source ») ; fond en damier clair pour les pictogrammes transparents, pour voir la transparence ;
 *  - `plancheContours` : pour une paire avant/après, les contours de la source choisie (cyan) et de chaque essai
 *    d'édition (magenta), superposés (blanc là où ils coïncident), avec un score d'écart par essai (plus petit =
 *    mieux) : un meuble qui a bougé laisse deux traits décalés et fait monter le score.
 * Le score (`ecartContours`) : les deux images ramenées à la même taille (768 px de large), en niveaux de gris, un
 * léger flou, puis la norme du gradient de Sobel ; sont « bords » les 12 % de pixels au gradient le plus fort (seuil
 * adaptatif : un changement de teinte des façades affaiblit un bord sans le déplacer), avec un plancher pour qu'une
 * image unie n'ait aucun bord. L'écart est la part des bords de l'une sans bord de l'autre à moins de 2 px, moyennée
 * dans les deux sens, en pourcentage : 0 = contours identiques, 100 = rien en commun.
 */

export const HAUTEUR_TUILE = 512;
export const MARGE_PLANCHE = 24;
export const LARGEUR_CONTOURS = 768;
/** Part des pixels retenus comme bords (les plus forts gradients). */
const PART_BORDS = 0.12;
/** Gradient minimal d'un bord (sur 0-255, après flou) : une image unie n'a aucun bord. */
const SEUIL_MIN_BORD = 24;
/** Tolérance de position d'un bord, en pixels à 768 px de large. */
const TOLERANCE_PX = 2;
const FOND_PLANCHE = { r: 34, g: 34, b: 34 };

export type Tuile = { fichier: string; etiquette: string };

const sharpModule = async () => (await import("sharp")).default;
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Un damier clair (cases de 24 px) pour voir la transparence d'un pictogramme. */
async function damier(largeur: number, hauteur: number): Promise<Buffer> {
  const sharp = await sharpModule();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><defs><pattern id="d" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="#ffffff"/><rect width="24" height="24" fill="#e4e4e4"/><rect x="24" y="24" width="24" height="24" fill="#e4e4e4"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** L'étiquette d'une tuile (le numéro de l'essai en gros, ou « source »), en SVG posé en haut à gauche. */
function etiquetteSvg(largeur: number, hauteur: number, texte: string): Buffer {
  const court = texte.length <= 2;
  const taille = court ? 96 : Math.max(18, Math.min(52, Math.floor((largeur - 72) / (texte.length * 0.62))));
  const boite = court ? 128 : Math.min(largeur - 32, Math.round(texte.length * taille * 0.62) + 40);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><rect x="16" y="16" rx="16" width="${boite}" height="120" fill="#000000" fill-opacity="0.66"/><text x="${16 + boite / 2}" y="${court ? 112 : 96}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${taille}" fill="#ffffff">${echapper(texte)}</text></svg>`
  );
}

/** Une tuile : l'image à la hauteur de la planche (sur damier si transparente), son étiquette par-dessus. */
async function tuile(t: Tuile, avecDamier: boolean): Promise<{ octets: Buffer; largeur: number }> {
  const sharp = await sharpModule();
  const meta = await sharp(t.fichier).metadata();
  const largeur = Math.max(1, Math.round(((meta.width ?? HAUTEUR_TUILE) * HAUTEUR_TUILE) / (meta.height ?? HAUTEUR_TUILE)));
  const image = await sharp(t.fichier).resize(largeur, HAUTEUR_TUILE, { fit: "fill" }).png().toBuffer();
  const fond = avecDamier ? sharp(await damier(largeur, HAUTEUR_TUILE)) : sharp({ create: { width: largeur, height: HAUTEUR_TUILE, channels: 3, background: { r: 255, g: 255, b: 255 } } });
  const octets = await fond.composite([{ input: image }, { input: etiquetteSvg(largeur, HAUTEUR_TUILE, t.etiquette) }]).png().toBuffer();
  return { octets, largeur };
}

/** Assemble des tuiles de même hauteur côte à côte, en JPEG. */
async function assembler(tuiles: { octets: Buffer; largeur: number }[], fichier: string): Promise<{ largeur: number; hauteur: number }> {
  const sharp = await sharpModule();
  const largeur = tuiles.reduce((s, t) => s + t.largeur, 0) + MARGE_PLANCHE * (tuiles.length + 1);
  const hauteur = HAUTEUR_TUILE + 2 * MARGE_PLANCHE;
  let x = MARGE_PLANCHE;
  const couches = tuiles.map((t) => {
    const couche = { input: t.octets, left: x, top: MARGE_PLANCHE };
    x += t.largeur + MARGE_PLANCHE;
    return couche;
  });
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: FOND_PLANCHE } }).composite(couches).jpeg({ quality: 86 }).toFile(fichier);
  return { largeur, hauteur };
}

/** La planche de choix d'une image : ses essais (et la source d'une édition) côte à côte, numérotés. */
export async function planche(tuiles: Tuile[], fichier: string, options: { damier?: boolean } = {}): Promise<{ largeur: number; hauteur: number }> {
  if (tuiles.length === 0) throw new Error("Planche vide.");
  return assembler(await Promise.all(tuiles.map((t) => tuile(t, options.damier ?? false))), fichier);
}

/** Les dimensions de travail des contours : 768 px de large, la hauteur au ratio de la source. */
async function dimensionsContours(source: string): Promise<{ largeur: number; hauteur: number }> {
  const meta = await (await sharpModule())(source).metadata();
  return { largeur: LARGEUR_CONTOURS, hauteur: Math.max(1, Math.round((LARGEUR_CONTOURS * (meta.height ?? 1)) / (meta.width ?? 1))) };
}

/** La carte des bords d'une image (1 = bord), aux dimensions données. */
export async function carteBords(fichier: string, largeur: number, hauteur: number): Promise<Uint8Array> {
  const sharp = await sharpModule();
  const { data, info } = await sharp(fichier).flatten({ background: "#ffffff" }).greyscale().resize(largeur, hauteur, { fit: "fill" }).blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const c = info.channels;
  const gris = (x: number, y: number) => data[(y * largeur + x) * c];
  const norme = new Float32Array(largeur * hauteur);
  for (let y = 1; y < hauteur - 1; y++) {
    for (let x = 1; x < largeur - 1; x++) {
      const gx = gris(x + 1, y - 1) + 2 * gris(x + 1, y) + gris(x + 1, y + 1) - gris(x - 1, y - 1) - 2 * gris(x - 1, y) - gris(x - 1, y + 1);
      const gy = gris(x - 1, y + 1) + 2 * gris(x, y + 1) + gris(x + 1, y + 1) - gris(x - 1, y - 1) - 2 * gris(x, y - 1) - gris(x + 1, y - 1);
      norme[y * largeur + x] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  // Seuil adaptatif : le gradient au-dessus duquel se trouvent les PART_BORDS pixels les plus contrastés.
  const histogramme = new Uint32Array(1024);
  for (const v of norme) histogramme[Math.min(1023, Math.floor(v))]++;
  let cumul = 0;
  let seuil = 1023;
  const cible = norme.length * PART_BORDS;
  for (; seuil > 0; seuil--) {
    cumul += histogramme[seuil];
    if (cumul >= cible) break;
  }
  seuil = Math.max(seuil, SEUIL_MIN_BORD);
  const bords = new Uint8Array(largeur * hauteur);
  for (let i = 0; i < norme.length; i++) bords[i] = norme[i] >= seuil ? 1 : 0;
  return bords;
}

/** Dilatation carrée de rayon r (séparable) : un bord « couvre » ses voisins à r pixels près. */
function dilater(bords: Uint8Array, largeur: number, hauteur: number, r: number): Uint8Array {
  const h = new Uint8Array(bords.length);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < largeur) v = bords[y * largeur + xx];
      }
      h[y * largeur + x] = v;
    }
  }
  const sortie = new Uint8Array(bords.length);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < hauteur) v = h[yy * largeur + x];
      }
      sortie[y * largeur + x] = v;
    }
  }
  return sortie;
}

/** L'écart des contours de deux cartes (0 = identiques, 100 = rien en commun), à TOLERANCE_PX près. */
export function ecartCartes(a: Uint8Array, b: Uint8Array, largeur: number, hauteur: number): number {
  const da = dilater(a, largeur, hauteur, TOLERANCE_PX);
  const db = dilater(b, largeur, hauteur, TOLERANCE_PX);
  let na = 0, nb = 0, horsA = 0, horsB = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) {
      na++;
      if (!db[i]) horsA++;
    }
    if (b[i]) {
      nb++;
      if (!da[i]) horsB++;
    }
  }
  if (na === 0 && nb === 0) return 0;
  if (na === 0 || nb === 0) return 100;
  return Math.round(((horsA / na + horsB / nb) / 2) * 1000) / 10;
}

/** L'écart des contours entre la source choisie et un essai d'édition (plus petit = mieux). */
export async function ecartContours(source: string, essai: string): Promise<number> {
  const { largeur, hauteur } = await dimensionsContours(source);
  return ecartCartes(await carteBords(source, largeur, hauteur), await carteBords(essai, largeur, hauteur), largeur, hauteur);
}

/**
 * La planche des contours d'une paire avant/après : une tuile par essai (contours de la source en cyan, de l'essai en
 * magenta, blanc où ils coïncident), étiquetée « n · écart x », et les scores rendus.
 */
export async function plancheContours(source: string, essais: { numero: number; fichier: string }[], fichier: string): Promise<{ largeur: number; hauteur: number; scores: { essai: number; ecart: number }[] }> {
  const sharp = await sharpModule();
  const { largeur, hauteur } = await dimensionsContours(source);
  const bordsSource = await carteBords(source, largeur, hauteur);
  const scores: { essai: number; ecart: number }[] = [];
  const tuiles: { octets: Buffer; largeur: number }[] = [];
  for (const e of essais) {
    const bordsEssai = await carteBords(e.fichier, largeur, hauteur);
    const ecart = ecartCartes(bordsSource, bordsEssai, largeur, hauteur);
    scores.push({ essai: e.numero, ecart });
    const rgb = Buffer.alloc(largeur * hauteur * 3);
    for (let i = 0; i < bordsSource.length; i++) {
      const s = bordsSource[i], t = bordsEssai[i];
      const [r, g, b] = s && t ? [255, 255, 255] : s ? [0, 200, 255] : t ? [255, 60, 170] : [18, 18, 22];
      rgb[i * 3] = r;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = b;
    }
    const hauteurTuile = HAUTEUR_TUILE;
    const largeurTuile = Math.max(1, Math.round((largeur * hauteurTuile) / hauteur));
    const image = await sharp(rgb, { raw: { width: largeur, height: hauteur, channels: 3 } }).resize(largeurTuile, hauteurTuile, { fit: "fill" }).png().toBuffer();
    const etiquette = `${e.numero} · écart ${ecart.toFixed(1).replace(".", ",")}`;
    const octets = await sharp(image).composite([{ input: etiquetteSvg(largeurTuile, hauteurTuile, etiquette) }]).png().toBuffer();
    tuiles.push({ octets, largeur: largeurTuile });
  }
  if (tuiles.length === 0) throw new Error("Planche de contours vide.");
  return { ...(await assembler(tuiles, fichier)), scores };
}
