import { z } from "zod/v4";
import { jourParis } from "@/lib/dossiers/dates";

/**
 * La période d'une analyse (mission 8) : un raccourci lisible ou deux dates ;
 * la période précédente, de même longueur, sert à la comparaison. Bornes en
 * heure de Paris : du premier jour à 0 h au dernier jour à 24 h.
 */

export const RACCOURCIS_PERIODE = ["7_jours", "30_jours", "90_jours", "mois_en_cours", "mois_dernier", "trimestre_en_cours", "annee_en_cours", "12_mois"] as const;
export type RaccourciPeriode = (typeof RACCOURCIS_PERIODE)[number];

export const schemaPeriode = z.object({
  periode: z.enum(RACCOURCIS_PERIODE).optional().describe("Raccourci : 7_jours, 30_jours (défaut), 90_jours, mois_en_cours, mois_dernier, trimestre_en_cours, annee_en_cours, 12_mois."),
  du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Premier jour, AAAA-MM-JJ (remplace le raccourci, avec « au »)."),
  au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Dernier jour inclus, AAAA-MM-JJ."),
});
export type EntreePeriode = z.output<typeof schemaPeriode>;

export type Periode = { du: string; au: string; debut: Date; fin: Date; libelle: string; jours: number };
export type PeriodeComparee = { periode: Periode; precedente: Periode };

const JOUR = 86_400_000;

/** Décalage de Paris ce jour-là (+01:00 ou +02:00), pour poser une borne à minuit heure de Paris. */
function minuitParis(jour: string, finDeJournee = false): Date {
  const decalage = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(new Date(`${jour}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "UTC+1";
  const heures = Number(/([+-]\d+)/.exec(decalage)?.[1] ?? 1);
  const date = new Date(`${jour}T00:00:00Z`);
  date.setUTCHours(date.getUTCHours() - heures);
  return finDeJournee ? new Date(date.getTime() + JOUR) : date;
}

const versJour = (date: Date) => jourParis(date);
const decaler = (jour: string, jours: number) => versJour(new Date(minuitParis(jour).getTime() + jours * JOUR + 12 * 3_600_000));

function periodeDe(du: string, au: string, libelle: string): Periode {
  const debut = minuitParis(du);
  const fin = minuitParis(au, true);
  return { du, au, debut, fin, libelle, jours: Math.max(1, Math.round((fin.getTime() - debut.getTime()) / JOUR)) };
}

export function resoudrePeriode(entree: EntreePeriode, maintenant: Date = new Date()): PeriodeComparee {
  const aujourdhui = versJour(maintenant);
  const [annee, mois] = aujourdhui.split("-").map(Number);
  let periode: Periode;
  if (entree.du && entree.au) {
    if (entree.au < entree.du) throw new Error("La période est à l'envers : « au » précède « du ».");
    periode = periodeDe(entree.du, entree.au, `du ${entree.du} au ${entree.au}`);
  } else {
    switch (entree.periode ?? "30_jours") {
      case "7_jours":
        periode = periodeDe(decaler(aujourdhui, -6), aujourdhui, "les 7 derniers jours");
        break;
      case "90_jours":
        periode = periodeDe(decaler(aujourdhui, -89), aujourdhui, "les 90 derniers jours");
        break;
      case "mois_en_cours":
        periode = periodeDe(`${aujourdhui.slice(0, 7)}-01`, aujourdhui, "le mois en cours");
        break;
      case "mois_dernier": {
        const m = mois === 1 ? 12 : mois - 1;
        const a = mois === 1 ? annee - 1 : annee;
        const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
        periode = periodeDe(`${a}-${String(m).padStart(2, "0")}-01`, `${a}-${String(m).padStart(2, "0")}-${String(dernier).padStart(2, "0")}`, "le mois dernier");
        break;
      }
      case "trimestre_en_cours": {
        const premierMois = Math.floor((mois - 1) / 3) * 3 + 1;
        periode = periodeDe(`${annee}-${String(premierMois).padStart(2, "0")}-01`, aujourdhui, "le trimestre en cours");
        break;
      }
      case "annee_en_cours":
        periode = periodeDe(`${annee}-01-01`, aujourdhui, "l'année en cours");
        break;
      case "12_mois":
        periode = periodeDe(decaler(aujourdhui, -364), aujourdhui, "les 12 derniers mois");
        break;
      default:
        periode = periodeDe(decaler(aujourdhui, -29), aujourdhui, "les 30 derniers jours");
    }
  }
  const precedente = periodeDe(decaler(periode.du, -periode.jours), decaler(periode.du, -1), "la période précédente, de même longueur");
  return { periode, precedente };
}

/** Une valeur et sa comparaison : « 12 (contre 9 la période précédente, +33 %) ». */
export function comparer(actuel: number, precedent: number): { actuel: number; precedent: number; evolution: number | null } {
  return { actuel, precedent, evolution: precedent === 0 ? null : Math.round(((actuel - precedent) / precedent) * 100) / 100 };
}

export const dansPeriode = (date: Date, periode: Periode) => date >= periode.debut && date < periode.fin;
