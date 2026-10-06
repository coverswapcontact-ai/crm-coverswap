import type { EntreeChronologie, FamilleChronologie } from "./familles";

/**
 * Mission 22 (A1) — les types et constantes du journal global, sans dépendance serveur : lisibles par l'écran v2
 * (`components/v2/journal`) comme par le service (`journal.ts`, qui les réexporte).
 */
export const FILTRES_JOURNAL = ["CLIENTS", "ARGENT", "SYSTEME"] as const;
export type FiltreJournal = (typeof FILTRES_JOURNAL)[number];
export const LIBELLES_FILTRE_JOURNAL: Record<FiltreJournal, string> = { CLIENTS: "Clients", ARGENT: "Argent", SYSTEME: "Système" };

export type EntreeJournal = Omit<EntreeChronologie, "famille"> & {
  famille: FamilleChronologie | "SYSTEME";
  filtre: FiltreJournal;
  /** La personne (nom du client du dossier, du client, ou du lead) ; null pour un fait système. */
  clientNom: string | null;
  clientId: string | null;
  leadId: string | null;
  /** Lignes identiques groupées (même type, même dossier, même document) ; 1 sinon. */
  occurrences: number;
  /** Qui a agi quand ce n'est ni la personne ni le gérant : « Claude », « le système ». */
  acteur: string | null;
  /** Proposition à valider : les routes POST des deux gestes (corps `{}` pour valider, `{ motif }` pour ignorer). */
  gestes?: { valider: string; ignorer: string };
};

export type ResultatJournal = {
  entrees: EntreeJournal[];
  total: number;
  page: number;
  pages: number;
  /** Le nombre d'entrées de chaque filtre sur toute la période (avant filtrage et pagination). */
  compteurs: Record<FiltreJournal, number>;
  depuis: string;
  jusqua: string;
};
