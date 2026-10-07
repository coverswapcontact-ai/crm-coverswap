import { rgbVersLab } from "../couleur";
import { profilDe, type Profil } from "./materiaux";
import type { ReferenceMoteur } from "./types";

/**
 * Mission 23 (L4a) — une teinte du catalogue dite en mots anglais, pour la variante `retouche` du prompt (calibrage) :
 * le modèle d'image lit mal une vignette (il la prend pour une indication), il lit sans erreur « a muted, dusty,
 * greyish olive, closer to grey than to green ». Fonction pure : elle lit le Lab du hex du catalogue (clarté L*,
 * saturation C*, angle de teinte), rien d'autre.
 *
 *  - clarté : very light … very dark ;
 *  - saturation : « muted, dusty, greyish » quand C* est bas (< 15) ;
 *  - teinte : olive, sage, taupe, greige, warm white, blue-grey… (bois : un ton de bois) ;
 *  - pièges : ce que le modèle pose à la place, d'après la dérive mesurée en L2 (« NOT fresh green, mint or pistachio »
 *    pour un olive grisé) ;
 *  - consigne finale : le contrôle avant de rendre, dans le sens de la dérive mesurée pour la famille (`CONSIGNES_FIN`).
 */

/** Les familles de la mesure (L2, `mesure-rendu.ts › familleTeinte`), recopiées ici sans dépendance (le moteur est pur). */
export type FamilleTeinteMoteur = "uni clair" | "uni sombre" | "uni désaturé" | "bois clair" | "bois foncé" | "pierre";

export type TeinteEnMots = {
  hex: string;
  lab: { L: number; a: number; b: number; C: number; h: number };
  famille: FamilleTeinteMoteur;
  clarte: string;
  saturation: string;
  teinte: string;
  /** Ce qu'il ne faut pas poser à la place (« closer to grey than to green, NOT fresh green, mint or pistachio »). */
  pieges: string;
  /** La phrase complète : « a medium-light, muted, dusty, greyish olive (#A4A38F) — closer to grey… ». */
  phrase: string;
  /** « compare with the sample before you output; if greener or brighter, desaturate toward grey ». */
  consigneFin: string;
};

const PROFILS_PIERRE: readonly Profil[] = ["marbre", "pierre", "terrazzo", "beton", "brique", "metal-patine", "paillettes"];

function familleDe(profil: Profil, L: number, C: number): FamilleTeinteMoteur {
  if (PROFILS_PIERRE.includes(profil)) return "pierre";
  if (profil === "bois") return L >= 55 ? "bois clair" : "bois foncé";
  if (C < 15 && L >= 25 && L < 85) return "uni désaturé";
  return L >= 60 ? "uni clair" : "uni sombre";
}

function clarteEnMots(L: number): string {
  if (L >= 90) return "very light";
  if (L >= 75) return "light";
  if (L >= 60) return "medium-light";
  if (L >= 45) return "medium";
  if (L >= 30) return "dark";
  return "very dark";
}

function saturationEnMots(C: number): string {
  if (C < 4) return "neutral";
  if (C < 8) return "very muted, almost grey";
  if (C < 15) return "muted, dusty, greyish";
  if (C < 25) return "softly saturated";
  if (C < 40) return "saturated";
  return "vivid";
}

type Teinte = { nom: string; pieges: string };

function teinteDeBois(L: number, C: number): Teinte {
  const ton = C < 12 ? "greyish brown" : C < 22 ? "natural beige-brown" : C < 30 ? "warm honey" : "orange-honey";
  const nom = `${ton} wood tone`;
  if (L >= 55) return { nom, pieges: "NOT darkened into a medium oak, NOT greyer, NOT orange or yellow pine" };
  return { nom, pieges: "NOT reddish or orange, NOT blackened, the grain stays readable" };
}

function teinteDUni(L: number, C: number, h: number, b: number): Teinte {
  if (C < 4) {
    const chaud = b > 1.5 ? "warm " : b < -1.5 ? "cool " : "";
    if (L >= 92) return { nom: `${chaud}white`, pieges: "NOT cream or yellow, NOT bluish" };
    if (L >= 22) return { nom: `${chaud}grey`, pieges: "NOT bluish, NOT beige or brown" };
    return { nom: "black", pieges: "NOT blue-black, NOT grey-washed" };
  }
  // Tons chauds (jaunes, beiges, bruns) : l'essentiel des blancs cassés, grèges, taupes et lattes.
  if (h >= 35 && h < 100) {
    if (C < 6) return L >= 85 ? { nom: "warm white", pieges: "NOT yellow or butter cream, NOT a cold pure white" } : L >= 65 ? { nom: "warm light grey (greige)", pieges: "NOT beige, NOT a cold grey" } : { nom: "warm grey", pieges: "NOT brown, NOT a cold grey" };
    if (C < 15) {
      if (L >= 85) return { nom: "warm off-white", pieges: "NOT yellow or butter cream, NOT a cold pure white" };
      if (L >= 68) return { nom: "greige (warm grey-beige)", pieges: "NOT yellow beige, NOT pinkish, NOT a cold grey" };
      return { nom: "taupe", pieges: "NOT yellow beige, NOT pinkish or reddish, NOT a cold grey" };
    }
    if (C < 26) {
      if (L >= 80) return { nom: "cream beige", pieges: "NOT yellow, NOT butter, NOT peach" };
      if (L >= 58) return { nom: "latte beige, a milky coffee taupe", pieges: "NOT yellow beige or sand, NOT orange, NOT pinkish" };
      return { nom: "brown", pieges: "NOT orange, NOT reddish, NOT black" };
    }
    if (L >= 65) return { nom: "honey sand", pieges: "NOT orange, NOT a bright yellow" };
    if (L >= 45) return { nom: "caramel", pieges: "NOT orange, NOT reddish" };
    return { nom: "chestnut brown", pieges: "NOT reddish, NOT black" };
  }
  // Verts : les olives et les sauges sourdes sont le cas qui a lancé la mission (RM30).
  if (h >= 100 && h < 165) {
    if (C < 15) return h < 125 ? { nom: "olive", pieges: "closer to grey than to green, NOT fresh green, mint or pistachio" } : { nom: "sage green", pieges: "closer to grey than to green, NOT fresh green, mint or emerald" };
    if (C < 30) return h < 120 ? { nom: "olive green", pieges: "NOT yellow-green, NOT fresh or bright green" } : { nom: "sage green", pieges: "NOT mint, NOT bright or emerald green" };
    return h < 115 ? { nom: "yellowish olive", pieges: "NOT mustard yellow, NOT bright green" } : { nom: "green", pieges: "NOT more saturated, NOT bluer" };
  }
  // Bleus et bleu-verts.
  if (h >= 165 && h < 290) {
    if (C < 10) return { nom: L < 30 ? "blue-grey, almost black (a midnight blue)" : "blue-grey", pieges: "NOT a bright or royal blue, NOT turquoise, NOT plain grey" };
    if (C < 25) return { nom: h < 220 ? "dusty teal blue" : "dusty slate blue", pieges: "NOT a bright blue, NOT turquoise" };
    return { nom: L < 30 ? "navy blue" : "blue", pieges: "NOT purple, NOT turquoise, NOT more saturated" };
  }
  if (h >= 290 && h < 345) return { nom: C < 15 ? "dusty mauve" : "plum", pieges: "NOT pink, NOT more saturated" };
  // Rouges, roses et terres cuites.
  if (C < 15) return { nom: "dusty rose taupe", pieges: "NOT pink, NOT beige" };
  if (L < 35) return { nom: "burgundy red", pieges: "NOT brown, NOT a bright red" };
  return { nom: h < 35 ? "terracotta red" : "red", pieges: "NOT orange, NOT pink" };
}

/**
 * La consigne finale de la variante `retouche`, dans le sens de la dérive mesurée en L2 sur la production (REPRISE §
 * Mission 23, « Analyse d'erreur ») : uni désaturé plus saturé et plus vert ; uni clair plus jaune ; uni sombre plus
 * sombre et plus rouge ; bois clair plus foncé et plus gris ; bois foncé un peu plus sombre ; pierre plus saturée et
 * plus jaune.
 */
export const CONSIGNES_FIN: Record<FamilleTeinteMoteur, string> = {
  // Le mot du gérant (essai manuel du 07/10, olive grisé) ; pour un uni désaturé qui n'est pas vert, voir `consigneFinDe`.
  "uni désaturé": "compare with the sample before you output; if greener or brighter, desaturate toward grey",
  "uni clair": "compare with the sample before you output; if yellower or creamier, cool it back toward the sample",
  "uni sombre": "compare with the sample before you output; if darker or redder, lift it and shift it back toward the sample",
  "bois clair": "compare with the sample before you output; if darker or greyer, lighten it toward the sample's warm tone",
  "bois foncé": "compare with the sample before you output; if darker or redder, lighten it toward the sample",
  pierre: "compare with the sample before you output; if warmer or yellower, desaturate toward the sample",
};

/**
 * Uni désaturé : la production le rend plus saturé dans les deux groupes de L2, vers le vert en V1, vers le rouge et le
 * jaune ailleurs. Le mot du gérant (« greener ») pour les verts ; « more colourful or yellower » pour les autres teintes.
 */
function consigneFinDe(famille: FamilleTeinteMoteur, h: number, C: number): string {
  if (famille !== "uni désaturé" || C < 4 || (h >= 90 && h < 165)) return CONSIGNES_FIN[famille];
  return "compare with the sample before you output; if more colourful, yellower or brighter, desaturate toward grey";
}

const arrondi = (n: number) => Math.round(n * 10) / 10;

/** La teinte d'une référence en mots ; null sans hex lisible (ni au catalogue ni mesuré). */
export function teinteEnMots(r: Pick<ReferenceMoteur, "nom" | "famille" | "categorie" | "tags" | "hex" | "couleur">): TeinteEnMots | null {
  const hex = (r.hex ?? r.couleur?.hex ?? "").toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(hex)) return null;
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const { L, a, b } = rgbVersLab(R, G, B);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const profil = profilDe(r);
  const famille = familleDe(profil, L, C);
  const t = profil === "bois" ? teinteDeBois(L, C) : teinteDUni(L, C, h, b);
  const clarte = clarteEnMots(L);
  const saturation = saturationEnMots(C);
  const phrase = `a ${clarte}, ${saturation} ${t.nom} (${hex}) — ${t.pieges}`;
  return { hex, lab: { L: arrondi(L), a: arrondi(a), b: arrondi(b), C: arrondi(C), h: Math.round(h) }, famille, clarte, saturation, teinte: t.nom, pieges: t.pieges, phrase, consigneFin: consigneFinDe(famille, h, C) };
}
