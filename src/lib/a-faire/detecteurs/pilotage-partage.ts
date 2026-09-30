import { pilotageCommercial } from "@/lib/commercial/pilotage";
import type { PilotageCommercial } from "@/lib/commercial/types";

/**
 * Mission 17 (partie A) : `pilotageCommercial` lu UNE fois par passage pour DOSSIERS et LEADS, qui tournent ensemble
 * (`detection.ts › passeComplete` lance les détecteurs en parallèle). Seule la lecture en cours est partagée, pour le
 * même instant : elle est oubliée dès qu'elle aboutit, un passage suivant relit donc toujours la base (rien de périmé).
 */
const enCours = new Map<number, Promise<PilotageCommercial>>();

export function pilotageDuPassage(maintenant: Date): Promise<PilotageCommercial> {
  const cle = maintenant.getTime();
  const deja = enCours.get(cle);
  if (deja) return deja;
  // Sans limite : un contact ou un dossier non lu serait coché « par absence » (relecture).
  const lecture = pilotageCommercial(maintenant, { sansLimite: true }).finally(() => enCours.delete(cle));
  enCours.set(cle, lecture);
  return lecture;
}
