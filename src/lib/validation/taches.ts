import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { TENTATIVES_EXECUTION, TYPE_TACHE_EXECUTION, executerPropositionValidee, expirerPropositions } from "./service";

export function enregistrerTachesValidation(): void {
  enregistrerTraitement(TYPE_TACHE_EXECUTION, {
    libelle: "Exécution d'une proposition validée",
    // Remplacé, pendant l'exécution, par la personne qui a validé.
    acteur: "SYSTEME:validation",
    tentativesMax: TENTATIVES_EXECUTION,
    executer: executerPropositionValidee,
  });
  enregistrerTravailPeriodique({
    nom: "expiration-propositions",
    libelle: "Expiration des propositions échues",
    acteur: "SYSTEME:expiration",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      await expirerPropositions();
    },
  });
}
