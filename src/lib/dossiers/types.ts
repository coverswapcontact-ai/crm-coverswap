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
  createdAt: string;
  updatedAt: string;
};

export type PhotoVue = { id: string; url: string; type: string };

export type NoteVue = { id: string; etape: EtapeDossier; contenu: string; createdAt: string };

export type EvenementVue = {
  id: string;
  type: TypeEvenement;
  direction: DirectionEvenement;
  contenu: string;
  createdAt: string;
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
};

export type DossierDetail = DossierResume & {
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
};

export type PresetVue = {
  id: string;
  designation: string;
  unite: Unite;
  prixUnitaire: number | null;
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
    detail.documents.some((document) => document.type === type && document.statut !== "BROUILLON");
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
  };
}

/** Montant affiché sur une carte : dernier devis généré, sinon estimation. */
export function montantAffiche(dossier: Pick<DossierResume, "montantDernierDevis" | "montantEstime">): number | null {
  return dossier.montantDernierDevis ?? dossier.montantEstime;
}
