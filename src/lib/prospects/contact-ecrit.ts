import prisma, { type Transaction } from "@/lib/prisma";

/**
 * Mission 17 (partie A) — le dernier contact ÉCRIT sortant d'un lead (`Lead.dernierContactLe`) : un SMS copié, un mail
 * parti, un échange SMS ou mail noté à la main. Un lead ainsi contacté sort d'« À appeler » et entre dans « À
 * rappeler » sans date (règle de `prospects/leads.ts`, lue aussi par `commercial/pilotage.ts`) ; la tâche « Appeler »
 * est alors cochée par le CRM (« SMS copié le 29/09 »). `dernierAppelLe` garde son sens : un appel, rien d'autre.
 *
 * Le seul point d'écriture, appelé par `noterSmsCopie`, `executerEnvoi`, `tracerMailSurLeLead` (mail sortant) et
 * `ajouterEchange`. La date ne recule jamais (une trace plus ancienne, relevée tard par la synchronisation, ne remplace
 * pas un contact plus récent). Sans lead, rien. Rend vrai si la date a avancé.
 */
export async function retenirContactEcrit(leadId: string | null | undefined, le: Date, client: Pick<Transaction, "lead"> = prisma): Promise<boolean> {
  if (!leadId || Number.isNaN(le.getTime())) return false;
  const { count } = await client.lead.updateMany({ where: { id: leadId, OR: [{ dernierContactLe: null }, { dernierContactLe: { lt: le } }] }, data: { dernierContactLe: le } });
  return count > 0;
}
