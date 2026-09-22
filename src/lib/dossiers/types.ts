import type { SelectionPrestations } from "@/lib/prestations/prestations";
// Formes sérialisées échangées entre le serveur et l'interface /dossiers
// (dates en ISO, JSON déjà décodé). Aucune dépendance serveur.

import type {
  DirectionEvenement,
  EtapeActive,
  EtapeDossier,
  LigneDocument,
  MotifPerte,
  SourceDossier,
  StatutDocument,
  TypeDocument,
  TypeEvenement,
  Unite,
} from "./constants";
import type { PaiementsDossier } from "@/lib/encaissements/types";
import type { PointACompleter } from "./completude";
import type { FaitsDossier } from "./regles";
import type { DelaisCles, EcartsPrix, PassageEtape } from "./delais";

export type DossierResume = {
  id: string;
  clientNom: string;
  clientVille: string;
  objet: string;
  etape: EtapeDossier;
  source: SourceDossier;
  montantEstime: number | null;
  montantDernierDevis: number | null;
  prochaineAction: string | null;
  prochaineActionDate: string | null;
  /** Perdu ou en pause : étape active quittée (la progression y reste figée). */
  etapeAvantSortie: EtapeActive | null;
  /** Nombre de points à compléter (completude.ts). */
  aCompleter: number;
  /** Date réelle d'ouverture (reprise d'un dossier commencé avant le CRM), à défaut sa création. */
  ouvertLe: string;
  createdAt: string;
  updatedAt: string;
  /** Familles et sous-parties du projet (src/lib/prestations) : visibles sur la carte, modifiables dans le dossier. */
  prestations: SelectionPrestations;
};

export type PhotoVue = { id: string; url: string; type: string; /** Après chantier (portfolio). */ apres: boolean };

export type NoteVue = { id: string; etape: EtapeDossier; contenu: string; createdAt: string };

export type EvenementVue = {
  id: string;
  type: TypeEvenement;
  direction: DirectionEvenement;
  contenu: string;
  createdAt: string;
  /** Date réelle de l'événement (corrigée ou reprise), à défaut sa saisie. */
  date: string;
  /** Date de saisie, quand la date réelle en diffère. */
  saisiLe: string | null;
  /** Mail rangé dans le dossier : lisible depuis l'historique. */
  messageId: string | null;
};

export type DocumentVue = {
  id: string;
  type: TypeDocument;
  numero: string | null;
  dateEmission: string | null;
  objet: string;
  lignes: LigneDocument[];
  totalHt: number;
  acomptePct: number | null;
  noteMl: boolean;
  statut: StatutDocument;
  pdfUrl: string | null;
  /** CRM : généré ici, figé ; REPRISE : émis avant le CRM, rattaché avec son numéro, corrigeable. */
  origine: "CRM" | "REPRISE";
  echeanceLe: string | null;
  /** Avoir : facture annulée ; devis refait : devis remplacé. */
  documentOrigine: { id: string; numero: string | null } | null;
  /** Facture annulée : son avoir ; devis remplacé : le nouveau devis. */
  documentsLies: { id: string; type: TypeDocument; numero: string | null }[];
  motifAvoir: string | null;
};

export type DossierDetail = DossierResume & {
  /** Ce qui manque au dossier : signalé, jamais exigé. */
  completude: PointACompleter[];
  /** Fiche client rattachée. */
  client: { id: string; nom: string } | null;
  clientAdresse: string;
  clientCp: string;
  clientEmail: string | null;
  clientTelephone: string;
  motifPerte: MotifPerte | null;
  perte: {
    le: string | null;
    etape: EtapeDossier | null;
    concurrent: string | null;
    montantConcurrent: number | null;
    montantPropose: number | null;
    commentaire: string | null;
  } | null;
  /** Étapes traversées et temps passé dans chacune ; délais clés du parcours. */
  parcours: PassageEtape[];
  delais: DelaisCles;
  ecarts: EcartsPrix;
  dateChantier: string | null;
  origine: { type: "LEAD" | "PROSPECT"; id: string; nom: string } | null;
  photos: PhotoVue[];
  notes: NoteVue[];
  evenements: EvenementVue[];
  documents: DocumentVue[];
  paiements: PaiementsDossier;
};

export type PresetVue = {
  id: string;
  designation: string;
  unite: Unite;
  prixUnitaire: number | null;
  /** Sous-parties des prestations que ce tarif chiffre (« CUISINE.facades-hautes ») : attribuées par Lucas. */
  prestations?: string[];
};

export type PreRemplissageDossier = {
  clientNom: string;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  clientTelephone: string;
  clientEmail: string;
  objet: string;
  source: SourceDossier;
};

export type LeadTrouve = {
  origine: "CLIENT" | "LEAD" | "PROSPECT";
  id: string;
  libelle: string;
  detail: string;
  nbDossiers: number;
  preRemplissage: PreRemplissageDossier;
};

export function faitsDepuisDetail(detail: DossierDetail): FaitsDossier {
  const genere = (type: TypeDocument) =>
    detail.documents.some((document) => document.type === type && document.statut !== "BROUILLON" && document.statut !== "ANNULEE");
  return {
    etape: detail.etape,
    clientNom: detail.clientNom,
    clientAdresse: detail.clientAdresse,
    clientCp: detail.clientCp,
    clientVille: detail.clientVille,
    clientTelephone: detail.clientTelephone,
    objet: detail.objet,
    nbPhotos: detail.photos.length,
    dateChantier: detail.dateChantier,
    aDevisGenere: genere("DEVIS"),
    aFactureGeneree: genere("FACTURE"),
    acompteEnregistre: detail.paiements.acompteEnregistre,
    soldeEncaisse: detail.paiements.soldeEncaisse,
    resteDu: detail.paiements.resteDu,
  };
}

/** Montant affiché sur une carte : dernier devis généré, sinon estimation. */
export function montantAffiche(dossier: Pick<DossierResume, "montantDernierDevis" | "montantEstime">): number | null {
  return dossier.montantDernierDevis ?? dossier.montantEstime;
}
