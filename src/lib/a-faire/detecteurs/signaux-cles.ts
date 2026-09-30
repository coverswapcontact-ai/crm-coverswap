import type { CodeSignal } from "@/lib/espace/suivi-types";
import type { TypeTache } from "../types";
import { cleTache } from "./types";

/**
 * Mission 17 (partie A) : la tâche que porte chaque signal d'un espace client (espace/suivi.ts). Pur, et partagé par
 * le détecteur SIGNAUX (qui crée la tâche) et la vue des espaces (qui masque le signal d'une tâche écartée) : les deux
 * DOIVENT lire la même clé.
 * - Par projet (dossier) : PROPOSITION_DEMANDEE et SIMULATIONS_DEMANDEES → DEMANDE_CLIENT ; PHOTOS_SANS_SIMULATION →
 *   SIMULATION (la clé du détecteur des dossiers : la fusion s'en charge) ; BROUILLONS → PUBLIER ; HESITE → HESITE ;
 *   DATE_A_FIXER → DATE_CHANTIER ; NON_ENVOYE, JAMAIS_OUVERT, EXPIRE, EXPIRE_BIENTOT → ENVOYER_LIEN.
 * - Par client : NOUVEAU_PROJET et PROJET_DEMANDE → DEMANDE_CLIENT sur le client.
 * - CONFIRMATION_DEMANDEE (téléphone à confirmer à la prochaine visite) ne demande rien à Lucas : pas de tâche.
 */
export const TYPE_DU_SIGNAL: Record<CodeSignal, TypeTache | null> = {
  PROPOSITION_DEMANDEE: "DEMANDE_CLIENT",
  SIMULATIONS_DEMANDEES: "DEMANDE_CLIENT",
  PHOTOS_SANS_SIMULATION: "SIMULATION",
  BROUILLONS: "PUBLIER",
  HESITE: "HESITE",
  DATE_A_FIXER: "DATE_CHANTIER",
  NON_ENVOYE: "ENVOYER_LIEN",
  JAMAIS_OUVERT: "ENVOYER_LIEN",
  EXPIRE: "ENVOYER_LIEN",
  EXPIRE_BIENTOT: "ENVOYER_LIEN",
  NOUVEAU_PROJET: "DEMANDE_CLIENT",
  PROJET_DEMANDE: "DEMANDE_CLIENT",
  CONFIRMATION_DEMANDEE: null,
};

/** Les signaux portés par le client (son espace permanent), pas par un de ses projets. */
export const SIGNAUX_DU_CLIENT: readonly CodeSignal[] = ["NOUVEAU_PROJET", "PROJET_DEMANDE", "CONFIRMATION_DEMANDEE"];

/** La clé de la tâche d'un signal : sur le dossier du projet, ou sur le client pour un signal du client. Null : pas de tâche. */
export function cleDuSignal(code: CodeSignal, cible: { dossierId?: string | null; clientId?: string | null }): string | null {
  const type = TYPE_DU_SIGNAL[code];
  if (!type) return null;
  if (SIGNAUX_DU_CLIENT.includes(code)) return cible.clientId ? cleTache(type, { type: "CLIENT", id: cible.clientId }) : null;
  return cible.dossierId ? cleTache(type, { type: "DOSSIER", id: cible.dossierId }) : null;
}
