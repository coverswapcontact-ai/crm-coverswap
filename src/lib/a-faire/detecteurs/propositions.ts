import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur PROPOSITIONS — ce qui attend une validation (écran À valider).
 *
 * TODO (lot 2, docs/TACHES.md § 3, validation/service.ts) : chaque `Proposition` EN_ATTENTE → VALIDER « Valider · (titre) »,
 * niveau 2 pour une relance (ENVOI_MAIL motif RELANCE_DEVIS), 3 pour une carte, 5 pour une règle (REGLE_TRI, REGLE_TACHE) ;
 * clé `VALIDER:<sujet>:<propositionId>` ; `raccourci: { genre: "VALIDER", propositionId }` et `donnees.propositionId`
 * (l'effet « Fait » l'applique, « Pas à faire » la rejette : reponses.ts). Achèvement : statut ≠ EN_ATTENTE (le moteur
 * coche par absence avec « proposition validée / ignorée »).
 */
export const detecteurPropositions: Detecteur = {
  source: "PROPOSITIONS",
  async detecter() {
    return [];
  },
};
