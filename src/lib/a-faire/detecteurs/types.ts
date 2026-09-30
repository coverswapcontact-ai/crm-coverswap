/**
 * Mission 17 (partie A) : le contrat d'un détecteur de tâches (docs/TACHES.md § 2). Un détecteur LIT la base et rend
 * des `Detection` ; il n'écrit jamais (c'est le moteur, `a-faire/moteur.ts › reconcilier`, qui écrit). Pur côté types :
 * importable par les détecteurs comme par les essais.
 */

import type { Detection, SourceTache, SujetTache, TypeTache } from "../types";

/**
 * La clé d'une tâche, « TYPE:sujet » : `REPONDRE:dossier:<id>`, `APPELER:lead:<id>`, `SYSTEME:jeton-meta` (sujet
 * SYSTEME : la précision seule). Deux sources qui voient la même chose DOIVENT rendre la même clé (REPONDRE par mail,
 * par l'espace, par SMS → `REPONDRE:dossier:<id>`) : le moteur les fusionne en une seule tâche. `precision` distingue
 * deux tâches du même type sur le même sujet (`COHERENCE:dossier:<id>:MAIN_DECALEE`).
 */
export function cleTache(type: TypeTache, sujet: SujetTache, precision?: string | null): string {
  if (sujet.type === "SYSTEME") return [type, precision ?? sujet.id ?? "systeme"].join(":");
  return [type, sujet.type.toLowerCase(), sujet.id ?? "", ...(precision ? [precision] : [])].join(":");
}

/**
 * La prochaine action posée à la main (Lucas ou Claude) sur un dossier, encore en vigueur (`a-faire/vigueur.ts`) :
 * texte inchangé depuis, et aucun événement du client après. Tant qu'elle l'est, aucun détecteur ne crée de tâche sur
 * ce dossier, sauf la tâche PROCHAINE_ACTION (le jour de sa date) et les tâches SYSTEME.
 */
export type ActionManuelle = {
  dossierId: string;
  /** Le texte retenu (`Dossier.prochaineActionManuelle`). */
  action: string;
  /** La date de la prochaine action (`Dossier.prochaineActionDate`), null sans date. */
  date: Date | null;
  /** Quand elle a été posée (`Dossier.prochaineActionManuelleLe`). */
  le: Date;
  /** Qui l'a posée : HUMAIN:…, ASSISTANT:claude. */
  par: string | null;
};

export type ContexteDetection = {
  /** L'instant du passage : un détecteur ne lit jamais l'horloge lui-même (essais à instant fixe). */
  maintenant: Date;
  /** dossierId → prochaine action manuelle en vigueur. Le moteur écarte déjà les détections de ces dossiers (voir moteur.ts). */
  vigueur: Map<string /* dossierId */, ActionManuelle>;
};

/** Une tâche dont la condition propre est remplie (tâche MANUELLE à condition) : le moteur la coche, avec ce texte. */
export type Achevement = { cle: string; texte: string };

export type Detecteur = {
  /** La source couverte par ce détecteur : ses tâches absentes d'un passage réussi sont cochées par le CRM. */
  source: SourceTache;
  /** Les tâches vues maintenant. Une exception = la source n'est PAS couverte ce passage (rien n'est coché à tort). */
  detecter(contexte: ContexteDetection): Promise<Detection[]>;
  /** Facultatif : les tâches dont la condition propre est remplie (pour les tâches MANUELLE à condition). */
  acheves?(contexte: ContexteDetection): Promise<Achevement[]>;
};
