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
import { enregistrerTachesSimulateur } from "@/lib/simulateur/taches";
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
  enregistrerTachesCoherence();
  enregistrerTachesSauvegardes();
  enregistrerTachesCorbeille();
  enregistrerTachesRedimensionnement();
}
