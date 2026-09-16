import { enregistrerTachesClients } from "@/lib/clients/taches";
import { enregistrerTachesEncaissements } from "@/lib/encaissements/reprise";
import { enregistrerTachesRelances } from "@/lib/relances/service";
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
}
