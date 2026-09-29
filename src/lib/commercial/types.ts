// Pilotage commercial : types partagés par l'écran et le serveur (aucune dépendance serveur).

/** Ce qu'une affaire attend, et de qui. */
export type GroupeAffaire =
  | "REPONDRE" // un SMS, un mail ou un message d'espace du client attend une réponse
  | "RAPPELER" // nouveau contact, rappel dû, appel resté sans réponse
  | "SIMULATION" // photos reçues : à moi de préparer la simulation
  | "DEVIS" // simulation choisie : à moi de faire le devis
  | "PLANIFIER" // devis signé : fixer la date, suivre l'acompte
  | "DECIDER" // contacté, mais aucune suite donnée
  | "ECARTER" // hors zone : ne se rappelle que si Lucas le décide
  | "ATTENTE_PHOTOS"
  | "ATTENTE_SIMULATION"
  | "ATTENTE_DEVIS"
  | "PLUS_TARD"; // rappel ou chantier déjà daté

/** Ordre d'affichage : ce qui brûle d'abord. */
export const GROUPES_A_MOI: GroupeAffaire[] = ["REPONDRE", "RAPPELER", "SIMULATION", "DEVIS", "PLANIFIER", "DECIDER", "ECARTER"];
export const GROUPES_CLIENT: GroupeAffaire[] = ["ATTENTE_DEVIS", "ATTENTE_SIMULATION", "ATTENTE_PHOTOS", "PLUS_TARD"];

export type Affaire = {
  cle: string;
  genre: "CONTACT" | "DOSSIER";
  leadId: string | null;
  dossierId: string | null;
  conversationId: string | null;
  nom: string;
  ville: string | null;
  /** Format international, prêt pour un lien tel: ; null si le numéro est illisible. */
  telephone: string | null;
  etape: string;
  priorite: string | null;
  prioriteMotif: string | null;
  main: "MOI" | "CLIENT";
  groupe: GroupeAffaire;
  action: string;
  echeance: string | null;
  enRetard: boolean;
  /** Jours depuis le dernier fait marquant (ou depuis que la balle est chez le client). */
  depuisJours: number;
  recuLe: string;
  dernier: { type: string; texte: string; le: string } | null;
  montant: number | null;
  nonLus: number;
};

export type PilotageCommercial = {
  genereLe: string;
  affaires: Affaire[];
  compteurs: { aMoi: number; chezLeClient: number; rappeler: number; repondre: number; simulations: number; devis: number; planifier: number; relancesAValider: number };
};
