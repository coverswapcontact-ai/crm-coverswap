import prisma from "@/lib/prisma";

/**
 * Mission 14 (29/09/2026), partie 6 — LA règle « le client a fait une simulation », d'où qu'elle vienne : dans son
 * espace (toute source, non archivée), rangée dans le dossier, portée par le lead du dossier ou par un lead de son
 * client (même sans rendu, même pas encore rangée), ou faite sur le site et rattachée à l'un de ces leads.
 *
 * Une seule règle pour deux lecteurs : la relance photos l'écarte (`relances/photos.ts`), et la colonne Espace ne le
 * dit jamais « en attente de ses photos » (`espace/suivi.ts`, `attenteDuClient`). L'étape de l'espace
 * (`etapeEspace`), elle, ne compte que ce que le client voit dans son espace : elle peut rester « Photos » pour un
 * client qui a fait une simulation pas encore publiée chez lui.
 */

export type DossierDuClient = { id: string; clientId: string | null; leadId: string | null };

/** Les dossiers (parmi ceux donnés) dont le client a fait une simulation. Quatre lectures, quel que soit leur nombre. */
export async function dossiersAvecSimulation(dossiers: readonly DossierDuClient[]): Promise<Set<string>> {
  if (dossiers.length === 0) return new Set();
  const dossierIds = dossiers.map((d) => d.id);
  const clientIds = [...new Set(dossiers.map((d) => d.clientId).filter((id): id is string => Boolean(id)))];
  const leadsDesClients = clientIds.length ? await prisma.lead.findMany({ where: { clientId: { in: clientIds } }, select: { id: true, clientId: true } }) : [];
  const leadsDe = (d: DossierDuClient) => new Set([d.leadId, ...leadsDesClients.filter((l) => d.clientId && l.clientId === d.clientId).map((l) => l.id)].filter((id): id is string => Boolean(id)));
  const leadIds = [...new Set(dossiers.flatMap((d) => [...leadsDe(d)]))];

  // L'extension du journal écarte les lignes archivées.
  const [simulationsEspace, simulations, simulationsSite] = await Promise.all([
    prisma.simulationEspace.findMany({ where: { dossierId: { in: dossierIds } }, select: { dossierId: true } }),
    prisma.simulation.findMany({ where: { OR: [{ dossierId: { in: dossierIds } }, ...(leadIds.length ? [{ leadId: { in: leadIds } }] : [])] }, select: { dossierId: true, leadId: true } }),
    leadIds.length ? prisma.simulationSite.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true } }) : Promise.resolve([] as { leadId: string | null }[]),
  ]);

  const avec = new Set<string>();
  for (const d of dossiers) {
    const leads = leadsDe(d);
    if (
      simulationsEspace.some((s) => s.dossierId === d.id) ||
      simulations.some((s) => s.dossierId === d.id || leads.has(s.leadId)) ||
      simulationsSite.some((s) => s.leadId !== null && leads.has(s.leadId))
    )
      avec.add(d.id);
  }
  return avec;
}
