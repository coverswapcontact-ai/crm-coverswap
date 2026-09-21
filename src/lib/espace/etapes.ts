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
  projet: boolean;
  /** Simulations publiées préparées par Lucas (hors celles faites sur le site). */
  simulationsCrm: number;
  simulationsSite: number;
  choix: boolean;
  devis: boolean;
  accord: boolean;
  acompteRecu: boolean;
  etapeDossier: string;
};

export function etapeEspace(f: FaitsEspace): EtapeEspace {
  if (["FACTURE", "ENCAISSE"].includes(f.etapeDossier)) return "TERMINE";
  if (["PLANIFIE", "CHANTIER"].includes(f.etapeDossier)) return "CHANTIER";
  if (f.accord) return f.acompteRecu ? "CHANTIER" : "ACOMPTE";
  if (f.devis) return "DEVIS";
  if (f.simulationsCrm > 0 && !f.choix) return "SIMULATIONS";
  if (f.photos === 0 && f.simulationsSite === 0) return "PHOTOS";
  if (!f.projet) return "PROJET";
  if (f.choix) return "ATTENTE_DEVIS";
  if (f.simulationsCrm > 0) return "SIMULATIONS";
  return "ATTENTE_SIMULATION";
}

export const ETAPES_PROGRESSION = [
  { cle: "PHOTOS", libelle: "Photos" },
  { cle: "PROJET", libelle: "Projet" },
  { cle: "SIMULATIONS", libelle: "Simulation" },
  { cle: "DEVIS", libelle: "Devis" },
  { cle: "ACOMPTE", libelle: "Acompte" },
] as const;
export type CleProgression = (typeof ETAPES_PROGRESSION)[number]["cle"];

/** Les cinq étapes, faites ou non, et celle où se trouve le client. */
export function progression(f: FaitsEspace): { cle: CleProgression; libelle: string; fait: boolean; courante: boolean }[] {
  const etape = etapeEspace(f);
  const fait: Record<CleProgression, boolean> = {
    PHOTOS: f.photos > 0 || f.simulationsSite > 0,
    PROJET: f.projet,
    SIMULATIONS: f.choix || f.accord,
    DEVIS: f.accord,
    ACOMPTE: f.acompteRecu || ["PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(f.etapeDossier),
  };
  const courante: CleProgression | null =
    etape === "PHOTOS" ? "PHOTOS"
    : etape === "PROJET" ? "PROJET"
    : etape === "SIMULATIONS" || etape === "ATTENTE_SIMULATION" ? "SIMULATIONS"
    : etape === "DEVIS" || etape === "ATTENTE_DEVIS" ? "DEVIS"
    : etape === "ACOMPTE" ? "ACOMPTE"
    : null;
  return ETAPES_PROGRESSION.map((e) => ({ cle: e.cle, libelle: e.libelle, fait: fait[e.cle], courante: e.cle === courante }));
}

export const LIBELLES_ETAPE_ESPACE: Record<EtapeEspace, string> = {
  PHOTOS: "Photos attendues",
  PROJET: "Projet à préciser",
  SIMULATIONS: "Choix de la simulation",
  ATTENTE_SIMULATION: "Simulation en préparation",
  ATTENTE_DEVIS: "Devis en préparation",
  DEVIS: "Devis à signer",
  ACOMPTE: "Acompte attendu",
  CHANTIER: "Chantier",
  TERMINE: "Terminé",
};
