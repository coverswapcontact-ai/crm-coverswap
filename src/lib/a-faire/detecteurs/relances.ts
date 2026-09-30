import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur RELANCES — les relances proposables (calculées, jamais stockées).
 *
 * TODO (lot 2, docs/TACHES.md § 3, relances/proposables.ts) : `relancesProposables(contexte.maintenant)` UNE fois →
 * - RELANCER_DEVIS « Relancer le devis · Nom » (niveau 2, 2 min) : raccourci RELANCE_MAIL (proposition du mail) ou SMS
 *   (`sms: { action: "RELANCE_DEVIS", dossierId, relance }`) ; clé `RELANCER_DEVIS:dossier:<id>:<documentId>:<rang>` ;
 * - RELANCER_PHOTOS « Relancer pour les photos · Nom » (niveau 3, 1 min) : SMS à copier.
 * Montant = `totalHt` du devis. Achèvement : la relance n'est plus proposable (trace SMS_COPIE ou MAIL_ENVOYE).
 */
export const detecteurRelances: Detecteur = {
  source: "RELANCES",
  async detecter() {
    return [];
  },
};
