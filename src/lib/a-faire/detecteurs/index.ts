import { detecteurCoherence } from "./coherence";
import { detecteurDossiers } from "./dossiers";
import { detecteurEspaceMessages } from "./espace-messages";
import { detecteurLeads } from "./leads";
import { detecteurMail } from "./mail";
import { detecteurManuelles } from "./manuelles";
import { detecteurPropositions } from "./propositions";
import { detecteurRelances } from "./relances";
import { detecteurSignaux } from "./signaux";
import { detecteurSysteme } from "./systeme";
import type { Detecteur } from "./types";

export type { Achevement, ActionManuelle, ContexteDetection, Detecteur } from "./types";
export { cleTache } from "./types";

/**
 * Mission 17 (partie A) : tous les détecteurs, un par source (un fichier chacun). `a-faire/detection.ts › passeComplete`
 * les lance ; un détecteur qui lève n'arrête pas les autres, et sa source n'est pas couverte ce passage.
 */
export const DETECTEURS: Detecteur[] = [
  detecteurDossiers,
  detecteurLeads,
  detecteurMail,
  detecteurEspaceMessages,
  detecteurPropositions,
  detecteurRelances,
  detecteurSignaux,
  detecteurCoherence,
  detecteurSysteme,
  detecteurManuelles,
];
