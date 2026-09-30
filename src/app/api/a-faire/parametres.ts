import { ErreurMetier } from "@/lib/commun/erreurs";

/**
 * Mission 17 (partie A) — les paramètres d'adresse des routes /api/a-faire (tâches de Lucas). Toutes ces routes sont
 * derrière la session, comme le reste du pilotage : le proxy refuse par défaut ce qui n'est pas une route publique
 * (src/lib/acces/routes-publiques.ts) ; l'acteur des écritures est lu de la session (journal/acteur.ts).
 */

/** Identifiant d'une tâche (cuid). */
export function idDeTache(id: string): string {
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new ErreurMetier("Tâche introuvable.", 404);
  return id;
}

/** Clé d'un lot (« anciens-leads », « reprise »). */
export function cleDeLot(lot: string): string {
  const cle = decodeURIComponent(lot);
  if (!/^[a-z0-9:_-]{1,80}$/i.test(cle)) throw new ErreurMetier("Lot introuvable.", 404);
  return cle;
}
