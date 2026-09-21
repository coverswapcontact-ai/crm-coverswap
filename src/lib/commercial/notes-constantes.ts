// Notes d'appel : constantes partagées par l'écran et le serveur (aucune dépendance serveur).

/**
 * Étiquettes à toucher pendant ou après un appel, en plus du texte. Elles diront
 * plus tard pourquoi des affaires se perdent : un code stable par étiquette.
 */
export const ETIQUETTES_APPEL = ["TROP_CHER", "VEUT_REFLECHIR", "LOCATAIRE", "PROJET_LOINTAIN", "COMPARE_DEVIS", "VEUT_UN_RENDU", "DEJA_DECIDE", "PAS_JOIGNABLE"] as const;
export type EtiquetteAppel = (typeof ETIQUETTES_APPEL)[number];

export const LIBELLES_ETIQUETTE_APPEL: Record<EtiquetteAppel, string> = {
  TROP_CHER: "Trop cher",
  VEUT_REFLECHIR: "Veut réfléchir",
  LOCATAIRE: "Locataire",
  PROJET_LOINTAIN: "Projet lointain",
  COMPARE_DEVIS: "Compare des devis",
  VEUT_UN_RENDU: "Veut voir un rendu",
  DEJA_DECIDE: "Déjà décidé",
  PAS_JOIGNABLE: "Pas joignable",
};

/** Une note d'appel telle que l'écran la montre. */
export type NoteAppelVue = {
  id: string;
  /** Début de l'appel (ou de la note). */
  appelLe: string;
  /** Dernier enregistrement. */
  majLe: string;
  texte: string;
  etiquettes: EtiquetteAppel[];
  /** Issue notée en fin d'appel (Intéressé, À rappeler…), s'il y en a une. */
  issue: string | null;
  /** Reprise dans l'historique d'un dossier. */
  dansDossier: boolean;
};

/**
 * Une note continue tant que l'appel n'est pas fini : au-delà de ce délai sans
 * nouvel appel noté, la frappe suivante ouvre une nouvelle note, datée.
 */
export const NOTE_APPEL_OUVERTE_MS = 3 * 60 * 60 * 1000;
