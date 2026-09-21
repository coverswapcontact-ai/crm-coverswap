import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { rattraperSimulationsSansDossier } from "./depuis-lead";

/** Filet : une simulation d'un contact qui a déjà un dossier, laissée hors de ce dossier par une erreur, y est rangée dans le quart d'heure. */
export function enregistrerTachesDossiers(): void {
  enregistrerTravailPeriodique({
    nom: "simulations-dossiers",
    libelle: "Simulations du site : rangées dans le dossier du contact quand il en a un",
    acteur: "SYSTEME:simulation-dossier",
    intervalleMs: 15 * 60_000,
    executer: async () => {
      const bilan = await rattraperSimulationsSansDossier(50);
      if (bilan.contacts > 0) console.log(`[dossiers] rattrapage des simulations : ${JSON.stringify(bilan)}`);
    },
  });
}
