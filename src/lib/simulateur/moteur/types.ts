import type { AnalyseCouleur } from "../couleur";
import type { IdPiece, IdZone, IdZoneElementaire } from "../zones";

/**
 * Le moteur de prompt du simulateur (mission 15, partie 2) — une seule source
 * pour le site, l'espace client et le CRM. Fonctions pures : aucune base, aucun
 * réseau ici ; l'analyse de la photo et le contrôle du rendu (appels vision)
 * vivent à côté et sont injectables pour les essais.
 */

export type { IdPiece, IdZone };

/** Lettre de l'échantillon sur la planche (« Sample A »). */
export type Etiquette = "A" | "B" | "C" | "D";

export type FormatImage = "paysage" | "portrait" | "carre";

/**
 *  - `api-planche` : Image 1 = la photo, Image 2 = la planche des échantillons étiquetés ;
 *  - `api-swatches` : Images 2..n = les échantillons bruts, un par film ;
 *  - `chatgpt` : même texte que la planche (Image 2 = la planche que Lucas joint), sans question au modèle.
 */
export type ModeMoteur = "api-planche" | "api-swatches" | "chatgpt";

/** Une référence du catalogue telle que le moteur la lit (couleur mesurée quand elle est connue). */
export type ReferenceMoteur = {
  ref: string;
  nom: string;
  famille: string;
  categorie: string;
  finition: string;
  tags: string[];
  /** Couleur moyenne du catalogue du site (`revetements.json › hex`), quand elle est présente. */
  hex?: string | null;
  /** Couleur mesurée sur l'échantillon par le CRM (`couleur.ts`), quand elle est connue. */
  couleur?: AnalyseCouleur | null;
};

export type ZoneMoteur = {
  zone: IdZone;
  etiquette: Etiquette;
  reference: ReferenceMoteur;
};

/** Ce que l'appel vision rend sur la photo (conservé, réutilisé par empreinte). */
export type AnalysePhoto = {
  /** 3 à 5 phrases en anglais, style « THE KITCHEN IN IMAGE 1 ». */
  description: string;
  zones_visibles: Partial<Record<IdZoneElementaire, { visible: boolean; description: string }>>;
  /** Les objets vus (en anglais), cités dans NOT COVERED et LOCKED. */
  objets: string[];
  lumiere: { source: string; direction: string; temperature: string; dominante: string };
  format: FormatImage;
  qualite_photo: { verdict: "bonne" | "floue" | "sombre" | "contre-jour" | "trop-loin"; conseil: string };
};

export type EntreeMoteur = {
  piece: IdPiece;
  zones: ZoneMoteur[];
  analyse?: AnalysePhoto | null;
  format: FormatImage;
  mode: ModeMoteur;
  /** Défauts relevés par le contrôle de la tentative précédente, rappelés dans FINAL CHECK. */
  defautsPrecedents?: string[];
};

/** Les 12 blocs, dans l'ordre imposé. */
export const BLOCS = ["ROLE", "IMAGES", "ART_DIRECTION", "METHODE", "PIECE", "AFFECTATION", "REALISME", "QUALITE_PHOTO", "LOCKED", "AVOID", "FINAL_CHECK", "OUTPUT"] as const;
export type NomBloc = (typeof BLOCS)[number];

export type PromptConstruit = {
  texte: string;
  blocs: Record<NomBloc, string>;
  directionArtistique: string;
  version: "v2";
};

/** Un défaut relevé par le contrôle automatique du rendu. */
export type DefautRendu = {
  type: "objet-disparu" | "objet-ajoute" | "facades-differentes" | "zone-non-couverte" | "debordement" | "aspect-3d" | "autre";
  detail: string;
};

export type ResultatControle = { score: number; defauts: DefautRendu[] };

export const TAILLES: Record<FormatImage, string> = { paysage: "1536×1024 landscape", portrait: "1024×1536 portrait", carre: "1024×1024 square" };

/** Le format de la photo d'après ses dimensions (mêmes seuils que le cadrage). */
export function formatDepuisDimensions(largeur: number, hauteur: number): FormatImage {
  const ratio = largeur / hauteur;
  if (ratio > 1.15) return "paysage";
  if (ratio < 0.85) return "portrait";
  return "carre";
}
