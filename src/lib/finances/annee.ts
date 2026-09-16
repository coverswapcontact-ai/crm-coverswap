import { ErreurMetier } from "@/lib/commun/erreurs";
import { anneeParis } from "@/lib/dossiers/dates";

/** Année demandée (?annee=2026), l'année en cours à défaut. */
export function anneeDemandee(parametres: URLSearchParams): number {
  const brute = parametres.get("annee");
  const annee = brute ? Number(brute) : anneeParis(new Date());
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) throw new ErreurMetier("Année invalide.", 400);
  return annee;
}
