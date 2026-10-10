/**
 * Mission 25 — le contrat de la messagerie : faits d'un suivi, « Où on en est », état lu d'un dossier ou d'un lead, et
 * intentions du moteur. Pur : importable par les écrans comme par le serveur.
 */
import type { CodeFile, EtapeRelance, VarianteMessage } from "./catalogue";
import type { Piece } from "./texte";
import type { Zone } from "./zone";

/* ── Faits ──────────────────────────────────────────────────────────────────── */

export type Budget = "AISE" | "SENSIBLE" | "INCONNU";
export type CanalPrefere = "LIEN" | "SMS_DABORD" | "INCONNU";
export type Temperature = "CHAUD" | "TIEDE" | "FROID" | "INCONNUE";

/** Ce que les notes, les messages et l'IA ont appris, qui ne se lit pas ailleurs dans le CRM. */
export type Faits = {
  pieces: string[];
  teintesEvoquees: string[];
  teintesFavorites: string[];
  surface: string | null;
  budget: Budget;
  delai: string | null;
  decideur: string | null;
  objections: string[];
  disponibilites: string | null;
  canalPrefere: CanalPrefere;
  temperature: Temperature;
  /** Une note de Lucas dit une hésitation ou un budget serré : ses messages passent en Validation. */
  sensible: boolean;
};

export const FAITS_VIDES: Faits = {
  pieces: [],
  teintesEvoquees: [],
  teintesFavorites: [],
  surface: null,
  budget: "INCONNU",
  delai: null,
  decideur: null,
  objections: [],
  disponibilites: null,
  canalPrefere: "INCONNU",
  temperature: "INCONNUE",
  sensible: false,
};

export function lireFaits(json: string | null | undefined): Faits {
  try {
    const brut = JSON.parse(json || "{}") as Partial<Faits>;
    return { ...FAITS_VIDES, ...brut, pieces: brut.pieces ?? [], teintesEvoquees: brut.teintesEvoquees ?? [], teintesFavorites: brut.teintesFavorites ?? [], objections: brut.objections ?? [] };
  } catch {
    return { ...FAITS_VIDES };
  }
}

/* ── « Où on en est » ───────────────────────────────────────────────────────── */

export type OuEnEst = {
  /** 📍 où en est le dossier, depuis quand, ce que le client a fait */
  situation: string;
  /** 👤 ce qu'il veut, ce qui le freine, qui décide */
  client: string;
  /** ➡️ la prochaine action, qui l'a en main, quand */
  suite: string;
  le: string;
  par: "REGLES" | "IA" | "TOI";
};

export const LONGUEUR_MAX_OU_EN_EST = 240;

export function lireOuEnEst(json: string | null | undefined): OuEnEst | null {
  try {
    const brut = JSON.parse(json || "{}") as Partial<OuEnEst>;
    if (!brut.situation) return null;
    return { situation: brut.situation, client: brut.client ?? "", suite: brut.suite ?? "", le: brut.le ?? "", par: brut.par ?? "REGLES" };
  } catch {
    return null;
  }
}

/* ── Journal ────────────────────────────────────────────────────────────────── */

export type ActeurJournal = "CLIENT" | "TOI" | "IA" | "CRM";
export const LIBELLES_ACTEUR_JOURNAL: Record<ActeurJournal, string> = { CLIENT: "Client", TOI: "Toi", IA: "IA", CRM: "CRM" };

export type LigneJournal = { cle: string; le: Date; acteur: ActeurJournal; texte: string };

/* ── Messages préparés ──────────────────────────────────────────────────────── */

export const STATUTS_MESSAGE = ["PREVU", "A_ENVOYER", "A_VALIDER", "ENVOYE", "NON_ENVOYE", "RETENU", "ANNULE"] as const;
export type StatutMessage = (typeof STATUTS_MESSAGE)[number];
export const STATUTS_OUVERTS: StatutMessage[] = ["PREVU", "A_ENVOYER", "A_VALIDER"];

export type CanalMessage = "SMS" | "MAIL" | "ESPACE";

export const RAISONS_NON_ENVOI = ["DEJA_FAIT_TELEPHONE", "PLUS_PERTINENT", "AUTRE"] as const;
export type RaisonNonEnvoi = (typeof RAISONS_NON_ENVOI)[number];
export const LIBELLES_RAISON_NON_ENVOI: Record<RaisonNonEnvoi, string> = {
  DEJA_FAIT_TELEPHONE: "Déjà fait par téléphone",
  PLUS_PERTINENT: "Plus pertinent",
  AUTRE: "Autre",
};

/** Ce que le moteur sait d'un message déjà préparé (pour ne pas le refaire et pour la garde). */
export type MessageConnu = {
  id: string;
  code: string;
  cle: string;
  statut: StatutMessage;
  prevuLe: Date;
  envoyeLe: Date | null;
  createdAt: Date;
  ouvertLe: Date | null;
  nonConfirmeLe: Date | null;
  reponse: boolean;
  douceur: boolean;
};

/* ── État lu d'un dossier ou d'un lead ──────────────────────────────────────── */

export type AppelLu = { le: Date; issue: string | null; repondu: boolean };
/** Ce qui est parti vers le client ; « TELEPHONE » : un message non envoyé parce que c'était « déjà fait par téléphone ». */
export type EnvoiLu = { le: Date; code: string | null; canal: "SMS" | "MAIL" | "ESPACE" | "TELEPHONE"; relance: boolean; etape: EtapeRelance | null; texte?: string | null };
export type MessageClientLu = { id: string; le: Date; texte: string; canal: "SMS" | "ESPACE" | "MAIL"; photos?: number };

export type EtatSuivi = {
  suiviId: string;
  lancement: Date;
  cible: { leadId: string | null; dossierId: string | null; clientId: string | null };
  nom: string;
  prenom: string | null;
  telephone: string | null;
  mobile: boolean;
  email: string | null;
  stop: boolean;
  piece: Piece;
  familles: string[];
  zone: Zone;
  ville: string | null;
  lead: null | {
    id: string;
    creeLe: Date;
    source: string;
    statut: string;
    tentatives: number;
    dernierAppelLe: Date | null;
    rappelLe: Date | null;
    perteLe: Date | null;
    motifPerte: string | null;
    archive: boolean;
    priorite: string | null;
  };
  dossier: null | {
    id: string;
    ouvertLe: Date;
    etape: string;
    perteLe: Date | null;
    motifPerte: string | null;
    dateChantier: Date | null;
    /** Minutes depuis minuit (Paris) quand l'heure du chantier est connue. */
    heureChantier: number | null;
    archive: boolean;
    main: string | null;
    mainMotif: string | null;
    prochaineAction: string | null;
    prochaineActionDate: Date | null;
    montantEstime: number | null;
  };
  espace: null | { ouvertLe: Date; premierAccesLe: Date | null; dernierAccesLe: Date | null; lienEmisLe: Date | null; lienCommunique: boolean };
  photos: { nombre: number; premiereLe: Date | null; derniereLe: Date | null };
  simulations: { id: string; publieeLe: Date; vueLe: Date | null; source: string }[];
  simulationsVuesLe: Date | null;
  simulationFaiteSurLeSite: boolean;
  devis: { id: string; numero: string | null; totalHt: number; enLigneLe: Date; premiereOuvertureLe: Date | null; consultations: number; consulteLe: Date | null }[];
  accord: { id: string; le: Date; documentId: string } | null;
  acompte: { id: string; le: Date } | null;
  chantierFiniLe: Date | null;
  avisLe: Date | null;
  consentementCommercial: boolean;
  appels: AppelLu[];
  tentativesSansReponse: number;
  /** Le client a écrit, appelé ou décroché : le dernier de ces gestes. */
  dernierGesteClientLe: Date | null;
  messagesClient: MessageClientLu[];
  /** Le client attend une réponse de Lucas (main épinglée « Répondre à… »). */
  attendReponse: boolean;
  /** Rappel daté posé par Lucas (lead ou dossier, ou pause du suivi). */
  rappel: { le: Date; motif: string } | null;
  pause: { jusquau: Date; motif: string | null } | null;
  envois: EnvoiLu[];
  premierSms: boolean;
  faits: Faits;
  messages: MessageConnu[];
  demarrageDoux: boolean;
  validationForcee: boolean;
};

/* ── Intentions du moteur ───────────────────────────────────────────────────── */

export type Intention = {
  code: CodeFile;
  cle: string;
  /** L'heure voulue, avant les horaires. */
  voulu: Date;
  variante: VarianteMessage;
  raison: string;
  sourceId?: string | null;
  simulationId?: string | null;
  /** Répond au client qui vient d'écrire : fenêtre de 8 h 30 à 21 h, garde passée. */
  reponse?: boolean;
  valeurs?: { nombre?: string; quand?: string; creneau_1?: string; creneau_2?: string; texte?: string };
};

export type Annulation = { messageId: string; motif: string };
