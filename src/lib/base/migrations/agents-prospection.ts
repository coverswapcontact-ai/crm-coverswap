import { assurerAgentsProspection } from "@/lib/prospection/agents";
import type { MigrationDonnees } from "./index";

/** Les agents de prospection existent partout où le pilotage tourne (la production n'avait jamais lancé le seed). */
export const migrationAgentsProspection: MigrationDonnees = {
  nom: "2026-09-17-agents-prospection",
  description: "Crée les agents de prospection hôtels et restaurants s'ils manquent, sans toucher à une configuration existante",
  async executer(client) {
    return { agentsCrees: await assurerAgentsProspection(client) };
  },
};
