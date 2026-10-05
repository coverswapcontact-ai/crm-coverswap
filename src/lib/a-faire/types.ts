/**
 * Mission 17 (partie A) — les tâches de Lucas : le contrat commun (types, codes, libellés, niveaux, durées de départ,
 * raisons de réponse). Pur : importable par les écrans comme par le serveur. Conception : docs/TACHES.md.
 */

export const TYPES_TACHE = [
  "REPONDRE",
  "LIRE_MAIL",
  "DATE_CHANTIER",
  "ENCAISSER",
  "DEMANDE_CLIENT",
  "RELANCER_DEVIS",
  "HESITE",
  "RAPPELER",
  "APPELER",
  "PROCHAINE_ACTION",
  "VALIDER",
  "SIMULATION",
  "PUBLIER",
  "DEVIS",
  "ENVOYER_DEVIS",
  "ENVOYER_LIEN",
  "RELANCER_PHOTOS",
  "RELANCER_AVIS",
  "REACTIVER",
  "DECIDER",
  "MANUELLE",
  "SYSTEME",
  "COHERENCE",
  "ECARTER",
  "CLASSER_LEAD",
] as const;
export type TypeTache = (typeof TYPES_TACHE)[number];

export const SOURCES_TACHE = ["DOSSIERS", "LEADS", "MAIL", "ESPACE_MESSAGES", "PROPOSITIONS", "RELANCES", "SIGNAUX", "COHERENCE", "SYSTEME", "MANUELLE"] as const;
export type SourceTache = (typeof SOURCES_TACHE)[number];

export const STATUTS_TACHE = ["A_FAIRE", "FAITE", "PLUS_TARD", "PAS_A_FAIRE"] as const;
export type StatutTache = (typeof STATUTS_TACHE)[number];

export const REPONSES_TACHE = ["FAIT", "PLUS_TARD", "PAS_A_FAIRE"] as const;
export type ReponseTache = (typeof REPONSES_TACHE)[number];

export type SujetTache = { type: "LEAD" | "DOSSIER" | "CLIENT" | "SYSTEME"; id: string | null };

/** 1 argent en jeu · 2 chaud · 3 production · 4 système urgent · 5 ménage. */
export type NiveauTache = 1 | 2 | 3 | 4 | 5;
export const LIBELLES_NIVEAU: Record<NiveauTache, string> = { 1: "Argent en jeu", 2: "Chaud", 3: "Production", 4: "Système", 5: "Ménage" };

/** Acteur des écritures automatiques (coche du CRM, détecteurs). */
export const ACTEUR_TACHES = "SYSTEME:taches-a-faire";

/** Temps de départ, en minutes, avant toute mesure (docs/TACHES.md § 3). */
export const DUREES_DEPART: Record<TypeTache, number> = {
  REPONDRE: 5,
  LIRE_MAIL: 1,
  DATE_CHANTIER: 3,
  ENCAISSER: 1,
  DEMANDE_CLIENT: 5,
  RELANCER_DEVIS: 2,
  HESITE: 3,
  RAPPELER: 3,
  APPELER: 3,
  PROCHAINE_ACTION: 3,
  VALIDER: 1,
  SIMULATION: 10,
  PUBLIER: 1,
  DEVIS: 10,
  ENVOYER_DEVIS: 2,
  ENVOYER_LIEN: 1,
  RELANCER_PHOTOS: 1,
  RELANCER_AVIS: 1,
  REACTIVER: 1,
  DECIDER: 2,
  MANUELLE: 5,
  SYSTEME: 5,
  COHERENCE: 1,
  ECARTER: 1,
  CLASSER_LEAD: 1,
};

/** Nom du groupe dans « j'ai N minutes » : « 3 appels · 10 min ». Singulier, pluriel. */
export const GROUPES_TYPE: Record<TypeTache, [string, string]> = {
  REPONDRE: ["réponse", "réponses"],
  LIRE_MAIL: ["mail à lire", "mails à lire"],
  DATE_CHANTIER: ["date de chantier", "dates de chantier"],
  ENCAISSER: ["encaissement", "encaissements"],
  DEMANDE_CLIENT: ["demande client", "demandes client"],
  RELANCER_DEVIS: ["relance", "relances"],
  HESITE: ["appel", "appels"],
  RAPPELER: ["appel", "appels"],
  APPELER: ["appel", "appels"],
  PROCHAINE_ACTION: ["action prévue", "actions prévues"],
  VALIDER: ["validation", "validations"],
  SIMULATION: ["simulation", "simulations"],
  PUBLIER: ["publication", "publications"],
  DEVIS: ["devis", "devis"],
  ENVOYER_DEVIS: ["devis à envoyer", "devis à envoyer"],
  ENVOYER_LIEN: ["SMS", "SMS"],
  RELANCER_PHOTOS: ["SMS", "SMS"],
  RELANCER_AVIS: ["SMS", "SMS"],
  REACTIVER: ["SMS", "SMS"],
  DECIDER: ["lead à trancher", "leads à trancher"],
  MANUELLE: ["tâche à moi", "tâches à moi"],
  SYSTEME: ["réglage", "réglages"],
  COHERENCE: ["correction", "corrections"],
  ECARTER: ["lead à classer", "leads à classer"],
  CLASSER_LEAD: ["lead à classer", "leads à classer"],
};

/** Les types regroupés sous « appels » dans « j'ai N minutes » (un même geste : tel:). */
export const FAMILLE_GROUPE: Partial<Record<TypeTache, string>> = { HESITE: "APPELS", RAPPELER: "APPELS", APPELER: "APPELS", ENVOYER_LIEN: "SMS", RELANCER_PHOTOS: "SMS", RELANCER_AVIS: "SMS", REACTIVER: "SMS" };

/* ── Raccourci : l'action prête à faire (un seul bouton principal) ─────────── */

export type GenreRaccourci =
  | "APPEL" // tel:, puis la fin d'appel à 4 boutons
  | "SMS" // écran SMS (copier vaut envoi)
  | "MAIL" // conversation mail, champ de réponse ouvert
  | "ESPACE" // fil de l'espace client, champ de réponse ouvert
  | "SIMULATEUR" // simulateur ouvert sur le dossier
  | "DEVIS" // devis prérempli (ou dépôt d'un PDF)
  | "RELANCE_MAIL" // aperçu du mail de relance (proposition)
  | "PLANIFIER" // créneaux libres, pose de la date du chantier
  | "ENCAISSER" // encaissement prérempli
  | "VALIDER" // Valider / Ignorer dans la ligne
  | "DOSSIER" // fiche du dossier (rubrique facultative)
  | "LEAD" // fiche du lead
  | "COHERENCE" // corriger en un geste
  | "PAGE"; // une page du CRM ou externe, avec la marche à suivre

export type Raccourci = {
  genre: GenreRaccourci;
  /** Libellé du bouton : « Appeler », « Faire le devis », « Copier le SMS ». */
  libelle: string;
  href?: string | null;
  telephone?: string | null;
  leadId?: string | null;
  dossierId?: string | null;
  messageId?: string | null;
  propositionId?: string | null;
  /** Rubrique du panneau dossier (photos, messages, devis, encaisser, historique, etape). */
  rubrique?: string | null;
  /** Écran SMS : la demande (action + cible + relance), jamais la proposition calculée d'avance. */
  sms?: { action: string; leadId?: string | null; dossierId?: string | null; relance?: unknown } | null;
  /** Devis : « nouveau » (prérempli) ou « pdf » (dépôt). */
  devis?: "nouveau" | "pdf" | null;
  /** Contrôle de cohérence : la clé à corriger. */
  cleCoherence?: string | null;
  /** Système : la marche à suivre en une ligne. */
  marche?: string | null;
  /** Lien externe (facturation Railway, Meta) : ouvert dans un nouvel onglet. */
  externe?: boolean;
};

/** Ce qu'un détecteur rend : une tâche vue, pas encore écrite. */
export type Detection = {
  cle: string;
  type: TypeTache;
  source: SourceTache;
  sujet: SujetTache;
  leadId?: string | null;
  dossierId?: string | null;
  clientId?: string | null;
  titre: string;
  raison: string;
  niveau: NiveauTache;
  montant?: number | null;
  depuis: Date;
  echeance?: Date | null;
  raccourci: Raccourci;
  donnees?: Record<string, unknown>;
  lot?: { cle: string; libelle: string } | null;
  /** Durée de départ propre à cette tâche (ex. simulation API : 2 min). */
  dureeMin?: number | null;
};

/* ── Réponses ─────────────────────────────────────────────────────────────── */

export const QUAND_PLUS_TARD = ["CE_SOIR", "DEMAIN", "LUNDI", "SEMAINE"] as const;
export type QuandPlusTard = (typeof QUAND_PLUS_TARD)[number];
export const LIBELLES_QUAND: Record<QuandPlusTard, string> = { CE_SOIR: "Ce soir", DEMAIN: "Demain", LUNDI: "Lundi", SEMAINE: "Dans une semaine" };

export const RAISONS_PLUS_TARD = ["ATTEND_CLIENT", "PAS_LE_TEMPS", "ATTEND_INFO"] as const;
export type RaisonPlusTard = (typeof RAISONS_PLUS_TARD)[number];
export const LIBELLES_RAISON_PLUS_TARD: Record<RaisonPlusTard, string> = { ATTEND_CLIENT: "J'attends le client", PAS_LE_TEMPS: "Pas le temps aujourd'hui", ATTEND_INFO: "J'attends une information" };

export const RAISONS_PAS_A_FAIRE = ["CLIENT_LE_FAIT", "DEJA_FAIT", "CLIENT_PERDU", "PAS_PERTINENT", "PAS_DE_REPONSE_A_FAIRE", "AUTRE"] as const;
export type RaisonPasAFaire = (typeof RAISONS_PAS_A_FAIRE)[number] | "SUJET_DISPARU" | "CLASSE_EN_LOT";
export const LIBELLES_RAISON_PAS_A_FAIRE: Record<RaisonPasAFaire, string> = {
  CLIENT_LE_FAIT: "Le client le fait lui-même",
  DEJA_FAIT: "Déjà fait hors CRM",
  CLIENT_PERDU: "Client perdu",
  PAS_PERTINENT: "Pas pertinent",
  PAS_DE_REPONSE_A_FAIRE: "Ne demande pas de réponse",
  AUTRE: "Autre",
  SUJET_DISPARU: "Plus d'actualité",
  CLASSE_EN_LOT: "Classé en lot",
};

/**
 * La liste courte adaptée au type (§ 2 de l'énoncé) : « client perdu » seulement quand il y a un client.
 * Mission 17 (partie A, relecture) : `aClient: false` (tâche sans dossier ni lead : un mail d'un inconnu, un fil sans
 * contact) retire « client perdu » — il n'y a personne à classer perdu (le serveur le refuse aussi). Sans option : la
 * liste du type.
 */
export function raisonsPasAFaire(type: TypeTache, options: { aClient?: boolean } = {}): RaisonPasAFaire[] {
  const raisons = raisonsDuType(type);
  return options.aClient === false ? raisons.filter((r) => r !== "CLIENT_PERDU") : raisons;
}

function raisonsDuType(type: TypeTache): RaisonPasAFaire[] {
  switch (type) {
    case "REPONDRE":
    case "LIRE_MAIL":
      return ["PAS_DE_REPONSE_A_FAIRE", "DEJA_FAIT", "CLIENT_PERDU", "AUTRE"];
    case "SIMULATION":
    case "DEVIS":
    case "PUBLIER":
      return ["CLIENT_LE_FAIT", "DEJA_FAIT", "CLIENT_PERDU", "PAS_PERTINENT", "AUTRE"];
    case "APPELER":
    case "RAPPELER":
    case "DECIDER":
    case "ECARTER":
    case "CLASSER_LEAD":
    case "HESITE":
    case "RELANCER_DEVIS":
    case "RELANCER_PHOTOS":
    case "ENVOYER_LIEN":
    case "ENVOYER_DEVIS":
      return ["DEJA_FAIT", "CLIENT_PERDU", "PAS_PERTINENT", "AUTRE"];
    // Mission 18 (A4) : un chantier fini, un contact déjà perdu — « client perdu » n'a pas de sens ici.
    case "RELANCER_AVIS":
    case "REACTIVER":
      return ["DEJA_FAIT", "PAS_PERTINENT", "AUTRE"];
    case "DATE_CHANTIER":
    case "ENCAISSER":
    case "DEMANDE_CLIENT":
    case "PROCHAINE_ACTION":
      return ["DEJA_FAIT", "CLIENT_LE_FAIT", "CLIENT_PERDU", "PAS_PERTINENT", "AUTRE"];
    case "VALIDER":
    case "SYSTEME":
    case "COHERENCE":
    case "MANUELLE":
      return ["DEJA_FAIT", "PAS_PERTINENT", "AUTRE"];
  }
}

/** Une tâche lue (écran, outils) : ce que l'API rend. */
export type TacheVue = {
  id: string;
  cle: string;
  type: TypeTache;
  source: SourceTache;
  sujetType: SujetTache["type"];
  sujetId: string | null;
  leadId: string | null;
  dossierId: string | null;
  clientId: string | null;
  /** Vrai si la tâche porte sur un dossier ou un lead : « client perdu » n'est proposé que dans ce cas (raisonsPasAFaire). */
  aClient: boolean;
  titre: string;
  raison: string;
  niveau: NiveauTache;
  montant: number | null;
  depuis: string;
  echeance: string | null;
  dureeMin: number;
  raccourci: Raccourci;
  donnees: Record<string, unknown>;
  lot: string | null;
  lotLibelle: string | null;
  statut: StatutTache;
  reponse: ReponseTache | null;
  reponseRaison: string | null;
  reponseTexte: string | null;
  reponduLe: string | null;
  /** « Lucas », « Claude » ou « le CRM ». */
  reponduParLisible: string | null;
  plusTardJusqua: string | null;
  revenueLe: string | null;
};

export type LotVue = { cle: string; libelle: string; nombre: number; dureeMin: number; types: TypeTache[] };

export type ListeTaches = {
  genereLe: string;
  aujourdhui: TacheVue[];
  /** Au-delà des 10 d'aujourd'hui, et les reportées (avec leur date de retour). */
  plusTard: TacheVue[];
  lots: LotVue[];
  faitAujourdhui: TacheVue[];
  /** Ce qui revient demain (reportées jusqu'à demain). */
  demain: number;
  compteurs: { aujourdhui: number; plusTard: number; enLot: number; faitAujourdhui: number; minutesAujourdhui: number };
};

/** « J'ai N minutes » : le meilleur ensemble qui tient, regroupé par type. */
export type GroupeMinutes = { famille: string; libelle: string; nombre: number; minutes: number; ids: string[] };
export type PlanMinutes = { minutes: number; utilisees: number; groupes: GroupeMinutes[]; taches: TacheVue[] };
export const CHOIX_MINUTES = [5, 15, 30, 60] as const;
