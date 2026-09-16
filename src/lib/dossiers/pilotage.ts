// Lecture de l'état d'un dossier d'un coup d'œil : échéance de la prochaine
// action, qui a la main (moi ou le client), progression vers l'encaissement.
// Fonctions pures, partagées par le kanban, la liste et le panneau de détail.

import { ETAPES_ACTIVES, REGLES_ETAPES, type EtapeActive, type EtapeDossier } from "./constants";
import { estAujourdhui, joursDeRetard } from "./dates";
import { estEtapeActive, rangEtape } from "./regles";

type Datable = { etape: EtapeDossier; prochaineActionDate: string | null };

export type Echeance = "retard" | "aujourdhui" | "avenir" | "aucune";

export function echeanceDe(dossier: Datable, maintenant: Date): Echeance {
  if (!dossier.prochaineActionDate) return "aucune";
  // Un dossier perdu ou encaissé n'attend plus d'action : pas d'alerte de retard.
  if (dossier.etape === "PERDU" || dossier.etape === "ENCAISSE") return "avenir";
  if (joursDeRetard(dossier.prochaineActionDate, maintenant) > 0) return "retard";
  return estAujourdhui(dossier.prochaineActionDate, maintenant) ? "aujourdhui" : "avenir";
}

/**
 * Qui a la main maintenant.
 * - MOI        : l'étape attend une action de ma part ;
 * - CLIENT     : le dossier est entre les mains du client ;
 * - A_RELANCER : l'étape attend le client, mais la prochaine action est
 *                dépassée : c'est à moi de relancer ;
 * - AUCUNE     : dossier perdu.
 */
export type Main = "MOI" | "CLIENT" | "A_RELANCER" | "AUCUNE";

export function mainDe(dossier: Datable, maintenant: Date): Main {
  const responsable = REGLES_ETAPES[dossier.etape].responsable;
  if (responsable === null) return "AUCUNE";
  if (responsable === "MOI") return "MOI";
  return echeanceDe(dossier, maintenant) === "retard" ? "A_RELANCER" : "CLIENT";
}

/** Filtre « À faire » : les dossiers où j'ai la main, retards compris (même en pause). */
export function estAFaire(dossier: Datable, maintenant: Date): boolean {
  const main = mainDe(dossier, maintenant);
  return main === "MOI" || main === "A_RELANCER";
}

export type Progression = {
  numero: number; // 1 à 9
  total: number;
  /** Dossier perdu ou en pause : progression figée à l'étape quittée. */
  arrete: boolean;
  /** Étapes restant à franchir avant « Facturé » (0 une fois facturé). */
  etapesAvantFacturation: number;
};

export function progressionDe(etape: EtapeDossier, etapeAvantSortie: EtapeActive | null): Progression | null {
  const reference = estEtapeActive(etape) ? etape : etapeAvantSortie;
  if (!reference) return null;
  return {
    numero: rangEtape(reference) + 1,
    total: ETAPES_ACTIVES.length,
    arrete: !estEtapeActive(etape),
    etapesAvantFacturation: Math.max(0, rangEtape("FACTURE") - rangEtape(reference)),
  };
}
