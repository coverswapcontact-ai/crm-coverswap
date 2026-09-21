import type { EtapeEspace, progression } from "./etapes";

/** Types de l'onglet Espaces clients, partagés par l'écran (sans dépendance serveur). */
export type CodeSignal = "PHOTOS_SANS_SIMULATION" | "PROPOSITION_DEMANDEE" | "BROUILLONS" | "HESITE" | "JAMAIS_OUVERT" | "EXPIRE_BIENTOT" | "EXPIRE" | "NON_ENVOYE" | "DATE_A_FIXER";
export type Signal = { code: CodeSignal; libelle: string; ton: "rouge" | "ambre" | "gris" };

export type LigneEspace = {
  espaceId: string;
  dossierId: string;
  clientNom: string;
  ville: string;
  telephone: string;
  typeProjet: string;
  lien: string | null;
  apercu: string | null;
  creeLe: string;
  lienEnvoyeLe: string | null;
  expireLe: string;
  revoque: boolean;
  expire: boolean;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  derniereActivite: string | null;
  etape: EtapeEspace;
  etapeLibelle: string;
  etapes: ReturnType<typeof progression>;
  faits: {
    photos: number;
    projet: string | null;
    simulationsPubliees: number;
    brouillons: number;
    choix: string | null;
    devis: { numero: string; consultations: number; consulteLe: string | null } | null;
    accord: string | null;
    acompte: { montant: number; recu: number } | null;
  };
  /** Qui a la main ; quand c'est Lucas, le geste qui fait avancer (un bouton dans la carte). */
  attente: { qui: "MOI" | "CLIENT" | "PERSONNE"; libelle: string; geste?: "DEVIS" | "SIMULATEUR" | "PUBLIER" | "APPELER" };
  signaux: Signal[];
};
