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
 * Pour chaque client, le plus récent geste : un `Message` ENTRANT rattaché au client, ou un geste sur l'un de ses
 * dossiers (même liste que ci-dessus). Pour une tâche posée sur un client sans dossier ni lead (mail d'un client connu).
 */
export async function dernierEvenementClientClients(ids: readonly string[]): Promise<Map<string, Date>> {
  const carte = new Map<string, Date>();
  const uniques = [...new Set(ids.filter(Boolean))];
  for (const paquet of paquets(uniques)) {
    const [messages, dossiers] = await Promise.all([
      prisma.message.groupBy({ by: ["clientId"], where: { clientId: { in: paquet }, sens: "ENTRANT" }, _max: { recuLe: true } }),
      prisma.dossier.findMany({ where: { clientId: { in: paquet }, ...AVEC_ARCHIVES }, select: { id: true, clientId: true } }),
    ]);
    for (const g of messages) retenir(carte, g.clientId, g._max.recuLe);
    const gestes = await dernierEvenementClientDossiers(dossiers.map((d) => d.id));
    for (const d of dossiers) retenir(carte, d.clientId, gestes.get(d.id));
  }
  return carte;
}

/** Pour chaque fil de mails (tâche REPONDRE:fil:<fil> ou LIRE_MAIL:fil:<fil>, sans contact connu), le dernier mail reçu. */
export async function dernierEvenementClientFils(fils: readonly string[]): Promise<Map<string, Date>> {
  const carte = new Map<string, Date>();
  const uniques = [...new Set(fils.filter(Boolean))];
  for (const paquet of paquets(uniques)) {
    const [parFil, parId] = await Promise.all([
      prisma.message.groupBy({ by: ["filCanal"], where: { filCanal: { in: paquet }, sens: "ENTRANT" }, _max: { recuLe: true } }),
      // Un fil sans identifiant chez le fournisseur a pour clé l'id de son message (mail/vues.ts : filCanal ?? id).
      prisma.message.findMany({ where: { id: { in: paquet }, filCanal: null, sens: "ENTRANT" }, select: { id: true, recuLe: true } }),
    ]);
    for (const g of parFil) retenir(carte, g.filCanal, g._max.recuLe);
    for (const m of parId) retenir(carte, m.id, m.recuLe);
  }
  return carte;
}

/** Le fil d'une clé de tâche `TYPE:fil:<fil>`, s'il y en a un. */
export function filDeLaCle(cle: string | null | undefined): string | null {
  const trouve = /^[A-Z_]+:fil:(.+)$/.exec(cle ?? "");
  return trouve ? trouve[1] : null;
}

type SujetLu = { dossierId?: string | null; leadId?: string | null; clientId?: string | null; cle?: string | null };

/**
 * Le plus récent geste du client pour chaque sujet (dossier, lead, client, ou fil de mails sans contact) : une seule
 * lecture groupée pour tout un passage du moteur.
 */
export async function dernierEvenementClient(sujets: readonly SujetLu[]): Promise<(sujet: SujetLu) => Date | null> {
  const ids = (cle: keyof SujetLu) => sujets.map((s) => s[cle]).filter((id): id is string => Boolean(id));
  const dossierIds = ids("dossierId");
  const leadIds = ids("leadId");
  const clientIds = ids("clientId");
  const fils = sujets.map((s) => filDeLaCle(s.cle)).filter((f): f is string => Boolean(f));
  const vide = new Map<string, Date>();
  const [dossiers, leads, clients, parFil] = await Promise.all([
    dossierIds.length ? dernierEvenementClientDossiers(dossierIds) : vide,
    leadIds.length ? dernierEvenementClientLeads(leadIds) : vide,
    clientIds.length ? dernierEvenementClientClients(clientIds) : vide,
    fils.length ? dernierEvenementClientFils(fils) : vide,
  ]);
  return (sujet) => {
    const dates = [
      sujet.dossierId ? dossiers.get(sujet.dossierId) : undefined,
      sujet.leadId ? leads.get(sujet.leadId) : undefined,
      sujet.clientId ? clients.get(sujet.clientId) : undefined,
      parFil.get(filDeLaCle(sujet.cle) ?? ""),
    ].filter((d): d is Date => Boolean(d));
    return dates.length ? dates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b)) : null;
  };
}
