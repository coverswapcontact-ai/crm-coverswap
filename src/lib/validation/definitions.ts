import type { z } from "zod/v4";
import type { Transaction } from "@/lib/prisma";
import type { ChampModifiable, MotifRejet } from "./types";

export type ContexteExecution = {
  propositionId: string;
  /** Personne qui a validé (ou acteur d'une exécution automatique autorisée). */
  decidePar: string;
  /** Transaction de la validation (exécution IMMEDIATE seulement). */
  tx?: Transaction;
};

export type ResultatExecution = {
  /** Gardé sur la proposition (JSON). */
  resultat?: unknown;
  /** Effets à lancer une fois la transaction validée (jamais bloquants). */
  apresValidation?: () => Promise<void>;
};

export type DefinitionProposition<C = Record<string, unknown>> = {
  type: string;
  libelle: string;
  schema: z.ZodType<C>;
  /**
   * Engage de l'argent ou part chez un client (étape Signé, facturation,
   * encaissement, perte, envoi d'un mail…) : jamais exécutée sans décision
   * humaine, jamais validée en lot. Peut dépendre du contenu.
   */
  sensible: boolean | ((contenu: C) => boolean);
  /** « Tout valider » permis (jamais pour une proposition sensible). */
  validationGroupee: boolean;
  /**
   * Exécution sans validation permise quand la confiance est très haute
   * (archiver du bruit, noter un événement certain). Refusée d'office si la
   * proposition est sensible.
   */
  automatisable?: boolean;
  champs?: ChampModifiable[];
  motifsRejet?: MotifRejet[];
  /** IMMEDIATE : dans la transaction de la validation. FILE : par la file de tâches (services extérieurs). */
  execution: "IMMEDIATE" | "FILE";
  executer: (contenu: C, contexte: ContexteExecution) => Promise<ResultatExecution | void>;
  /** Encore pertinente ? Rend le motif qui la rend sans objet, ou null. */
  pertinente?: (contenu: C) => Promise<string | null>;
};

/** Aide au typage : `definirProposition({ … })` infère le type du contenu depuis le schéma. */
export function definirProposition<C extends Record<string, unknown>>(
  definition: DefinitionProposition<C>
): DefinitionProposition<C> {
  return definition;
}

export function estSensible<C>(definition: DefinitionProposition<C>, contenu: C): boolean {
  return typeof definition.sensible === "function" ? definition.sensible(contenu) : definition.sensible;
}
