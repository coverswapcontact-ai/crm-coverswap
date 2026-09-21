import type { ConversationSms } from "@prisma/client";
import prisma from "@/lib/prisma";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { dossierDeLaConversation } from "./conversations";

/**
 * Le contexte du dossier, à côté de la conversation : où en est-on, qu'a-t-on
 * reçu, quel devis court, quelle est la prochaine action. Tout ce qu'il faut
 * pour répondre sans quitter le fil.
 */
export type ContexteConversation = {
  contact: {
    id: string;
    nom: string;
    statut: string;
    ville: string | null;
    typeProjet: string;
    priorite: string | null;
    prioriteMotif: string | null;
    tailleCuisine: string | null;
    source: string;
    campagne: string | null;
    rappelLe: string | null;
    recuLe: string;
  } | null;
  client: { id: string; nom: string } | null;
  dossier: {
    id: string;
    objet: string;
    etape: string;
    prochaineAction: string | null;
    prochaineActionDate: string | null;
    montantEstime: number | null;
    nbPhotos: number;
    devis: { id: string; numero: string | null; totalHt: number; statut: string; le: string } | null;
  } | null;
  espace: {
    id: string;
    expireLe: string;
    revoque: boolean;
    premierAccesLe: string | null;
    dernierAccesLe: string | null;
    souhaits: boolean;
    nbSimulations: number;
    simulationChoisie: boolean;
    accordLe: string | null;
  } | null;
  /** Messages envoyés sur les dix derniers jours sans réponse du client : au-delà de cinq, on passe pour un harceleur. */
  envoisSansReponse10j: number;
};

export async function contexteDeLaConversation(conversation: Pick<ConversationSms, "id" | "leadId" | "clientId">): Promise<ContexteConversation> {
  const dossierRef = await dossierDeLaConversation(conversation);
  const [lead, client, dossier] = await Promise.all([
    conversation.leadId
      ? prisma.lead.findUnique({
          where: { id: conversation.leadId },
          select: { id: true, prenom: true, nom: true, statut: true, ville: true, typeProjet: true, priorite: true, prioriteMotif: true, tailleCuisine: true, source: true, campagne: true, rappelLe: true, createdAt: true },
        })
      : null,
    conversation.clientId ? prisma.client.findUnique({ where: { id: conversation.clientId }, select: { id: true, nom: true } }) : null,
    dossierRef
      ? prisma.dossier.findUnique({
          where: { id: dossierRef.id },
          select: {
            id: true,
            objet: true,
            etape: true,
            prochaineAction: true,
            prochaineActionDate: true,
            montantEstime: true,
            photos: true,
            documents: { where: { type: "DEVIS", archiveLe: null, statut: { notIn: ["BROUILLON", "REMPLACE", "ANNULEE"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, numero: true, totalHt: true, statut: true, createdAt: true } },
            espaces: { where: { archiveLe: null }, take: 1, include: { simulations: { where: { archiveLe: null }, select: { choisieLe: true } } } },
            accords: { where: { retireLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
          },
        })
      : null,
  ]);

  // Plafond de courtoisie : les envois des dix derniers jours depuis la dernière réponse du client.
  const dixJours = new Date(Date.now() - 10 * 86_400_000);
  const derniereReponse = await prisma.sms.findFirst({ where: { conversationId: conversation.id, sens: "ENTRANT" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const depuis = derniereReponse && derniereReponse.createdAt > dixJours ? derniereReponse.createdAt : dixJours;
  const envoisSansReponse10j = await prisma.sms.count({ where: { conversationId: conversation.id, sens: "SORTANT", statut: { not: "ECHEC" }, createdAt: { gt: depuis } } });

  const espace = dossier?.espaces[0] ?? null;
  const devis = dossier?.documents[0] ?? null;
  const prenom = lead?.prenom.trim() ?? "";
  const nom = lead?.nom.trim() ?? "";
  return {
    contact: lead
      ? {
          id: lead.id,
          nom: !prenom || prenom.toLowerCase() === nom.toLowerCase() ? nom || prenom : `${prenom} ${nom}`.trim(),
          statut: lead.statut,
          ville: /^(non renseign|inconnue?$)/i.test(lead.ville.trim()) ? null : lead.ville.trim() || null,
          typeProjet: lead.typeProjet,
          priorite: lead.priorite,
          prioriteMotif: lead.prioriteMotif,
          tailleCuisine: lead.tailleCuisine,
          source: lead.source,
          campagne: lead.campagne,
          rappelLe: lead.rappelLe?.toISOString() ?? null,
          recuLe: lead.createdAt.toISOString(),
        }
      : null,
    client,
    dossier: dossier
      ? {
          id: dossier.id,
          objet: dossier.objet,
          etape: dossier.etape,
          prochaineAction: dossier.prochaineAction,
          prochaineActionDate: dossier.prochaineActionDate?.toISOString() ?? null,
          montantEstime: dossier.montantEstime,
          nbPhotos: lirePhotos(dossier.photos).length,
          devis: devis ? { id: devis.id, numero: devis.numero, totalHt: devis.totalHt, statut: devis.statut, le: devis.createdAt.toISOString() } : null,
        }
      : null,
    espace: espace
      ? {
          id: espace.id,
          expireLe: espace.expireLe.toISOString(),
          revoque: Boolean(espace.revoqueLe),
          premierAccesLe: espace.premierAccesLe?.toISOString() ?? null,
          dernierAccesLe: espace.dernierAccesLe?.toISOString() ?? null,
          souhaits: Boolean(espace.souhaits),
          nbSimulations: espace.simulations.length,
          simulationChoisie: espace.simulations.some((s) => s.choisieLe),
          accordLe: dossier?.accords[0]?.createdAt.toISOString() ?? null,
        }
      : null,
    envoisSansReponse10j,
  };
}
