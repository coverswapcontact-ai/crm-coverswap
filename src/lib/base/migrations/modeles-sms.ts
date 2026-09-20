import type { MigrationDonnees } from "./index";
import { poserModelesParDefaut } from "@/lib/sms/modeles";

/**
 * Messages types de la messagerie SMS (mission du 20/09/2026) : posés une fois,
 * jamais réécrits — Lucas les corrige ensuite dans Paramètres. L'accusé de
 * réception reprend son texte, mot pour mot, complété de la mention d'arrêt et
 * de l'annonce du nouveau numéro qu'il a demandées.
 */
export const migrationModelesSms: MigrationDonnees = {
  nom: "messages-types-sms",
  description: "Pose les messages types de la messagerie SMS (accusé de réception, lien de l'espace client, relances)",
  executer: async (client) => ({ modelesPoses: await poserModelesParDefaut(client) }),
};
