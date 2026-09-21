import type { MigrationDonnees } from "./index";
import { rattraperSimulationsSansDossier } from "@/lib/dossiers/depuis-lead";

/**
 * Règle du 21/09/2026 : une simulation faite sur le site (coordonnées + photo)
 * ouvre un dossier, avec la photo avant et chaque rendu dans ses photos de
 * chantier — donc dans Drive. Cette migration applique la règle aux simulations
 * déjà en base. Les contacts archivés (essais, doublons) sont laissés de côté.
 * Rejouable : une simulation rangée porte son dossier et n'est jamais recopiée.
 */
export const migrationSimulationsDossiers: MigrationDonnees = {
  nom: "simulations-du-site-vers-dossiers",
  description: "Ouvre le dossier de chaque contact ayant une simulation du site, et y range la photo avant et les rendus",
  executer: async () => ({ ...(await rattraperSimulationsSansDossier(1000)) }),
};
