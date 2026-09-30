import { mettreEnFile } from "@/lib/taches/file";

/**
 * Mission 17 (partie A) : « quelque chose a bougé, repasse les détecteurs » (docs/TACHES.md § 2). Appelé à la fin des
 * gestes qui changent ce que Lucas a à faire (mail parti, appel noté, SMS copié, main recalculée, proposition décidée…),
 * TOUJOURS après la transaction, jamais dedans. Une seule passe pour une rafale de gestes : la clé est unique, le mode
 * RECONCILIATION remet la tâche en attente (ou la fait rejouer une fois si elle tourne déjà) et la date de 3 s est
 * repoussée à chaque geste.
 *
 * Jamais bloquant, jamais d'exception : une file indisponible n'empêche pas le geste (le travail périodique de 15
 * minutes rattrape). Ne dépend que de la file des tâches de fond : importable partout sans cycle.
 */

export const TYPE_TACHE_DETECTION = "A_FAIRE_DETECTION";
export const CLE_TACHE_DETECTION = "a-faire:detection";
export const DELAI_DETECTION_MS = 3_000;
/** L'effet d'une réponse sur sa source (reponses.ts › executerEffet) : déclaré ici pour que taches.ts reste léger. */
export const TYPE_TACHE_EFFET = "A_FAIRE_EFFET";

export async function signalerChangementTaches(): Promise<void> {
  try {
    await mettreEnFile({ type: TYPE_TACHE_DETECTION, cle: CLE_TACHE_DETECTION, mode: "RECONCILIATION", apres: new Date(Date.now() + DELAI_DETECTION_MS), tentativesMax: 3 });
  } catch (erreur) {
    console.error("[a-faire] passage des détecteurs non demandé :", erreur);
  }
}
