// Formes des clients telles que l'interface les reçoit (aucune dépendance serveur).

import type { CategorieClient, FamilleSource, SourceClient, StatutConsentement } from "./constantes";

export type ClientResume = {
  id: string;
  nom: string;
  categorie: CategorieClient;
  ville: string | null;
  source: SourceClient;
  sourceDetail: string | null;
  premierContactLe: string;
  derniereActiviteLe: string;
  telephone: string | null;
  email: string | null;
  nbDossiers: number;
  nbDossiersEnCours: number;
  /** Somme des devis acceptés (HT = TTC en franchise). */
  montantSigne: number;
  recommandePar: { id: string; nom: string } | null;
  nbRecommandations: number;
  archiveLe: string | null;
};

export type CoordonneeVue = {
  id: string;
  valeur: string;
  saisi: string | null;
  libelle: string | null;
  principale: boolean;
  archiveLe: string | null;
  archiveMotif: string | null;
};

export type ConsentementVue = {
  id: string;
  statut: StatutConsentement;
  moyen: string;
  recueilliLe: string;
  preuve: string | null;
  createdAt: string;
};

export type ClientDetail = ClientResume & {
  prenom: string | null;
  nomFamille: string | null;
  raisonSociale: string | null;
  siret: string | null;
  adresse: string | null;
  codePostal: string | null;
  campagne: string | null;
  publicite: string | null;
  formulaire: string | null;
  recommandeParTexte: string | null;
  notes: string | null;
  archiveMotif: string | null;
  fusionneDans: { id: string; nom: string } | null;
  anonymiseLe: string | null;
  emails: CoordonneeVue[];
  telephones: CoordonneeVue[];
  consentements: ConsentementVue[];
  recommandations: { id: string; nom: string; nbDossiers: number; montantSigne: number }[];
  dossiers: {
    id: string;
    objet: string;
    etape: string;
    ville: string;
    montant: number | null;
    createdAt: string;
    archiveLe: string | null;
  }[];
  leads: { id: string; source: string; statut: string; createdAt: string; campagne: string | null; formulaire: string | null }[];
  propositionsEnAttente: { id: string; titre: string; type: string }[];
  historique: { horodatage: string; operation: string; acteur: string; modele: string; resume: string }[];
};

export type LigneAcquisition = {
  famille: FamilleSource;
  source: SourceClient;
  clients: number;
  clientsSignes: number;
  montantSigne: number;
};
