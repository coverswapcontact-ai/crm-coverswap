import type { ConversationSms, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { trouverClientParCoordonnees } from "@/lib/clients/identification";
import { ETAPES_SORTIE } from "@/lib/dossiers/constants";

/**
 * Conversations SMS : une par numéro de téléphone.
 *
 * Un numéro connu (fiche client, contact entrant) est rattaché tout seul ; un
 * numéro inconnu ouvre une conversation orpheline, visible dans la file « à
 * rattacher » — jamais perdue. Le fil d'une conversation mêle les SMS, les
 * appels notés et les gestes du client dans son espace : toute l'histoire du
 * contact dans l'ordre où elle s'est passée.
 */

export type Rattachement = { leadId?: string | null; clientId?: string | null };

function numeroExige(saisie: string): string {
  const numero = normaliserTelephone(saisie);
  if (!numero) throw new ErreurMetier("Numéro de téléphone illisible.", 400);
  return numero;
}

function nomDe(personne: { prenom?: string | null; nom?: string | null } | null | undefined): string | null {
  if (!personne) return null;
  const prenom = (personne.prenom ?? "").trim();
  const nom = (personne.nom ?? "").trim();
  if (!prenom || prenom.toLowerCase() === nom.toLowerCase()) return nom || prenom || null;
  return nom ? `${prenom} ${nom}` : prenom;
}

/** Le contact entrant le plus récent qui porte ce numéro (les anciens leads gardent le numéro tel que saisi). */
async function leadDuNumero(numero: string): Promise<{ id: string; prenom: string; nom: string; clientId: string | null } | null> {
  const fin = numero.slice(-9);
  const candidats = await prisma.lead.findMany({
    where: { telephone: { contains: fin.slice(-8) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, prenom: true, nom: true, telephone: true, clientId: true },
  });
  return candidats.find((lead) => normaliserTelephone(lead.telephone) === numero) ?? null;
}

/** Trouve la conversation d'un numéro, ou la crée — rattachée si le numéro est connu. */
export async function conversationDuNumero(saisie: string, rattachement: Rattachement = {}): Promise<ConversationSms> {
  const numero = numeroExige(saisie);
  const existante = await prisma.conversationSms.findUnique({ where: { numero } });
  if (existante) {
    // Une conversation orpheline se rattache dès qu'on sait à qui elle est.
    if ((!existante.leadId && rattachement.leadId) || (!existante.clientId && rattachement.clientId)) {
      return rattacherConversation(existante.id, { leadId: existante.leadId ?? rattachement.leadId, clientId: existante.clientId ?? rattachement.clientId });
    }
    return existante.archiveLe ? prisma.conversationSms.update({ where: { id: existante.id }, data: { archiveLe: null, archiveMotif: null } }) : existante;
  }

  const lead = rattachement.leadId
    ? await prisma.lead.findUnique({ where: { id: rattachement.leadId }, select: { id: true, prenom: true, nom: true, clientId: true } })
    : await leadDuNumero(numero);
  const client = rattachement.clientId
    ? await prisma.client.findUnique({ where: { id: rattachement.clientId } })
    : lead?.clientId
      ? await prisma.client.findUnique({ where: { id: lead.clientId } })
      : await trouverClientParCoordonnees({ telephones: [numero] });

  try {
    return await prisma.conversationSms.create({
      data: { numero, leadId: lead?.id ?? null, clientId: client?.id ?? null, nomAffiche: nomDe(lead) ?? client?.nom ?? null },
    });
  } catch (erreur) {
    // Deux réponses du même client à la même seconde : la seconde retrouve la conversation créée par la première.
    const creee = await prisma.conversationSms.findUnique({ where: { numero } });
    if (creee) return creee;
    throw erreur;
  }
}

export async function rattacherConversation(id: string, rattachement: Rattachement): Promise<ConversationSms> {
  const lead = rattachement.leadId ? await prisma.lead.findUnique({ where: { id: rattachement.leadId }, select: { id: true, prenom: true, nom: true, clientId: true } }) : null;
  if (rattachement.leadId && !lead) throw new ErreurMetier("Contact introuvable.", 404);
  const clientId = rattachement.clientId ?? lead?.clientId ?? null;
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, nom: true } }) : null;
  if (rattachement.clientId && !client) throw new ErreurMetier("Client introuvable.", 404);
  return prisma.conversationSms.update({
    where: { id },
    data: { leadId: lead?.id ?? null, clientId: client?.id ?? null, nomAffiche: nomDe(lead) ?? client?.nom ?? null },
  });
}

/** Le dossier vivant d'une conversation : celui du contact, sinon le plus récent du client, hors dossiers perdus ou en pause s'il y en a un autre. */
export async function dossierDeLaConversation(conversation: Pick<ConversationSms, "leadId" | "clientId">): Promise<{ id: string; etape: string } | null> {
  const ou: Prisma.DossierWhereInput[] = [];
  if (conversation.leadId) ou.push({ leadId: conversation.leadId });
  if (conversation.clientId) ou.push({ clientId: conversation.clientId });
  if (ou.length === 0) return null;
  const dossiers = await prisma.dossier.findMany({ where: { OR: ou }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, etape: true } });
  return dossiers.find((d) => !(ETAPES_SORTIE as readonly string[]).includes(d.etape)) ?? dossiers[0] ?? null;
}

/* ── Liste ─────────────────────────────────────────────────────────── */

export const FILTRES_CONVERSATIONS = ["TOUTES", "NON_LUES", "A_REPONDRE", "A_RATTACHER", "ARCHIVEES"] as const;
export type FiltreConversations = (typeof FILTRES_CONVERSATIONS)[number];

export type ConversationResume = {
  id: string;
  numero: string;
  numeroLisible: string;
  nom: string | null;
  dernierExtrait: string | null;
  dernierSens: "ENTRANT" | "SORTANT" | null;
  dernierMessageLe: string | null;
  nonLus: number;
  /** Qui doit agir : le dernier mot est au client → à moi de répondre. */
  attente: "MOI" | "CLIENT" | null;
  aRattacher: boolean;
  stop: boolean;
  leadId: string | null;
  clientId: string | null;
  brouillon: string | null;
  archivee: boolean;
};

export function resumerConversation(c: ConversationSms): ConversationResume {
  return {
    id: c.id,
    numero: c.numero,
    numeroLisible: formaterTelephone(c.numero),
    nom: c.nomAffiche,
    dernierExtrait: c.dernierExtrait,
    dernierSens: (c.dernierSens as "ENTRANT" | "SORTANT" | null) ?? null,
    dernierMessageLe: c.dernierMessageLe?.toISOString() ?? null,
    nonLus: c.nonLus,
    attente: c.stopLe ? null : c.dernierSens === "ENTRANT" ? "MOI" : c.dernierSens === "SORTANT" ? "CLIENT" : null,
    aRattacher: !c.leadId && !c.clientId,
    stop: Boolean(c.stopLe),
    leadId: c.leadId,
    clientId: c.clientId,
    brouillon: c.brouillon,
    archivee: Boolean(c.archiveLe),
  };
}

export async function listerConversations(options: { filtre?: FiltreConversations; recherche?: string; limite?: number } = {}): Promise<{ conversations: ConversationResume[]; compteurs: { nonLues: number; aRepondre: number; aRattacher: number } }> {
  const filtre = options.filtre ?? "TOUTES";
  const recherche = (options.recherche ?? "").trim();
  const chiffres = recherche.replace(/\D/g, "");
  const parRecherche: Prisma.ConversationSmsWhereInput = !recherche
    ? {}
    : {
        OR: [
          { nomAffiche: { contains: recherche } },
          ...(chiffres.length >= 4 ? [{ numero: { contains: chiffres.replace(/^0/, "").slice(-9) } }] : []),
          // La recherche porte aussi sur le contenu des messages.
          { messages: { some: { texte: { contains: recherche } } } },
        ],
      };
  const parFiltre: Prisma.ConversationSmsWhereInput =
    filtre === "NON_LUES"
      ? { nonLus: { gt: 0 } }
      : filtre === "A_REPONDRE"
        ? { dernierSens: "ENTRANT", stopLe: null }
        : filtre === "A_RATTACHER"
          ? { leadId: null, clientId: null }
          : filtre === "ARCHIVEES"
            ? { archiveLe: { not: null } }
            : {};
  const [lignes, nonLues, aRepondre, aRattacher] = await Promise.all([
    prisma.conversationSms.findMany({
      where: { ...(filtre === "ARCHIVEES" ? AVEC_ARCHIVES : {}), AND: [parRecherche, parFiltre] },
      orderBy: [{ dernierMessageLe: "desc" }, { createdAt: "desc" }],
      take: Math.min(options.limite ?? 200, 500),
    }),
    prisma.conversationSms.count({ where: { nonLus: { gt: 0 } } }),
    prisma.conversationSms.count({ where: { dernierSens: "ENTRANT", stopLe: null } }),
    prisma.conversationSms.count({ where: { leadId: null, clientId: null } }),
  ]);
  return { conversations: lignes.map(resumerConversation), compteurs: { nonLues, aRepondre, aRattacher } };
}

/** Nombre de SMS reçus non lus : le badge de l'icône et de la navigation. */
export async function compterSmsNonLus(): Promise<number> {
  const somme = await prisma.conversationSms.aggregate({ _sum: { nonLus: true } });
  return somme._sum.nonLus ?? 0;
}

/* ── Fil ───────────────────────────────────────────────────────────── */

export type ElementFil =
  | {
      genre: "SMS";
      id: string;
      le: string;
      sens: "ENTRANT" | "SORTANT";
      texte: string;
      statut: string;
      erreur: string | null;
      origine: string;
      cleEnvoi: string | null;
      segments: number | null;
    }
  | { genre: "APPEL" | "NOTE" | "EVENEMENT"; id: string; le: string; titre: string; texte: string };

const EVENEMENTS_DU_FIL = ["APPEL", "NOTE_AJOUTEE", "CHANGEMENT_ETAPE", "DEVIS_ENVOYE", "DEVIS_GENERE", "ESPACE_LIEN_CREE", "ESPACE_VISITE", "ESPACE_PHOTOS", "ESPACE_SOUHAITS", "ESPACE_SIMULATION_DEPOSEE", "ESPACE_SIMULATION_CHOISIE", "ESPACE_COMMENTAIRE", "ESPACE_COORDONNEES", "ESPACE_DEVIS_ACCEPTE"];

export async function filDeLaConversation(id: string, options: { depuis?: Date } = {}): Promise<{ conversation: ConversationResume; elements: ElementFil[]; dossier: { id: string; etape: string } | null }> {
  const conversation = await prisma.conversationSms.findUnique({ where: { id } });
  if (!conversation) throw new ErreurMetier("Conversation introuvable.", 404);
  const dossier = await dossierDeLaConversation(conversation);
  const depuis = options.depuis ? { gt: options.depuis } : undefined;

  const [sms, echanges, evenements] = await Promise.all([
    prisma.sms.findMany({ where: { conversationId: id, ...(depuis ? { updatedAt: depuis } : {}) }, orderBy: { createdAt: "asc" }, take: 1000 }),
    conversation.leadId
      ? prisma.interaction.findMany({ where: { leadId: conversation.leadId, type: { in: ["APPEL", "NOTE"] }, ...(depuis ? { createdAt: depuis } : {}) }, orderBy: { createdAt: "asc" }, take: 300 })
      : Promise.resolve([]),
    dossier
      ? prisma.dossierEvenement.findMany({ where: { dossierId: dossier.id, type: { in: EVENEMENTS_DU_FIL }, ...(depuis ? { createdAt: depuis } : {}) }, orderBy: { createdAt: "asc" }, take: 300 })
      : Promise.resolve([]),
  ]);

  const elements: ElementFil[] = [
    ...sms.map(
      (m): ElementFil => ({
        genre: "SMS",
        id: m.id,
        le: (m.recuLe ?? m.createdAt).toISOString(),
        sens: m.sens as "ENTRANT" | "SORTANT",
        texte: m.texte,
        statut: m.statut,
        erreur: m.erreur,
        origine: m.origine,
        cleEnvoi: m.cleEnvoi,
        segments: m.segments,
      })
    ),
    ...echanges
      // Les notes automatiques d'arrivée du lead n'apprennent rien dans un fil de discussion.
      .filter((e) => e.type === "APPEL" || !/^(Lead |Contact saisi|Statut :)/.test(e.contenu))
      .map((e): ElementFil => ({ genre: e.type === "APPEL" ? "APPEL" : "NOTE", id: `i-${e.id}`, le: e.createdAt.toISOString(), titre: e.type === "APPEL" ? "Appel" : "Note", texte: e.contenu })),
    ...evenements.map(
      (e): ElementFil => ({
        genre: e.type === "APPEL" ? "APPEL" : e.type === "NOTE_AJOUTEE" ? "NOTE" : "EVENEMENT",
        id: `e-${e.id}`,
        le: (e.survenuLe ?? e.createdAt).toISOString(),
        titre: e.type,
        texte: e.contenu,
      })
    ),
  ].sort((a, b) => a.le.localeCompare(b.le));

  return { conversation: resumerConversation(conversation), elements, dossier };
}

/** La conversation vient d'être ouverte : ses SMS reçus sont lus, le compteur retombe. */
export async function marquerConversationLue(id: string): Promise<void> {
  const maintenant = new Date();
  await prisma.$transaction([
    prisma.sms.updateMany({ where: { conversationId: id, sens: "ENTRANT", luLe: null }, data: { luLe: maintenant } }),
    prisma.conversationSms.updateMany({ where: { id, nonLus: { gt: 0 } }, data: { nonLus: 0 } }),
  ]);
}

/** Remet la conversation en « non lue » (j'y reviendrai). */
export async function marquerConversationNonLue(id: string): Promise<void> {
  await prisma.conversationSms.update({ where: { id }, data: { nonLus: { increment: 1 } } });
}

export async function enregistrerBrouillon(id: string, texte: string | null): Promise<void> {
  await prisma.conversationSms.updateMany({ where: { id }, data: { brouillon: texte?.trim() ? texte.slice(0, 1600) : null } });
}

export async function archiverConversation(id: string, motif: string): Promise<void> {
  await prisma.conversationSms.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif.slice(0, 300) } });
}
