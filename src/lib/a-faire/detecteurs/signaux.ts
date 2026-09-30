import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur SIGNAUX — les signaux des espaces clients (espace/suivi.ts).
 *
 * TODO (lot 2, docs/TACHES.md § 3, espace/suivi.ts › listerEspaces) : `listerEspaces(contexte.maintenant)` UNE fois (coûteux) →
 * DEMANDE_CLIENT (PROPOSITION_DEMANDEE, SIMULATIONS_DEMANDEES, NOUVEAU_PROJET, PROJET_DEMANDE ; niveau 1), HESITE (devis
 * relu ≥ 4 fois sans signer ; niveau 2, tel:), PUBLIER (BROUILLONS ; niveau 3), ENVOYER_LIEN (NON_ENVOYE ; niveau 3,
 * SMS LIEN_ESPACE à copier), DATE_CHANTIER (DATE_A_FIXER ; même clé que DOSSIERS : `DATE_CHANTIER:dossier:<id>`).
 */
export const detecteurSignaux: Detecteur = {
  source: "SIGNAUX",
  async detecter() {
    return [];
  },
};
