import { dateDepuisJour, debutDuJourParis, estJourValide, jourParis } from "@/lib/dossiers/dates";
import { LIBELLES_PERIODE, PERIODES_ANALYTIQUE, type ClePeriode, type Periode } from "./types";

/**
 * Mission 17 (partie B) — la période de l'Analytique (docs/ANALYTIQUE.md § 1) : 7 j, 30 j, 90 j, mois en cours,
 * 12 mois ou deux dates, toujours en JOURS DE PARIS (bornes incluses, AAAA-MM-JJ), et la période précédente de même
 * longueur (comparaison de chaque indicateur). Pur : `maintenant` est toujours passé.
 */

export type EntreePeriodeAnalytique = { p?: string | null; du?: string | null; au?: string | null };

const JOUR_MS = 86_400_000;

/** Le jour AAAA-MM-JJ décalé de n jours (calendrier, sans fuseau : un jour reste un jour). */
export function decalerJour(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Nombre de jours de `du` à `au`, bornes incluses. */
export function nombreDeJours(du: string, au: string): number {
  return Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / JOUR_MS) + 1;
}

/** Les jours de la période, dans l'ordre (séries par jour, sparklines). */
export function joursDe(periode: { du: string; au: string }): string[] {
  const n = nombreDeJours(periode.du, periode.au);
  return Array.from({ length: Math.max(0, n) }, (_, i) => decalerJour(periode.du, i));
}

/** Instants de la période pour une requête : du premier jour à 0 h (Paris) au lendemain du dernier jour à 0 h (exclu). */
export function bornes(periode: { du: string; au: string }): { debut: Date; fin: Date } {
  return { debut: debutDuJourParis(dateDepuisJour(periode.du)), fin: debutDuJourParis(dateDepuisJour(decalerJour(periode.au, 1))) };
}

/** Le mois AAAA-MM d'un jour, et le mois précédent / décalé. */
export const moisDuJour = (jour: string) => jour.slice(0, 7);
export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function dernierJourDuMoisDe(mois: string): string {
  return decalerJour(`${decalerMois(mois, 1)}-01`, -1);
}

const courte = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;

function periode(cle: ClePeriode, du: string, au: string, libelle: string): Periode {
  const jours = nombreDeJours(du, au);
  return { cle, du, au, jours, libelle, precedente: { du: decalerJour(du, -jours), au: decalerJour(du, -1) } };
}

export const estClePeriode = (valeur: unknown): valeur is ClePeriode => typeof valeur === "string" && (PERIODES_ANALYTIQUE as readonly string[]).includes(valeur);

/** Relecture B (point 14) : une période libre ne dépasse pas trois ans (écran comme outil MCP : calculs bornés). */
export const JOURS_LIBRES_MAX = 3 * 366;

/**
 * `?p=7j|30j|90j|mois|12m` ou `?du=&au=` (libre, prioritaire quand les deux dates sont valides ; à l'envers, elles
 * sont remises dans l'ordre ; une date dans le futur est ramenée à aujourd'hui ; plus de trois ans : ramenée aux
 * `JOURS_LIBRES_MAX` derniers jours avant `au`). Rien de valable : 30 jours.
 */
export function resoudrePeriode(entree: EntreePeriodeAnalytique = {}, maintenant: Date = new Date()): Periode {
  const aujourdhui = jourParis(maintenant);
  const du = entree.du?.trim();
  const au = entree.au?.trim();
  if (du && au && estJourValide(du) && estJourValide(au)) {
    let [a, b] = du <= au ? [du, au] : [au, du];
    if (b > aujourdhui) b = aujourdhui;
    if (a > b) a = b;
    if (nombreDeJours(a, b) > JOURS_LIBRES_MAX) a = decalerJour(b, -(JOURS_LIBRES_MAX - 1));
    return periode("libre", a, b, `du ${courte(a)} au ${courte(b)}${a.slice(0, 4) !== aujourdhui.slice(0, 4) ? ` ${a.slice(0, 4)}` : ""}`);
  }
  const cle = estClePeriode(entree.p) && entree.p !== "libre" ? entree.p : "30j";
  switch (cle) {
    case "7j":
      return periode(cle, decalerJour(aujourdhui, -6), aujourdhui, "les 7 derniers jours");
    case "90j":
      return periode(cle, decalerJour(aujourdhui, -89), aujourdhui, "les 90 derniers jours");
    case "mois":
      return periode(cle, `${aujourdhui.slice(0, 7)}-01`, aujourdhui, "le mois en cours");
    case "12m":
      return periode(cle, decalerJour(aujourdhui, -364), aujourdhui, "les 12 derniers mois");
    default:
      return periode("30j", decalerJour(aujourdhui, -29), aujourdhui, "les 30 derniers jours");
  }
}

/** La période précédente, comme période à part entière (pour la recalculer avec les mêmes fonctions). */
export function periodePrecedente(p: Periode): Periode {
  return periode(p.cle, p.precedente.du, p.precedente.au, "la période précédente");
}

/** Les périodes pré-calculées chaque matin (cache.ts). */
export const PERIODES_STANDARD = PERIODES_ANALYTIQUE.filter((c) => c !== "libre") as Exclude<ClePeriode, "libre">[];

export const libellePeriodeCourt = (p: Periode): string => (p.cle === "libre" ? p.libelle : LIBELLES_PERIODE[p.cle]);
