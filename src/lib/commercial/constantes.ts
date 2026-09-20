// Suivi commercial : constantes partagées par l'écran et le serveur (aucune dépendance serveur).

export const ISSUES_APPEL = ["INTERESSE", "A_RAPPELER", "PAS_DE_REPONSE", "PAS_INTERESSE"] as const;
export type IssueAppel = (typeof ISSUES_APPEL)[number];

export const LIBELLES_ISSUE: Record<IssueAppel, string> = {
  INTERESSE: "Intéressé",
  A_RAPPELER: "À rappeler",
  PAS_DE_REPONSE: "Pas de réponse",
  PAS_INTERESSE: "Pas intéressé",
};

export type SuiteAppel = {
  /** Où l'appel a été écrit. */
  cible: "DOSSIER" | "CONTACT";
  dossierId: string | null;
  leadId: string | null;
  rappelLe: string | null;
  /** Message type que l'écran propose ensuite (rien ne part sans validation). */
  messagePropose: "LIEN_ESPACE" | "INJOIGNABLE_LIEN" | null;
  resume: string;
};
