import { famille, type IdFamille } from "@/lib/prestations/prestations";

/**
 * Mission 13 (B3) : l'objet d'un dossier d'après ce que le client a choisi de
 * rénover — le type de projet d'un lead, ou les familles validées dans son
 * espace. Une seule famille : « Recouvrement de cuisine » ; plusieurs :
 * « Recouvrement : cuisine, salle de bain ». Rien n'est inventé sans famille.
 */
export const OBJET_PAR_FAMILLE: Record<IdFamille, string> = {
  CUISINE: "Recouvrement de cuisine",
  SDB: "Recouvrement de salle de bains",
  MEUBLES: "Recouvrement de mobilier",
  PRO: "Recouvrement de local professionnel",
};

export function objetDepuisFamilles(familles: readonly string[]): string {
  const connues = [...new Set(familles)].filter((f): f is IdFamille => f in OBJET_PAR_FAMILLE);
  if (connues.length === 0) return "";
  if (connues.length === 1) return OBJET_PAR_FAMILLE[connues[0]];
  return `Recouvrement : ${connues.map((f) => famille(f).libelle.toLowerCase()).join(", ")}`;
}
