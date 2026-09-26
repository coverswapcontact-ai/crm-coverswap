import { enregistrerTraitement } from "@/lib/taches/registre";
import { enregistrerTachesRevocation } from "./revocation";
import { TACHE_ALERTE_PHOTOS, TACHE_ALERTE_PROJET, alerterPhotosDeposees, alerterProjetPrecise } from "./service";

/** Espace client en arrière-plan : une seule alerte pour un dépôt de photos en plusieurs envois, une pour le projet saisi à la frappe. */
export function enregistrerTachesEspace(): void {
  enregistrerTraitement(TACHE_ALERTE_PHOTOS, {
    libelle: "Espace client : alerte « photos reçues »",
    acteur: "SYSTEME:espace",
    tentativesMax: 3,
    executer: async (charge) => alerterPhotosDeposees((charge as { dossierId: string }).dossierId),
  });
  enregistrerTraitement(TACHE_ALERTE_PROJET, {
    libelle: "Espace client : alerte « projet précisé »",
    acteur: "SYSTEME:espace",
    tentativesMax: 3,
    executer: async (charge) => alerterProjetPrecise((charge as { espaceId: string }).espaceId),
  });
  // Mission 13 (lot 2) : lien désactivé 90 jours après l'encaissement du dernier chantier.
  enregistrerTachesRevocation();
}
