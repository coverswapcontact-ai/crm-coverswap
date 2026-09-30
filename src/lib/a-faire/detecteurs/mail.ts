import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur MAIL — les fils de la boîte pro « À traiter » (mail/vues.ts › `conversations`).
 *
 * TODO (lot 2, docs/TACHES.md § 3, mail/vues.ts › ligneDuFil) : un fil `aTraiter` →
 * - REPONDRE « Répondre · Nom » (niveau 1, 5 min) pour un mail humain ou client qui attend une réponse ; clé
 *   `REPONDRE:dossier:<id>` si le fil est rattaché à un dossier, `REPONDRE:lead:<id>` à un lead (fusion avec ESPACE_MESSAGES
 *   et DOSSIERS), sinon `REPONDRE:client:<id>` ou `LIRE_MAIL…` ; `raccourci: { genre: "MAIL", messageId }` et
 *   `donnees.messageIds` (les effets archivent ou reportent CES fils : reponses.ts) ;
 * - LIRE_MAIL « Lire · Expéditeur » (niveau 5, 1 min) pour un administratif non lu.
 * Un fil reporté (snooze futur) n'est PAS rendu : le moteur met alors la tâche en PLUS_TARD jusqu'à la date du report
 * (achevement.ts). Attention au « Revenu » collant (vues.ts : `revenu`) et aux paiements Stripe/Railway (mail/tri.ts : Railway est rangé d'office).
 */
export const detecteurMail: Detecteur = {
  source: "MAIL",
  async detecter() {
    return [];
  },
};
