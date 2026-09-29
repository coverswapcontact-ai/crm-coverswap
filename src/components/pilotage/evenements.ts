/**
 * Mission 13 (lot 5, B9) — l'événement qui fait recharger les badges de la
 * navigation (leads à appeler, mails à traiter, tâches en échec). Émis par
 * `appelApi` après chaque écriture réussie et par la navigation elle-même au
 * retour sur l'onglet : plus besoin que chaque écran y pense.
 */
export const EVENEMENT_COMPTEURS = "pilotage:compteurs";

/** À déclencher après une action qui change un compteur (validation, relance d'une tâche). */
export function rafraichirCompteurs(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENEMENT_COMPTEURS));
}

/* ── Mission 14 (partie 4) : la fin d'appel prévient les écrans ─────────── */

/** Un appel noté a changé des leads (listes, fiche) : l'écran Leads se recharge. */
export const EVENEMENT_LEADS_MODIFIES = "leads:modifies";
/** La fin d'un appel lancé depuis « Appels à la suite » est finie (SMS compris) : la file passe au lead suivant. */
export const EVENEMENT_APPEL_TERMINE = "appel:termine";

export type DetailAppelTermine = { leadId: string };

export function signalerLeadsModifies(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENEMENT_LEADS_MODIFIES));
}

export function signalerAppelTermine(leadId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<DetailAppelTermine>(EVENEMENT_APPEL_TERMINE, { detail: { leadId } }));
}
