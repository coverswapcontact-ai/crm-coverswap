import type { BaseDonnees } from "@/lib/prisma";
import { migrationClients } from "./clients";
import { journalEtatInitial } from "./journal-etat-initial";
import { migrationRegistreNumeros } from "./registre-numeros";

export type MigrationDonnees = {
  /** Identifiant définitif : ne jamais renommer une migration déjà livrée. */
  nom: string;
  description: string;
  /**
   * Doit être idempotente : si le démarrage s'interrompt après son exécution
   * mais avant son enregistrement, elle est rejouée. Rend des compteurs.
   */
  executer: (client: BaseDonnees) => Promise<Record<string, number>>;
};

/** Dans l'ordre d'exécution. On ajoute à la fin, on ne retire ni ne réordonne jamais. */
export const MIGRATIONS_DONNEES: readonly MigrationDonnees[] = [journalEtatInitial, migrationClients, migrationRegistreNumeros];
