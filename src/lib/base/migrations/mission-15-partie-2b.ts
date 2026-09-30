import type { MigrationDonnees } from "./index";
import { remettreEnAttenteAgenda } from "./mission-14-partie-9";

/**
 * Mission 15 (30/09/2026), après la partie 2 — en production, les tâches d'agenda remises en attente par la
 * migration 14-9 sont retombées en ECHEC_DEFINITIF à leur essai suivant : l'exécuteur n'a pas reconnu l'attente
 * (`instanceof` entre deux copies du module dans le bundle de Next). L'exécuteur reconnaît désormais l'attente par un
 * marqueur ; ces tâches sont remises en attente une seconde fois (même fonction, rejouable).
 */
export const migrationAgendaRappelsEnAttente15: MigrationDonnees = {
  nom: "agenda-rappels-en-attente-15-2b",
  description: "Tâches d'agenda retombées en échec « accessNotConfigured » remises en attente (l'exécuteur reconnaît l'attente par marqueur)",
  executer: (client) => remettreEnAttenteAgenda(client),
};
