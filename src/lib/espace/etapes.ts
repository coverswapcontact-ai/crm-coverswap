/**
 * Où en est le client dans son espace — règle unique, partagée par l'espace
 * (ce qu'il voit en grand en arrivant) et par l'onglet Espaces clients du CRM.
 * Fonctions pures, sans base : testées telles quelles.
 *
 * Une seule chose à faire à la fois, dans cet ordre de priorité : ce qui fait
 * signer passe devant ce qui précise. Un devis en attente d'accord l'emporte
 * sur des photos manquantes ; des simulations publiées à choisir l'emportent
 * sur un projet pas encore précisé.
 */

export type EtapeEspace =
  | "PHOTOS"
  | "PROJET"
  | "SIMULATIONS"
  | "ATTENTE_SIMULATION"
  | "ATTENTE_DEVIS"
  | "DEVIS"
  | "ACOMPTE"
  | "CHANTIER"
  | "TERMINE";

export type FaitsEspace = {
  photos: number;
  /** Il a dit quelque chose de son projet (zones, taille ou note). */
  projet: boolean;
  /** Il l'a VALIDÉ (pastille verte) ; absent = anciens appelants : on se fie à `projet`. */
  projetValide?: boolean;
  /** Simulations publiées préparées par Lucas (hors celles faites sur le site ou par le client dans son espace). */
  simulationsCrm: number;
  simulationsSite: number;
  /** Simulations créées par le client lui-même, dans son espace (v3). */
  simulationsClient?: number;
  choix: boolean;
  devis: boolean;
  accord: boolean;
  acompteRecu: boolean;
  /** Tout est encaissé. */
  solde?: boolean;
  etapeDossier: string;
};

const projetFait = (f: FaitsEspace) => f.projetValide ?? f.projet;

/**
 * Espace v3 (21/09/2026, soir) : le client crée lui-même ses simulations ; il
 * n'attend plus Lucas pour en voir une. L'étape « ATTENTE_SIMULATION » n'est
 * plus produite (gardée dans le type pour les anciens écrans).
 */
export function etapeEspace(f: FaitsEspace): EtapeEspace {
  if (["FACTURE", "ENCAISSE"].includes(f.etapeDossier)) return "TERMINE";
  if (["PLANIFIE", "CHANTIER"].includes(f.etapeDossier)) return "CHANTIER";
  if (f.accord) return f.acompteRecu ? "CHANTIER" : "ACOMPTE";
  if (f.devis) return "DEVIS";
  if (f.choix) return "ATTENTE_DEVIS";
  // Une simulation préparée par Lucas l'attend : c'est elle d'abord, même sans ses photos.
  if (f.simulationsCrm > 0) return "SIMULATIONS";
  if (f.photos === 0 && f.simulationsSite === 0) return "PHOTOS";
  if (!projetFait(f)) return "PROJET";
  return "SIMULATIONS";
}

export const ETAPES_PROGRESSION = [
  { cle: "PHOTOS", libelle: "Photos" },
  { cle: "PROJET", libelle: "Projet" },
  { cle: "SIMULATIONS", libelle: "Simulations" },
  { cle: "DEVIS", libelle: "Devis" },
  { cle: "ACOMPTE", libelle: "Paiement" },
] as const;
export type CleProgression = (typeof ETAPES_PROGRESSION)[number]["cle"];

/** Ce qui débloque un onglet verrouillé, dit au client. */
export const RAISONS_VERROU: Partial<Record<CleProgression, string>> = {
  DEVIS: "Validez une simulation pour recevoir votre devis.",
  ACOMPTE: "Le paiement s'ouvre après votre accord sur le devis.",
};

/** Les cinq onglets : faits ou non, verrouillés ou non (et pourquoi), et celui où se trouve le client. */
export function progression(f: FaitsEspace): { cle: CleProgression; libelle: string; fait: boolean; courante: boolean; verrouillee: boolean; raison: string | null }[] {
  const etape = etapeEspace(f);
  const fait: Record<CleProgression, boolean> = {
    PHOTOS: f.photos > 0 || f.simulationsSite > 0,
    PROJET: projetFait(f),
    SIMULATIONS: f.choix || f.accord,
    DEVIS: f.accord,
    ACOMPTE: f.acompteRecu || ["PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(f.etapeDossier),
  };
  const verrouillee: Record<CleProgression, boolean> = {
    PHOTOS: false,
    PROJET: false,
    SIMULATIONS: false,
    // Un devis émis (même sans simulation validée, après un appel) ouvre l'onglet.
    DEVIS: !f.choix && !f.devis && !f.accord,
    ACOMPTE: !f.accord,
  };
  const courante: CleProgression | null =
    etape === "PHOTOS" ? "PHOTOS"
    : etape === "PROJET" ? "PROJET"
    : etape === "SIMULATIONS" || etape === "ATTENTE_SIMULATION" ? "SIMULATIONS"
    : etape === "DEVIS" || etape === "ATTENTE_DEVIS" ? "DEVIS"
    : etape === "ACOMPTE" ? "ACOMPTE"
    : null;
  return ETAPES_PROGRESSION.map((e) => ({ cle: e.cle, libelle: e.libelle, fait: fait[e.cle], courante: e.cle === courante, verrouillee: verrouillee[e.cle], raison: verrouillee[e.cle] ? (RAISONS_VERROU[e.cle] ?? null) : null }));
}

export const LIBELLES_ETAPE_ESPACE: Record<EtapeEspace, string> = {
  PHOTOS: "Photos attendues",
  PROJET: "Projet à valider",
  SIMULATIONS: "Simulations : à valider",
  ATTENTE_SIMULATION: "Simulation en préparation",
  ATTENTE_DEVIS: "Devis en préparation",
  DEVIS: "Devis à signer",
  ACOMPTE: "Paiement attendu",
  CHANTIER: "Chantier",
  TERMINE: "Terminé",
};
