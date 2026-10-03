import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { rattraperSimulationsSansDossier } from "./depuis-lead";

/**
 * Filet : une simulation ou une photo d'un contact qui a déjà un dossier, laissée hors de ce dossier par une erreur, y est
 * rangée dans le quart d'heure ; mission 18 (A2) : le dossier d'un contact qui a fait quelque chose sur le site ces deux
 * derniers jours, et qu'une erreur n'a pas ouvert, s'ouvre.
 */
export function enregistrerTachesDossiers(): void {
  enregistrerTravailPeriodique({
    nom: "simulations-dossiers",
    libelle: "Site : dossiers ouverts tout seuls (simulation, photos, demande de devis), images rangées dans le dossier",
    acteur: "SYSTEME:simulation-dossier",
    intervalleMs: 15 * 60_000,
    executer: async () => {
      const bilan = await rattraperSimulationsSansDossier(50);
      if (bilan.contacts > 0) console.log(`[dossiers] rattrapage des simulations : ${JSON.stringify(bilan)}`);
    },
  });
}
