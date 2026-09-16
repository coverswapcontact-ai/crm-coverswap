import { ErreurMetier } from "@/lib/commun/erreurs";
import { estJourValide } from "@/lib/dossiers/dates";
import { calculerAlertes } from "./alertes";
import { calculerSynthese } from "./calcul";
import { redigerSynthese } from "./redaction";
import { referencesDe } from "./references";
import type { Alerte, References, Synthese } from "./types";

export type SyntheseLue = { synthese: Synthese; references: References; redaction: string; alertes: Alerte[] };

/** Période et mode demandés (?du=AAAA-MM-JJ&au=AAAA-MM-JJ&anonyme=1). */
export function lirePeriode(parametres: URLSearchParams): { du: string; au: string; anonyme: boolean } {
  const du = parametres.get("du") ?? "";
  const au = parametres.get("au") ?? "";
  if (!estJourValide(du) || !estJourValide(au)) throw new ErreurMetier("Période invalide : dates attendues au format AAAA-MM-JJ.", 400);
  if (du > au) throw new ErreurMetier("Période invalide : le début est après la fin.", 400);
  if (Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`) > 3 * 366 * 86_400_000) throw new ErreurMetier("Période trop longue : trois ans au plus.", 400);
  return { du, au, anonyme: parametres.get("anonyme") === "1" };
}

export async function lireSynthese(du: string, au: string, anonyme: boolean, maintenant: Date = new Date()): Promise<SyntheseLue> {
  const [synthese, alertes] = await Promise.all([calculerSynthese(du, au, maintenant), calculerAlertes(maintenant, { anonyme })]);
  const references = await referencesDe(synthese, anonyme);
  return { synthese, references, redaction: redigerSynthese(synthese, references, alertes), alertes };
}
