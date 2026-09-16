/**
 * Registre des traitements de tâches et des travaux périodiques.
 *
 * Chaque volet déclare ses traitements dans src/lib/taches/traitements.ts
 * (import explicite, pas d'effet de bord caché) ; l'exécuteur ne connaît que
 * ce registre.
 */

/** Erreur après laquelle réessayer ne sert à rien (accès révoqué, donnée invalide). */
export class ErreurDefinitive extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurDefinitive";
  }
}

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

export function travauxPeriodiques(): TravailPeriodique[] {
  return [...registre.travaux.values()];
}

export function typesDeTaches(): { type: string; libelle: string }[] {
  return [...registre.traitements.entries()].map(([type, traitement]) => ({ type, libelle: traitement.libelle }));
}
