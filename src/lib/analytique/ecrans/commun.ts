import { decalerJour, joursDe } from "../periode";
import type { EtatSource, Evolution, Format, Indicateur, Periode, SourceDonnees } from "../types";

/**
 * Mission 17 (partie B) — petites briques communes aux écrans de l'Analytique (purs) : la comparaison à la période
 * précédente et son TON (le sens favorable de l'indicateur : un coût qui baisse est vert), la tuile d'indicateur, les
 * séries par jour.
 */

/** Variation sous laquelle un indicateur est dit stable (± 5 %). */
export const SEUIL_STABLE = 0.05;

export type Sens = "hausse" | "baisse";

/**
 * L'évolution d'une valeur face à la précédente. `favorable` : le sens souhaité (« hausse » pour des leads, « baisse »
 * pour un coût). Sans valeur : neutre. Précédente nulle ou à zéro et valeur positive : « nouveau ».
 */
export function evolutionDe(valeur: number | null, precedente: number | null, favorable: Sens): Evolution {
  if (valeur === null) return { precedente, variation: null, sens: null, ton: "neutre" };
  if (precedente === null || precedente === 0) {
    if (valeur === 0 || precedente === null) return { precedente, variation: null, sens: precedente === 0 && valeur === 0 ? "stable" : null, ton: "neutre" };
    return { precedente, variation: null, sens: "nouveau", ton: favorable === "hausse" ? "favorable" : "defavorable" };
  }
  const variation = Math.round(((valeur - precedente) / Math.abs(precedente)) * 1000) / 1000;
  if (Math.abs(variation) < SEUIL_STABLE) return { precedente, variation, sens: "stable", ton: "neutre" };
  const sens: Sens = variation > 0 ? "hausse" : "baisse";
  return { precedente, variation, sens, ton: sens === favorable ? "favorable" : "defavorable" };
}

/**
 * Une tuile. `comparaison` (facultatif) : les valeurs à comparer quand elles diffèrent de la valeur affichée — relecture
 * B, point 4 : la période qui finit aujourd'hui compte un jour ENTAMÉ ; l'évolution se calcule alors hors jour en cours
 * des deux côtés (`jourEntame`), la valeur affichée reste la période entière.
 */
export function indicateur(p: { cle: string; libelle: string; valeur: number | null; precedente: number | null; format: Format; favorable: Sens; serie?: number[]; source: SourceDonnees; detail?: string | null; comparaison?: { valeur: number | null; precedente: number | null } | null }): Indicateur {
  const c = p.comparaison ?? { valeur: p.valeur, precedente: p.precedente };
  const evolution = p.valeur === null ? evolutionDe(null, p.precedente, p.favorable) : { ...evolutionDe(c.valeur, c.precedente, p.favorable), ...(p.comparaison ? { horsJourEnCours: true } : {}) };
  return { cle: p.cle, libelle: p.libelle, valeur: p.valeur, format: p.format, evolution, detail: p.detail ?? null, serie: p.valeur === null ? [] : p.serie ?? [], source: p.source };
}

/**
 * Le jour entamé de la période (pur) : la période finit aujourd'hui (heure de Paris) et compte plus d'un jour → les
 * comparaisons s'arrêtent la veille, des deux côtés (même nombre de jours complets). null : rien à retirer.
 */
export function jourEntame(periode: Pick<Periode, "du" | "au" | "precedente">, aujourdhui: string): { actuel: { du: string; au: string }; avant: { du: string; au: string } } | null {
  if (periode.au !== aujourdhui || periode.du === periode.au) return null;
  return { actuel: { du: periode.du, au: decalerJour(periode.au, -1) }, avant: { du: periode.precedente.du, au: decalerJour(periode.precedente.au, -1) } };
}

/** Compte des éléments datés dans une plage (pur). */
export const compterDans = (elements: readonly { jour: string }[], plage: { du: string; au: string }) => elements.filter((e) => e.jour >= plage.du && e.jour <= plage.au).length;

/** Une valeur par jour de la période, à partir d'éléments datés (compte ou somme). */
export function serieParJour<T extends { jour: string }>(periode: Pick<Periode, "du" | "au">, elements: readonly T[], valeur: (e: T) => number = () => 1): number[] {
  const parJour = new Map<string, number>();
  for (const e of elements) parJour.set(e.jour, (parJour.get(e.jour) ?? 0) + valeur(e));
  return joursDe(periode).map((j) => Math.round((parJour.get(j) ?? 0) * 100) / 100);
}

/** Série d'un enregistrement { jour: valeur }. */
export const serieDepuis = (periode: Pick<Periode, "du" | "au">, parJour: Record<string, number>) => joursDe(periode).map((j) => parJour[j] ?? 0);

export const ratio = (a: number | null, b: number | null, decimales = 3): number | null => (a === null || b === null || b === 0 ? null : Math.round((a / b) * 10 ** decimales) / 10 ** decimales);
export const arrondi2 = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);

/** L'état d'une source de données (CRM et SITE : toujours à jour). */
export function etatDe(etats: readonly EtatSource[], source: SourceDonnees): EtatSource {
  return etats.find((e) => e.source === source) ?? (source === "CRM" || source === "SITE" ? { source, branchee: true, etat: "A_JOUR", derniereReussite: null, erreur: null, aFaire: null } : { source, branchee: false, etat: "NON_BRANCHEE", derniereReussite: null, erreur: null, aFaire: null });
}

/**
 * Des chiffres existent-ils pour cette source ? Branchée, ou en échec avec une réussite passée (les derniers chiffres
 * restent, avec la date). Non branchée ou en attente d'accès : valeur null (jamais un zéro trompeur).
 */
export const chiffresDisponibles = (etat: EtatSource): boolean => etat.branchee || (Boolean(etat.derniereReussite) && etat.etat !== "NON_BRANCHEE");
