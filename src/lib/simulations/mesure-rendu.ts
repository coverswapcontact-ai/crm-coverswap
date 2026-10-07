import { profilDe, type Profil } from "@/lib/simulateur/moteur/materiaux";
import { carteBords, ecartCartes, LARGEUR_CONTOURS } from "./planches";
import { blancDeZone, deltaE2000, gainsBlanc, hexVersRgb, medianeCorrigee, rgbVersHex, rgbVersLab, versLineaire, versSrgb, type Lab, type Rgb, type Zone } from "./teintes";

/**
 * Mission 23 (L2a) — la mesure automatique d'un rendu du simulateur, sans aucune zone dessinée à la main : la photo
 * avant, le rendu, et les références demandées (hex du catalogue, classe de texture, zones en % si on les connaît).
 * Aucun réseau, aucune base : sharp et du calcul.
 *
 * 1. MASQUE de la surface changée, à l'échelle de travail (grand côté `COTE_TRAVAIL` = 1024 px ; le rendu est ramené
 *    aux dimensions de l'avant, étiré comme dans `ecartContours` — ou recadré au centre si les proportions diffèrent
 *    de plus de 2 %, `recadre: true`) :
 *    - différence par pixel en Lab (ΔE 1976, conversion de `teintes.ts`), lissée par une moyenne 5 × 5 (bruit, JPEG,
 *      grain redessiné) ;
 *    - seuil `SEUIL_DIFFERENCE` (ΔE76 = 7 : un blanc cassé changé en grège, ≈ 10, passe ; le redessin d'une pièce
 *      inchangée reste dessous ; réglé sur les rendus de Lattes, voir REPRISE § Mission 23) ;
 *    - ouverture (carré de rayon 3 : retire les veines d'un marbre redessiné, les bords décalés d'un pixel), puis
 *      fermeture (rayon 6 : bouche les poignées, les joints) ;
 *    - composantes connexes (4-voisinage) de plus de `MIN_COMPOSANTE` = 2 500 px À L'ÉCHELLE DE TRAVAIL (≈ 0,36 % d'une
 *      image 1024 × 683) ;
 *    - bord flouté (gaussienne σ = 2) : `masque.flou`, pour la planche et la future correction (L3). La mesure, elle,
 *      ne lit que l'intérieur (masque érodé de 4 px : ni bord, ni halo).
 *    Masque douteux (signalé, jamais corrigé) : plus de 60 % de l'image, moins de 1 %, plus de 12 composantes
 *    (éclaté), ou contours déplacés (`ecartContours` hors masque ≥ 30, ou global ≥ 40 : rendu décalé ou zoomé).
 * 2. PLUSIEURS RÉFÉRENCES (heuristique) : chaque pixel du masque va à la référence la plus proche de sa couleur telle
 *    qu'elle paraîtrait sous la lumière de la scène (le hex divisé par les gains de la balance des blancs), en ΔE76
 *    avec la clarté comptée pour moitié (une ombre ne doit pas faire changer de référence) ; puis composantes par
 *    référence. Avec une seule référence, les composantes du masque. Pour chaque référence, la composante la plus
 *    fidèle est gardée ; une autre qui en est à plus de `SEUIL_HORS_DEMANDE` (ΔE 2000 = 25) est un « changement hors
 *    demande » (un plan de travail repeint, un mur) et n'entre pas dans sa mesure.
 * 3. ΔE 2000 par surface entre la médiane mesurée (`medianeCorrigee` après `gainsBlanc`) et le hex du catalogue, plus
 *    la dérive signée en L, a, b et C* (mesuré − catalogue).
 *    Balance des blancs automatique, avec les règles de `teintes.ts` : le blanc est cherché HORS du masque dans le
 *    rendu (pixels L* ≥ 60 et C* ≤ 15, au moins 0,3 % de l'image), `blancDeZone` en prend le quart le plus lumineux ;
 *    un vrai blanc (L* ≥ 70 et C* ≤ 10) règle dominante ET exposition (ramené à #F2F2F2) ; sinon (mur crème, scène
 *    sombre) la dominante seulement, à sa luminance (`exposition: false`) ; une scène sans aucun neutre clair : pas de
 *    correction (`aucune`). Gains bornés à [0,25 ; 4].
 * 4. TEXTURE : l'écart-type de L* sur des fenêtres de 7 × 7 px dans l'intérieur de la surface, en médiane. Un bois ou
 *    une pierre sous `SEUIL_TEXTURE` (1,2) est « perdue » (devenu aplat). Classe attendue : `classeTexture`.
 * 5. RESPECT de la pièce : `ecartContours` (cartes de `planches.ts`, 768 px) hors du masque (dilaté) et global ; la part
 *    du masque hors des zones demandées si chaque référence a ses zones, sinon null ; la part du masque dans l'image.
 */

export const COTE_TRAVAIL = 1024;
export const SEUIL_DIFFERENCE = 7;
const RAYON_LISSAGE = 2;
const RAYON_OUVERTURE = 3;
const RAYON_FERMETURE = 6;
export const MIN_COMPOSANTE = 2_500;
const SIGMA_BORD = 2;
const EROSION_MESURE = 4;
const RAYON_TEXTURE = 3;
export const SEUIL_TEXTURE = 1.2;
export const SEUIL_HORS_DEMANDE = 15;
const ECART_HORS_DEMANDE = 8;
const PART_MAX = 0.6;
const PART_MIN = 0.01;
const COMPOSANTES_MAX = 12;
export const SEUIL_CONTOURS_HORS_MASQUE = 30;
export const SEUIL_CONTOURS_GLOBAL = 40;
const ECHANTILLON_MAX = 12_000;
/** Échantillon du tri des morceaux (seulement pour décider s'ils sont hors demande). */
const ECHANTILLON_MORCEAU = 4_000;
export const BLANC_CIBLE: Rgb = [242, 242, 242];

export type ClasseTexture = "uni" | "bois" | "pierre";

/**
 * La classe de texture attendue d'une référence, d'après son profil (`profilDe`, famille et nom du catalogue) :
 * bois → bois ; marbre, pierre, terrazzo, béton, brique, métal patiné, paillettes → pierre (un motif irrégulier) ;
 * le reste (unis, bois peint, cuir, tissu, métal brossé ou poli) → uni.
 */
export function classeTexture(r: { nom: string; famille: string; categorie?: string | null; tags?: string[] | null }): ClasseTexture {
  const profil: Profil = profilDe({ nom: r.nom, famille: r.famille, categorie: r.categorie ?? "", tags: r.tags ?? [] });
  if (profil === "bois") return "bois";
  if (["marbre", "pierre", "terrazzo", "beton", "brique", "metal-patine", "paillettes"].includes(profil)) return "pierre";
  return "uni";
}

export type ReferenceMesure = { ref: string; nom?: string; hex: string; classe: ClasseTexture; /** Rectangles en % de l'image (x, y, l, h), si on sait la situer. */ zones?: Zone[] };

export type Derive = { L: number; a: number; b: number; C: number };

export type SurfaceMesuree = {
  ref: string;
  nom: string | null;
  hex: string;
  /** Une composante du masque lui a été attribuée. */
  trouvee: boolean;
  mesure: string | null;
  brute: string | null;
  /** Pixels de la surface (échelle de travail) et sa part de l'image. */
  pixels: number;
  part: number;
  deltaE: number | null;
  /** Mesuré − catalogue, en Lab et en saturation C*. */
  derive: Derive | null;
  texture: { mesuree: number | null; attendue: ClasseTexture; perdue: boolean };
};

export type ComposanteMesuree = { pixels: number; part: number; mesure: string; ref: string | null; deltaE: number | null; horsDemande: boolean };

export type Balance = { blanc: string | null; mode: "blanc" | "dominante" | "aucune"; gains: Rgb };

export type MesureRendu = {
  largeur: number;
  hauteur: number;
  recadre: boolean;
  masque: { part: number; composantes: number; seuil: number; douteux: boolean; raisons: string[] };
  balance: Balance;
  surfaces: SurfaceMesuree[];
  composantes: ComposanteMesuree[];
  respect: { contoursHorsMasque: number; contoursGlobal: number; partHorsZones: number | null; partMasque: number; partHorsDemande: number };
  dureeMs: number;
  /** Seulement avec `garderMasque` : le masque flou (0-255) et, par pixel, l'indice de la surface (−1 : rien, −2 : hors demande). */
  detail?: { flou: Uint8Array; surface: Int16Array };
};

export type OptionsMesure = { seuil?: number; garderMasque?: boolean };

/* ── Petits outils d'image (masques binaires 0/1, largeur × hauteur) ── */

/**
 * Érosion (`toutes` : tous les pixels de la fenêtre à 1) ou dilatation (au moins un) par un carré de rayon r, en deux
 * passes séparables à somme glissante (fenêtre bornée à l'image).
 */
function fenetre(entree: Uint8Array, largeur: number, hauteur: number, r: number, toutes: boolean): Uint8Array {
  const h = new Uint8Array(entree.length);
  for (let y = 0; y < hauteur; y++) {
    const o = y * largeur;
    let n = 0;
    for (let x = 0; x <= Math.min(r, largeur - 1); x++) n += entree[o + x];
    for (let x = 0; x < largeur; x++) {
      const t = Math.min(largeur - 1, x + r) - Math.max(0, x - r) + 1;
      h[o + x] = toutes ? (n === t ? 1 : 0) : n > 0 ? 1 : 0;
      if (x + r + 1 < largeur) n += entree[o + x + r + 1];
      if (x - r >= 0) n -= entree[o + x - r];
    }
  }
  // Passe verticale ligne à ligne (un compteur par colonne) : lecture contiguë en mémoire.
  const v = new Uint8Array(entree.length);
  const n = new Int32Array(largeur);
  for (let y = 0; y <= Math.min(r, hauteur - 1); y++) for (let x = 0; x < largeur; x++) n[x] += h[y * largeur + x];
  for (let y = 0; y < hauteur; y++) {
    const t = Math.min(hauteur - 1, y + r) - Math.max(0, y - r) + 1;
    const o = y * largeur;
    for (let x = 0; x < largeur; x++) v[o + x] = toutes ? (n[x] === t ? 1 : 0) : n[x] > 0 ? 1 : 0;
    if (y + r + 1 < hauteur) for (let x = 0, p = (y + r + 1) * largeur; x < largeur; x++) n[x] += h[p + x];
    if (y - r >= 0) for (let x = 0, p = (y - r) * largeur; x < largeur; x++) n[x] -= h[p + x];
  }
  return v;
}
export const eroder = (m: Uint8Array, l: number, h: number, r: number) => (r > 0 ? fenetre(m, l, h, r, true) : m);
export const dilater = (m: Uint8Array, l: number, h: number, r: number) => (r > 0 ? fenetre(m, l, h, r, false) : m);

/** Moyenne glissante (2r + 1)² d'une carte flottante. */
function lisser(carte: Float32Array, largeur: number, hauteur: number, r: number): Float32Array {
  const h = new Float32Array(carte.length);
  for (let y = 0; y < hauteur; y++) {
    const o = y * largeur;
    let s = 0;
    for (let x = 0; x <= Math.min(r, largeur - 1); x++) s += carte[o + x];
    for (let x = 0; x < largeur; x++) {
      h[o + x] = s / (Math.min(largeur - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < largeur) s += carte[o + x + r + 1];
      if (x - r >= 0) s -= carte[o + x - r];
    }
  }
  const v = new Float32Array(carte.length);
  const s = new Float64Array(largeur);
  for (let y = 0; y <= Math.min(r, hauteur - 1); y++) for (let x = 0; x < largeur; x++) s[x] += h[y * largeur + x];
  for (let y = 0; y < hauteur; y++) {
    const t = Math.min(hauteur - 1, y + r) - Math.max(0, y - r) + 1;
    const o = y * largeur;
    for (let x = 0; x < largeur; x++) v[o + x] = s[x] / t;
    if (y + r + 1 < hauteur) for (let x = 0, p = (y + r + 1) * largeur; x < largeur; x++) s[x] += h[p + x];
    if (y - r >= 0) for (let x = 0, p = (y - r) * largeur; x < largeur; x++) s[x] -= h[p + x];
  }
  return v;
}

/** Composantes connexes (4-voisinage) : étiquette par pixel (−1 hors masque) et tailles. */
export function composantes(m: Uint8Array, largeur: number): { etiquettes: Int32Array; tailles: number[] } {
  const etiquettes = new Int32Array(m.length).fill(-1);
  const tailles: number[] = [];
  const pile = new Int32Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || etiquettes[i] >= 0) continue;
    const e = tailles.length;
    let haut = 0;
    let n = 0;
    pile[haut++] = i;
    etiquettes[i] = e;
    while (haut > 0) {
      const p = pile[--haut];
      n++;
      const x = p % largeur;
      for (let v = 0; v < 4; v++) {
        const q = v === 0 ? (x > 0 ? p - 1 : -1) : v === 1 ? (x < largeur - 1 ? p + 1 : -1) : v === 2 ? p - largeur : p + largeur;
        if (q < 0 || q >= m.length || !m[q] || etiquettes[q] >= 0) continue;
        etiquettes[q] = e;
        pile[haut++] = q;
      }
    }
    tailles.push(n);
  }
  return { etiquettes, tailles };
}

/**
 * Lab de chaque pixel d'une image RGB brute, par libvips (`toColourspace("lab")`, D65) : la même conversion que
 * `rgbVersLab` de `teintes.ts` à 0,01 près (vérifié par le test), cent fois plus vite qu'un appel par pixel. Sert au
 * masque, au blanc et à la texture ; les médianes et les ΔE passent par `teintes.ts`.
 */
export async function labImage(rgb: Buffer, largeur: number, hauteur: number): Promise<{ L: Float32Array; a: Float32Array; b: Float32Array }> {
  const sharp = await sharpModule();
  const brut = await sharp(rgb, { raw: { width: largeur, height: hauteur, channels: 3 } }).toColourspace("lab").raw({ depth: "float" }).toBuffer();
  const f = new Float32Array(brut.buffer, brut.byteOffset, brut.length / 4);
  const n = largeur * hauteur;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = f[3 * i];
    A[i] = f[3 * i + 1];
    B[i] = f[3 * i + 2];
  }
  return { L, a: A, b: B };
}

/** Les pixels RGB des indices retenus, échantillonnés à `max` au plus (pas régulier). */
function pixelsDe(rgb: Buffer, indices: number[], max = ECHANTILLON_MAX): Buffer {
  const pas = Math.max(1, Math.ceil(indices.length / max));
  const garde = Math.ceil(indices.length / pas);
  const sortie = Buffer.alloc(garde * 3);
  for (let k = 0, j = 0; k < indices.length; k += pas, j++) rgb.copy(sortie, j * 3, indices[k] * 3, indices[k] * 3 + 3);
  return sortie;
}

const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);
const mediane = (v: number[]) => {
  if (v.length === 0) return 0;
  const t = [...v].sort((x, y) => x - y);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

type ImageLab = { L: Float32Array; a: Float32Array; b: Float32Array };

/** ΔE 1976 pixel à pixel entre deux images Lab de mêmes dimensions. */
function difference(x: ImageLab, y: ImageLab, n: number): Float32Array {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dL = y.L[i] - x.L[i];
    const da = y.a[i] - x.a[i];
    const db = y.b[i] - x.b[i];
    d[i] = Math.sqrt(dL * dL + da * da + db * db);
  }
  return d;
}

/* ── La balance des blancs automatique ── */

/** Le blanc de la scène hors du masque et les gains qui en découlent (règles de `teintes.ts`, voir l'en-tête). */
export function balanceAutomatique(rgb: Buffer, lab: ImageLab, exclus: Uint8Array, n: number): Balance {
  const candidats: number[] = [];
  const tous: number[] = [];
  for (let i = 0; i < n; i++) {
    if (exclus[i]) continue;
    tous.push(i);
    if (lab.L[i] >= 60 && lab.a[i] * lab.a[i] + lab.b[i] * lab.b[i] <= 225) candidats.push(i);
  }
  const borne = (g: Rgb) => g.map((x) => Math.max(0.25, Math.min(4, x))) as Rgb;
  if (candidats.length >= Math.max(200, 0.003 * n)) {
    const blanc = blancDeZone(pixelsDe(rgb, candidats));
    const labBlanc = rgbVersLab(blanc);
    const vrai = labBlanc[0] >= 70 && chroma(labBlanc) <= 10;
    return { blanc: rgbVersHex(blanc), mode: vrai ? "blanc" : "dominante", gains: borne(gainsBlanc(blanc, BLANC_CIBLE, vrai)) };
  }
  if (tous.length > 0) {
    const blanc = blancDeZone(pixelsDe(rgb, tous));
    if (chroma(rgbVersLab(blanc)) <= 20) return { blanc: rgbVersHex(blanc), mode: "dominante", gains: borne(gainsBlanc(blanc, BLANC_CIBLE, false)) };
  }
  return { blanc: null, mode: "aucune", gains: [1, 1, 1] };
}

/* ── Les étapes de la mesure (fonctions courtes : V8 optimise mal les boucles d'une très longue fonction) ── */

/** Le masque de la surface changée : seuil sur la différence lissée, ouverture, fermeture, grandes composantes. */
function masqueChange(labA: ImageLab, labR: ImageLab, W: number, H: number, seuil: number): { masque: Uint8Array; nbComposantes: number; pixels: number } {
  const N = W * H;
  const lisse = lisser(difference(labA, labR, N), W, H, RAYON_LISSAGE);
  let brut: Uint8Array = new Uint8Array(N);
  for (let i = 0; i < N; i++) brut[i] = lisse[i] > seuil ? 1 : 0;
  brut = dilater(eroder(brut, W, H, RAYON_OUVERTURE), W, H, RAYON_OUVERTURE);
  brut = eroder(dilater(brut, W, H, RAYON_FERMETURE), W, H, RAYON_FERMETURE);
  const { etiquettes, tailles } = composantes(brut, W);
  const masque = new Uint8Array(N);
  let pixels = 0;
  for (let i = 0; i < N; i++) {
    const e = etiquettes[i];
    if (e >= 0 && tailles[e] > MIN_COMPOSANTE) {
      masque[i] = 1;
      pixels++;
    }
  }
  return { masque, nbComposantes: tailles.filter((t) => t > MIN_COMPOSANTE).length, pixels };
}

/** Le sous-masque des pixels du masque attribués à la référence k (la plus proche : ΔE76, clarté comptée pour moitié). */
function sousMasque(lab: ImageLab, masque: Uint8Array, cibles: Lab[], k: number): Uint8Array {
  const sortie = new Uint8Array(masque.length);
  for (let i = 0; i < masque.length; i++) {
    if (!masque[i]) continue;
    let meilleure = 0;
    let dMin = Infinity;
    for (let j = 0; j < cibles.length; j++) {
      const dL = lab.L[i] - cibles[j][0];
      const da = lab.a[i] - cibles[j][1];
      const db = lab.b[i] - cibles[j][2];
      const d = 0.25 * dL * dL + da * da + db * db;
      if (d < dMin) {
        dMin = d;
        meilleure = j;
      }
    }
    if (meilleure === k) sortie[i] = 1;
  }
  return sortie;
}

type Morceau = { ref: number; indices: number[]; interieur: number[]; mesure: Rgb; deltaE: number | null; horsDemande: boolean };

/** Les composantes (> MIN_COMPOSANTE) d'un sous-masque, avec leurs pixels et leur intérieur (érodé). */
function morceauxDe(sous: Uint8Array, W: number, H: number, ref: number): Morceau[] {
  const interieur = eroder(sous, W, H, EROSION_MESURE);
  const { etiquettes, tailles } = composantes(sous, W);
  const parEtiquette: (Morceau | null)[] = tailles.map((t) => (t > MIN_COMPOSANTE ? { ref, indices: [], interieur: [], mesure: [0, 0, 0], deltaE: null, horsDemande: false } : null));
  for (let i = 0; i < sous.length; i++) {
    const e = etiquettes[i];
    if (e < 0) continue;
    const m = parEtiquette[e];
    if (!m) continue;
    m.indices.push(i);
    if (interieur[i]) m.interieur.push(i);
  }
  return parEtiquette.filter((m): m is Morceau => m !== null);
}

/** Les images intégrales de L et de L² (pour l'écart-type local en temps constant). */
function integrales(L: Float32Array, W: number, H: number): { s: Float64Array; s2: Float64Array } {
  const s = new Float64Array((W + 1) * (H + 1));
  const s2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let ligne = 0;
    let ligne2 = 0;
    for (let x = 0; x < W; x++) {
      const v = L[y * W + x];
      ligne += v;
      ligne2 += v * v;
      s[(y + 1) * (W + 1) + x + 1] = s[y * (W + 1) + x + 1] + ligne;
      s2[(y + 1) * (W + 1) + x + 1] = s2[y * (W + 1) + x + 1] + ligne2;
    }
  }
  return { s, s2 };
}

/** La médiane de l'écart-type de L sur des fenêtres (2r + 1)² centrées sur les pixels donnés (échantillonnés). */
function textureMediane(I: { s: Float64Array; s2: Float64Array }, W: number, H: number, pixels: number[]): number {
  const pas = Math.max(1, Math.ceil(pixels.length / ECHANTILLON_MAX));
  const ecarts: number[] = [];
  for (let j = 0; j < pixels.length; j += pas) {
    const i = pixels[j];
    const x = i % W;
    const y = (i - x) / W;
    const x0 = Math.max(0, x - RAYON_TEXTURE);
    const x1 = Math.min(W, x + RAYON_TEXTURE + 1);
    const y0 = Math.max(0, y - RAYON_TEXTURE);
    const y1 = Math.min(H, y + RAYON_TEXTURE + 1);
    const n = (x1 - x0) * (y1 - y0);
    const a = y1 * (W + 1) + x1;
    const b = y0 * (W + 1) + x1;
    const c = y1 * (W + 1) + x0;
    const d = y0 * (W + 1) + x0;
    const m = (I.s[a] - I.s[b] - I.s[c] + I.s[d]) / n;
    ecarts.push(Math.sqrt(Math.max(0, (I.s2[a] - I.s2[b] - I.s2[c] + I.s2[d]) / n - m * m)));
  }
  return mediane(ecarts);
}

/** Une carte de bords (768 px de large) privée des pixels couverts par le masque (échelle de travail W × H). */
function horsMasque(bords: Uint8Array, lc: number, hc: number, masque: Uint8Array, W: number, H: number): Uint8Array {
  const sortie = new Uint8Array(bords);
  for (let y = 0; y < hc; y++) {
    const ys = Math.min(H - 1, Math.floor((y * H) / hc));
    for (let x = 0; x < lc; x++) if (masque[ys * W + Math.min(W - 1, Math.floor((x * W) / lc))]) sortie[y * lc + x] = 0;
  }
  return sortie;
}

/* ── La mesure ── */

const sharpModule = async () => (await import("sharp")).default;

/** Mesure un rendu contre sa photo avant (fichiers), pour les références demandées. Voir l'en-tête. */
export async function mesurerRendu(avant: string, rendu: string, references: ReferenceMesure[], options: OptionsMesure = {}): Promise<MesureRendu> {
  const debut = Date.now();
  const sharp = await sharpModule();
  const seuil = options.seuil ?? SEUIL_DIFFERENCE;

  // Échelle de travail : grand côté à COTE_TRAVAIL ; le rendu aux mêmes dimensions.
  const [metaA, metaR] = await Promise.all([sharp(avant).metadata(), sharp(rendu).metadata()]);
  const wa = metaA.width ?? 1;
  const ha = metaA.height ?? 1;
  const echelle = COTE_TRAVAIL / Math.max(wa, ha);
  const W = Math.max(1, Math.round(wa * echelle));
  const H = Math.max(1, Math.round(ha * echelle));
  const recadre = Math.abs((metaR.width ?? 1) / (metaR.height ?? 1) / (wa / ha) - 1) > 0.02;
  const [rgbA, rgbR] = await Promise.all([
    sharp(avant).flatten({ background: "#ffffff" }).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(rendu).flatten({ background: "#ffffff" }).resize(W, H, { fit: recadre ? "cover" : "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  const N = W * H;
  const lc = LARGEUR_CONTOURS;
  const hc = Math.max(1, Math.round((lc * ha) / wa));
  const bords = Promise.all([carteBords(avant, lc, hc), carteBords(rendu, lc, hc)]);
  bords.catch(() => undefined);
  const [labA, labR] = await Promise.all([labImage(rgbA, W, H), labImage(rgbR, W, H)]);

  // 1. Le masque.
  const { masque, nbComposantes, pixels: pixelsMasque } = masqueChange(labA, labR, W, H, seuil);

  // 2. La balance des blancs, hors du masque (dilaté : pas les bords de la surface).
  const masqueLarge = dilater(masque, W, H, 6);
  const balance = balanceAutomatique(rgbR, labR, masqueLarge, N);

  // 3. Les références : la couleur telle qu'elle paraîtrait dans la scène, pour l'attribution.
  const refs = references.filter((r, i) => references.findIndex((x) => x.ref === r.ref) === i);
  const labCatalogue = refs.map((r) => rgbVersLab(hexVersRgb(r.hex)));
  const labScene = refs.map((r) => rgbVersLab(hexVersRgb(r.hex).map((c, k) => versSrgb(versLineaire(c) / balance.gains[k])) as Rgb));

  // Les morceaux : composantes par référence (ou du masque entier s'il y a 0 ou 1 référence), et leur intérieur.
  const morceaux: Morceau[] = [];
  if (refs.length > 1) for (let k = 0; k < refs.length; k++) morceaux.push(...morceauxDe(sousMasque(labR, masque, labScene, k), W, H, k));
  else morceaux.push(...morceauxDe(masque, W, H, refs.length ? 0 : -1));
  for (const m of morceaux) {
    const lus = m.interieur.length >= 50 ? m.interieur : m.indices;
    m.mesure = medianeCorrigee([pixelsDe(rgbR, lus, ECHANTILLON_MORCEAU)], balance.gains);
    m.deltaE = m.ref >= 0 ? deltaE2000(rgbVersLab(m.mesure), labCatalogue[m.ref]) : null;
  }
  // Hors demande : loin de sa référence (ΔE > 15 ET 8 de plus que le meilleur) alors qu'un autre morceau la rend mieux.
  for (let k = 0; k < refs.length; k++) {
    const siens = morceaux.filter((m) => m.ref === k).sort((x, y) => (x.deltaE ?? 0) - (y.deltaE ?? 0));
    const meilleur = siens[0]?.deltaE ?? 0;
    for (const m of siens.slice(1)) if ((m.deltaE ?? 0) > Math.max(SEUIL_HORS_DEMANDE, meilleur + ECART_HORS_DEMANDE)) m.horsDemande = true;
  }
  if (refs.length === 0) for (const m of morceaux) m.horsDemande = true;

  // 4. Les surfaces : médiane, ΔE, dérive, texture.
  const I = integrales(labR.L, W, H);

  const surfaceDuPixel = new Int16Array(N).fill(-1);
  const surfaces: SurfaceMesuree[] = refs.map((r, k) => {
    const siens = morceaux.filter((m) => m.ref === k && !m.horsDemande);
    const indices = siens.flatMap((m) => m.indices);
    for (const i of indices) surfaceDuPixel[i] = k;
    const attendue = r.classe;
    if (indices.length === 0) return { ref: r.ref, nom: r.nom ?? null, hex: r.hex.toUpperCase(), trouvee: false, mesure: null, brute: null, pixels: 0, part: 0, deltaE: null, derive: null, texture: { mesuree: null, attendue, perdue: false } };
    const interieur = siens.flatMap((m) => m.interieur);
    const lus = interieur.length >= 50 ? interieur : indices;
    const echantillon = pixelsDe(rgbR, lus);
    const mesure = medianeCorrigee([echantillon], balance.gains);
    const labMesure = rgbVersLab(mesure);
    const cible = labCatalogue[k];
    const texture = arrondi(textureMediane(I, W, H, lus), 2);
    return {
      ref: r.ref,
      nom: r.nom ?? null,
      hex: r.hex.toUpperCase(),
      trouvee: true,
      mesure: rgbVersHex(mesure),
      brute: rgbVersHex(medianeCorrigee([echantillon])),
      pixels: indices.length,
      part: arrondi(indices.length / N, 4),
      deltaE: arrondi(deltaE2000(labMesure, cible)),
      derive: { L: arrondi(labMesure[0] - cible[0]), a: arrondi(labMesure[1] - cible[1]), b: arrondi(labMesure[2] - cible[2]), C: arrondi(chroma(labMesure) - chroma(cible)) },
      texture: { mesuree: texture, attendue, perdue: attendue !== "uni" && texture < SEUIL_TEXTURE },
    };
  });
  let pixelsHorsDemande = 0;
  for (const m of morceaux)
    if (m.horsDemande) {
      pixelsHorsDemande += m.indices.length;
      for (const i of m.indices) surfaceDuPixel[i] = -2;
    }

  // 5. Le respect de la pièce : contours hors du masque (dilaté) et global, zones demandées.
  const [bordsA, bordsR] = await bords;
  const contoursHorsMasque = ecartCartes(horsMasque(bordsA, lc, hc, masqueLarge, W, H), horsMasque(bordsR, lc, hc, masqueLarge, W, H), lc, hc);
  const contoursGlobal = ecartCartes(bordsA, bordsR, lc, hc);
  let partHorsZones: number | null = null;
  if (refs.length > 0 && refs.every((r) => r.zones && r.zones.length > 0) && pixelsMasque > 0) {
    const dansZones = new Uint8Array(N);
    for (const r of refs)
      for (const z of r.zones!) {
        const x0 = Math.max(0, Math.floor((z[0] / 100) * W));
        const y0 = Math.max(0, Math.floor((z[1] / 100) * H));
        const x1 = Math.min(W, Math.ceil(((z[0] + z[2]) / 100) * W));
        const y1 = Math.min(H, Math.ceil(((z[1] + z[3]) / 100) * H));
        for (let y = y0; y < y1; y++) dansZones.fill(1, y * W + x0, y * W + x1);
      }
    let dehors = 0;
    for (let i = 0; i < N; i++) if (masque[i] && !dansZones[i]) dehors++;
    partHorsZones = arrondi(dehors / pixelsMasque, 3);
  }

  // Le masque douteux.
  const part = pixelsMasque / N;
  const raisons: string[] = [];
  const pc = (x: number) => `${String(arrondi(100 * x)).replace(".", ",")} %`;
  if (part > PART_MAX) raisons.push(`le masque couvre ${pc(part)} de l'image (rendu décalé, zoomé ou entièrement redessiné ?)`);
  if (part < PART_MIN) raisons.push(`masque minuscule (${pc(part)} de l'image)`);
  if (nbComposantes > COMPOSANTES_MAX) raisons.push(`masque éclaté (${nbComposantes} composantes)`);
  if (contoursHorsMasque >= SEUIL_CONTOURS_HORS_MASQUE || contoursGlobal >= SEUIL_CONTOURS_GLOBAL) raisons.push(`contours déplacés (hors masque ${contoursHorsMasque}, global ${contoursGlobal}) : rendu décalé ou zoomé ?`);

  let detail: MesureRendu["detail"];
  if (options.garderMasque) {
    const flou = await sharp(Buffer.from(masque.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } }).blur(SIGMA_BORD).extractChannel(0).raw().toBuffer();
    if (flou.length !== N) throw new Error(`Masque flou : ${flou.length} octets pour ${N} pixels.`);
    detail = { flou: new Uint8Array(flou), surface: surfaceDuPixel };
  }

  return {
    largeur: W,
    hauteur: H,
    recadre,
    masque: { part: arrondi(part, 4), composantes: nbComposantes, seuil, douteux: raisons.length > 0, raisons },
    balance: { ...balance, gains: balance.gains.map((g) => arrondi(g, 3)) as Rgb },
    surfaces,
    composantes: morceaux.map((m) => ({ pixels: m.indices.length, part: arrondi(m.indices.length / N, 4), mesure: rgbVersHex(m.mesure), ref: m.ref >= 0 ? refs[m.ref].ref : null, deltaE: m.deltaE === null ? null : arrondi(m.deltaE), horsDemande: m.horsDemande })),
    respect: { contoursHorsMasque, contoursGlobal, partHorsZones, partMasque: arrondi(part, 4), partHorsDemande: arrondi(pixelsHorsDemande / N, 4) },
    dureeMs: Date.now() - debut,
    ...(detail ? { detail } : {}),
  };
}

/* ── L'analyse d'erreur par famille de teinte ── */

export type FamilleTeinte = "uni clair" | "uni sombre" | "uni désaturé" | "bois clair" | "bois foncé" | "pierre";
export const FAMILLES_TEINTE: FamilleTeinte[] = ["uni clair", "uni sombre", "uni désaturé", "bois clair", "bois foncé", "pierre"];

/**
 * La famille d'une teinte du catalogue : pierre (classe pierre) ; bois clair si L* ≥ 55, sinon bois foncé ; un uni est
 * « désaturé » si C* < 15 et 25 ≤ L* < 85 (les olives, taupes, gris chauds : un blanc ou un noir n'y est pas), sinon
 * « clair » si L* ≥ 60, sinon « sombre ».
 */
export function familleTeinte(hex: string, classe: ClasseTexture): FamilleTeinte {
  if (classe === "pierre") return "pierre";
  const lab = rgbVersLab(hexVersRgb(hex));
  if (classe === "bois") return lab[0] >= 55 ? "bois clair" : "bois foncé";
  if (chroma(lab) < 15 && lab[0] >= 25 && lab[0] < 85) return "uni désaturé";
  return lab[0] >= 60 ? "uni clair" : "uni sombre";
}

export type CasAnalyse = { famille: FamilleTeinte; moteur: string; modele: string; deltaE: number; derive: Derive };
export type LigneAnalyse = { famille: FamilleTeinte; groupe: string; n: number; deltaEMedian: number; deltaE90: number; derive: Derive };

/** Le centile p (0-100) par interpolation linéaire. */
export function centile(valeurs: number[], p: number): number {
  if (valeurs.length === 0) return 0;
  const t = [...valeurs].sort((x, y) => x - y);
  const pos = ((t.length - 1) * p) / 100;
  const i = Math.floor(pos);
  return i + 1 < t.length ? t[i] + (t[i + 1] - t[i]) * (pos - i) : t[i];
}

/** Par famille : tous les cas, puis par moteur (V1, V2…), puis par modèle ; n, ΔE médian et 90e centile, dérive moyenne. */
export function analyserParFamille(cas: CasAnalyse[]): LigneAnalyse[] {
  const lignes: LigneAnalyse[] = [];
  const ligne = (famille: FamilleTeinte, groupe: string, liste: CasAnalyse[]): LigneAnalyse => {
    const moy = (f: (d: Derive) => number) => arrondi(liste.reduce((s, c) => s + f(c.derive), 0) / liste.length);
    return { famille, groupe, n: liste.length, deltaEMedian: arrondi(centile(liste.map((c) => c.deltaE), 50)), deltaE90: arrondi(centile(liste.map((c) => c.deltaE), 90)), derive: { L: moy((d) => d.L), a: moy((d) => d.a), b: moy((d) => d.b), C: moy((d) => d.C) } };
  };
  for (const famille of FAMILLES_TEINTE) {
    const siens = cas.filter((c) => c.famille === famille);
    if (siens.length === 0) continue;
    lignes.push(ligne(famille, "tous", siens));
    for (const moteur of [...new Set(siens.map((c) => c.moteur))].sort()) lignes.push(ligne(famille, `moteur ${moteur}`, siens.filter((c) => c.moteur === moteur)));
    for (const modele of [...new Set(siens.map((c) => c.modele))].sort()) lignes.push(ligne(famille, `modèle ${modele}`, siens.filter((c) => c.modele === modele)));
  }
  return lignes;
}
