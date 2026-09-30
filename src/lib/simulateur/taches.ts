import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { analyserCatalogueParLots } from "./catalogue";
import { surveillerCredit } from "./consommation";
import { DELAI_TACHE_API_MS, TACHE_SIMULATION_API, executerGenerationApi } from "./preparation";
import { pluriel } from "@/lib/commun/format";

/**
 * Simulateur du CRM en arrière-plan :
 *  - la génération par l'API (40 à 90 s) tourne en tâche de fond : l'écran du
 *    téléphone peut se mettre en veille, l'image arrive quand même en brouillon ;
 *    une seule tentative (une génération ratée est peut-être facturée : on ne
 *    relance pas sans que Lucas le décide) ;
 *  - la couleur de chaque échantillon du catalogue est mesurée peu à peu (les
 *    goûts du client proposent alors les bonnes teintes en premier) ;
 *  - le solde estimé du crédit OpenAI est surveillé.
 */
export function enregistrerTachesSimulateur(): void {
  enregistrerTraitement(TACHE_SIMULATION_API, {
    libelle: "Simulateur : génération d'une simulation par l'API",
    acteur: "SYSTEME:simulateur",
    tentativesMax: 1,
    delaiMaxMs: DELAI_TACHE_API_MS,
    // Mission 15 : voie longue de l'exécuteur (deux générations en parallèle, sans bloquer les tâches courtes).
    voie: "longue",
    executer: async (charge, { signal }) => executerGenerationApi((charge as { preparationId: string }).preparationId, signal),
  });
  enregistrerTravailPeriodique({
    nom: "catalogue-couleurs",
    libelle: "Simulateur : couleur mesurée des échantillons du catalogue",
    acteur: "SYSTEME:simulateur",
    intervalleMs: 60 * 60_000,
    executer: async (signal) => {
      const { analysees, restantes } = await analyserCatalogueParLots(60, signal);
      if (analysees > 0) console.log(`[simulateur] ${pluriel(analysees, "échantillon mesuré", "échantillons mesurés")}, ${pluriel(restantes, "restant")}`);
    },
  });
  enregistrerTravailPeriodique({
    nom: "credit-openai",
    libelle: "Simulateur : solde estimé du crédit OpenAI",
    acteur: "SYSTEME:simulateur",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      await surveillerCredit();
    },
  });
}
