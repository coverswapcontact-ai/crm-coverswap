import { relancesPhotosProposables, type RelancePhotos } from "./photos";
import { listerRelances, type DevisARelancer } from "./service";

/**
 * Mission 14 (29/09/2026), partie 6 — toutes les relances à faire aujourd'hui, en un endroit : les devis dont la
 * relance est proposable (SMS à copier sauf STOP, mail à valider s'il y a une adresse) et les espaces sans photo ni
 * simulation (hors STOP : leur relance n'est qu'un SMS).
 * Source unique de la feuille « Relances » (écran Leads), de la fiche du dossier (`dossierId`), de `GET
 * /api/relances`, et du point du jour (partie 7). Tout est proposé, rien n'est envoyé ni écrit.
 */
export type RelancesProposables = { devis: DevisARelancer[]; photos: RelancePhotos[]; total: number };

export async function relancesProposables(maintenant: Date = new Date(), filtre: { dossierId?: string } = {}): Promise<RelancesProposables> {
  const [{ devis }, photos] = await Promise.all([listerRelances(maintenant, filtre), relancesPhotosProposables(maintenant, filtre)]);
  // Un client en STOP n'a pas de SMS : sa relance n'est à faire ici que par le mail à relire (sinon : par téléphone, « voir_relances »).
  const proposables = devis.filter((d) => d.proposable && (!d.stop || d.mail !== null));
  return { devis: proposables, photos, total: proposables.length + photos.length };
}
