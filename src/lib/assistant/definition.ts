import type { z } from "zod/v4";

/**
 * La couche d'outils de l'assistant (mission 8) : chaque action métier du CRM
 * devient un outil — un nom, une description en français qui dit ce qu'il fait
 * et quand s'en servir, des paramètres typés — que le serveur MCP expose à
 * l'application Claude, et qu'un assistant intégré au CRM pourra reprendre
 * tel quel. Un outil ne porte AUCUNE logique métier : il appelle le code de
 * `src/lib` et met le résultat en mots.
 *
 * Trois niveaux, marqués sur chaque outil :
 * - LECTURE : libre.
 * - REVERSIBLE : exécuté directement (note, étiquette, planification,
 *   changement d'étape, archivage d'un seul élément), annulable par l'outil
 *   inverse.
 * - SENSIBLE : jamais exécuté sans confirmation (mail ou lien à un client,
 *   facture, encaissement, action en masse). L'outil rend d'abord un aperçu
 *   précis et n'agit qu'à un second appel, avec le jeton de confirmation.
 */

export const NIVEAUX_OUTIL = ["LECTURE", "REVERSIBLE", "SENSIBLE"] as const;
export type NiveauOutil = (typeof NIVEAUX_OUTIL)[number];

export const LIBELLES_NIVEAU: Record<NiveauOutil, string> = {
  LECTURE: "Lecture",
  REVERSIBLE: "Écriture réversible",
  SENSIBLE: "Sensible (confirmation)",
};

export type LienOutil = { libelle: string; href: string };

/** Ce qu'un outil rend : lisible d'abord (Claude le lit à voix haute), les données à côté. */
export type ResultatOutil = {
  texte: string;
  donnees?: unknown;
  liens?: LienOutil[];
  /** Action sensible : l'aperçu a été rendu, rien n'a été fait ; ce jeton confirme au second appel. */
  confirmation?: { jeton: string; expireLe: string };
};

export type ContexteOutil = {
  sessionId: string;
  /** La phrase de Lucas, telle que Claude la transmet : elle entre dans le journal. */
  commande: string | null;
  /** E-mail de la personne qui a autorisé l'application Claude. */
  utilisateur: string;
  maintenant: Date;
};

export type DefinitionOutil<E = Record<string, unknown>> = {
  /** Nom stable, en français sans accent, minuscules et tirets bas (`chercher`, `noter_appel`). */
  nom: string;
  titre: string;
  /** Ce que fait l'outil, précisément, et quand l'utiliser — c'est ce que Claude lit. */
  description: string;
  niveau: NiveauOutil;
  schema: z.ZodType<E>;
  /** Nombre d'éléments touchés : au-delà de trois, l'action devient sensible (aperçu, puis confirmation). */
  masse?: (entree: E) => number;
  /** Sensible selon l'entrée (passer un dossier à « Signé », « Facturé », « Encaissé » ou « Perdu » ; valider une proposition qui touche un montant). */
  sensible?: (entree: E) => boolean | Promise<boolean>;
  /** Action sensible : la phrase exacte de ce qui va être fait, rendue avant toute exécution. */
  apercu?: (entree: E, contexte: ContexteOutil) => Promise<string>;
  executer: (entree: E, contexte: ContexteOutil) => Promise<ResultatOutil>;
};

/** Aide au typage : `definirOutil({ … })` infère le type de l'entrée depuis le schéma. */
export function definirOutil<E extends Record<string, unknown>>(definition: DefinitionOutil<E>): DefinitionOutil<E> {
  return definition;
}

/** Adresse publique du CRM (liens rendus par les outils). */
export function adresseCrm(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
}

export const lien = (libelle: string, chemin: string): LienOutil => ({ libelle, href: `${adresseCrm()}${chemin}` });

const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const jour = (valeur: string | Date | null | undefined) => (valeur ? new Date(valeur).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : "—");
const jourCourt = (valeur: string | Date | null | undefined) => (valeur ? new Date(valeur).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }) : "—");
const pourcent = (valeur: number | null) => (valeur === null ? "—" : `${Math.round(valeur * 100)} %`);

/** Petits formats partagés par les outils (texte lu à voix haute : pas de sigles, des mots). */
export const format = { euros, jour, jourCourt, pourcent };
