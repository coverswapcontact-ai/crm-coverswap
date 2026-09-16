import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { PORTEES_GOOGLE, connexionActive } from "@/lib/google/connexion";
import { etatIa } from "@/lib/ia/modele";
import { lireFichierConserve } from "@/lib/fichiers/stockage";
import {
  LIBELLES_CATEGORIE_MESSAGE,
  STATUTS_MESSAGE,
  type AnalyseVue,
  type CategorieMessage,
  type DemandePreremplie,
  type EtatAgentMail,
  type MessageDetail,
  type MessageResume,
  type PieceVue,
  type StatutMessage,
} from "./constantes";
import { lireListe } from "./stockage";
import { decouperNom, retirerCitations, trouverCodePostalVille, trouverTelephone } from "./texte";

/** Lecture des messages pour l'interface : file à trier, fiche client, dossier. */

const inclusion = {
  client: { select: { id: true, nom: true } },
  dossier: { select: { id: true, objet: true } },
  pieces: { orderBy: { rang: "asc" as const } },
  analyses: { orderBy: { createdAt: "desc" as const }, take: 1, include: { appelIa: { select: { coutEuros: true } } } },
} satisfies Prisma.MessageInclude;

type MessageLu = Prisma.MessageGetPayload<{ include: typeof inclusion }>;
type AnalyseLue = MessageLu["analyses"][number];

function vuePiece(messageId: string, piece: MessageLu["pieces"][number]): PieceVue {
  return {
    id: piece.id,
    nom: piece.nom,
    typeMime: piece.typeMime,
    taille: piece.taille,
    enLigne: piece.enLigne,
    statut: piece.statut as PieceVue["statut"],
    raison: piece.raison,
    url: piece.statut === "CONSERVEE" ? `/api/messages/${messageId}/pieces/${piece.id}` : null,
    estImage: piece.typeMime.startsWith("image/"),
  };
}

function vueAnalyse(analyse: AnalyseLue): AnalyseVue {
  const categorie = analyse.categorie as CategorieMessage | null;
  return {
    id: analyse.id,
    createdAt: analyse.createdAt.toISOString(),
    methode: analyse.methode === "MODELE" ? "MODELE" : "REGLES",
    categorie,
    libelleCategorie: categorie ? (LIBELLES_CATEGORIE_MESSAGE[categorie] ?? categorie) : null,
    confiance: analyse.confiance,
    raisonnement: analyse.raisonnement,
    erreur: analyse.erreur,
    coutEuros: analyse.appelIa?.coutEuros ?? null,
  };
}

function vueResume(message: MessageLu, propositionsEnAttente: number): MessageResume {
  return {
    id: message.id,
    canal: message.canal === "WHATSAPP" ? "WHATSAPP" : "EMAIL",
    sens: message.sens === "SORTANT" ? "SORTANT" : "ENTRANT",
    de: message.de,
    deNom: message.deNom,
    a: lireListe(message.a),
    objet: message.objet,
    extrait: message.extrait,
    recuLe: message.recuLe.toISOString(),
    statut: (STATUTS_MESSAGE as readonly string[]).includes(message.statut) ? (message.statut as StatutMessage) : "A_TRIER",
    categorie: message.categorie as CategorieMessage | null,
    client: message.client,
    dossier: message.dossier,
    // Images intégrées (logos, signatures) écartées de la liste.
    pieces: message.pieces.filter((piece) => !(piece.enLigne && piece.taille < 50 * 1024)).map((piece) => vuePiece(message.id, piece)),
    analyse: message.analyses[0] ? vueAnalyse(message.analyses[0]) : null,
    propositionsEnAttente,
    boiteArchiveLe: message.boiteArchiveLe?.toISOString() ?? null,
  };
}

async function compterPropositions(messageIds: string[]): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();
  const groupes = await prisma.proposition.groupBy({ by: ["messageId"], where: { messageId: { in: messageIds }, statut: "EN_ATTENTE" }, _count: { _all: true } });
  return new Map(groupes.map((groupe) => [groupe.messageId ?? "", groupe._count._all]));
}

export type FiltresMessages = {
  statut?: StatutMessage | "TOUS";
  clientId?: string;
  dossierId?: string;
  recherche?: string;
  limite?: number;
};

export async function listerMessages(filtres: FiltresMessages = {}): Promise<MessageResume[]> {
  const termes = (filtres.recherche ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const messages = await prisma.message.findMany({
    where: {
      ...(filtres.statut && filtres.statut !== "TOUS" ? { statut: filtres.statut } : {}),
      ...(filtres.clientId ? { clientId: filtres.clientId } : {}),
      ...(filtres.dossierId ? { dossierId: filtres.dossierId } : {}),
      AND: termes.map((terme) => ({ OR: [{ objet: { contains: terme } }, { de: { contains: terme.toLowerCase() } }, { deNom: { contains: terme } }, { extrait: { contains: terme } }] })),
    },
    include: inclusion,
    orderBy: { recuLe: "desc" },
    take: Math.min(filtres.limite ?? 100, 300),
  });
  const comptes = await compterPropositions(messages.map((message) => message.id));
  return messages.map((message) => vueResume(message, comptes.get(message.id) ?? 0));
}

export async function compterMessagesATrier(): Promise<number> {
  return prisma.message.count({ where: { statut: "A_TRIER" } });
}

function demandePreremplie(message: MessageLu, texte: string, proposee: Record<string, unknown> | null): DemandePreremplie {
  const lire = (cle: string) => (typeof proposee?.[cle] === "string" && proposee[cle] ? (proposee[cle] as string) : null);
  if (proposee) {
    const ouvrir = lire("ouvrirDossier");
    return {
      prenom: lire("prenom"),
      nomFamille: lire("nomFamille"),
      raisonSociale: lire("raisonSociale"),
      categorieClient: lire("categorieClient"),
      telephone: lire("telephone"),
      source: lire("source"),
      ouvrirDossier: ouvrir === "OUI" || ouvrir === "NON" ? ouvrir : null,
      adresse: lire("adresse"),
      codePostal: lire("codePostal"),
      ville: lire("ville"),
      objet: lire("objet"),
      prochaineAction: lire("prochaineAction"),
      prochaineActionDate: lire("prochaineActionDate"),
      note: lire("note"),
    };
  }
  const nom = decouperNom(message.deNom);
  const lieu = trouverCodePostalVille(texte);
  return {
    ...nom,
    raisonSociale: null,
    categorieClient: null,
    telephone: trouverTelephone(texte),
    source: null,
    ouvrirDossier: null,
    adresse: null,
    codePostal: lieu?.codePostal ?? null,
    ville: lieu?.ville ?? null,
    objet: null,
    prochaineAction: null,
    prochaineActionDate: null,
    note: null,
  };
}

export async function detailMessage(id: string): Promise<MessageDetail> {
  const message = await prisma.message.findUnique({
    where: { id },
    include: { ...inclusion, analyses: { orderBy: { createdAt: "desc" }, take: 20, include: { appelIa: { select: { coutEuros: true } } } }, contenu: true },
  });
  if (!message) throw new ErreurMetier("Message introuvable.", 404);
  const [comptes, fil, demande, dossiersDuClient, ia] = await Promise.all([
    compterPropositions([id]),
    message.filCanal
      ? prisma.message.findMany({
          where: { canal: message.canal, filCanal: message.filCanal, id: { not: id } },
          orderBy: { recuLe: "asc" },
          take: 30,
          select: { id: true, sens: true, de: true, objet: true, recuLe: true, extrait: true },
        })
      : [],
    prisma.proposition.findFirst({ where: { messageId: id, type: "NOUVELLE_DEMANDE", statut: "EN_ATTENTE" }, orderBy: { createdAt: "desc" }, select: { contenu: true } }),
    message.clientId
      ? prisma.dossier.findMany({ where: { clientId: message.clientId, etape: { notIn: ["ENCAISSE", "PERDU"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, objet: true, etape: true } })
      : [],
    etatIa(),
  ]);
  const texte = message.contenu?.anonymiseLe ? null : (message.contenu?.texte ?? null);
  let proposee: Record<string, unknown> | null = null;
  try {
    proposee = demande ? (JSON.parse(demande.contenu) as Record<string, unknown>) : null;
  } catch {
    proposee = null;
  }
  return {
    ...vueResume(message, comptes.get(id) ?? 0),
    texte,
    texteUtile: texte ? retirerCitations(texte) : null,
    analyses: message.analyses.map(vueAnalyse),
    fil: fil.map((autre) => ({ ...autre, sens: autre.sens === "SORTANT" ? "SORTANT" : "ENTRANT", recuLe: autre.recuLe.toISOString() })),
    demande: demandePreremplie(message, texte ?? "", proposee),
    dossiersDuClient,
    lienBoite:
      message.canal === "EMAIL" && message.identifiantCanal
        ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(message.compte)}#all/${encodeURIComponent(message.filCanal ?? message.identifiantCanal)}`
        : null,
    ia: { active: ia.active, raison: ia.raison },
  };
}

/** Pièce conservée, servie seulement dans une session (routes /api, refus par défaut). */
export async function lirePieceMessage(messageId: string, pieceId: string): Promise<{ contenu: Buffer; typeMime: string; nom: string }> {
  const piece = await prisma.pieceMessage.findUnique({ where: { id: pieceId } });
  if (!piece || piece.messageId !== messageId) throw new ErreurMetier("Pièce jointe introuvable.", 404);
  if (piece.statut !== "CONSERVEE" || !piece.fichierId) throw new ErreurMetier(piece.raison ?? "Pièce jointe non conservée dans le CRM : l'ouvrir dans la boîte mail.", 404);
  const fichier = await lireFichierConserve(piece.fichierId);
  return { contenu: fichier.contenu, typeMime: fichier.typeMime, nom: piece.nom };
}

export async function agentMailActif(): Promise<{ id: string; compte: string } | null> {
  if (process.env.AGENT_MAIL === "0") return null;
  return connexionActive(PORTEES_GOOGLE.GMAIL_MODIFIER);
}

export async function etatAgentMail(maintenant: Date = new Date()): Promise<EtatAgentMail> {
  const [connexion, ia, planification, aTrier, recus] = await Promise.all([
    agentMailActif(),
    etatIa(maintenant),
    prisma.planification.findUnique({ where: { nom: "releve-boite-mail" } }),
    compterMessagesATrier(),
    prisma.message.count({ where: { sens: "ENTRANT", recuLe: { gte: new Date(maintenant.getTime() - 7 * 24 * 60 * 60_000) } } }),
  ]);
  return {
    actif: connexion !== null,
    raison:
      process.env.AGENT_MAIL === "0"
        ? "désactivé sur le serveur (AGENT_MAIL=0)."
        : connexion
          ? null
          : "aucun compte Google connecté avec l'accès Gmail.",
    compte: connexion?.compte ?? null,
    dernierReleve: planification?.dernierFin?.toISOString() ?? null,
    derniereErreur: planification?.dernierStatut === "ECHEC" ? planification.derniereErreur : null,
    aTrier,
    recusSeptJours: recus,
    ia: {
      active: ia.active,
      raison: ia.raison,
      modele: ia.modele,
      budget: ia.budget,
      depenseMois: ia.depenseMois,
      appelsMois: ia.appelsMois,
      manquants: ia.manquants,
    },
  };
}
