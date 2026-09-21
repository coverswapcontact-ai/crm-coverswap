import type { EtapeEspace, progression } from "./etapes";

/** Types de l'onglet Espaces clients, partagés par l'écran (sans dépendance serveur). */
export type CodeSignal = "PHOTOS_SANS_SIMULATION" | "PROPOSITION_DEMANDEE" | "SIMULATIONS_DEMANDEES" | "BROUILLONS" | "HESITE" | "JAMAIS_OUVERT" | "EXPIRE_BIENTOT" | "EXPIRE" | "NON_ENVOYE" | "DATE_A_FIXER";
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
    /** Le client (ou Lucas) a validé le projet : pastille verte. */
    projetValideLe: string | null;
    simulationsPubliees: number;
    /** Simulations créées par le client dans son espace, et ce qu'il lui en reste. */
    simulationsClient: number;
    /** Faites sur coverswap.fr : elles comptent dans son quota. */
    simulationsSite: number;
    simulationsRestantes: number;
    simulationsDemandeesLe: string | null;
    brouillons: number;
    choix: string | null;
    /** Teintes de la simulation validée, zone par zone. */
    choixTeintes: string | null;
    /** Demande d'autre proposition en attente : sa date et son mot, entier. */
    proposition: { le: string; message: string | null } | null;
    devis: { numero: string; consultations: number; consulteLe: string | null } | null;
    accord: string | null;
    /** ESPACE : bon pour accord en ligne ; CRM : devis noté accepté dans le CRM (signé sur papier). */
    accordSource: "ESPACE" | "CRM" | null;
    acompte: { montant: number; recu: number } | null;
    /** Total du devis, reçu, reste : lus sur les encaissements du dossier. */
    paiement: { total: number; recu: number; reste: number; regle: boolean } | null;
  };
  /** Qui a la main ; quand c'est Lucas, le geste qui fait avancer (un bouton dans la carte). */
  attente: { qui: "MOI" | "CLIENT" | "PERSONNE"; libelle: string; geste?: "DEVIS" | "SIMULATEUR" | "PUBLIER" | "APPELER" | "ACCORDER" };
  signaux: Signal[];
};
