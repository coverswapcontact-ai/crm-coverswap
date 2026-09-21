import { poserModelesParDefaut } from "@/lib/sms/modeles";
import type { MigrationDonnees } from "./index";

/**
 * Passe 2 de la mission espace client (21/09/2026, soir) : le message type
 * « lien de l'espace, il a fait une simulation sur le site » est posé. Les
 * messages déjà en base ne sont jamais réécrits (Lucas a pu les retoucher).
 */
export const migrationSmsLienSimulation: MigrationDonnees = {
  nom: "sms-lien-simulation-21-09",
  description: "Message type LIEN_ESPACE_SIMULATION (le client a déjà une simulation du site)",
  executer: async (client) => ({ modelesPoses: await poserModelesParDefaut(client) }),
};
