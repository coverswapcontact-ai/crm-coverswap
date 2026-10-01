/**
 * Prix et coûts du simulateur — fonctions pures, sans base ni réseau
 * (importables par les écrans : Paramètres → Simulateur affiche le coût
 * estimé d'un rendu par qualité).
 *
 * Prix publics en dollars par million de jetons. Les modèles d'image comptent
 * des jetons de texte, d'image (entrée) et de sortie ; `gpt-4.1-mini` (analyse
 * de la photo et contrôle du rendu, mission 15) compte ses jetons d'entrée au
 * même prix, image comprise.
 */

export type Qualite = "low" | "medium" | "high";
export const QUALITES: readonly Qualite[] = ["low", "medium", "high"];

/**
 * `gpt-image-2` et `gpt-image-2.5` (génération `-flare`, édition `-sunburst`, et leurs alias datés) : page tarifs
 * d'OpenAI lue le 30/09/2026 — texte 5 $, image 8 $, sortie 30 $ par million de jetons. L'entrée en cache (1,25 $
 * pour 2.5, 2 $ pour 2) n'est pas utilisée ici : chaque appel du script d'images est compté plein tarif.
 */
const PRIX_GPT_IMAGE_2 = { texte: 5, image: 8, sortie: 30 };

export const PRIX: Record<string, { texte: number; image: number; sortie: number }> = {
  "gpt-image-1": { texte: 5, image: 10, sortie: 40 },
  "gpt-image-2": PRIX_GPT_IMAGE_2,
  "gpt-image-2.5-flare": PRIX_GPT_IMAGE_2,
  "gpt-image-2.5-flare-2026-09-08": PRIX_GPT_IMAGE_2,
  "gpt-image-2.5-sunburst": PRIX_GPT_IMAGE_2,
  "gpt-image-2.5-sunburst-2026-09-08": PRIX_GPT_IMAGE_2,
  "gpt-image-1-mini": { texte: 2, image: 2.5, sortie: 8 },
  "gpt-4.1-mini": { texte: 0.4, image: 0.4, sortie: 1.6 },
};

/** Modèle des appels vision (analyse de la photo, contrôle du rendu) : décision de la mission 15, rester chez OpenAI. */
export const MODELE_VISION = "gpt-4.1-mini";

export type Usage = { texte: number; image: number; sortie: number };

export function coutEnDollars(usage: Usage, modele: string): number {
  const prix = PRIX[modele] ?? PRIX["gpt-image-1"];
  return Math.round(((usage.texte * prix.texte + usage.image * prix.image + usage.sortie * prix.sortie) / 1_000_000) * 10_000) / 10_000;
}

/**
 * Mesure de référence en production (qualité medium, 1536 × 1024) : 0,21 $ avec
 * un échantillon, +0,066 $ par échantillon de plus. La qualité high coûte
 * environ 1,7 fois plus (à confirmer par le banc, partie 3), low environ 0,4.
 */
export const FACTEUR_QUALITE: Record<Qualite, number> = { low: 0.4, medium: 1, high: 1.7 };

/** Coût annoncé AVANT de lancer un rendu, selon le nombre d'échantillons joints et la qualité. */
export function coutEstime(echantillons: number, qualite: Qualite = "medium"): number {
  return Math.round((0.21 + 0.066 * Math.max(0, echantillons - 1)) * FACTEUR_QUALITE[qualite] * 100) / 100;
}

/** Coût estimé d'un appel vision (analyse ou contrôle) : environ un demi-centime — compté, jamais bloquant. */
export const COUT_ESTIME_VISION_DOLLARS = 0.005;

export function estQualite(valeur: unknown): valeur is Qualite {
  return typeof valeur === "string" && (QUALITES as readonly string[]).includes(valeur);
}
