import { famille, famillesDe, type IdFamille, type SelectionPrestations } from "@/lib/prestations/prestations";

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

/** Au-delà, l'objet reste celui de la famille : il ne devient pas une liste. */
const PRESTATIONS_DANS_L_OBJET = 3;

/**
 * Mission 14 (R3) : l'objet d'après le projet validé dans l'espace. Une seule
 * famille avec 1 à 3 prestations choisies : « Recouvrement de salle de bains :
 * meuble vasque » ; sinon l'objet des familles (objetDepuisFamilles). Vide sans famille.
 */
export function objetDepuisProjet(projet: { familles: SelectionPrestations } | null | undefined): string {
  if (!projet) return "";
  const familles = famillesDe(projet.familles);
  const objet = objetDepuisFamilles(familles);
  if (familles.length !== 1 || !objet) return objet;
  const f = famille(familles[0]);
  // « Autre », « Autre meuble » ne nomment rien : ils restent dans la note du client, pas dans l'objet.
  // Seule la première lettre passe en minuscule : « Meuble TV » → « meuble TV » (l'objet s'imprime sur le devis).
  const libelles = (projet.familles[f.id] ?? [])
    .filter((id) => id !== "autre" && !id.startsWith("autre-"))
    .map((id) => f.sousParties.find((s) => s.id === id)?.libelle)
    .filter((l): l is string => Boolean(l))
    .map((l) => l.charAt(0).toLocaleLowerCase("fr") + l.slice(1));
  return libelles.length >= 1 && libelles.length <= PRESTATIONS_DANS_L_OBJET ? `${objet} : ${libelles.join(", ")}` : objet;
}
