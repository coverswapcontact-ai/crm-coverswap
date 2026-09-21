import { enregistrerTraitement } from "@/lib/taches/registre";
import { TACHE_ALERTE_PHOTOS, alerterPhotosDeposees } from "./service";

/** Espace client en arrière-plan : une seule alerte pour un dépôt de photos fait en plusieurs envois. */
export function enregistrerTachesEspace(): void {
  enregistrerTraitement(TACHE_ALERTE_PHOTOS, {
    libelle: "Espace client : alerte « photos reçues »",
    acteur: "SYSTEME:espace",
    tentativesMax: 3,
    executer: async (charge) => alerterPhotosDeposees((charge as { dossierId: string }).dossierId),
  });
}
