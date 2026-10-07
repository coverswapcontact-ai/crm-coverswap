import { composantes, dilater, eroder, mesurerRendu, SIGMA_BORD, type MesureRendu, type ReferenceMesure, type SourceImage } from "./mesure-rendu";
import { deltaE2000, hexVersRgb, medianeCorrigee, rgbVersLab, versLineaire, type Lab, type Rgb } from "./teintes";
import type { EtatFidelite, FideliteSurface } from "./fidelite";

export type { EtatFidelite, FideliteSurface } from "./fidelite";
export { detailFidelite, lireFidelite, resumerFidelite, type ResumeFidelite } from "./fidelite";

/**
 * Mission 23 (L3) — la correction mathématique des teintes d'un rendu du simulateur, derrière le modèle d'image : il lit
 * l'échantillon comme une indication et redessine (olives plus vertes, blancs cassés plus crème, bois clairs plus
 * foncés) ; on recale chaque surface sur le catalogue, sans toucher au reste de la pièce. Aucun réseau : sharp et du
 * calcul, sur les masques et le Lab de la mesure (`mesure-rendu.ts`, L2), qui ne sont pas recopiés ici.
 *
 * 1. MESURE (`mesurerRendu`, masque gardé) : masque de chaque surface, balance des blancs de la scène, ΔE 2000 avant,
 *    texture, masque douteux.
 * 2. LIMITES, avec la raison écrite (`etat`) :
 *    - masque douteux (rendu décalé, zoomé, redessiné ; masque < 1 % ou > 60 % de l'image, éclaté), surface non
 *      trouvée, surface sous 1 % de l'image, texture perdue (bois ou pierre devenus aplat) : « a_regenerer », rien
 *      n'est touché ;
 *    - ΔE ≤ `SEUIL_FIDELE` (2) : « fidele », rien n'est touché ;
 *    - (sans vrai blanc dans la scène, ces seuils se lisent sur le ΔE à clarté égale : `clarteIncertaine`) ;
 *    - au-delà de `ECART_MAX` (ΔE 2000 > 25 : ce n'est plus une teinte à recaler mais une autre matière) :
 *      « a_regenerer » ;
 *    - surface inchangée (médianes brutes du rendu et de la photo à moins de 3 en teinte et 6 en clarté) : le modèle
 *      n'a rien posé là, la surface n'est dans le masque que par la compensation d'exposition, et ce peut être un rideau
 *      ou un mur (vu sur le jeu réel du 07/10 : un rideau pris pour des façades en frêne blanc, repeint en jaune) :
 *      « a_regenerer » ;
 *    - une correction qui ne gagne pas au moins 1 de ΔE est abandonnée : « a_regenerer ».
 * 3. RECALAGE, sur chaque surface à corriger, en Lab, dans l'espace « balancé » de la mesure (pixels × gains de la
 *    balance des blancs, en lumière linéaire) : viser le hex du catalogue dans cet espace revient à viser le hex
 *    ramené sous l'éclairage de la scène (hex ÷ gains), et le ΔE après se lit exactement comme le ΔE avant.
 *    - a et b : décalés de (cible − médiane), le même pour tous les pixels : l'écart de chaque pixel à la médiane est
 *      conservé (le fil du bois, les veines, le grain restent) ; atténué dans les noirs (L* < 12) et les reflets (voir
 *      `attenuation`) pour ne pas teinter un reflet ni une ombre portée.
 *    - L : multiplicatif (L* × f) : les ombres et les reflets gardent leur rapport ; f = (cible / médiane) ^
 *      `AMPLITUDE_L`, borné à [0,8 ; 1,25]. La clarté est la mesure la moins sûre (elle dépend du blanc retenu, et une
 *      façade à l'ombre d'un mur blanc éclairé paraît plus sombre) : correction partielle (voir `AMPLITUDE_L`), et
 *      aucune quand la scène n'a pas de vrai blanc (balance « dominante » ou « aucune » : l'exposition n'est pas
 *      connue).
 *    - trois itérations sur un échantillon de l'intérieur (aller-retour sRGB 8 bits compris) : la médiane corrigée
 *      tombe sur la cible malgré la non-linéarité et l'écrêtage.
 *    - attribution et garde de couleur (`distanceCentre`, voir là) : chaque pixel du masque va à la surface dont la
 *      médiane mesurée est la plus proche de sa couleur ; loin de toutes, il n'est pas recalé (objet posé dessus,
 *      appareil, bout de plan voisin pris par le masque). Sans elles, la planche du 07/10 montrait un plan en bois voisin
 *      teinté de rose par le recalage d'une façade olive, et des taches sur des colonnes crème à l'ombre.
 *    - coutures (`morceauxACouture`) : un morceau (panneau, porte) que le modèle n'a changé qu'en partie, sans arête
 *      avec le reste, n'est pas recalé du tout (il ferait une couture visible) ; noté dans la raison de la surface.
 *    - bord doux : le masque de tout ce qui a changé (mesure), trous bouchés (`boucherTrous`), érodé de `EROSION_BORD` px puis flouté (σ de L2) à
 *      l'échelle de travail, ramené à la taille du rendu ; hors de ce bord, aucun pixel n'est modifié.
 *    - partage (`PARTAGE_MAX`) : une surface dont la couleur, dans le rendu, se confond avec celle d'une autre n'est pas
 *      recalée (« a_regenerer ») : elle se marbrait.
 * 4. ENCODAGE : même format que le rendu (PNG sans perte ; JPEG qualité 92, chroma 4:4:4).
 *
 * `appliquer: false` : la mesure seule, en lecture (le réglage inactif) ; une surface qu'on aurait corrigée est
 * « mesuree » (ΔE après = ΔE avant : l'image livrée n'a pas changé).
 */

export const SEUIL_FIDELE = 2;
export const ECART_MAX = 25;
/** Part minimale de l'image pour corriger une surface (en dessous, la médiane n'est pas sûre). */
export const PART_MIN_SURFACE = 0.01;
/** Gain minimal (ΔE 2000) pour garder une correction. */
const GAIN_MIN = 1;
/**
 * L'amplitude de la correction de clarté (0 : aucune, 1 : jusqu'à la cible). Réglée sur 70 % du jeu réel du 07/10
 * (REPRISE § Mission 23, L3) : voir là-bas les essais 0 / 0,5 / 1 et la planche.
 */
export const AMPLITUDE_L = 0.5;
const FACTEUR_L_MIN = 0.8;
const FACTEUR_L_MAX = 1.25;
const EROSION_BORD = 2;
const ECHANTILLON = 8_000;
/** Sous ces deux écarts (médianes Lab brutes, rendu contre photo), une surface n'a pas été repeinte. */
const INCHANGEE_TEINTE = 3;
const INCHANGEE_CLARTE = 6;
const ITERATIONS = 3;

export type EntreeCorrection = {
  avant: SourceImage;
  apres: SourceImage;
  /** Les zones demandées (une fidélité par zone ; deux zones d'une même référence partagent sa mesure). */
  zones: { zone: string; ref: string }[];
  references: ReferenceMesure[];
  /** false : la mesure seule, l'image rendue telle quelle (réglage inactif). Défaut : true. */
  appliquer?: boolean;
  /** Pour le réglage sur le jeu d'essai seulement. */
  amplitudeL?: number;
  /** Essais et planches : garder le bord flou du masque appliqué (0-255, taille du rendu) et les recalages. */
  garderPoids?: boolean;
};

export type ResultatCorrection = {
  /** Le rendu corrigé, ou le rendu d'origine (mêmes octets) si rien n'a été corrigé. */
  image: Buffer;
  corrigee: boolean;
  fidelite: FideliteSurface[];
  dureeMs: number;
  mesure: Omit<MesureRendu, "detail">;
  /** Seulement avec `garderPoids` et une correction faite : le bord flou du masque (0-255, taille du rendu) et les recalages. */
  detail?: { poids: Uint8Array; recalages: { ref: string; centre: Lab; da: number; db: number; facteurL: number }[] };
};

const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const virgule = (n: number) => String(arrondi(n)).replace(".", ",");
const mediane = (v: number[]) => {
  if (v.length === 0) return 0;
  const t = [...v].sort((x, y) => x - y);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};
const sharpModule = async () => (await import("sharp")).default;

/* ── Conversions rapides, pixel par pixel (mêmes formules que `teintes.ts`) ── */

const LINEAIRE = Float64Array.from({ length: 256 }, (_, c) => versLineaire(c));
const XN = 0.95047;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (t: number) => (t * t * t > EPS ? t * t * t : (116 * t - 16) / KAPPA);
/** Lumière linéaire → sRGB 8 bits, par une table sur l'échelle de la racine (fine dans les noirs) : ±1 niveau au plus. */
const PAS_RACINE = 16_384;
const SRGB_RACINE = Uint8Array.from({ length: PAS_RACINE + 1 }, (_, i) => {
  const l = (i / PAS_RACINE) ** 2;
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
});
const srgb8 = (l: number) => (l <= 0 ? 0 : l >= 1 ? 255 : SRGB_RACINE[Math.round(Math.sqrt(l) * PAS_RACINE)]);

/** Lab « balancé » (gains linéaires appliqués) d'un pixel RGB 8 bits. */
function versLab(r: number, g: number, b: number, gains: Rgb, sortie: Float64Array): void {
  const lr = LINEAIRE[r] * gains[0];
  const lg = LINEAIRE[g] * gains[1];
  const lb = LINEAIRE[b] * gains[2];
  const fx = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN);
  const fy = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const fz = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / ZN);
  sortie[0] = 116 * fy - 16;
  sortie[1] = 500 * (fx - fy);
  sortie[2] = 200 * (fy - fz);
}

/** Le pixel RGB 8 bits d'un Lab balancé (gains retirés), écrit dans `rgb` à l'indice o. */
function versRgb(L: number, a: number, b: number, gains: Rgb, rgb: Uint8Array | Buffer, o: number): void {
  const fy = (L + 16) / 116;
  const x = XN * fInv(fy + a / 500);
  const y = L > KAPPA * EPS ? fy * fy * fy : L / KAPPA;
  const z = ZN * fInv(fy - b / 200);
  rgb[o] = srgb8((3.2404542 * x - 1.5371385 * y - 0.4985314 * z) / gains[0]);
  rgb[o + 1] = srgb8((-0.969266 * x + 1.8760108 * y + 0.041556 * z) / gains[1]);
  rgb[o + 2] = srgb8((0.0556434 * x - 0.2040259 * y + 1.0572252 * z) / gains[2]);
}

/**
 * Atténuation du décalage de teinte dans les noirs et dans les reflets : un pixel nettement plus clair que la surface
 * (L* au-delà de sa médiane + 12, et au moins 94) reçoit moins de teinte. Relative à la surface : un blanc mat proche
 * de 94 n'est pas un reflet et doit recevoir toute sa teinte.
 */
const attenuation = (L: number, Lsurface: number) => {
  const reflet = Math.min(100, Math.max(94, Lsurface + 12));
  return Math.max(0, Math.min(1, L / 12, (reflet + 6 - L) / 6));
};

/** La médiane de la surface avant correction (`centre`) et ce qu'on lui applique. */
type Recalage = { centre: Lab; da: number; db: number; facteurL: number };

/**
 * L'ATTRIBUTION d'un pixel du masque et la GARDE de couleur. Un pixel du masque va aux surfaces dont la médiane
 * (mesurée dans le rendu, pas le hex du catalogue) est proche de sa couleur (`parts`), en ΔE76 avec la clarté comptée
 * au quart (une ombre, un reflet, le fil d'un bois restent dans leur surface) ; plus loin que `GARDE_PLEINE` il n'est
 * recalé qu'en partie, plus loin que `GARDE_NULLE` pas du tout : ce n'est pas la surface (un objet posé dessus, un
 * appareil, un bout de mur ou de plan voisin pris par le masque).
 * Pourquoi pas l'attribution de la mesure (L2) : au plus proche du hex sous la lumière de la scène, elle range une
 * façade crème à l'ombre avec le plan en noyer voisin et laisse des trous (morceaux sous 2 500 px) ; recalées
 * séparément, ces taches se voyaient sur la planche du 07/10. Elle ne sert plus qu'à échantillonner les médianes.
 */
const GARDE_PLEINE = 12;
const GARDE_NULLE = 26;
const TEMPERATURE_PARTS = 1.5;
/** Le flou (σ, pixels du rendu) sous lequel la couleur d'un lieu est lue pour l'attribution. */
const SIGMA_ATTRIBUTION = 6;
const distanceCentre = (lab: Float64Array, centre: Lab) => {
  const dL = 0.25 * (lab[0] - centre[0]);
  const da = lab[1] - centre[1];
  const db = lab[2] - centre[2];
  return Math.sqrt(dL * dL + da * da + db * db);
};
const rampe = (d: number) => (d <= GARDE_PLEINE ? 1 : d >= GARDE_NULLE ? 0 : (GARDE_NULLE - d) / (GARDE_NULLE - GARDE_PLEINE));

/** Applique un recalage, pondéré par w ∈ [0, 1], à un Lab balancé. */
function recaler(lab: Float64Array, r: Recalage, w: number): void {
  if (w <= 0) return;
  const t = w * attenuation(lab[0], r.centre[0]);
  // Un pixel brûlé (un canal à 255) dépasse 100 une fois balancé : ramené à 100 avant le facteur, sinon il ressort
  // plus clair que ses voisins quand on assombrit.
  lab[0] = Math.max(0, Math.min(100, Math.min(100, lab[0]) * (1 + w * (r.facteurL - 1))));
  lab[1] += t * r.da;
  lab[2] += t * r.db;
}

/**
 * Les parts des surfaces pour un pixel : partagées selon exp(−(d − dmin) / `TEMPERATURE_PARTS`) (la plus proche prend
 * presque tout dès qu'elle l'est nettement : une façade crème ne reçoit pas le recalage du plan en chêne voisin, à 11
 * de là ; à mi-chemin, moitié-moitié), puis plafonnées par la garde de la plus proche. Entre deux surfaces de couleurs voisines (un plan noir et une crédence anthracite),
 * le recalage passe ainsi de l'une à l'autre sans pixels alternés : la planche du 07/10 montrait des plinthes
 * mouchetées avec une attribution au plus proche.
 */
function parts(lab: Float64Array, centres: (Lab | null)[], sortie: Float64Array): number {
  let dMin = Infinity;
  for (let j = 0; j < centres.length; j++) {
    const c = centres[j];
    sortie[j] = c ? distanceCentre(lab, c) : Infinity;
    if (sortie[j] < dMin) dMin = sortie[j];
  }
  if (dMin >= GARDE_NULLE) {
    sortie.fill(0);
    return 0;
  }
  let somme = 0;
  for (let j = 0; j < centres.length; j++) {
    const d = sortie[j];
    sortie[j] = d < GARDE_NULLE ? Math.exp(-(d - dMin) / TEMPERATURE_PARTS) : 0;
    somme += sortie[j];
  }
  const plafond = rampe(dMin);
  for (let j = 0; j < centres.length; j++) sortie[j] = (sortie[j] / somme) * plafond;
  return somme;
}

/** Applique à un Lab les recalages des surfaces, chacun à sa part (le décalage de a, b et le facteur de L mélangés). */
function recalerMelange(lab: Float64Array, recalages: (Recalage | null)[], p: Float64Array, poids: number, exclus: (Uint8Array | null)[] = [], i = 0): boolean {
  let facteur = 0;
  let da = 0;
  let db = 0;
  let w = 0;
  let Lsurface = 0;
  for (let j = 0; j < recalages.length; j++) {
    const r = recalages[j];
    const e = exclus[j];
    if (e && e[i] > 0) p[j] *= 1 - e[i] / 255;
    if (!r || p[j] <= 0) continue;
    Lsurface += p[j] * r.centre[0];
    facteur += p[j] * (r.facteurL - 1);
    da += p[j] * r.da;
    db += p[j] * r.db;
    w += p[j];
  }
  if (w <= 0) return false;
  const t = poids * attenuation(lab[0], Lsurface / w);
  lab[0] = Math.max(0, Math.min(100, Math.min(100, lab[0]) * (1 + poids * facteur)));
  lab[1] += t * da;
  lab[2] += t * db;
  return true;
}

/**
 * Les recalages sur les pixels du bord flou du masque (`poids` > 0). Les parts se lisent sur le rendu flouté
 * (`flou`, σ `SIGMA_ATTRIBUTION`) et le recalage s'applique au pixel net : la décision suit la couleur du lieu, pas le
 * grain ; sans cela, un bois voisin d'une teinte proche, à cheval sur la garde, se recalait un pixel sur deux (taches
 * rousses sur un flanc d'îlot, planche du 07/10).
 */
function appliquerRecalages(rgb: Buffer, flou: Buffer, sortie: Buffer, poids: Uint8Array, gains: Rgb, centres: (Lab | null)[], recalages: (Recalage | null)[], exclus: (Uint8Array | null)[]): Partage {
  const lab = new Float64Array(3);
  const p = new Float64Array(centres.length);
  const partage: Partage = { pixels: centres.map(() => 0), partages: centres.map(() => 0) };
  for (let i = 0; i < poids.length; i++) {
    if (poids[i] === 0) continue;
    const o = 3 * i;
    versLab(flou[o], flou[o + 1], flou[o + 2], gains, lab);
    const somme = parts(lab, centres, p);
    if (somme <= 0) continue;
    let k = 0;
    let total = 0;
    for (let j = 0; j < p.length; j++) {
      total += p[j];
      if (p[j] > p[k]) k = j;
    }
    if (recalages[k] && total > 0) {
      partage.pixels[k]++;
      if (p[k] / total < PART_PROPRE) partage.partages[k]++;
    }
    versLab(rgb[o], rgb[o + 1], rgb[o + 2], gains, lab);
    if (recalerMelange(lab, recalages, p, poids[i] / 255, exclus, i)) versRgb(lab[0], lab[1], lab[2], gains, sortie, o);
  }
  return partage;
}

/**
 * Le PARTAGE : par surface recalée, ses pixels (ceux où elle a la plus grande part) et ceux qu'elle partage avec une
 * autre (sa part sous `PART_PROPRE`). Plus de `PARTAGE_MAX` de pixels partagés : sa couleur, dans le rendu, est trop
 * proche de celle d'une autre surface pour qu'on les sépare ; recalée quand même, elle se marbrait de blocs (colonne
 * gris clair voisine d'un plan blanc, planche du 07/10 : 100 % partagés ; les surfaces bien rendues restent sous 35 %).
 */
type Partage = { pixels: number[]; partages: number[] };
const PART_PROPRE = 0.8;
const PARTAGE_MAX = 0.5;

/* ── Les coutures ── */

/**
 * Les COUTURES. Le modèle change parfois une partie seulement d'une surface d'aspect uni (le flanc d'un îlot, le haut
 * d'une colonne au contre-jour) : invisible dans le rendu, la limite de son changement le devient dès qu'on recale
 * l'intérieur et pas l'extérieur. La région qu'une surface va recaler (masque de ce qui a changé, trous bouchés,
 * pixels dont elle a la plus grande part ; échelle de travail, rendu flouté) est coupée le long des arêtes de l'image
 * (gradient de Lab > `ARETE`) : chaque morceau est à peu près un panneau, une porte, un plan. On suit le bord de chaque
 * morceau : un point du bord est « ouvert » si, 4 px dehors (hors de la région), la couleur est la même que 3 px dedans
 * (ΔE76 < `ECART_COUTURE` : rien ne les sépare) et que le recalage du dedans l'en éloignerait (de plus de 2). Un
 * morceau dont plus de `PART_OUVERTE_MAX` du bord est ouvert n'est pas recalé, tout entier (jamais à moitié : un
 * effacement progressif depuis les bords ouverts faisait des damiers sur une colonne blanche, planche du 07/10). Une
 * porte, un panneau sont bordés d'arêtes (joints, plinthe, mur, plan) : ils restent recalés. Sans cette règle, une
 * bande grise se voyait sur le flanc en noyer d'un îlot (planche du 07/10).
 */
const PART_OUVERTE_MAX = 0.5;
const ECART_COUTURE = 6;
const ARETE = 8;
const MORCEAU_MIN = 400;

type LabTravail = { L: Float64Array; a: Float64Array; b: Float64Array };

/** Les arêtes de l'image (0/1) : gradient central de Lab (ΔE76 par pixel) au-dessus de `ARETE`. */
function aretes(lab: LabTravail, W: number, H: number): Uint8Array {
  const sortie = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = Math.hypot(lab.L[i + 1] - lab.L[i - 1], lab.a[i + 1] - lab.a[i - 1], lab.b[i + 1] - lab.b[i - 1]) / 2;
      const gy = Math.hypot(lab.L[i + W] - lab.L[i - W], lab.a[i + W] - lab.a[i - W], lab.b[i + W] - lab.b[i - W]) / 2;
      if (Math.max(gx, gy) > ARETE) sortie[i] = 1;
    }
  return sortie;
}

/** Les morceaux de la région de chaque surface à ne pas recaler (0/1, échelle de travail), ou null s'il n'y en a pas. */
function morceauxACouture(change: Uint8Array, lab: LabTravail, W: number, H: number, centres: (Lab | null)[], recalages: (Recalage | null)[]): { exclus: (Uint8Array | null)[]; nombre: number[] } {
  const n = W * H;
  const p = new Float64Array(centres.length);
  const pixel = new Float64Array(3);
  const meilleure = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!change[i]) continue;
    pixel[0] = lab.L[i];
    pixel[1] = lab.a[i];
    pixel[2] = lab.b[i];
    if (parts(pixel, centres, p) <= 0) continue;
    let k = -1;
    for (let j = 0; j < centres.length; j++) if (p[j] >= 0.5 && (k < 0 || p[j] > p[k])) k = j;
    meilleure[i] = k;
  }
  const arete = dilater(aretes(lab, W, H), W, H, 1);
  const ecart = (i: number, j: number) => Math.hypot(lab.L[i] - lab.L[j], lab.a[i] - lab.a[j], lab.b[i] - lab.b[j]);
  // Ouvert : rien ne séparait dehors et dedans, et le recalage du dedans les éloignerait.
  const recale = new Float64Array(3);
  const couture = (dehors: number, dedans: number, r: Recalage) => {
    const avant = ecart(dehors, dedans);
    if (avant >= ECART_COUTURE) return false;
    recale[0] = lab.L[dedans];
    recale[1] = lab.a[dedans];
    recale[2] = lab.b[dedans];
    recaler(recale, r, 1);
    return Math.hypot(lab.L[dehors] - recale[0], lab.a[dehors] - recale[1], lab.b[dehors] - recale[2]) > avant + 2;
  };
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const exclus: (Uint8Array | null)[] = [];
  const nombre: number[] = [];
  for (let k = 0; k < centres.length; k++) {
    const r = recalages[k];
    if (!r) {
      exclus.push(null);
      nombre.push(0);
      continue;
    }
    const region = new Uint8Array(n);
    const morceaux = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      if (meilleure[i] === k) {
        region[i] = 1;
        if (!arete[i]) morceaux[i] = 1;
      }
    const { etiquettes, tailles } = composantes(morceaux, W);
    const bord = new Float64Array(tailles.length);
    const ouvert = new Float64Array(tailles.length);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const e = etiquettes[i];
        if (e < 0) continue;
        for (const [dx, dy] of DIRS) {
          const xs = x + dx;
          const ys = y + dy;
          if (xs < 0 || ys < 0 || xs >= W || ys >= H || morceaux[ys * W + xs]) continue;
          // Un point du bord du morceau : seul compte celui qui donne hors de la région (pas sur une arête intérieure).
          const xo = x + 4 * dx;
          const yo = y + 4 * dy;
          const xi = x - 3 * dx;
          const yi = y - 3 * dy;
          if (xo < 0 || yo < 0 || xo >= W || yo >= H || xi < 0 || yi < 0 || xi >= W || yi >= H) break;
          bord[e]++;
          if (!region[yo * W + xo] && couture(yo * W + xo, yi * W + xi, r)) ouvert[e]++;
          break;
        }
      }
    const aExclure = tailles.map((t, e) => t >= MORCEAU_MIN && bord[e] > 0 && ouvert[e] / bord[e] > PART_OUVERTE_MAX);
    const nb = aExclure.filter(Boolean).length;
    nombre.push(nb);
    if (nb === 0) {
      exclus.push(null);
      continue;
    }
    const masque = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (etiquettes[i] >= 0 && aExclure[etiquettes[i]]) masque[i] = 1;
    exclus.push(masque);
  }
  return { exclus, nombre };
}

/** Le Lab balancé, flouté, de toute l'image à l'échelle de travail. */
async function labTravail(image: Buffer, W: number, H: number, gains: Rgb): Promise<LabTravail> {
  const sharp = await sharpModule();
  const rgb = await sharp(image).removeAlpha().resize(W, H, { fit: "fill" }).blur(1.5).raw().toBuffer();
  const n = W * H;
  const L = new Float64Array(n);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const lab = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    versLab(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2], gains, lab);
    L[i] = lab[0];
    a[i] = lab[1];
    b[i] = lab[2];
  }
  return { L, a, b };
}

/** Un masque d'exclusion (0/1, échelle de travail) élargi de 3 px (arêtes et bord flou), flouté, agrandi à la taille du rendu (0-255). */
async function exclusionAgrandie(masque: Uint8Array, W: number, H: number, largeur: number, hauteur: number): Promise<Uint8Array> {
  const sharp = await sharpModule();
  const large = dilater(masque, W, H, 3);
  const octets = Buffer.alloc(large.length);
  for (let i = 0; i < large.length; i++) if (large[i]) octets[i] = 255;
  const flou = await sharp(octets, { raw: { width: W, height: H, channels: 1 } }).blur(SIGMA_BORD).resize(largeur, hauteur, { fit: "fill", kernel: "linear" }).extractChannel(0).raw().toBuffer();
  return new Uint8Array(flou);
}

/* ── Les masques ── */

/** Un masque binaire (0/1) de l'échelle de travail, érodé puis flouté, agrandi à la taille du rendu (0-255). */
async function adoucir(masque: Uint8Array, W: number, H: number, largeur: number, hauteur: number): Promise<Uint8Array> {
  const sharp = await sharpModule();
  const binaire = eroder(masque, W, H, EROSION_BORD);
  const octets = Buffer.alloc(binaire.length);
  for (let i = 0; i < binaire.length; i++) if (binaire[i]) octets[i] = 255;
  const flou = await sharp(octets, { raw: { width: W, height: H, channels: 1 } })
    .blur(SIGMA_BORD)
    .resize(largeur, hauteur, { fit: "fill", kernel: "linear" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (flou.length !== largeur * hauteur) throw new Error(`Masque adouci : ${flou.length} octets pour ${largeur * hauteur} pixels.`);
  return new Uint8Array(flou);
}

/**
 * Bouche les trous d'un masque (0/1, en place) : les composantes du fond qui ne touchent pas le bord de l'image et
 * couvrent moins de `TROU_MAX` de l'image. Un trou laissé dans une façade (un reflet que le modèle n'a pas assez
 * changé) restait de l'ancienne teinte au milieu de la nouvelle : un carré visible sur la planche du 07/10. Une
 * poignée, un objet devant la façade sont bouchés aussi, mais la garde de couleur les laisse tels quels.
 */
const TROU_MAX = 0.01;
function boucherTrous(masque: Uint8Array, W: number, H: number): void {
  const fond = new Uint8Array(masque.length);
  for (let i = 0; i < masque.length; i++) fond[i] = masque[i] ? 0 : 1;
  const { etiquettes, tailles } = composantes(fond, W);
  const auBord = new Uint8Array(tailles.length);
  for (let x = 0; x < W; x++) {
    if (etiquettes[x] >= 0) auBord[etiquettes[x]] = 1;
    if (etiquettes[(H - 1) * W + x] >= 0) auBord[etiquettes[(H - 1) * W + x]] = 1;
  }
  for (let y = 0; y < H; y++) {
    if (etiquettes[y * W] >= 0) auBord[etiquettes[y * W]] = 1;
    if (etiquettes[y * W + W - 1] >= 0) auBord[etiquettes[y * W + W - 1]] = 1;
  }
  for (let i = 0; i < masque.length; i++) {
    const e = etiquettes[i];
    if (e >= 0 && !auBord[e] && tailles[e] < TROU_MAX * masque.length) masque[i] = 1;
  }
}

/** Le poids (0-255) d'une surface de la mesure, à la taille du rendu (pour échantillonner son intérieur). */
async function poidsSurface(surface: Int16Array, k: number, W: number, H: number, largeur: number, hauteur: number): Promise<Uint8Array> {
  const masque = new Uint8Array(surface.length);
  for (let i = 0; i < surface.length; i++) if (surface[i] === k) masque[i] = 1;
  return adoucir(masque, W, H, largeur, hauteur);
}

/** Les indices des pixels pleinement dans la surface (poids 255), échantillonnés au pas régulier. */
function interieur(poids: Uint8Array): number[] {
  let n = 0;
  for (let i = 0; i < poids.length; i++) if (poids[i] === 255) n++;
  const pas = Math.max(1, Math.ceil(n / ECHANTILLON));
  const sortie: number[] = [];
  for (let i = 0, j = 0; i < poids.length; i++) if (poids[i] === 255 && j++ % pas === 0) sortie.push(i);
  return sortie;
}

/**
 * Les pixels RGB d'un échantillon après le recalage de la surface k (attribution et garde comprises, aller-retour
 * 8 bits compris), en Buffer RGB ; sans recalage, les pixels tels quels.
 */
function echantillonRecale(rgb: Buffer, indices: number[], gains: Rgb, r: Recalage | null, centres: (Lab | null)[] = [], k = -1, flou: Buffer = rgb): Buffer {
  const sortie = Buffer.alloc(indices.length * 3);
  const lab = new Float64Array(3);
  const p = new Float64Array(centres.length);
  for (let j = 0; j < indices.length; j++) {
    const o = indices[j] * 3;
    if (!r) {
      rgb.copy(sortie, j * 3, o, o + 3);
      continue;
    }
    versLab(flou[o], flou[o + 1], flou[o + 2], gains, lab);
    parts(lab, centres, p);
    versLab(rgb[o], rgb[o + 1], rgb[o + 2], gains, lab);
    recaler(lab, r, p[k]);
    versRgb(lab[0], lab[1], lab[2], gains, sortie, j * 3);
  }
  return sortie;
}

/** Médiane de L, a, b (balancés) d'un échantillon RGB. */
function medianesLab(pixels: Buffer, gains: Rgb): Lab {
  const n = pixels.length / 3;
  const L: number[] = new Array(n);
  const A: number[] = new Array(n);
  const B: number[] = new Array(n);
  const lab = new Float64Array(3);
  for (let j = 0; j < n; j++) {
    versLab(pixels[3 * j], pixels[3 * j + 1], pixels[3 * j + 2], gains, lab);
    L[j] = lab[0];
    A[j] = lab[1];
    B[j] = lab[2];
  }
  return [mediane(L), mediane(A), mediane(B)];
}

/** ΔE 2000 et ΔE à clarté égale de la médiane d'un échantillon (méthode de la mesure : `medianeCorrigee`). */
function ecarts(pixels: Buffer, gains: Rgb, cible: Lab): { deltaE: number; teinte: number } {
  const lab = rgbVersLab(medianeCorrigee([pixels], gains));
  return { deltaE: deltaE2000(lab, cible), teinte: deltaE2000([cible[0], lab[1], lab[2]], cible) };
}

/* ── La correction ── */

type Decision = { k: number; etat: EtatFidelite; raison?: string; deltaEAvant: number | null; deltaEApres: number | null; teinteAvant: number | null; teinteApres: number | null; recalage?: Recalage };

export async function corrigerTeintes(entree: EntreeCorrection): Promise<ResultatCorrection> {
  const debut = Date.now();
  const sharp = await sharpModule();
  const appliquer = entree.appliquer !== false;
  const refs = entree.references.filter((r, i) => entree.references.findIndex((x) => x.ref === r.ref) === i);
  const m = await mesurerRendu(entree.avant, entree.apres, refs, { garderMasque: true });
  const { detail, ...mesure } = m;
  const gains = m.balance.gains;
  const clarteSure = m.balance.mode === "blanc";
  const amplitude = clarteSure ? (entree.amplitudeL ?? AMPLITUDE_L) : 0;
  /** L'écart qui décide : le ΔE 2000, ou à clarté égale quand l'exposition de la scène n'est pas connue. */
  const critere = (deltaE: number, teinte: number) => (clarteSure ? deltaE : teinte);

  // 1. Les décisions de principe, surface par surface.
  const decisions: Decision[] = m.surfaces.map((s, k) => {
    const base = { k, deltaEAvant: s.deltaE, deltaEApres: s.deltaE, teinteAvant: s.deltaEChromatique, teinteApres: s.deltaEChromatique };
    const pc = (x: number) => `${String(arrondi(100 * x)).replace(".", ",")} %`;
    if (m.masque.douteux) return { ...base, etat: "a_regenerer", raison: `masque douteux : ${m.masque.raisons.join(" ; ")}` };
    if (!s.trouvee || s.deltaE === null) return { ...base, etat: "a_regenerer", raison: "surface non trouvée dans le rendu (inchangée, ou changée hors de la teinte demandée)" };
    if (s.part < PART_MIN_SURFACE) return { ...base, etat: "a_regenerer", raison: `surface trop petite pour être recalée (${pc(s.part)} de l'image)` };
    if (s.texture.perdue) return { ...base, etat: "a_regenerer", raison: `texture perdue : ${s.texture.attendue} rendu en aplat (texture ${String(s.texture.relative ?? s.texture.mesuree).replace(".", ",")})` };
    const ecart = critere(s.deltaE, s.deltaEChromatique ?? s.deltaE);
    if (ecart <= SEUIL_FIDELE) return { ...base, etat: "fidele" };
    if (ecart > ECART_MAX) return { ...base, etat: "a_regenerer", raison: `écart trop grand pour une retouche (ΔE ${String(s.deltaE).replace(".", ",")}) : une autre matière, pas une teinte à recaler` };
    return { ...base, etat: appliquer ? "corrigee" : "mesuree" };
  });

  const aCorriger = decisions.filter((d) => d.etat === "corrigee" || d.etat === "mesuree");
  let image = Buffer.isBuffer(entree.apres) ? entree.apres : await sharp(entree.apres).toBuffer();
  let corrigee = false;
  let poidsGlobal: Uint8Array | null = null;

  if (aCorriger.length > 0 && detail) {
    // 2. Le rendu à sa taille ; pour chaque surface trouvée, son intérieur (attribution de la mesure) et sa médiane.
    const { data: rgb, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const largeur = info.width;
    const hauteur = info.height;
    const rgbFlou = await sharp(rgb, { raw: { width: largeur, height: hauteur, channels: 3 } }).blur(SIGMA_ATTRIBUTION).raw().toBuffer();
    // L'avant aux dimensions du rendu (étiré comme dans la mesure), pour savoir si la surface a vraiment été repeinte.
    const rgbAvant = await sharp(entree.avant).flatten({ background: "#ffffff" }).resize(largeur, hauteur, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const echantillons: (number[] | null)[] = [];
    const centres: (Lab | null)[] = [];
    for (const [k, s] of m.surfaces.entries()) {
      const indices = s.trouvee ? interieur(await poidsSurface(detail.surface, k, m.largeur, m.hauteur, largeur, hauteur)) : [];
      echantillons.push(indices.length >= 50 ? indices : null);
      centres.push(indices.length >= 50 ? medianesLab(echantillonRecale(rgb, indices, gains, null), gains) : null);
    }

    for (const d of aCorriger) {
      const s = m.surfaces[d.k];
      const cible = rgbVersLab(hexVersRgb(s.hex));
      const indices = echantillons[d.k];
      const depart = centres[d.k];
      if (!indices || !depart) {
        Object.assign(d, { etat: "a_regenerer", raison: "intérieur de la surface trop petit à la taille du rendu" });
        continue;
      }
      const brut = echantillonRecale(rgb, indices, gains, null);
      // Surface inchangée : le modèle n'a pas repeint ces pixels (même teinte, même clarté que la photo, sans balance) ;
      // ils sont dans le masque par la compensation d'exposition, et ce peut être n'importe quoi (un rideau, un mur).
      const labAvant = medianesLab(echantillonRecale(rgbAvant, indices, [1, 1, 1], null), [1, 1, 1]);
      const labRendu = medianesLab(brut, [1, 1, 1]);
      const ecartTeinte = Math.hypot(labRendu[1] - labAvant[1], labRendu[2] - labAvant[2]);
      const ecartClarte = Math.abs(labRendu[0] - labAvant[0]);
      if (ecartTeinte < INCHANGEE_TEINTE && ecartClarte < INCHANGEE_CLARTE) {
        Object.assign(d, { etat: "a_regenerer", raison: `surface inchangée par le modèle (écart à la photo : teinte ${virgule(ecartTeinte)}, clarté ${virgule(ecartClarte)}) : le revêtement n'a pas été posé, ou le masque a pris autre chose` });
        continue;
      }
      if (d.etat === "mesuree") continue;
      const avant = ecarts(brut, gains, cible);
      const cibleL = depart[0] * Math.max(FACTEUR_L_MIN, Math.min(FACTEUR_L_MAX, (cible[0] / Math.max(1, depart[0])) ** amplitude));
      const r: Recalage = { centre: depart, da: cible[1] - depart[1], db: cible[2] - depart[2], facteurL: cibleL / Math.max(1, depart[0]) };
      for (let it = 1; it < ITERATIONS; it++) {
        const actuel = medianesLab(echantillonRecale(rgb, indices, gains, r, centres, d.k, rgbFlou), gains);
        r.da += cible[1] - actuel[1];
        r.db += cible[2] - actuel[2];
        r.facteurL = Math.max(FACTEUR_L_MIN, Math.min(FACTEUR_L_MAX, r.facteurL * (cibleL / Math.max(1, actuel[0]))));
      }
      const apres = ecarts(echantillonRecale(rgb, indices, gains, r, centres, d.k, rgbFlou), gains, cible);
      Object.assign(d, { deltaEAvant: arrondi(avant.deltaE), teinteAvant: arrondi(avant.teinte), deltaEApres: arrondi(apres.deltaE), teinteApres: arrondi(apres.teinte), recalage: r });
      const gainAvant = critere(avant.deltaE, avant.teinte);
      const gainApres = critere(apres.deltaE, apres.teinte);
      if (gainApres > gainAvant - GAIN_MIN)
        Object.assign(d, { etat: "a_regenerer", raison: `correction sans gain (ΔE${clarteSure ? "" : " à clarté égale"} ${virgule(gainAvant)} → ${virgule(gainApres)})`, deltaEApres: arrondi(avant.deltaE), teinteApres: arrondi(avant.teinte), recalage: undefined });
    }

    // 3. L'application, pixel par pixel, sur le seul bord flou du masque de la mesure (tout ce qui a changé).
    const recalages: (Recalage | null)[] = m.surfaces.map((_, k) => aCorriger.find((d) => d.k === k && d.etat === "corrigee")?.recalage ?? null);
    if (recalages.some((r) => r !== null)) {
      const change = new Uint8Array(detail.flou.length);
      for (let i = 0; i < change.length; i++) if (detail.flou[i] >= 128) change[i] = 1;
      boucherTrous(change, m.largeur, m.hauteur);
      poidsGlobal = await adoucir(change, m.largeur, m.hauteur, largeur, hauteur);
      const coutures = morceauxACouture(change, await labTravail(image, m.largeur, m.hauteur, gains), m.largeur, m.hauteur, centres, recalages);
      const exclus = await Promise.all(coutures.exclus.map((x) => (x ? exclusionAgrandie(x, m.largeur, m.hauteur, largeur, hauteur) : null)));
      for (const d of aCorriger)
        if (d.etat === "corrigee" && coutures.nombre[d.k] > 0) d.raison = `${coutures.nombre[d.k]} morceau(x) laissé(s) tel(s) quel(s) : changé(s) par le modèle sans bord net avec le reste, le recaler ferait une couture`;
      let sortie = Buffer.from(rgb);
      const partage = appliquerRecalages(rgb, rgbFlou, sortie, poidsGlobal, gains, centres, recalages, exclus);
      let refaire = false;
      for (const d of aCorriger) {
        const n = partage.pixels[d.k];
        if (d.etat !== "corrigee" || n === 0 || partage.partages[d.k] / n <= PARTAGE_MAX) continue;
        Object.assign(d, { etat: "a_regenerer", raison: `couleur trop proche d'une autre surface dans le rendu (${String(Math.round((100 * partage.partages[d.k]) / n))} % des pixels partagés) : impossible de la recaler seule`, deltaEApres: d.deltaEAvant, teinteApres: d.teinteAvant, recalage: undefined });
        recalages[d.k] = null;
        refaire = true;
      }
      if (refaire) {
        sortie = Buffer.from(rgb);
        if (recalages.some((r) => r !== null)) appliquerRecalages(rgb, rgbFlou, sortie, poidsGlobal, gains, centres, recalages, exclus);
      }
      // Le ΔE après, relu sur l'image produite (coutures et parts comprises), pas sur la simulation de l'échantillon.
      for (const d of aCorriger) {
        const indices = echantillons[d.k];
        if (d.etat !== "corrigee" || !indices) continue;
        const relu = ecarts(echantillonRecale(sortie, indices, gains, null), gains, rgbVersLab(hexVersRgb(m.surfaces[d.k].hex)));
        d.deltaEApres = arrondi(relu.deltaE);
        d.teinteApres = arrondi(relu.teinte);
      }
      if (recalages.some((r) => r !== null)) {
        const png = image[0] === 0x89 && image[1] === 0x50;
        const brut = sharp(sortie, { raw: { width: largeur, height: hauteur, channels: 3 } });
        image = await (png ? brut.png({ compressionLevel: 6 }) : brut.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })).toBuffer();
        corrigee = true;
      }
    }
  }

  // 4. La fidélité, par zone demandée (une zone sans référence mesurée n'en a pas).
  const parRef = new Map(m.surfaces.map((s, k) => [s.ref, { s, d: decisions[k] }]));
  const fidelite: FideliteSurface[] = [];
  for (const z of entree.zones) {
    const x = parRef.get(z.ref);
    if (!x) continue;
    const { s, d } = x;
    const texture = s.texture.attendue === "uni" ? null : (s.texture.relative ?? s.texture.mesuree);
    fidelite.push({
      zone: z.zone,
      ref: z.ref,
      deltaEAvant: d.deltaEAvant,
      deltaEApres: d.etat === "corrigee" ? d.deltaEApres : d.deltaEAvant,
      deltaETeinteAvant: d.teinteAvant,
      deltaETeinteApres: d.etat === "corrigee" ? d.teinteApres : d.teinteAvant,
      texture,
      etat: d.etat,
      ...(d.raison ? { raison: d.raison } : {}),
      ...(clarteSure ? {} : { clarteIncertaine: true }),
    });
  }
  const detailPoids =
    entree.garderPoids && poidsGlobal ? { poids: poidsGlobal, recalages: decisions.filter((d) => d.etat === "corrigee" && d.recalage).map((d) => ({ ref: m.surfaces[d.k].ref, ...d.recalage! })) } : undefined;
  return { image, corrigee, fidelite, dureeMs: Date.now() - debut, mesure, ...(detailPoids ? { detail: detailPoids } : {}) };
}
