import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { TYPE_TACHE_DETECTION, TYPE_TACHE_EFFET } from "./signal";
import { ACTEUR_TACHES } from "./types";

/**
 * Mission 17 (partie A) : ce qui tourne en arrière-plan pour les tâches de Lucas (branché dans
 * taches/traitements.ts) :
 * - A_FAIRE_DETECTION : un passage des détecteurs, demandé par `signalerChangementTaches()` après un geste ;
 * - A_FAIRE_EFFET : l'effet d'une réponse sur sa source (reponses.ts › executerEffet), 6 s après la réponse ;
 * - le travail périodique « taches-a-faire » : un passage complet toutes les 15 minutes.
 * Les modules lourds sont importés à l'exécution : les détecteurs lisent des volets (assistant, espace, mail) qui
 * importent à leur tour la lecture des tâches de fond — un import statique ici ferait un cycle (taches/lecture.ts ›
 * enregistrerTousLesTraitements).
 */

export const NOM_TRAVAIL_TACHES = "taches-a-faire";
export const INTERVALLE_TACHES_MS = 15 * 60_000;

export function enregistrerTachesAFaire(): void {
  enregistrerTraitement(TYPE_TACHE_DETECTION, {
    libelle: "Tâches : passage des détecteurs après un geste",
    acteur: ACTEUR_TACHES,
    tentativesMax: 3,
    delaiMaxMs: 5 * 60_000,
    executer: async () => {
      const { passeComplete, resumePasse } = await import("./detection");
      const bilan = await passeComplete(new Date());
      return { resume: resumePasse(bilan), bilan };
    },
  });
  enregistrerTraitement(TYPE_TACHE_EFFET, {
    libelle: "Tâches : effet d'une réponse sur sa source (proposition, mail, espace, contact)",
    acteur: ACTEUR_TACHES,
    tentativesMax: 5,
    executer: async (charge) => {
      const { executerEffet } = await import("./reponses");
      return executerEffet(charge);
    },
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_TACHES,
    libelle: "Tâches de Lucas : détection et coche automatique, toutes les 15 minutes",
    acteur: ACTEUR_TACHES,
    intervalleMs: INTERVALLE_TACHES_MS,
    executer: async () => {
      const { passeComplete, resumePasse } = await import("./detection");
      const bilan = await passeComplete(new Date());
      if (bilan.sources.some((s) => !s.couverte) || bilan.reconciliation.crees + bilan.reconciliation.cochees > 0) console.log(`[a-faire] ${resumePasse(bilan)}`);
    },
  });
}
