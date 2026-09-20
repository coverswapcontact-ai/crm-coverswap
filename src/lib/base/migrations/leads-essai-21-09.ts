import type { MigrationDonnees } from "./index";

/**
 * Contacts d'essai envoyés par Lucas depuis Zapier les 20 et 21/09/2026.
 *
 * Avant de les archiver, la migration VÉRIFIE le second (passé par la chaîne
 * unifiée) et rend le constat sous forme de compteurs — 1 = renseigné, 0 =
 * manquant — que le démarrage écrit dans les journaux du serveur. Des nombres
 * seulement : ni nom, ni numéro, ni ville ne sortent de la base.
 */
export const LEADS_ESSAI_21_09 = ["cmua6do0m00ab7eyqanajfoqc", "cmu9seh1s0035xiqqbmk9pvpr"] as const;

export const migrationLeadsEssai2109: MigrationDonnees = {
  nom: "verifier-archiver-leads-essai-21-09",
  description: "Vérifie le contact d'essai du 21/09/2026 (ville, code postal, campagne, ensemble, publicité) puis archive les deux contacts d'essai",
  executer: async (client) => {
    const [aVerifier] = LEADS_ESSAI_21_09;
    const lead = await client.lead.findUnique({
      where: { id: aVerifier },
      select: { ville: true, codePostal: true, campagne: true, publicite: true, source: true, telephone: true, clientId: true },
    });
    const evenements = lead ? await client.metaLead.findMany({ where: { leadId: aVerifier, archiveLe: undefined }, select: { adsetId: true, adsetNom: true, campagneId: true, adId: true, pousseLe: true } }) : [];
    const oui = (condition: unknown) => (condition ? 1 : 0);
    const constat = {
      trouve: oui(lead),
      ville: oui(lead?.ville && !/^(non renseign|inconnue?$)/i.test(lead.ville) && !/^\d{5}$/.test(lead.ville.trim())),
      codePostal: oui(lead?.codePostal),
      campagne: oui(lead?.campagne),
      ensemble: oui(evenements.some((e) => e.adsetId || e.adsetNom)),
      publicite: oui(lead?.publicite),
      identifiantsMeta: oui(evenements.some((e) => e.campagneId && e.adId)),
      sourceMetaAds: oui(lead?.source === "META_ADS"),
      telephoneInternational: oui(lead?.telephone?.startsWith("+33")),
      clientRattache: oui(lead?.clientId),
      evenementsMeta: evenements.length,
    };

    const motif = "Contact d'essai Zapier (20-21/09/2026), archivé après vérification";
    const leads = await client.lead.updateMany({ where: { id: { in: [...LEADS_ESSAI_21_09] }, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: motif } });
    const meta = await client.metaLead.updateMany({ where: { leadId: { in: [...LEADS_ESSAI_21_09] }, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: motif } });
    return { ...constat, contactsArchives: leads.count, evenementsArchives: meta.count };
  },
};
