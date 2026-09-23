/** Les familles de la chronologie (mission 9), sans dépendance serveur : lisibles par les écrans. */
export const FAMILLES_CHRONOLOGIE = ["MAIL", "APPEL", "ESPACE", "DOSSIER", "DOCUMENT", "PAIEMENT", "NOTE", "PROPOSITION"] as const;
export type FamilleChronologie = (typeof FAMILLES_CHRONOLOGIE)[number];

export const LIBELLES_FAMILLE_CHRONOLOGIE: Record<FamilleChronologie, string> = {
  MAIL: "Mails",
  APPEL: "Appels",
  ESPACE: "Espace client",
  DOSSIER: "Dossier",
  DOCUMENT: "Devis et factures",
  PAIEMENT: "Paiements",
  NOTE: "Notes",
  PROPOSITION: "Propositions validées",
};

export type EntreeChronologie = {
  id: string;
  le: string;
  famille: FamilleChronologie;
  type: string;
  titre: string;
  texte: string | null;
  direction: "ENTRANT" | "SORTANT" | "INTERNE";
  lien: string | null;
  messageId: string | null;
  dossierId: string | null;
};
