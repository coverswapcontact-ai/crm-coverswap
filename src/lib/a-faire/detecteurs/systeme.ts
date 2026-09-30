import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur SYSTEME — ce qui bloque le CRM et que Lucas seul peut régler.
 *
 * TODO (lot 2, docs/TACHES.md § 3 ; sources : meta/sante.ts, simulateur/consommation.ts, google/connexion.ts, taches/file.ts) : SYSTEME « (verbe) · (quoi) », niveau 4 si urgent sinon 5, sujet
 * `{ type: "SYSTEME", id: null }`, clé `cleTache("SYSTEME", sujet, "jeton-meta")` (`SYSTEME:jeton-meta`,
 * `SYSTEME:credit-openai`, `SYSTEME:numerotation-factures:<annee>`, `SYSTEME:tache-fond:<id>`…), raccourci PAGE avec
 * `marche` (une ligne) et `externe` pour Railway/Meta. Lire les sources directement, pas `santeSysteme` (ids perdus).
 * Une tâche SYSTEME n'est jamais écartée par une prochaine action manuelle ; répondue à la main, elle revient si la
 * condition tient encore 24 h après (moteur.ts).
 */
export const detecteurSysteme: Detecteur = {
  source: "SYSTEME",
  async detecter() {
    return [];
  },
};
