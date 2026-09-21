import type { BaseDonnees } from "@/lib/prisma";
import { migrationAgentsProspection } from "./agents-prospection";
import { migrationClients } from "./clients";
import { migrationArchiverLeadEssaiPont, migrationLeadsMetaPont } from "./leads-meta-pont";
import { migrationLeadsEssai2109 } from "./leads-essai-21-09";
import { migrationLeadsEssai2109Detail } from "./leads-essai-21-09-detail";
import { journalEtatInitial } from "./journal-etat-initial";
import { migrationModelesSms } from "./modeles-sms";
import { migrationPrioriteLeads } from "./priorite-leads";
import { migrationPrioriteLeadsSimulation } from "./priorite-leads-simulation";
import { migrationRegistreNumeros } from "./registre-numeros";
import { migrationSimulationsDossiers } from "./simulations-dossiers";

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
export const MIGRATIONS_DONNEES: readonly MigrationDonnees[] = [journalEtatInitial, migrationClients, migrationRegistreNumeros, migrationAgentsProspection, migrationLeadsMetaPont, migrationArchiverLeadEssaiPont, migrationLeadsEssai2109, migrationLeadsEssai2109Detail, migrationPrioriteLeads, migrationModelesSms, migrationSimulationsDossiers, migrationPrioriteLeadsSimulation];
