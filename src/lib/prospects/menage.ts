import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { signalerChangementTaches } from "@/lib/a-faire/signal";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { synchroniserRappels } from "@/lib/agenda/rappels";
import { ACTIONS_LEADS, LIBELLES_MOTIF_ARCHIVAGE, MOTIFS_ARCHIVAGE } from "./menage-constantes";

/**
 * Actions rapides sur les leads, depuis la liste, sans ouvrir la fiche :
 * archiver (avec un motif en un geste) — le lead sort des deux listes —, ou
 * restaurer. Mission 14 (partie 3) : « traité / reprendre » n'existe plus ; un
 * lead ne sort des listes que vers un dossier, en « sans suite » ou archivé.
 * Rien ne se supprime, le journal garde chaque changement. Un dossier déjà
 * ouvert n'est jamais touché.
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
  const leads = await prisma.lead.findMany({ where: { id: { in: ids }, archiveLe: undefined }, select: { id: true, archiveLe: true } });
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
    }
    changes.push(lead.id);
  }
  // Mission 14 (partie 7) : un lead archivé perd l'événement de son rappel ; restauré, il le retrouve.
  await synchroniserRappels(changes.map((id) => ({ type: "LEAD" as const, id })));
  await signalerChangementTaches(); // Mission 17 (partie A) : les tâches de Lucas suivent ce geste.
  return { ids: changes };
}

/**
 * Mission 25 (lot 6) — « Archiver les anciens leads » : les leads encore « À appeler » reçus avant la campagne Meta du
 * 25/09/2026 (220 sur 229 le 10/10). Le bouton de l'écran Leads montre leur nombre exact, puis Lucas archive d'un
 * geste, avec le motif « Ancien lead, avant la campagne du 25/09 ». Réversible (Archivés → Restaurer, ou « Annuler »),
 * et ils restent disponibles pour une campagne de réactivation. Rien n'est archivé sans ce geste ; un dossier déjà
 * ouvert n'est jamais touché.
 */
export const MOTIF_ANCIEN_LEAD = "Ancien lead, avant la campagne du 25/09";

export async function archiverAnciensLeads(maintenant: Date = new Date()): Promise<{ ids: string[] }> {
  const { whereAnciensLeads } = await import("./leads");
  const anciens = await prisma.lead.findMany({ where: whereAnciensLeads(maintenant), select: { id: true } });
  const ids: string[] = [];
  for (const lead of anciens) {
    await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: maintenant, archiveMotif: MOTIF_ANCIEN_LEAD } });
    ids.push(lead.id);
  }
  if (ids.length) {
    await synchroniserRappels(ids.map((id) => ({ type: "LEAD" as const, id })));
    await signalerChangementTaches();
  }
  return { ids };
}

