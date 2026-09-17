import type { GroupeDemarchage, GroupeEntrants, IntentionLead } from "./constantes";

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
  photos: { id: string; url: string; le: string }[];
  campagne: string | null;
  publicite: string | null;
  formulaire: string | null;
  archiveMotif: string | null;
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

export type ProspectResume = {
  id: string;
  nom: string;
  ville: string | null;
  agent: { slug: string; nom: string };
  statut: string;
  groupe: GroupeDemarchage;
  score: number;
  signalPrincipal: string | null;
  noteGoogle: number | null;
  nbAvis: number | null;
  telephone: string | null;
  siteWeb: string | null;
  sourceLe: string;
  derniereActiviteLe: string;
  dossier: { id: string; etape: string } | null;
  client: { id: string; nom: string } | null;
};

export type ProspectDetail = ProspectResume & {
  adresse: string | null;
  codePostal: string | null;
  email: string | null;
  siret: string | null;
  fermetureHebdo: string | null;
  angleSuggere: string | null;
  lienGoogleMaps: string;
  scoreDetails: { signaux: { label: string; points: number; source?: string }[]; total: number } | null;
  avis: { note: number; texte: string; le: string | null }[];
  activites: { id: string; type: string; message: string; le: string }[];
};

export type ListeProspects = {
  lignes: ProspectResume[];
  compteurs: Record<GroupeDemarchage, number>;
};

export type EtatAgent = {
  slug: string;
  nom: string;
  actif: boolean;
  prospects: number;
  aScorer: number;
  aContacter: number;
};
