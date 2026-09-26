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
