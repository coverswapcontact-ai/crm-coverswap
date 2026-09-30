/**
 * Mission 17 (partie B) — l'adresse de l'écran Analytique : `?onglet=` (ensemble par défaut), `?p=` (7j, 30j, 90j,
 * mois, 12m ; 30j par défaut) ou `?du=AAAA-MM-JJ&au=AAAA-MM-JJ` (dates libres, heure de Paris), `?source=` (filtre
 * de la Vue d'ensemble). Une valeur inconnue retombe sur le défaut : un lien abîmé ouvre quand même l'écran.
 * Pur : lu par la page serveur, la route GET /api/analytique et les liens de l'écran.
 */
import { FAMILLES, ONGLETS_ANALYTIQUE, PERIODES_ANALYTIQUE, type ClePeriode, type Famille, type OngletAnalytique } from "@/lib/analytique/types";

export type RequeteAnalytique = {
  onglet: OngletAnalytique;
  periode: ClePeriode;
  /** Dates libres (période « libre ») ; null sinon. */
  du: string | null;
  au: string | null;
  /** Filtre par source de la Vue d'ensemble ; null = toutes. */
  source: Famille | null;
};

export const ONGLET_DEFAUT: OngletAnalytique = "ensemble";
export const PERIODE_DEFAUT: ClePeriode = "30j";
/** Trois ans au plus pour des dates libres (au-delà, le calcul ne sert plus l'écran). */
export const JOURS_LIBRES_MAX = 3 * 366;

type Parametres = URLSearchParams | Record<string, string | string[] | undefined>;

function lire(parametres: Parametres, cle: string): string | null {
  if (parametres instanceof URLSearchParams) return parametres.get(cle);
  const valeur = parametres[cle];
  return typeof valeur === "string" ? valeur : Array.isArray(valeur) ? (valeur[0] ?? null) : null;
}

/** Une vraie date du calendrier AAAA-MM-JJ (le 31/02 est refusé). */
export function dateValide(texte: string | null): texte is string {
  if (!texte || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const date = new Date(`${texte}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === texte;
}

function ecartJours(du: string, au: string): number {
  return Math.round((Date.parse(`${au}T12:00:00Z`) - Date.parse(`${du}T12:00:00Z`)) / 86_400_000);
}

export function lireRequete(parametres: Parametres): RequeteAnalytique {
  const ongletBrut = lire(parametres, "onglet");
  const onglet = (ONGLETS_ANALYTIQUE as readonly string[]).includes(ongletBrut ?? "") ? (ongletBrut as OngletAnalytique) : ONGLET_DEFAUT;

  const du = lire(parametres, "du");
  const au = lire(parametres, "au");
  let periode: ClePeriode = PERIODE_DEFAUT;
  let libres: { du: string; au: string } | null = null;
  if (dateValide(du) && dateValide(au)) {
    // À l'envers, les dates sont remises dans l'ordre (comme resoudrePeriode) ; trop longues, on garde les dernières.
    const [a, b] = du <= au ? [du, au] : [au, du];
    periode = "libre";
    libres = { du: ecartJours(a, b) < JOURS_LIBRES_MAX ? a : new Date(Date.parse(`${b}T12:00:00Z`) - (JOURS_LIBRES_MAX - 1) * 86_400_000).toISOString().slice(0, 10), au: b };
  } else {
    const p = lire(parametres, "p");
    if (p && p !== "libre" && (PERIODES_ANALYTIQUE as readonly string[]).includes(p)) periode = p as ClePeriode;
  }

  const sourceBrute = lire(parametres, "source");
  const source = onglet === "ensemble" && (FAMILLES as readonly string[]).includes(sourceBrute ?? "") ? (sourceBrute as Famille) : null;

  return { onglet, periode, du: libres?.du ?? null, au: libres?.au ?? null, source };
}

/**
 * L'adresse d'une vue de l'écran, sans les valeurs par défaut (« /analytique » pour la Vue d'ensemble sur 30 jours).
 * Changer d'onglet garde la période ; le filtre par source ne vaut que pour la Vue d'ensemble.
 */
export function adresseAnalytique(requete: Partial<RequeteAnalytique>, base = "/analytique"): string {
  const parametres = new URLSearchParams();
  const onglet = requete.onglet ?? ONGLET_DEFAUT;
  if (onglet !== ONGLET_DEFAUT) parametres.set("onglet", onglet);
  if (requete.periode === "libre" && requete.du && requete.au) {
    parametres.set("du", requete.du);
    parametres.set("au", requete.au);
  } else if (requete.periode && requete.periode !== "libre" && requete.periode !== PERIODE_DEFAUT) {
    parametres.set("p", requete.periode);
  }
  if (onglet === "ensemble" && requete.source) parametres.set("source", requete.source);
  const texte = parametres.toString();
  return texte ? `${base}?${texte}` : base;
}
