import { enregistrerTachesSauvegardes } from "@/lib/base/taches";
import { enregistrerTachesClients } from "@/lib/clients/taches";
import { enregistrerTachesCoherence } from "@/lib/coherence/taches";
import { enregistrerTachesCommerciales } from "@/lib/commercial/relances";
import { enregistrerTachesDossiers } from "@/lib/dossiers/taches";
import { enregistrerTachesDrive } from "@/lib/drive/synchronisation";
import { enregistrerTachesEncaissements } from "@/lib/encaissements/reprise";
import { enregistrerTachesEspace } from "@/lib/espace/taches";
import { enregistrerTachesMail } from "@/lib/mail/taches";
import { enregistrerTachesMessages } from "@/lib/messages/taches";
import { enregistrerTachesMeta } from "@/lib/meta/taches";
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
  enregistrerTachesCommerciales();
  enregistrerTachesDossiers();
  enregistrerTachesSimulateur();
  enregistrerTachesCoherence();
  enregistrerTachesSauvegardes();
}
