import { enregistrerTachesRappels } from "@/lib/agenda/rappels";
import { enregistrerTachesSauvegardes } from "@/lib/base/taches";
import { enregistrerTachesClients } from "@/lib/clients/taches";
import { enregistrerTachesCoherence } from "@/lib/coherence/taches";
import { enregistrerTachesDossiers } from "@/lib/dossiers/taches";
import { enregistrerTachesDrive } from "@/lib/drive/synchronisation";
import { enregistrerTachesEncaissements } from "@/lib/encaissements/reprise";
import { enregistrerTachesEspace } from "@/lib/espace/taches";
import { enregistrerTachesRedimensionnement } from "@/lib/fichiers/redimensionnement";
import { enregistrerTachesMail } from "@/lib/mail/taches";
import { enregistrerTachesMessages } from "@/lib/messages/taches";
import { enregistrerTachesMeta } from "@/lib/meta/taches";
import { enregistrerTachesCorbeille } from "@/lib/prospects/corbeille";
import { enregistrerTachesRelances } from "@/lib/relances/service";
import { enregistrerTachesRgpd } from "@/lib/rgpd/conservation";
import { enregistrerTachesAnalyses } from "@/lib/simulateur/analyses";
import { enregistrerTachesSimulateur } from "@/lib/simulateur/taches";
import { enregistrerTachesSimulationSite } from "@/lib/simulations/travaux";
import { enregistrerTachesSms } from "@/lib/sms/taches";
import { enregistrerTachesSynthese } from "@/lib/synthese/instantanes";
import { enregistrerTachesValidation } from "@/lib/validation/taches";

/**
 * Point d'enregistrement unique des traitements et des travaux périodiques de
 * chaque volet, appelé au démarrage avant l'exécuteur (src/instrumentation.ts).
 * Un import explicite par volet : ce fichier est la liste de tout ce qui tourne
 * en arrière-plan.
 *
 * Mission 14 (partie 6) : le travail « relances-sms » (SMS de relance proposés
 * puis envoyés par le fournisseur) est retiré — les relances sont des SMS à
 * copier (`relances/proposables.ts`). Sa ligne `Planification` reste en base :
 * l'exécuteur et l'écran des tâches ne lisent que les travaux enregistrés.
 *
 * Mission 14 (partie 7) : les rappels — l'événement Google Agenda de chaque rappel
 * daté et la notification 10 minutes avant (tâches datées, pas de route cron).
 *
 * Mission 15 (partie 1) : la génération du simulateur du site (SIMULATION_SITE),
 * en voie longue avec SIMULATION_API : deux rendus en parallèle au plus, sans
 * bloquer les tâches courtes. Partie 2 : l'analyse d'une photo (ANALYSE_PHOTO),
 * lancée par le site dès la photo chargée, sur la même voie.
 */
export function enregistrerTousLesTraitements(): void {
  enregistrerTachesValidation();
  enregistrerTachesClients();
  enregistrerTachesEncaissements();
  enregistrerTachesRelances();
  enregistrerTachesSynthese();
  enregistrerTachesDrive();
  enregistrerTachesMessages();
  enregistrerTachesMail();
  enregistrerTachesRgpd();
  enregistrerTachesMeta();
  enregistrerTachesSms();
  enregistrerTachesEspace();
  enregistrerTachesDossiers();
  enregistrerTachesSimulateur();
  enregistrerTachesSimulationSite();
  enregistrerTachesAnalyses();
  enregistrerTachesCoherence();
  enregistrerTachesSauvegardes();
  enregistrerTachesCorbeille();
  enregistrerTachesRedimensionnement();
  enregistrerTachesRappels();
}
