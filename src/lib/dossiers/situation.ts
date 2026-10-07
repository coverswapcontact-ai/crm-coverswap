import { tachesDuDossier } from "@/lib/a-faire/lecture";
import { espacesDesDossiers } from "@/lib/espace/suivi";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import type { TacheVue } from "@/lib/a-faire/types";
import type { DossierDetail } from "./types";

/**
 * Mission 22 (A3) — ce que le panneau v2 ajoute au détail d'un dossier (`GET /api/dossiers/[id]`, ajout de champs) :
 * l'état de son espace client (`espacesDesDossiers`, la même lecture que la liste) et ses tâches (`tachesDuDossier`).
 * `chargerDetail` reste tel quel : les routes d'écriture (PATCH, étape, encaissements…) rendent le détail sans ces
 * deux champs, et l'écran garde les précédents.
 */
export async function situationDuDossier(dossierId: string, maintenant: Date = new Date()): Promise<{ espace: EspaceResume | null; taches: TacheVue[] }> {
  const [espaces, taches] = await Promise.all([espacesDesDossiers(maintenant, [dossierId]), tachesDuDossier(dossierId, maintenant)]);
  return { espace: espaces.get(dossierId) ?? null, taches };
}

/** Le détail d'un dossier complété de sa situation ; les champs du détail priment (`chargerDetail` ne pose ni `espace` ni `taches`). */
export async function completerDetail(detail: DossierDetail, maintenant: Date = new Date()): Promise<DossierDetail> {
  const situation = await situationDuDossier(detail.id, maintenant);
  return { ...situation, ...detail };
}
