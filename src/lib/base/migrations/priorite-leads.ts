import type { MigrationDonnees } from "./index";
import { reclasserLesContactsActifs } from "@/lib/prospects/qualification";

/**
 * Priorité de rappel des contacts entrants (mission du 20/09/2026).
 *
 * 1. Pose la zone d'intervention si elle n'a jamais été saisie. Lucas l'a dite
 *    ainsi : « Hérault et proche ». L'Hérault est sûr ; « proche » est traduit
 *    par les départements limitrophes, à ajuster dans Paramètres → Suivi
 *    commercial (une nouvelle saisie remplace celle-ci, l'historique reste).
 * 2. Classe tous les contacts encore à traiter ou contactés.
 */
export const migrationPrioriteLeads: MigrationDonnees = {
  nom: "priorite-des-contacts-entrants",
  description: "Pose la zone d'intervention (Hérault et départements limitrophes) si elle manque, puis classe les contacts entrants actifs",
  executer: async (client) => {
    const valableDu = new Date("2026-01-01T00:00:00.000Z");
    const aPoser: [string, string, string][] = [
      ["ZONE_DEPARTEMENTS", "34", "Lucas, mission du 20/09/2026 : « ma zone (Hérault et proche) »"],
      ["ZONE_DEPARTEMENTS_PROCHES", "30, 11, 12, 81", "Agent, 21/09/2026 : « proche » traduit par les départements limitrophes de l'Hérault — à ajuster"],
    ];
    let parametresPoses = 0;
    for (const [cle, valeur, source] of aPoser) {
      if ((await client.parametre.count({ where: { cle } })) > 0) continue;
      await client.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu, source } });
      parametresPoses++;
    }
    const contactsClasses = await reclasserLesContactsActifs(client);
    return { parametresPoses, contactsClasses };
  },
};
