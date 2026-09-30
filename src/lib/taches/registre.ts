/**
 * Registre des traitements de tâches et des travaux périodiques.
 *
 * Chaque volet déclare ses traitements dans src/lib/taches/traitements.ts
 * (import explicite, pas d'effet de bord caché) ; l'exécuteur ne connaît que
 * ce registre.
 */

/** Erreur après laquelle réessayer ne sert à rien (accès révoqué, donnée invalide). */
export class ErreurDefinitive extends Error {
  /** Marqueur lu par `estErreurDefinitive` (voir plus bas : `instanceof` ne suffit pas en production). */
  readonly erreurDefinitive = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ErreurDefinitive";
  }
}

/**
 * Une ressource extérieure manque (compte Google coupé, jeton expiré, accès à
 * redonner) : l'action n'échoue pas, elle ATTEND. La tâche est remise en file
 * sans compter d'essai, et repart d'elle-même quand la ressource revient
 * (reconnexion : les tâches en attente sont réveillées). Aucune action perdue.
 */
export class AttenteExterne extends Error {
  /** Marqueur lu par `estAttenteExterne` (voir plus bas). */
  readonly attenteExterne = true as const;
  constructor(
    message: string,
    readonly reprendreDansMs = 15 * 60_000
  ) {
    super(message);
    this.name = "AttenteExterne";
  }
}

/**
 * Reconnaissance STRUCTURELLE, pas seulement par classe. En production, le bundle de Next peut porter deux copies de
 * ce module (instrumentation d'un côté, routes de l'autre) : une erreur levée dans l'une n'est pas `instanceof` la
 * classe de l'autre. Vu le 30/09/2026 (mission 15) : une `ApiGoogleNonActivee` (une attente de 6 h) a été classée en
 * échec définitif par l'exécuteur. Le marqueur, lui, voyage avec l'objet.
 */
export function estAttenteExterne(erreur: unknown): erreur is AttenteExterne {
  if (erreur instanceof AttenteExterne) return true;
  if (typeof erreur !== "object" || erreur === null) return false;
  const e = erreur as { attenteExterne?: unknown; reprendreDansMs?: unknown };
  return e.attenteExterne === true && typeof e.reprendreDansMs === "number";
}

export function estErreurDefinitive(erreur: unknown): erreur is ErreurDefinitive {
  if (erreur instanceof ErreurDefinitive) return true;
  return typeof erreur === "object" && erreur !== null && (erreur as { erreurDefinitive?: unknown }).erreurDefinitive === true;
}

/** Préfixe des tâches en attente d'une ressource extérieure (réveillées ensemble). */
export const PREFIXE_ATTENTE = "[en attente] ";

export type ContexteTraitement = {
  tacheId: string;
  tentative: number;
  /** Déclenché quand le délai maximal est dépassé : arrêter proprement. */
  signal: AbortSignal;
};

export type Traitement = {
  /** Libellé français, affiché dans l'écran des tâches. */
  libelle: string;
  /** Acteur sous lequel les écritures du traitement sont journalisées. */
  acteur: string;
  /** Au-delà, la tentative est abandonnée (et réessayée plus tard). */
  delaiMaxMs?: number;
  tentativesMax?: number;
  /**
   * Mission 15 : « longue » pour une génération d'image (40 à 90 s) — exécutée
   * dans la voie longue de l'exécuteur (deux en parallèle au plus) sans bloquer
   * les tâches courtes (mails, Drive, notifications). « courte » par défaut.
   */
  voie?: "courte" | "longue";
  executer: (charge: unknown, contexte: ContexteTraitement) => Promise<unknown>;
};

export type TravailPeriodique = {
  nom: string;
  libelle: string;
  acteur: string;
  intervalleMs: number;
  /** Le travail tourne-t-il ? (variable d'environnement, paramètre, connexion Google…) */
  estActif?: () => Promise<boolean> | boolean;
  executer: (signal: AbortSignal) => Promise<void>;
};

const CLE = "__coverswapRegistreTaches";
type Registre = { traitements: Map<string, Traitement>; travaux: Map<string, TravailPeriodique> };
const globalAvecRegistre = globalThis as unknown as Record<string, Registre | undefined>;
const registre = (globalAvecRegistre[CLE] ??= { traitements: new Map(), travaux: new Map() });

export function enregistrerTraitement(type: string, traitement: Traitement): void {
  registre.traitements.set(type, traitement);
}

export function enregistrerTravailPeriodique(travail: TravailPeriodique): void {
  registre.travaux.set(travail.nom, travail);
}

export function traitementDe(type: string): Traitement | undefined {
  return registre.traitements.get(type);
}

/** Types de tâches de la voie longue (mission 15) : l'exécuteur les lit à part. */
export function typesDeVoieLongue(): string[] {
  return [...registre.traitements.entries()].filter(([, t]) => t.voie === "longue").map(([type]) => type);
}

export function travauxPeriodiques(): TravailPeriodique[] {
  return [...registre.travaux.values()];
}

export function typesDeTaches(): { type: string; libelle: string }[] {
  return [...registre.traitements.entries()].map(([type, traitement]) => ({ type, libelle: traitement.libelle }));
}
