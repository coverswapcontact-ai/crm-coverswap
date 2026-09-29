import { lancerRedimensionnement, photosARedimensionner } from "@/lib/fichiers/redimensionnement";
import type { MigrationDonnees } from "./index";

/**
 * Mission 13 (26/09/2026), lot 6 — les photos déjà déposées reçoivent leur
 * version 1 600 px et leur vignette : la migration met le premier lot en file
 * (tâche de fond `REDIMENSIONNER_PHOTOS`, 25 photos par lot, journalisée dans
 * Tâches de fond) ; la sauvegarde automatique précède, comme pour toute
 * migration. Les originaux partent hors ligne (originaux/), rien n'est effacé.
 */
export const migrationPhotosRedimensionnees13: MigrationDonnees = {
  nom: "photos-redimensionnees-13-6",
  description: "Les photos existantes reçoivent leur version 1 600 px et leur vignette, par lots de 25 en tâche de fond ; l'original part hors ligne",
  executer: async (client) => {
    const candidates = await photosARedimensionner();
    if (candidates.length === 0) return { candidates: 0, enFile: 0 };
    await lancerRedimensionnement(client);
    return { candidates: candidates.length, enFile: 1 };
  },
};
