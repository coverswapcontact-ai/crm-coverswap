// Formes sérialisées des encaissements (dates en ISO). Aucune dépendance serveur.

import type { MoyenPaiement, StatutAffectation, StatutEncaissement } from "./constantes";

export type AffectationVue = {
  id: string;
  numero: string;
  type: "DEVIS" | "FACTURE";
  montant: number;
  statut: StatutAffectation;
  motifFin: string | null;
};

export type EncaissementVue = {
  id: string;
  payeur: string;
  montant: number;
  moyen: MoyenPaiement | null;
  reference: string | null;
  recuLe: string;
  crediteLe: string | null;
  statut: StatutEncaissement;
  finLe: string | null;
  motifFin: string | null;
  origine: string;
  note: string | null;
  affectations: AffectationVue[];
  /** Part non imputée sur une pièce (trop-perçu, facture annulée en attente de la nouvelle). */
  nonAffecte: number;
};

export type PieceVue = {
  registreId: string;
  numero: string;
  type: "DEVIS" | "FACTURE";
  /** Montant de la pièce ; null si inconnu (facture hors CRM non complétée). */
  total: number | null;
  regle: number;
  /** Facture active : reste à payer ; sinon null. */
  reste: number | null;
  /** Facture non annulée, devis non remplacé. */
  active: boolean;
};

export type PaiementsDossier = {
  encaissements: EncaissementVue[];
  pieces: PieceVue[];
  nonAffecte: number;
  /** Reste à payer sur les factures actives. */
  resteDu: number;
  acompteEnregistre: boolean;
  soldeEncaisse: boolean;
};
