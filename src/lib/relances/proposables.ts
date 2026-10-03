import { relancesAvisProposables, type RelanceAvis } from "./avis";
import { relancesPhotosProposables, type RelancePhotos } from "./photos";
import { relancesReactivationProposables, type RelanceReactivation } from "./reactivation";
import { listerRelances, type DevisARelancer } from "./service";

/**
 * Mission 14 (29/09/2026), partie 6 — toutes les relances à faire aujourd'hui, en un endroit : les devis dont la
 * relance est proposable (SMS à copier sauf STOP, mail à valider s'il y a une adresse) et les espaces sans photo ni
 * simulation (hors STOP : leur relance n'est qu'un SMS).
 * Source unique de la feuille « Relances » (écran Leads), de la fiche du dossier (`dossierId`), de `GET
 * /api/relances`, et du point du jour (partie 7). Tout est proposé, rien n'est envoyé ni écrit.
 *
 * Mission 18 (A4) : un seul système de relance. S'y ajoutent la demande d'avis après chantier (`avis.ts`, SMS avec le
 * lien de l'espace) et la réactivation à 6 mois d'un contact perdu qui a donné son accord (`reactivation.ts`, SMS sans
 * lien) — les séquences de mails sont retirées. La réactivation porte sur un contact, pas sur un dossier : la fiche d'un
 * dossier (`dossierId`) n'en a pas.
 */
export type RelancesProposables = { devis: DevisARelancer[]; photos: RelancePhotos[]; avis: RelanceAvis[]; reactivations: RelanceReactivation[]; total: number };

export async function relancesProposables(
  maintenant: Date = new Date(),
  filtre: { dossierId?: string; smsPhotos?: boolean; smsDevis?: boolean; smsAvis?: boolean; smsReactivations?: boolean } = {}
): Promise<RelancesProposables> {
  // Mission 17 (partie A) : `smsPhotos: false` (détecteur des tâches) ne prépare pas le SMS des relances photos, qui
  // peut ouvrir un espace (relances/photos.ts) ; celui des devis n'écrit jamais (il n'ouvre aucun espace), mais
  // `smsDevis: false` évite une lecture par devis (relecture : le détecteur tourne toutes les 15 minutes).
  const [{ devis }, photos, avis, reactivations] = await Promise.all([
    listerRelances(maintenant, { dossierId: filtre.dossierId, sms: filtre.smsDevis }),
    relancesPhotosProposables(maintenant, { dossierId: filtre.dossierId, sms: filtre.smsPhotos }),
    relancesAvisProposables(maintenant, { dossierId: filtre.dossierId, sms: filtre.smsAvis }),
    filtre.dossierId ? Promise.resolve([]) : relancesReactivationProposables(maintenant, { sms: filtre.smsReactivations }),
  ]);
  // Un client en STOP n'a pas de SMS : sa relance n'est à faire ici que par le mail à relire (sinon : par téléphone, « voir_relances »).
  const proposables = devis.filter((d) => d.proposable && (!d.stop || d.mail !== null));
  return { devis: proposables, photos, avis, reactivations, total: proposables.length + photos.length + avis.length + reactivations.length };
}
