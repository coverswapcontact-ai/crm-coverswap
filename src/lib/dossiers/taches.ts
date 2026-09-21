import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { rattraperSimulationsSansDossier } from "./depuis-lead";

/** Filet : une simulation qu'une erreur aurait laissée sans dossier est reprise dans le quart d'heure. */
export function enregistrerTachesDossiers(): void {
  enregistrerTravailPeriodique({
    nom: "simulations-dossiers",
    libelle: "Simulations du site : dossier ouvert et photos rangées",
    acteur: "SYSTEME:simulation-dossier",
    intervalleMs: 15 * 60_000,
    executer: async () => {
      const bilan = await rattraperSimulationsSansDossier(50);
      if (bilan.contacts > 0) console.log(`[dossiers] rattrapage des simulations : ${JSON.stringify(bilan)}`);
    },
  });
}
