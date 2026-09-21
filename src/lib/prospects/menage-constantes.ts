// Constantes des actions rapides sur les leads, sans dépendance serveur : l'écran Leads les importe.
export const MOTIFS_ARCHIVAGE = ["TEST", "DOUBLON", "HORS_CIBLE", "AUTRE"] as const;
export type MotifArchivage = (typeof MOTIFS_ARCHIVAGE)[number];
export const LIBELLES_MOTIF_ARCHIVAGE: Record<MotifArchivage, string> = { TEST: "Test", DOUBLON: "Doublon", HORS_CIBLE: "Hors cible", AUTRE: "Autre" };

export const ACTIONS_LEADS = ["ARCHIVER", "RESTAURER", "TRAITER", "REPRENDRE"] as const;
export type ActionLeads = (typeof ACTIONS_LEADS)[number];
