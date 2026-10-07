import { couleurDepuisHex, decrireFilm } from "@/lib/simulateur/moteur/materiaux";
import type { ReferenceMoteur } from "@/lib/simulateur/moteur/types";
import type { IdZone } from "@/lib/simulateur/zones";
import { deltaE2000, hexVersRgb, rgbVersHex, rgbVersLab, versSrgb, type Lab, type Rgb } from "../teintes";
import type { ClasseTexture } from "../mesure-rendu";

/**
 * Calibrage Sunburst (consigne du gérant du 07/10, mission 23, phase S0) — la PRÉ-COMPENSATION d'une teinte : Sunburst
 * rend certaines familles avec un décalage régulier (beiges et taupes plus gris et plus froids, bois clairs refroidis…,
 * mesuré sur les 45 rendus de la mission 24). On lui donne en entrée une teinte décalée dans le sens inverse, pour que la
 * sortie tombe sur le hex du catalogue :
 *  - `cibleEntree` : catalogue − décalage mesuré, en Lab (a et b en entier, clarté à moitié par défaut : la clarté mesurée
 *    dépend de la lumière de chaque scène, comme pour la correction L3), ramenée dans le gamut sRGB à clarté et teinte
 *    constantes (seule la saturation baisse), et bornée (`ECART_ENTREE_MAX`) ;
 *  - `ajusterCible` : le tour suivant, la cible d'entrée précédente − le décalage qui reste (mesuré contre le catalogue) ;
 *  - `referenceCompensee` / `descriptionCompensee` : la référence du moteur portant cette cible (hex et couleur mesurée),
 *    donc la description en mots du moteur (`decrireFilm`) et le résumé de la planche ajustés d'eux-mêmes ;
 *  - `tuileAplat` (la planche peinte au hex de la cible) et `tuileRecoloree` (le « nuancier en vraie texture » : la
 *    vignette du catalogue recolorée vers la cible, fil et pores gardés), pour les bois.
 * Fonctions pures (sharp seulement pour les tuiles) : aucun réseau, aucune base. Rien n'est branché en production : seuls
 * les scripts de calibrage (`scripts/sunburst-23/`) s'en servent.
 */

/** Mesuré − catalogue : clarté, axes a et b, saturation C*, et angle de teinte en degrés (null pour un quasi-neutre). */
export type Decalage = { dL: number; da: number; db: number; dC: number; dh: number | null };

/** Sous cette saturation (C*), l'angle de teinte ne veut rien dire (blancs, gris). */
export const CHROMA_MIN_TEINTE = 5;
/** Écart maximal (ΔE 2000) entre la cible d'entrée et le catalogue : au-delà, ce n'est plus une compensation. */
export const ECART_ENTREE_MAX = 20;
/** Part du décalage de clarté compensée par défaut (la clarté mesurée est la moins sûre, voir L3). */
export const GAIN_CLARTE_DEFAUT = 0.5;

const r1 = (x: number) => Math.round(x * 10) / 10;
const chroma = (l: Lab) => Math.hypot(l[1], l[2]);
const angle = (l: Lab) => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360;

export function decalageDe(mesure: Lab, cible: Lab): Decalage {
  const neutre = chroma(mesure) < CHROMA_MIN_TEINTE || chroma(cible) < CHROMA_MIN_TEINTE;
  let dh = angle(mesure) - angle(cible);
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return { dL: r1(mesure[0] - cible[0]), da: r1(mesure[1] - cible[1]), db: r1(mesure[2] - cible[2]), dC: r1(chroma(mesure) - chroma(cible)), dh: neutre ? null : r1(dh) };
}

/** Le sens de la dérive, en mots (seuil 2 sur chaque axe) : « trop foncé, trop gris, trop froid ». */
export function sensDuDecalage(d: Pick<Decalage, "dL" | "da" | "db" | "dC">, seuil = 2): string {
  const mots: string[] = [];
  if (d.dL <= -seuil) mots.push("trop foncé");
  if (d.dL >= seuil) mots.push("trop clair");
  if (d.dC <= -seuil) mots.push("trop gris");
  if (d.dC >= seuil) mots.push("trop saturé");
  if (d.db <= -seuil) mots.push("trop froid");
  if (d.db >= seuil) mots.push("trop jaune");
  if (d.da <= -seuil) mots.push("trop vert");
  if (d.da >= seuil) mots.push("trop rouge");
  return mots.length ? mots.join(", ") : "juste";
}

/* ── Familles du calibrage ───────────────────────────────────────── */

export type FamilleCalibrage = "beiges" | "bois clairs" | "bois foncés" | "blancs" | "sombres" | "sourds";

/**
 * La famille d'une teinte pour ce calibrage (celles de la mission 24, avec les bois coupés en clairs et foncés) : bois
 * clair si L* ≥ 55 ; sinon, pour un uni ou une pierre, blanc si L* ≥ 85, sombre si L* < 30, beige ou taupe si la teinte
 * est entre 50° et 95° (jaune-orangé) avec 6 ≤ C* ≤ 30, sourd (olives, gris colorés, bétons) autrement.
 */
export function familleCalibrage(hex: string, classe: ClasseTexture): FamilleCalibrage {
  const lab = rgbVersLab(hexVersRgb(hex));
  if (classe === "bois") return lab[0] >= 55 ? "bois clairs" : "bois foncés";
  if (lab[0] >= 85) return "blancs";
  if (lab[0] < 30) return "sombres";
  const h = angle(lab);
  const c = chroma(lab);
  if (h >= 50 && h <= 95 && c >= 6 && c <= 30) return "beiges";
  return "sourds";
}

/* ── Lab → sRGB, gamut ───────────────────────────────────────────── */

/** Lab (D65) → sRGB linéaire NON borné (mêmes matrices que `teintes.ts`) : hors de [0, 1], la couleur est hors gamut. */
function labVersLineaire([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = 0.95047 * inv(fx);
  const Y = inv(fy);
  const Z = 1.08883 * inv(fz);
  return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
}

const TOLERANCE_GAMUT = 0.5 / 255;
export const dansLeGamut = (lab: Lab): boolean => labVersLineaire(lab).every((c) => c >= -TOLERANCE_GAMUT && c <= 1 + TOLERANCE_GAMUT);

/** Lab → hex sRGB (borné). */
export function labVersHex(lab: Lab): string {
  return rgbVersHex(labVersLineaire(lab).map((c) => versSrgb(Math.max(0, Math.min(1, c)))) as Rgb);
}

/**
 * Ramène un Lab dans le gamut sRGB sans changer sa clarté ni son angle de teinte : la saturation est réduite (recherche
 * par dichotomie) jusqu'à la plus grande valeur qui tienne. La clarté est d'abord bornée à [0, 100].
 */
export function ramenerDansLeGamut(lab: Lab): { lab: Lab; reduction: number } {
  const L = Math.max(0, Math.min(100, lab[0]));
  const depart: Lab = [L, lab[1], lab[2]];
  if (dansLeGamut(depart)) return { lab: depart, reduction: 0 };
  let bas = 0;
  let haut = 1;
  for (let i = 0; i < 30; i++) {
    const m = (bas + haut) / 2;
    if (dansLeGamut([L, lab[1] * m, lab[2] * m])) bas = m;
    else haut = m;
  }
  return { lab: [L, lab[1] * bas, lab[2] * bas], reduction: r1(chroma(depart) * (1 - bas)) };
}

/* ── La cible d'entrée ───────────────────────────────────────────── */

export type OptionsCompensation = {
  /** Part du décalage de a et b compensée (défaut 1). */
  gain?: number;
  /** Part du décalage de clarté compensée (défaut `GAIN_CLARTE_DEFAUT`). */
  gainClarte?: number;
};

export type CibleEntree = {
  /** Le hex donné au moteur (planche, description). */
  hex: string;
  /** Son Lab, relu depuis le hex (8 bits). */
  lab: Lab;
  /** Le Lab voulu avant le gamut et l'arrondi. */
  voulu: Lab;
  /** Saturation retirée pour rester dans le gamut (0 : aucune). */
  reductionGamut: number;
  /** La compensation a été bornée par `ECART_ENTREE_MAX`. */
  bornee: boolean;
  /** ΔE 2000 entre la cible d'entrée et le catalogue. */
  ecartAuCatalogue: number;
};

function compenser(base: Lab, catalogue: Lab, decalage: Pick<Decalage, "dL" | "da" | "db">, options: OptionsCompensation): CibleEntree {
  const gain = options.gain ?? 1;
  const gainClarte = options.gainClarte ?? GAIN_CLARTE_DEFAUT;
  const voulu: Lab = [base[0] - gainClarte * decalage.dL, base[1] - gain * decalage.da, base[2] - gain * decalage.db];
  // Bornée : au-delà d'un ΔE de ECART_ENTREE_MAX au catalogue, on recule vers le catalogue (même direction).
  let retenu = voulu;
  let bornee = false;
  if (deltaE2000(voulu, catalogue) > ECART_ENTREE_MAX) {
    bornee = true;
    let bas = 0;
    let haut = 1;
    for (let i = 0; i < 30; i++) {
      const m = (bas + haut) / 2;
      const essai: Lab = [catalogue[0] + m * (voulu[0] - catalogue[0]), catalogue[1] + m * (voulu[1] - catalogue[1]), catalogue[2] + m * (voulu[2] - catalogue[2])];
      if (deltaE2000(essai, catalogue) <= ECART_ENTREE_MAX) bas = m;
      else haut = m;
    }
    retenu = [catalogue[0] + bas * (voulu[0] - catalogue[0]), catalogue[1] + bas * (voulu[1] - catalogue[1]), catalogue[2] + bas * (voulu[2] - catalogue[2])];
  }
  const { lab: dedans, reduction } = ramenerDansLeGamut(retenu);
  const hex = labVersHex(dedans);
  const lab = rgbVersLab(hexVersRgb(hex));
  return { hex, lab: lab.map(r1) as Lab, voulu: voulu.map(r1) as Lab, reductionGamut: reduction, bornee, ecartAuCatalogue: r1(deltaE2000(lab, catalogue)) };
}

/** Tour 1 : la cible d'entrée d'une teinte, d'après le décalage moyen mesuré de Sunburst (mesuré − catalogue). */
export function cibleEntree(hexCatalogue: string, decalage: Pick<Decalage, "dL" | "da" | "db">, options: OptionsCompensation = {}): CibleEntree {
  const catalogue = rgbVersLab(hexVersRgb(hexCatalogue));
  return compenser(catalogue, catalogue, decalage, options);
}

/** Tours suivants : la cible précédente, décalée du décalage qui RESTE (le rendu du tour mesuré contre le catalogue). */
export function ajusterCible(hexCatalogue: string, hexEntreePrecedente: string, decalageRestant: Pick<Decalage, "dL" | "da" | "db">, options: OptionsCompensation = {}): CibleEntree {
  return compenser(rgbVersLab(hexVersRgb(hexEntreePrecedente)), rgbVersLab(hexVersRgb(hexCatalogue)), decalageRestant, options);
}

/* ── Ce que voit le moteur : référence, description, planche ────── */

/**
 * La référence du moteur portant la cible d'entrée : hex et couleur mesurée remplacés (le contraste du décor, mesuré sur
 * la vraie vignette, est gardé : il règle la largeur du fil d'un bois). Le prompt (`construirePrompt` → `decrireFilm`) et
 * le résumé de la planche se construisent alors d'eux-mêmes sur la cible.
 */
export function referenceCompensee(reference: ReferenceMoteur, hexEntree: string): ReferenceMoteur {
  const couleur = couleurDepuisHex(hexEntree);
  if (!couleur) throw new Error(`Cible d'entrée mal écrite : ${hexEntree}`);
  return { ...reference, hex: couleur.hex, couleur: { ...couleur, contraste: reference.couleur?.contraste ?? couleur.contraste } };
}

/** La description de la teinte dans les mots du moteur, ajustée à la cible d'entrée. */
export function descriptionCompensee(reference: ReferenceMoteur, hexEntree: string, zone: IdZone | null): string {
  return decrireFilm(referenceCompensee(reference, hexEntree), zone);
}

const sharpModule = async () => (await import("sharp")).default;

/** La tuile de planche peinte au hex de la cible (un aplat, JPEG carré). */
export async function tuileAplat(hex: string, cote = 660): Promise<Buffer> {
  const sharp = await sharpModule();
  return sharp({ create: { width: cote, height: cote, channels: 3, background: hex } }).jpeg({ quality: 95 }).toBuffer();
}


/**
 * Le nuancier en vraie texture : la vignette du catalogue recolorée vers la cible. En Lab, sa médiane est amenée sur la
 * cible (clarté multiplicative, a et b décalés) et l'écart de chaque pixel à la médiane est gardé : le fil, les pores et
 * les nœuds restent ; seule la couleur de fond change. Rend le JPEG et la médiane obtenue.
 */
export async function tuileRecoloree(vignette: Buffer, hexCible: string, cote = 660): Promise<{ image: Buffer; mediane: Lab; ecart: number }> {
  const sharp = await sharpModule();
  const { data, info } = await sharp(vignette).rotate().resize(cote, cote, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const labs = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const l = rgbVersLab([data[3 * i], data[3 * i + 1], data[3 * i + 2]]);
    labs[3 * i] = l[0];
    labs[3 * i + 1] = l[1];
    labs[3 * i + 2] = l[2];
  }
  const med = (k: number) => {
    const v = Array.from({ length: n }, (_, i) => labs[3 * i + k]).sort((x, y) => x - y);
    return v[n >> 1];
  };
  const source: Lab = [med(0), med(1), med(2)];
  const cible = rgbVersLab(hexVersRgb(hexCible));
  const kL = cible[0] / Math.max(1, source[0]);
  const sortie = Buffer.alloc(3 * n);
  for (let i = 0; i < n; i++) {
    const rgb = labVersLineaire([Math.min(100, labs[3 * i] * kL), labs[3 * i + 1] + cible[1] - source[1], labs[3 * i + 2] + cible[2] - source[2]]);
    for (let c = 0; c < 3; c++) sortie[3 * i + c] = Math.round(versSrgb(Math.max(0, Math.min(1, rgb[c]))));
  }
  const image = await sharp(sortie, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  // La médiane relue sur l'image produite (aller-retour 8 bits et JPEG compris).
  const relu = await sharp(image).raw().toBuffer();
  const canaux = [0, 1, 2].map((c) => {
    const v: number[] = [];
    for (let i = c; i < relu.length; i += 3) v.push(relu[i]);
    v.sort((x, y) => x - y);
    return v[v.length >> 1];
  }) as Rgb;
  const mediane = rgbVersLab(canaux);
  return { image, mediane: mediane.map(r1) as Lab, ecart: r1(deltaE2000(mediane, cible)) };
}

/* ── Résumé des décalages (script S0) ────────────────────────────── */

export type LigneDecalage = {
  n: number;
  photo: string;
  ref: string;
  variante: string;
  famille: FamilleCalibrage;
  /** Compté dans les médianes (hors photos non mesurables et hors descriptions T1). */
  retenu: boolean;
  m24: { deltaE: number; chromatique: number; decalage: Decalage };
  m23: { deltaE: number | null; chromatique: number | null; decalage: Decalage | null; douteux: boolean };
  l3: { etat: string; raison?: string; deltaEApres: number; chromApres: number; scoreApres: number };
  famille24: { mode: string; deltaEApres: number; chromApres: number };
  scoreAvant: number;
};

export type GroupeDecalage = { cle: string; n: number; nM23: number; m24: Decalage; m23: Decalage | null; sens: string };
export type GroupeCorrection = {
  groupe: string;
  n: number;
  brut: number;
  brutChrom: number;
  l3: number;
  l3Chrom: number;
  famille: number;
  familleChrom: number;
  l3Gagne: number;
  l3Degrade: number;
  familleGagne: number;
  familleDegrade: number;
  l3BatFamille: number;
};

export const mediane = (v: number[]): number => {
  if (v.length === 0) return NaN;
  const t = [...v].sort((x, y) => x - y);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

function decalageMedian(liste: Decalage[]): Decalage {
  const dh = liste.map((d) => d.dh).filter((x): x is number => x !== null);
  return { dL: r1(mediane(liste.map((d) => d.dL))), da: r1(mediane(liste.map((d) => d.da))), db: r1(mediane(liste.map((d) => d.db))), dC: r1(mediane(liste.map((d) => d.dC))), dh: dh.length ? r1(mediane(dh)) : null };
}

function grouper(lignes: LigneDecalage[], cle: (l: LigneDecalage) => string): GroupeDecalage[] {
  const groupes = new Map<string, LigneDecalage[]>();
  for (const l of lignes) groupes.set(cle(l), [...(groupes.get(cle(l)) ?? []), l]);
  return [...groupes].map(([c, ls]) => {
    const m24 = decalageMedian(ls.map((l) => l.m24.decalage));
    const avecM23 = ls.filter((l) => l.m23.decalage && !l.m23.douteux).map((l) => l.m23.decalage!);
    return { cle: c, n: ls.length, nM23: avecM23.length, m24, m23: avecM23.length ? decalageMedian(avecM23) : null, sens: sensDuDecalage(m24) };
  });
}

/** Médianes par teinte et par famille (lignes retenues), et bilan des deux corrections sur TOUTES les lignes mesurables. */
export function resumerDecalages(lignes: LigneDecalage[]): { parTeinte: GroupeDecalage[]; parFamille: GroupeDecalage[]; corrections: GroupeCorrection[]; etatsL3: Record<string, number> } {
  const retenues = lignes.filter((l) => l.retenu);
  const ordre: FamilleCalibrage[] = ["beiges", "bois clairs", "blancs", "bois foncés", "sombres", "sourds"];
  const parFamille = grouper(retenues, (l) => l.famille).sort((a, b) => ordre.indexOf(a.cle as FamilleCalibrage) - ordre.indexOf(b.cle as FamilleCalibrage));
  const famDe = new Map(lignes.map((l) => [l.ref, l.famille]));
  const parTeinte = grouper(retenues, (l) => l.ref).sort((a, b) => ordre.indexOf(famDe.get(a.cle)!) - ordre.indexOf(famDe.get(b.cle)!) || a.cle.localeCompare(b.cle));
  const bilan = (groupe: string, ls: LigneDecalage[]): GroupeCorrection => ({
    groupe,
    n: ls.length,
    brut: r1(mediane(ls.map((l) => l.m24.deltaE))),
    brutChrom: r1(mediane(ls.map((l) => l.m24.chromatique))),
    l3: r1(mediane(ls.map((l) => l.l3.deltaEApres))),
    l3Chrom: r1(mediane(ls.map((l) => l.l3.chromApres))),
    famille: r1(mediane(ls.map((l) => l.famille24.deltaEApres))),
    familleChrom: r1(mediane(ls.map((l) => l.famille24.chromApres))),
    l3Gagne: ls.filter((l) => l.l3.deltaEApres <= l.m24.deltaE - 1).length,
    l3Degrade: ls.filter((l) => l.l3.deltaEApres >= l.m24.deltaE + 1).length,
    familleGagne: ls.filter((l) => l.famille24.deltaEApres <= l.m24.deltaE - 1).length,
    familleDegrade: ls.filter((l) => l.famille24.deltaEApres >= l.m24.deltaE + 1).length,
    l3BatFamille: ls.filter((l) => l.l3.deltaEApres < l.famille24.deltaEApres - 0.5).length,
  });
  const mesurables = lignes.filter((l) => l.photo !== "p07");
  const corrections = [bilan("toutes", mesurables), ...ordre.map((f) => bilan(f, mesurables.filter((l) => l.famille === f))).filter((g) => g.n > 0)];
  const etatsL3: Record<string, number> = {};
  for (const l of mesurables) etatsL3[l.l3.etat] = (etatsL3[l.l3.etat] ?? 0) + 1;
  return { parTeinte, parFamille, corrections, etatsL3 };
}
