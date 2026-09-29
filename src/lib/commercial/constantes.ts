// Suivi commercial : constantes partagées par l'écran et le serveur (aucune dépendance serveur).

import type { PropositionSms } from "@/lib/sms/catalogue";

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
  /** Mission 14 (partie 4) : appels sans réponse d'affilée, cet appel compris (0 dès qu'un appel aboutit). */
  tentatives: number;
  /** 3ᵉ appel sans réponse ou plus : le CRM propose « Pas intéressé — plus de réponse », sans l'imposer. */
  proposerSansSuite: boolean;
  /**
   * Le SMS proposé ensuite, à copier ou à passer (écran SMS) : « pas de réponse » (A, puis D dès la 2ᵉ tentative),
   * « à rappeler » (B), « intéressé » (le lien de son espace) ; null pour « pas intéressé ». Rien ne part seul.
   */
  sms: PropositionSms | null;
  resume: string;
};
