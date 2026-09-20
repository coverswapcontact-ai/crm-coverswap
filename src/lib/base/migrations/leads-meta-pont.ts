import { lireNotesAcquisition, normaliserTelephone } from "@/lib/clients/normalisation";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { communeDuCodePostal, estCodePostal } from "@/lib/meta/communes";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Reprise des leads Meta arrivés par le pont Zapier avant le 20/09/2026.
 *
 * L'ancienne route écrivait un contact isolé : ni ligne MetaLead (donc absents
 * de l'écran Publicité), ni code postal (une ville réduite à « 78660 » restait
 * telle quelle), et la campagne, l'ensemble et la publicité étaient purement
 * ignorés. Cette migration reconstruit ce qui est reconstructible depuis ce qui
 * a été gardé — l'identifiant du lead, le formulaire, la page, la date — et
 * range le code postal là où il va.
 *
 * Ce qui n'a jamais été écrit ne s'invente pas : les leads d'avant cette date
 * n'auront pas de nom de campagne. Les suivants, oui.
 *
 * Idempotente : elle ne touche que ce qui n'a pas déjà été repris.
 */
const IDENTIFIANT_NOTES = /^(?:pont-[0-9a-f]{24}|\d{6,})$/;

async function rangerCodePostal(
  client: BaseDonnees,
  lead: { id: string; ville: string; codePostal: string | null }
): Promise<"range" | "deduit" | "rien"> {
  const ville = lead.ville.trim();
  if (!estCodePostal(ville)) return "rien";
  const commune = await communeDuCodePostal(ville);
  await client.lead.update({
    where: { id: lead.id },
    data: { codePostal: lead.codePostal ?? ville, ville: commune?.nom ?? "Non renseignée" },
  });
  return commune ? "deduit" : "range";
}

export const migrationLeadsMetaPont: MigrationDonnees = {
  nom: "leads-meta-pont",
  description: "Leads Meta du pont Zapier : ligne MetaLead reconstruite, code postal rangé, ville déduite",
  executer: async (client) => {
    const compteurs = { evenementsCrees: 0, codesPostauxRanges: 0, villesDeduites: 0, telephonesNormalises: 0 };

    const leads = await client.lead.findMany({
      where: { ...AVEC_ARCHIVES, source: "META_ADS" },
      select: { id: true, ville: true, codePostal: true, telephone: true, notes: true, metaLeadgenId: true, formulaire: true, campagne: true, publicite: true, createdAt: true },
      take: 2000,
    });

    for (const lead of leads) {
      const notes = lireNotesAcquisition(lead.notes);
      const leadgenId = lead.metaLeadgenId ?? notes.metaLeadgenId ?? null;

      // 1. Une ligne MetaLead, pour que le lead existe dans l'écran Publicité.
      if (leadgenId && IDENTIFIANT_NOTES.test(leadgenId)) {
        const deja = await client.metaLead.findUnique({ where: { leadgenId }, select: { id: true } });
        if (!deja) {
          await client.metaLead.create({
            data: {
              leadgenId,
              leadId: lead.id,
              statut: "TRAITE",
              traiteLe: new Date(),
              soumisLe: lead.createdAt,
              recuLe: lead.createdAt,
              pageId: notes.pageId ?? null,
              formId: notes.formulaireId ?? null,
              formNom: lead.formulaire ?? notes.formulaire ?? null,
              campagneNom: lead.campagne ?? notes.campagne ?? null,
              adNom: lead.publicite ?? notes.publicite ?? null,
            },
          });
          compteurs.evenementsCrees++;
        }
      }

      // 2. Une ville qui n'est qu'un code postal : rangée, et la commune déduite si possible.
      const range = await rangerCodePostal(client, lead);
      if (range === "deduit") compteurs.villesDeduites++;
      if (range !== "rien") compteurs.codesPostauxRanges++;

      // 3. Téléphone au format international, comme partout ailleurs.
      const normalise = normaliserTelephone(lead.telephone);
      if (normalise && normalise !== lead.telephone) {
        await client.lead.update({ where: { id: lead.id }, data: { telephone: normalise } });
        compteurs.telephonesNormalises++;
      }
    }

    return compteurs;
  },
};

/**
 * Le contact d'essai envoyé par Lucas le 20/09/2026 pour vérifier le pont
 * Zapier. Vérifié, puis archivé à sa demande — archivé, jamais supprimé : la
 * fiche reste consultable et la ligne MetaLead sort des compteurs de campagne.
 */
export const LEAD_ESSAI_PONT_20_09 = "cmu9seh1s0035xiqqbmk9pvpr";

export const migrationArchiverLeadEssaiPont: MigrationDonnees = {
  nom: "archiver-lead-essai-pont-20-09",
  description: "Archive le contact d'essai du pont Zapier du 20/09/2026",
  executer: async (client) => {
    const motif = "Contact d'essai du pont Zapier (20/09/2026), archivé après vérification";
    const lead = await client.lead.updateMany({
      where: { id: LEAD_ESSAI_PONT_20_09, archiveLe: null },
      data: { archiveLe: new Date(), archiveMotif: motif },
    });
    const evenement = await client.metaLead.updateMany({
      where: { leadId: LEAD_ESSAI_PONT_20_09, archiveLe: null },
      data: { archiveLe: new Date(), archiveMotif: motif },
    });
    return { contactArchive: lead.count, evenementArchive: evenement.count };
  },
};
