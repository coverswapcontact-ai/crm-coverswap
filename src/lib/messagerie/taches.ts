import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { mettreEnFile } from "@/lib/taches/file";

/**
 * Mission 25 — ce qui tourne en arrière-plan pour la messagerie (branché dans taches/traitements.ts) :
 * - MESSAGERIE_SCAN : le balayage de ce qui a bougé, demandé par `signalerMessagerie()` (appelé par
 *   `signalerChangementTaches()` après chaque geste, et à l'arrivée d'un lead) ;
 * - MESSAGERIE_ANALYSE : l'analyse d'un suivi (90 s après le dernier message d'un client, 2 s sinon) ;
 * - MESSAGERIE_ECHEANCE : les messages dus à cette heure-là (une tâche par quart d'heure : l'alerte arrive à l'heure
 *   prévue, à 5 minutes près) ;
 * - le travail périodique « messagerie-moteur » : le passage de 15 minutes (rattrapage, suivis à créer ou à revoir,
 *   garde de silence, 19 h 30, alertes).
 * L'IA n'est appelée que par une analyse, donc par un événement : jamais en boucle.
 */
export const ACTEUR_MESSAGERIE = "SYSTEME:messagerie";
export const NOM_TRAVAIL_MOTEUR = "messagerie-moteur";
export const INTERVALLE_MOTEUR_MS = 15 * 60_000;
export const DELAI_BALAYAGE_MS = 4_000;

export function enregistrerTachesMessagerie(): void {
  enregistrerTraitement("MESSAGERIE_SCAN", {
    libelle: "Messagerie : repérer ce qui a bougé et demander les analyses",
    acteur: ACTEUR_MESSAGERIE,
    executer: async () => {
      const { balayer } = await import("./moteur");
      return { analyses: await balayer(new Date()) };
    },
  });
  enregistrerTraitement("MESSAGERIE_ANALYSE", {
    libelle: "Messagerie : analyser un dossier (faits, journal, Où on en est, messages préparés)",
    acteur: ACTEUR_MESSAGERIE,
    executer: async (charge) => {
      const { suiviId } = (charge ?? {}) as { suiviId?: string };
      if (!suiviId) return { ignore: true };
      const { analyserSuivi } = await import("./analyse");
      const r = await analyserSuivi(suiviId, new Date());
      return { crees: r.crees.length, annules: r.annules, ia: r.ia };
    },
  });
  enregistrerTraitement("MESSAGERIE_ECHEANCE", {
    libelle: "Messagerie : messages dus à cette heure (garde de silence, alerte)",
    acteur: ACTEUR_MESSAGERIE,
    executer: async () => {
      const { traiterEcheances } = await import("./moteur");
      return traiterEcheances(new Date());
    },
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_MOTEUR,
    libelle: "Messagerie : relances dues, garde de silence, alertes, toutes les 15 minutes",
    acteur: ACTEUR_MESSAGERIE,
    intervalleMs: INTERVALLE_MOTEUR_MS,
    executer: async () => {
      const { passeMoteur } = await import("./moteur");
      const bilan = await passeMoteur(new Date());
      if (bilan.crees || bilan.aEnvoyer || bilan.nonConfirmes) console.log(`[messagerie] ${bilan.crees} suivis créés, ${bilan.revus} revus, ${bilan.aEnvoyer} messages à envoyer, ${bilan.nonConfirmes} non confirmés`);
    },
  });
}

/**
 * « Quelque chose a bougé » : un balayage dans 4 s (une seule tâche pour une rafale de gestes). Jamais bloquant, jamais
 * d'exception : le passage de 15 minutes rattrape.
 */
export async function signalerMessagerie(): Promise<void> {
  try {
    await mettreEnFile({ type: "MESSAGERIE_SCAN", cle: "messagerie:scan", mode: "RECONCILIATION", apres: new Date(Date.now() + DELAI_BALAYAGE_MS), tentativesMax: 3 });
  } catch (erreur) {
    console.error("[messagerie] balayage non demandé :", erreur);
  }
}
