// Encaissements : listes et libellés partagés entre le serveur et l'interface.
// Aucune dépendance serveur.

export const MOYENS_PAIEMENT = ["VIREMENT", "CHEQUE", "ESPECES", "CARTE", "AUTRE"] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

export const LIBELLES_MOYEN: Record<MoyenPaiement, string> = {
  VIREMENT: "Virement",
  CHEQUE: "Chèque",
  ESPECES: "Espèces",
  CARTE: "Carte",
  AUTRE: "Autre",
};

export const STATUTS_ENCAISSEMENT = ["VALIDE", "REJETE", "ANNULE"] as const;
export type StatutEncaissement = (typeof STATUTS_ENCAISSEMENT)[number];

export const STATUTS_AFFECTATION = ["ACTIVE", "TRANSFEREE", "LIBEREE"] as const;
export type StatutAffectation = (typeof STATUTS_AFFECTATION)[number];

/** Annulation : l'encaissement n'a jamais existé tel quel (erreur de saisie). */
export const MOTIFS_ANNULATION = [
  { code: "ERREUR_MONTANT", libelle: "Montant erroné" },
  { code: "ERREUR_DATE", libelle: "Date erronée" },
  { code: "ERREUR_PIECE", libelle: "Mauvais dossier ou mauvaise facture" },
  { code: "DOUBLON", libelle: "Saisi deux fois" },
  { code: "AUTRE", libelle: "Autre" },
] as const;

/** Rejet : le chèque est revenu impayé. */
export const MOTIFS_REJET = [
  { code: "SANS_PROVISION", libelle: "Sans provision" },
  { code: "OPPOSITION", libelle: "Opposition" },
  { code: "IRREGULIER", libelle: "Chèque irrégulier (signature, date, ordre)" },
  { code: "AUTRE", libelle: "Autre" },
] as const;

/** Signature sans acompte : pourquoi, en un choix. */
export const MOTIFS_SANS_ACOMPTE = [
  { code: "PAIEMENT_A_LA_FACTURE", libelle: "Paiement à la facture (professionnel)" },
  { code: "SOUS_TRAITANCE", libelle: "Sous-traitance" },
  { code: "PETIT_MONTANT", libelle: "Petit montant" },
  { code: "ACOMPTE_A_VENIR", libelle: "Acompte promis, pas encore reçu" },
  { code: "AUTRE", libelle: "Autre" },
] as const;

/** Tolérance d'arrondi sur les montants en euros (un demi-centime). */
export const TOLERANCE_EUROS = 0.005;

export function libelleMotif(liste: readonly { code: string; libelle: string }[], code: string, precision?: string | null): string {
  const libelle = liste.find((motif) => motif.code === code)?.libelle ?? code;
  return precision?.trim() ? `${libelle} (${precision.trim()})` : libelle;
}
