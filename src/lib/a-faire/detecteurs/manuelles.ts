import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur MANUELLE — les tâches ajoutées par Lucas ou Claude (`reponses.ts › ajouterTache`).
 *
 * Une tâche MANUELLE n'est jamais cochée par absence : `detecter` n'a rien à rendre. TODO (lot 2, docs/TACHES.md § 2 et
 * § 6) : `acheves` rend les tâches MANUELLE A_FAIRE/PLUS_TARD dont la condition propre (`donnees.condition`, posée par
 * `ajouterTache` ou par la migration de mise en route) est remplie — ex. `{ genre: "PARAMETRE", cle: "SIMULATEUR_MOTEUR",
 * valeur: "V2" }`, `{ genre: "ENV", variables: [...] }` — avec le texte de la preuve
 * (« paramètre posé le 29/09 »).
 */
export const detecteurManuelles: Detecteur = {
  source: "MANUELLE",
  async detecter() {
    return [];
  },
  async acheves() {
    return [];
  },
};
