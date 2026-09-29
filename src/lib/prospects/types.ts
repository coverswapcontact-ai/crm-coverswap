import type { GroupeEntrants, IntentionLead } from "./constantes";

export type EntrantResume = {
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  ville: string | null;
  source: string;
  statut: string;
  typeProjet: string;
  intention: IntentionLead;
  prixSimule: number | null;
  recuLe: string;
  dernierEchange: { type: string; contenu: string; le: string } | null;
  /** Jours depuis le dernier échange, ou depuis la réception s'il n'y en a pas. */
  joursSansNouvelle: number;
  groupe: GroupeEntrants;
  dossier: { id: string; etape: string } | null;
  client: { id: string; nom: string } | null;
  archiveLe: string | null;
  /** Classe de rappel (PRIORITAIRE, STANDARD, SECONDAIRE, A_ECARTER) ; null tant que le contact n'a pas été classé. */
  priorite: string | null;
  prioriteMotif: string | null;
  prioriteManuelle: boolean;
  /** Prochain rappel prévu, posé à la fin d'un appel. */
  rappelLe: string | null;
  /** Ce rappel est passé (mission 14 : en rouge). */
  rappelEnRetard: boolean;
  /** Dernier appel noté, quelle qu'en soit l'issue ; null = jamais appelé (« À appeler »). */
  dernierAppelLe: string | null;
  /** Appels sans réponse d'affilée depuis le dernier appel abouti. */
  tentatives: number;
};

export type SimulationVue = {
  id: string;
  le: string;
  source: string;
  reference: string | null;
  metresLineaires: number | null;
  prix: number | null;
  avant: string | null;
  apres: string | null;
  pdf: string;
};

export type EntrantDetail = EntrantResume & {
  prenom: string;
  nomFamille: string;
  codePostal: string | null;
  notes: string | null;
  /** Ce que la personne a écrit dans le formulaire du site. */
  message: string | null;
  styleSouhaite: string | null;
  /** Photos jointes à la demande (servies derrière la session). */
  photos: { id: string; url: string; vignette: string; le: string }[];
  campagne: string | null;
  publicite: string | null;
  formulaire: string | null;
  archiveMotif: string | null;
  /** Ce que le formulaire disait, lu à l'arrivée. */
  occupation: string | null;
  delaiProjet: string | null;
  delaiProjetTexte: string | null;
  tailleCuisine: string | null;
  simulations: SimulationVue[];
  echanges: { id: string; type: string; contenu: string; le: string }[];
  dossiers: { id: string; objet: string; etape: string; ouvertLe: string }[];
  anciensDevis: { id: string; numero: string; statut: string; montant: number; le: string; pdf: string; facture: { numero: string; pdf: string } | null }[];
  ancienChantier: { dateIntervention: string; adresse: string; statut: string; acompteRecu: boolean; soldeRecu: boolean; commandes: { reference: string; statut: string }[] } | null;
};

export type ListeEntrants = {
  lignes: EntrantResume[];
  compteurs: Record<GroupeEntrants, number>;
};
