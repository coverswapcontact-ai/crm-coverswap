/**
 * Où en est le client dans son espace — règle unique, partagée par l'espace
 * (ce qu'il voit en grand en arrivant) et par l'onglet Espaces clients du CRM.
 * Fonctions pures, sans base : testées telles quelles.
 *
 * Une seule chose à faire à la fois, dans cet ordre de priorité : ce qui fait
 * signer passe devant ce qui précise. Un devis en attente d'accord l'emporte
 * sur des photos manquantes ; des simulations publiées à choisir l'emportent
 * sur un projet pas encore précisé.
 *
 * Mission 14 (29/09/2026) : l'étape du DOSSIER fixe la frontière du devis — une
 * seule source pour l'espace et le dossier. Facturé ou encaissé : terminé ;
 * planifié ou chantier : chantier ; accord ou dossier signé : paiement (ou
 * chantier si l'acompte est reçu) ; devis envoyé ou relance : « Devis à signer »
 * s'il y a un devis en vigueur, sinon « Devis en préparation » ; qualification
 * ou simulation : jamais « Devis à signer » (le choix, les simulations, les
 * photos, le projet décident). En pause ou perdu : l'ordre d'avant, devis compris.
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
  if (f.accord || f.etapeDossier === "SIGNE") return f.acompteRecu ? "CHANTIER" : "ACOMPTE";
  if (["DEVIS_ENVOYE", "RELANCE"].includes(f.etapeDossier)) return f.devis ? "DEVIS" : "ATTENTE_DEVIS";
  // Qualification ou simulation : le dossier n'a pas envoyé de devis, l'espace ne le dit pas « à signer ».
  if (f.devis && !["QUALIFICATION", "SIMULATION"].includes(f.etapeDossier)) return "DEVIS";
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
    // Un devis établi ou signé : les photos et le projet sont derrière lui (Lucas a pu les prendre sur place).
    PHOTOS: f.photos > 0 || f.simulationsSite > 0 || f.accord,
    PROJET: projetFait(f) || f.devis || f.accord,
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

/**
 * Mission 14 (partie 6) : ce que le client a vraiment à faire quand la main lui est passée par un lien (espace
 * ouvert, lien envoyé) — d'après l'étape de son espace, la source unique. Une simulation du site publiée dans son
 * espace le fait sortir de PHOTOS ; une simulation qu'il a faite sans qu'elle soit publiée chez lui (rendu absent,
 * pas encore rangée, brouillon…) le laisse à l'étape PHOTOS, mais `simulation` (la règle partagée avec la relance
 * photos, `espace/simulations-faites.ts`) fait dire « en attente de son projet » : il n'est jamais « en attente de
 * ses photos » s'il en a fait une.
 */
export function attenteDuClient(etape: EtapeEspace, faits: { simulation?: boolean } = {}): string {
  switch (etape) {
    case "PHOTOS":
      return faits.simulation ? "Espace ouvert : en attente de son projet" : "Espace ouvert : en attente de ses photos";
    case "PROJET":
      return "Espace ouvert : en attente de son projet";
    case "SIMULATIONS":
      return "Espace ouvert : en attente de son choix de simulation";
    case "DEVIS":
      return "Devis envoyé : en attente de sa réponse";
    case "ACOMPTE":
      return "Accord donné : en attente de son paiement";
    default:
      return LIBELLES_ETAPE_ESPACE[etape];
  }
}
