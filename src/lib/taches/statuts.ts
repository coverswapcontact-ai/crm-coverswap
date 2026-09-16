// Statuts des tâches de fond, partagés par le serveur et l'interface (aucune dépendance serveur).

export const STATUTS_TACHE = ["EN_ATTENTE", "EN_COURS", "TERMINEE", "ECHEC_DEFINITIF", "ANNULEE"] as const;
export type StatutTache = (typeof STATUTS_TACHE)[number];

export const LIBELLES_STATUT_TACHE: Record<StatutTache, string> = {
  EN_ATTENTE: "En attente",
  EN_COURS: "En cours",
  TERMINEE: "Terminée",
  ECHEC_DEFINITIF: "En échec",
  ANNULEE: "Annulée",
};
