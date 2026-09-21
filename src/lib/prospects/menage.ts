import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ACTIONS_LEADS, LIBELLES_MOTIF_ARCHIVAGE, MOTIFS_ARCHIVAGE } from "./menage-constantes";

/**
 * Actions rapides sur les leads, depuis la liste, sans ouvrir la fiche :
 *  - archiver (avec un motif en un geste) : le lead sort de Leads et de la file ;
 *  - marquer comme traité : il sort de la file « à appeler », reste dans Leads.
 * Tout est réversible (restaurer, reprendre) ; rien ne se supprime, le journal
 * garde chaque changement. Un dossier déjà ouvert n'est jamais touché.
 */
export { ACTIONS_LEADS, LIBELLES_MOTIF_ARCHIVAGE, MOTIFS_ARCHIVAGE, type ActionLeads, type MotifArchivage } from "./menage-constantes";

export const schemaActionLeads = z
  .object({
    action: z.enum(ACTIONS_LEADS, "Action inconnue."),
    ids: z.array(z.string().min(1).max(40)).min(1, "Aucun lead choisi.").max(200, "200 leads au plus à la fois."),
    motif: z.enum(MOTIFS_ARCHIVAGE, "Motif d'archivage invalide.").optional(),
  })
  .refine((v) => v.action !== "ARCHIVER" || v.motif, "Choisis le motif de l'archivage.");

/** Rend les leads réellement changés : un lead déjà dans l'état demandé est laissé tel quel (rejouer ne change rien). */
export async function appliquerActionLeads(entree: z.output<typeof schemaActionLeads>, maintenant: Date = new Date()): Promise<{ ids: string[] }> {
  const ids = [...new Set(entree.ids)];
  // Lecture avec les archivés : restaurer doit les voir, archiver doit savoir qu'ils le sont déjà.
  const leads = await prisma.lead.findMany({ where: { id: { in: ids }, archiveLe: undefined }, select: { id: true, archiveLe: true, traiteLe: true } });
  if (leads.length === 0) throw new ErreurMetier("Lead introuvable.", 404);
  const changes: string[] = [];
  for (const lead of leads) {
    switch (entree.action) {
      case "ARCHIVER":
        if (lead.archiveLe) continue;
        await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: maintenant, archiveMotif: LIBELLES_MOTIF_ARCHIVAGE[entree.motif!] } });
        break;
      case "RESTAURER":
        if (!lead.archiveLe) continue;
        await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: null, archiveMotif: null } });
        break;
      case "TRAITER":
        if (lead.traiteLe || lead.archiveLe) continue;
        await prisma.lead.update({ where: { id: lead.id }, data: { traiteLe: maintenant } });
        break;
      case "REPRENDRE":
        if (!lead.traiteLe) continue;
        await prisma.lead.update({ where: { id: lead.id }, data: { traiteLe: null } });
        break;
    }
    changes.push(lead.id);
  }
  return { ids: changes };
}
