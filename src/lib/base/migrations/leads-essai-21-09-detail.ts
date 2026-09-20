import type { MigrationDonnees } from "./index";
import { LEADS_ESSAI_21_09 } from "./leads-essai-21-09";

/**
 * Le constat du 21/09 disait : pas de campagne, pas de code postal, téléphone
 * non normalisé. Avant de conclure que le Zap est mal réglé, on regarde ce que
 * Zapier avait transmis pour ce lead — en compteurs seulement (1 = présent).
 * Un lead de l'outil de test de Meta arrive sans publicité et avec un numéro
 * factice : `pageId`/`formId` présents et tout le reste absent le signe.
 */
export const migrationLeadsEssai2109Detail: MigrationDonnees = {
  nom: "constat-detail-lead-essai-21-09",
  description: "Détaille, en compteurs, ce que Zapier avait transmis pour le contact d'essai du 21/09/2026",
  executer: async (client) => {
    const [id] = LEADS_ESSAI_21_09;
    const lead = await client.lead.findUnique({ where: { id }, select: { telephone: true, ville: true, notes: true, metaLeadgenId: true } });
    const evenement = await client.metaLead.findFirst({ where: { leadId: id, archiveLe: undefined } });
    const oui = (v: unknown) => (v ? 1 : 0);
    let nbReponses = 0;
    try {
      nbReponses = evenement?.reponses ? (JSON.parse(evenement.reponses) as unknown[]).length : 0;
    } catch {
      nbReponses = -1;
    }
    const chiffres = (lead?.telephone ?? "").replace(/\D/g, "");
    return {
      trouve: oui(lead),
      leadgenId: oui(lead?.metaLeadgenId),
      leadgenIdDuPont: oui(evenement?.leadgenId?.startsWith("pont-")),
      pageId: oui(evenement?.pageId),
      formId: oui(evenement?.formId),
      formNom: oui(evenement?.formNom),
      campagneId: oui(evenement?.campagneId),
      campagneNom: oui(evenement?.campagneNom),
      adsetId: oui(evenement?.adsetId),
      adsetNom: oui(evenement?.adsetNom),
      adId: oui(evenement?.adId),
      adNom: oui(evenement?.adNom),
      nbReponses,
      telephoneNbChiffres: chiffres.length,
      telephoneFrancais: oui(/^(33|0)[1-9]\d{8}$/.test(chiffres)),
      villeDeduiteDuCodePostal: oui(/déduite du code postal/.test(lead?.notes ?? "")),
      traiteParLaChaineUnifiee: oui(evenement?.notifications !== undefined && evenement?.traiteLe),
    };
  },
};
