import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur ESPACE_MESSAGES — les messages du client dans son espace, non lus ou sans réponse.
 *
 * TODO (lot 2, docs/TACHES.md § 3, espace/messages.ts) : un dossier dont un `MessageEspace` CLIENT est non lu
 * (`luLe` nul) ou dont le dernier ESPACE_MESSAGE est sans réponse (`dossiers/main.ts › messageSansReponse`, qui compte
 * désormais REPONSE_INUTILE, REPONDU_HORS_CRM et PROCHAINE_ACTION_MANUELLE comme des réponses) → REPONDRE
 * « Répondre · Nom », niveau 1, clé `REPONDRE:dossier:<id>` (fusion avec MAIL), `raccourci: { genre: "ESPACE", dossierId }`,
 * `donnees.espaceDossierId = dossierId` (l'effet « Fait / Pas à faire » marque lus et écrit l'événement : reponses.ts).
 */
export const detecteurEspaceMessages: Detecteur = {
  source: "ESPACE_MESSAGES",
  async detecter() {
    return [];
  },
};
