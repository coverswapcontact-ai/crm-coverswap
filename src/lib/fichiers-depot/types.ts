/**
 * Mission 17 (partie C) — les fichiers déposés : vocabulaire commun au lien de
 * dépôt (page publique /depot/[jeton]), au téléchargement par URL et aux outils
 * de l'assistant (ajouter_fichier, ranger_fichier, voir_fichiers, lien_depot).
 * Fichier sans dépendance Node : la page de dépôt (navigateur) en lit les
 * limites et les libellés.
 */

export const ENTITES_CIBLE = ["DOSSIER", "LEAD", "CLIENT", "DEPENSE", "PUBLICATION"] as const;
export type EntiteCible = (typeof ENTITES_CIBLE)[number];

export const TYPES_FICHIER = ["PHOTO_AVANT", "PHOTO_APRES", "PLAN", "DEVIS", "FACTURE", "JUSTIFICATIF", "AUTRE"] as const;
export type TypeFichier = (typeof TYPES_FICHIER)[number];

export const VOIES_FICHIER = ["LIEN_DEPOT", "URL", "BASE64", "PIECE_MAIL", "FICHIER", "EXISTANT"] as const;
export type VoieFichier = (typeof VOIES_FICHIER)[number];

export const LIBELLES_TYPE_FICHIER: Record<TypeFichier, string> = {
  PHOTO_AVANT: "photo avant",
  PHOTO_APRES: "photo après chantier",
  PLAN: "plan",
  DEVIS: "devis",
  FACTURE: "facture",
  JUSTIFICATIF: "justificatif",
  AUTRE: "document",
};

export const LIBELLES_ENTITE: Record<EntiteCible, string> = {
  DOSSIER: "dossier",
  LEAD: "lead",
  CLIENT: "fiche client",
  DEPENSE: "dépense",
  PUBLICATION: "réalisation du site",
};

/** Durée de validité d'un lien de dépôt, depuis sa création. */
export const MINUTES_VALIDITE_LIEN = 30;
/** Une fois le formulaire soumis (lien consommé), le temps laissé pour envoyer ses fichiers un par un. */
export const MINUTES_ENVOI = 20;
/** 9 Mo par fichier : même plafond que les photos du dossier et deposer_document (une requête sous les 10 Mo du proxy). */
export const OCTETS_MAX_FICHIER = 9 * 1024 * 1024;
/** Par dépôt (une soumission) : 20 fichiers, 60 Mo en tout. */
export const FICHIERS_MAX_DEPOT = 20;
export const OCTETS_MAX_DEPOT = 60 * 1024 * 1024;
/** Côté téléphone : les photos réduites à 2 000 px, JPEG à 85 % (le HEIC part tel quel, le serveur le convertit). */
export const COMPRESSION_NAVIGATEUR = { cote: 2000, qualite: 0.85 } as const;

/** Cibles qui ne reçoivent qu'un seul fichier par dépôt (le justificatif d'une dépense, la photo d'une réalisation). */
export function fichiersMaxPour(entite: EntiteCible | null): number {
  return entite === "DEPENSE" || entite === "PUBLICATION" ? 1 : FICHIERS_MAX_DEPOT;
}

/** Ce que la page montre en titre : « Photos avant — dossier de Mme Martin », « Dépôt libre (À ranger) ». */
export function libelleDepot(entite: EntiteCible | null, nom: string | null, type: TypeFichier | null): string {
  const quoi = type ? LIBELLES_TYPE_FICHIER[type] : "photos ou documents";
  if (!entite) return `Dépôt libre (${quoi}) : rangé ensuite depuis l'assistant`;
  return `${quoi.charAt(0).toUpperCase()}${quoi.slice(1)} — ${LIBELLES_ENTITE[entite]}${nom ? ` : ${nom}` : ""}`;
}
