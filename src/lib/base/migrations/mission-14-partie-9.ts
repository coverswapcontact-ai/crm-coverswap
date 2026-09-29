import { TACHE_AGENDA_RAPPEL } from "@/lib/agenda/rappels";
import { pluriel } from "@/lib/commun/format";
import { API_CALENDAR, ATTENTE_API_NON_ACTIVEE_MS, MARQUE_API_NON_ACTIVEE, messageAttenteApiNonActivee } from "@/lib/google/connexion";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 9 — en production, les tâches AGENDA_RAPPEL de la partie 7 sont toutes en
 * ECHEC_DEFINITIF : « Accès refusé par Google (accessNotConfigured) ». La connexion a bien la portée agenda, mais l'API
 * Google Calendar n'est pas activée dans le projet Google Cloud ; `appelGoogle` classait tout 403 en définitif. Depuis
 * cette partie, ce 403-là fait ATTENDRE la tâche (6 h entre deux essais). Ici, les tâches déjà en échec pour cette raison
 * sont remises en attente (prochain essai dans 6 h, sans compter d'essai), avec le message qu'une tâche en attente porte
 * désormais — Paramètres → Connexions et `sante_systeme` le lisent. Rejouable : une tâche remise n'est plus en échec.
 */

const NOM = "agenda-rappels-en-attente-14-9";

export async function remettreEnAttenteAgenda(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  const { count } = await client.tache.updateMany({
    where: { type: TACHE_AGENDA_RAPPEL, statut: "ECHEC_DEFINITIF", derniereErreur: { contains: MARQUE_API_NON_ACTIVEE } },
    data: {
      statut: "EN_ATTENTE",
      prochainEssaiLe: new Date(maintenant.getTime() + ATTENTE_API_NON_ACTIVEE_MS),
      derniereErreur: messageAttenteApiNonActivee(API_CALENDAR, null),
      termineLe: null,
      verrouJusqua: null,
    },
  });
  console.info(`[migration ${NOM}] ${pluriel(count, "tâche d'agenda remise en attente", "tâches d'agenda remises en attente")} (API Google Calendar à activer dans le projet Google Cloud)`);
  return { remisesEnAttente: count };
}

export const migrationAgendaRappelsEnAttente14: MigrationDonnees = {
  nom: NOM,
  description: "Tâches d'agenda en échec « accessNotConfigured » (API Google Calendar non activée) remises en attente, nouvel essai dans 6 h",
  executer: (client) => remettreEnAttenteAgenda(client),
};
