import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur COHERENCE — les incohérences du contrôle quotidien (coherence/controle.ts).
 *
 * TODO (lot 2, docs/TACHES.md § 2 et § 3, coherence/controle.ts) : `controlerCoherence()` est coûteux — au plus une fois par
 * heure, résultat gardé en mémoire (globalThis) entre deux passages ; chaque incohérence → COHERENCE « Corriger · Nom »
 * (niveau 5, 1 min), clé `COHERENCE:<cle de l'incohérence>` (stable), raccourci COHERENCE (`cleCoherence`) si
 * `correction` non nulle, sinon DOSSIER. MAIL_SANS_REPONSE recoupe REPONDRE : ne pas le rendre (MAIL / ESPACE_MESSAGES
 * le couvrent). Une exception ici = source non couverte : rien n'est coché à tort.
 */
export const detecteurCoherence: Detecteur = {
  source: "COHERENCE",
  async detecter() {
    return [];
  },
};
