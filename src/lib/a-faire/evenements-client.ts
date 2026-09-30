import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";

/**
 * Mission 17 (partie A) : « un événement du client » (docs/TACHES.md § 2) — ce qui rouvre une tâche répondue « Pas à
 * faire » ou « Plus tard » par Lucas, et ce qui lève une prochaine action manuelle. Des requêtes groupées (quelques-unes
 * par appel, jamais une par dossier ou par lead) : le moteur les appelle une fois par passage.
 */

/**
 * Les gestes du client sur un dossier (DossierEvenement ENTRANT). ESPACE_VISITE n'est écrit qu'à la première visite
 * d'un projet (espace/service.ts › noterVisite) : les visites suivantes ne comptent donc pas, ni les relectures du devis
 * (ESPACE_DEVIS_CONSULTE, absent de la liste). DEMANDE_SITE est le nom de la conception ; le code écrit
 * ESPACE_DEMANDE_SITE (site/tunnel.ts) : les deux sont lus.
 */
export const TYPES_EVENEMENT_CLIENT = [
  "MAIL_RECU",
  "SMS_RECU",
  "WHATSAPP_RECU",
  "ESPACE_MESSAGE",
  "ESPACE_COMMENTAIRE",
  "ESPACE_NOUVELLE_PROPOSITION",
  "ESPACE_PHOTOS",
  "ESPACE_VISITE",
  "ESPACE_DEVIS_ACCEPTE",
  "ESPACE_SIMULATION_CHOISIE",
  "ESPACE_SIMULATIONS_DEMANDEES",
  "ESPACE_PROJET_VALIDE",
  "ESPACE_NOUVEAU_PROJET",
  "ESPACE_PROJET_DEMANDE",
  "ESPACE_ACCORD_RETIRE",
  "DEMANDE_SITE",
  "ESPACE_DEMANDE_SITE",
  "ESPACE_SIMULATION_CLIENT",
] as const;

/** Au-delà, la liste d'identifiants est découpée (limite de variables de SQLite). */
const PAQUET = 400;

function paquets<T>(liste: readonly T[]): T[][] {
  const sortie: T[][] = [];
  for (let i = 0; i < liste.length; i += PAQUET) sortie.push(liste.slice(i, i + PAQUET));
  return sortie;
}

function retenir(carte: Map<string, Date>, id: string | null | undefined, date: Date | null | undefined): void {
  if (!id || !date) return;
  const connue = carte.get(id);
  if (!connue || date.getTime() > connue.getTime()) carte.set(id, date);
}

/**
 * Pour chaque dossier, la date du plus récent geste du client (`survenuLe ?? createdAt` d'un DossierEvenement ENTRANT
 * des types ci-dessus, non archivé). Un dossier sans geste n'est pas dans la carte.
 */
export async function dernierEvenementClientDossiers(ids: readonly string[]): Promise<Map<string, Date>> {
  const carte = new Map<string, Date>();
  const uniques = [...new Set(ids.filter(Boolean))];
  for (const paquet of paquets(uniques)) {
    const filtre = { dossierId: { in: paquet }, direction: "ENTRANT", type: { in: [...TYPES_EVENEMENT_CLIENT] } };
    // La date réelle (survenuLe) n'est posée que sur un événement corrigé ou repris : rare. Les autres se lisent groupés.
    const [groupes, dates] = await Promise.all([
      prisma.dossierEvenement.groupBy({ by: ["dossierId"], where: { ...filtre, survenuLe: null }, _max: { createdAt: true } }),
      prisma.dossierEvenement.findMany({ where: { ...filtre, survenuLe: { not: null } }, select: { dossierId: true, survenuLe: true } }),
    ]);
    for (const g of groupes) retenir(carte, g.dossierId, g._max.createdAt);
    for (const e of dates) retenir(carte, e.dossierId, e.survenuLe);
  }
  return carte;
}

/**
 * Pour chaque lead, la date du plus récent geste du client : un `Message` ENTRANT rattaché (mail, WhatsApp), un `Sms`
 * ENTRANT de ses conversations, une `SimulationSite` rattachée ou une `PhotoLead`. Un lead sans geste n'est pas dans la
 * carte. Une simulation du site purgée (images effacées : `archiveLe`) reste un geste daté.
 */
export async function dernierEvenementClientLeads(ids: readonly string[]): Promise<Map<string, Date>> {
  const carte = new Map<string, Date>();
  const uniques = [...new Set(ids.filter(Boolean))];
  for (const paquet of paquets(uniques)) {
    const [messages, conversations, simulations, photos] = await Promise.all([
      prisma.message.groupBy({ by: ["leadId"], where: { leadId: { in: paquet }, sens: "ENTRANT" }, _max: { recuLe: true } }),
      prisma.conversationSms.findMany({ where: { leadId: { in: paquet }, ...AVEC_ARCHIVES }, select: { id: true, leadId: true } }),
      prisma.simulationSite.groupBy({ by: ["leadId"], where: { leadId: { in: paquet }, ...AVEC_ARCHIVES }, _max: { createdAt: true } }),
      prisma.photoLead.groupBy({ by: ["leadId"], where: { leadId: { in: paquet } }, _max: { createdAt: true } }),
    ]);
    for (const g of messages) retenir(carte, g.leadId, g._max.recuLe);
    for (const g of simulations) retenir(carte, g.leadId, g._max.createdAt);
    for (const g of photos) retenir(carte, g.leadId, g._max.createdAt);
    const leadDeConversation = new Map(conversations.map((c) => [c.id, c.leadId]));
    if (leadDeConversation.size > 0) {
      const sms = await prisma.sms.groupBy({ by: ["conversationId"], where: { conversationId: { in: [...leadDeConversation.keys()] }, sens: "ENTRANT" }, _max: { createdAt: true } });
      for (const g of sms) retenir(carte, leadDeConversation.get(g.conversationId), g._max.createdAt);
    }
  }
  return carte;
}

/**
 * Le plus récent geste du client pour chaque sujet (dossier et lead confondus), sous la clé `dossier:<id>` ou
 * `lead:<id>` : une seule lecture groupée pour tout un passage du moteur.
 */
export async function dernierEvenementClient(sujets: readonly { dossierId?: string | null; leadId?: string | null }[]): Promise<(sujet: { dossierId?: string | null; leadId?: string | null }) => Date | null> {
  const dossierIds = sujets.map((s) => s.dossierId).filter((id): id is string => Boolean(id));
  const leadIds = sujets.map((s) => s.leadId).filter((id): id is string => Boolean(id));
  const [dossiers, leads] = await Promise.all([
    dossierIds.length ? dernierEvenementClientDossiers(dossierIds) : new Map<string, Date>(),
    leadIds.length ? dernierEvenementClientLeads(leadIds) : new Map<string, Date>(),
  ]);
  return (sujet) => {
    const a = sujet.dossierId ? dossiers.get(sujet.dossierId) : undefined;
    const b = sujet.leadId ? leads.get(sujet.leadId) : undefined;
    if (a && b) return a.getTime() >= b.getTime() ? a : b;
    return a ?? b ?? null;
  };
}
