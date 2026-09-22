import type { Sms } from "@prisma/client";
import prisma from "@/lib/prisma";
import { recalculerMain } from "@/lib/dossiers/main";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { mettreEnFile } from "@/lib/taches/file";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { conversationDuNumero, dossierDeLaConversation, type Rattachement } from "./conversations";
import { EchecDefinitifSms, fournisseurSms } from "./fournisseurs";
import { publierEvenementSms } from "./flux";
import { avecMentionStop, mesurerSms } from "./texte";

/**
 * Envoi d'un SMS : la ligne est écrite TOUT DE SUITE (l'écran l'affiche sans
 * attendre), l'envoi réel passe par la file de tâches — nouvel essai si le
 * réseau ou le fournisseur flanche, jamais deux envois pour un même message.
 *
 * Règles qui ne souffrent pas d'exception :
 *  - un numéro qui a répondu STOP ne reçoit plus rien, quel que soit l'appelant ;
 *  - le premier SMS d'une conversation porte la mention d'arrêt ;
 *  - une même clé d'envoi (fabriquée par l'écran) ne produit qu'un seul SMS :
 *    un double-tap, ou une file hors ligne rejouée, ne spamme personne.
 */
export const TACHE_ENVOI_SMS = "SMS_ENVOI";
export const TENTATIVES_ENVOI = 6;

export const ORIGINES_SMS = ["MANUEL", "MODELE", "ACCUSE_AUTO", "RELANCE", "LIEN_ESPACE"] as const;
export type OrigineSms = (typeof ORIGINES_SMS)[number];

export type DemandeSms = {
  conversationId?: string;
  /** À défaut de conversation : le numéro, avec ce qu'on sait de la personne. */
  numero?: string;
  rattachement?: Rattachement;
  texte: string;
  origine?: OrigineSms;
  /** Message type d'où vient le texte, et la version proposée par le CRM avant correction. */
  modele?: string | null;
  textePropose?: string | null;
  propositionId?: string | null;
  /** Identifiant fabriqué par l'écran (envoi optimiste, file hors ligne). */
  cleEnvoi?: string | null;
};

export const LONGUEUR_MAX_SMS = 918; // six SMS enchaînés : au-delà, c'est un mail

export async function envoyerSms(demande: DemandeSms): Promise<Sms> {
  const texteSaisi = demande.texte.replace(/\r\n/g, "\n").trim();
  if (!texteSaisi) throw new ErreurMetier("Le message est vide.", 400);
  if (texteSaisi.length > LONGUEUR_MAX_SMS) throw new ErreurMetier(`Message trop long pour un SMS (${LONGUEUR_MAX_SMS} caractères au plus).`, 400);

  if (demande.cleEnvoi) {
    const dejaLa = await prisma.sms.findUnique({ where: { cleEnvoi: demande.cleEnvoi } });
    if (dejaLa) return dejaLa;
  }

  const conversation = demande.conversationId
    ? await prisma.conversationSms.findUnique({ where: { id: demande.conversationId } })
    : demande.numero
      ? await conversationDuNumero(demande.numero, demande.rattachement)
      : null;
  if (!conversation) throw new ErreurMetier("Conversation introuvable.", 404);
  if (conversation.stopLe) throw new ErreurMetier("Ce numéro a répondu STOP : plus aucun SMS ne peut lui être envoyé.", 409);
  if (!/^\+\d{8,15}$/.test(conversation.numero)) throw new ErreurMetier("Numéro invalide pour un SMS.", 400);
  if (conversation.numero.startsWith("+33") && !/^\+33[67]/.test(conversation.numero)) {
    throw new ErreurMetier("Ce numéro est un fixe : il ne reçoit pas les SMS.", 400);
  }

  const premier = !conversation.premierEnvoiLe;
  const texte = premier ? avecMentionStop(texteSaisi) : texteSaisi;
  const dossier = await dossierDeLaConversation(conversation);
  const lead = conversation.leadId ? await prisma.lead.findUnique({ where: { id: conversation.leadId }, select: { statut: true } }) : null;
  const maintenant = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const sms = await tx.sms.create({
        data: {
          conversationId: conversation.id,
          sens: "SORTANT",
          texte,
          statut: "A_ENVOYER",
          origine: demande.origine ?? "MANUEL",
          modele: demande.modele ?? null,
          textePropose: demande.textePropose ?? null,
          contexteEtape: dossier?.etape ?? (lead ? `CONTACT:${lead.statut}` : null),
          propositionId: demande.propositionId ?? null,
          cleEnvoi: demande.cleEnvoi ?? null,
          segments: mesurerSms(texte).segments,
          clientId: conversation.clientId,
          leadId: conversation.leadId,
          dossierId: dossier?.id ?? null,
        },
      });
      await tx.conversationSms.update({
        where: { id: conversation.id },
        data: {
          dernierMessageLe: maintenant,
          dernierExtrait: texte.slice(0, 140),
          dernierSens: "SORTANT",
          brouillon: null,
          archiveLe: null,
          archiveMotif: null,
          ...(premier ? { premierEnvoiLe: maintenant } : {}),
        },
      });
      await mettreEnFile({ type: TACHE_ENVOI_SMS, cle: `sms-envoi:${sms.id}:0`, charge: { smsId: sms.id }, priorite: 9, tentativesMax: TENTATIVES_ENVOI }, tx);
      return sms;
    });
  } catch (erreur) {
    // Deux requêtes avec la même clé d'envoi, arrivées ensemble : la seconde rend la ligne de la première.
    if (demande.cleEnvoi) {
      const dejaLa = await prisma.sms.findUnique({ where: { cleEnvoi: demande.cleEnvoi } });
      if (dejaLa) return dejaLa;
    }
    throw erreur;
  }
}

/** Remet en file un SMS en échec (« Réessayer »). */
export async function reessayerSms(smsId: string): Promise<Sms> {
  const sms = await prisma.sms.findUnique({ where: { id: smsId }, include: { conversation: { select: { stopLe: true } } } });
  if (!sms) throw new ErreurMetier("Message introuvable.", 404);
  if (sms.sens !== "SORTANT" || sms.statut !== "ECHEC") throw new ErreurMetier("Seul un envoi en échec se réessaie.", 409);
  if (sms.conversation.stopLe) throw new ErreurMetier("Ce numéro a répondu STOP : plus aucun SMS ne peut lui être envoyé.", 409);
  const essai = sms.tentatives + 1;
  return prisma.$transaction(async (tx) => {
    const maj = await tx.sms.update({ where: { id: smsId }, data: { statut: "A_ENVOYER", erreur: null, tentatives: essai } });
    await mettreEnFile({ type: TACHE_ENVOI_SMS, cle: `sms-envoi:${smsId}:${essai}`, charge: { smsId }, priorite: 9, tentativesMax: TENTATIVES_ENVOI }, tx);
    return maj;
  });
}

/**
 * Exécution de la tâche : le SMS part chez le fournisseur. Rejouée, elle ne
 * renvoie rien (le statut n'est plus « à envoyer »). Un refus définitif
 * (numéro invalide, crédit épuisé, clé refusée) marque l'échec tout de suite ;
 * une panne passagère laisse la file réessayer, et la dernière tentative
 * marque l'échec pour que l'écran propose « Réessayer ».
 */
export async function executerEnvoiSms(smsId: string, tentative: number): Promise<{ statut: string; fournisseur?: string }> {
  const sms = await prisma.sms.findUnique({ where: { id: smsId }, include: { conversation: true } });
  if (!sms) throw new ErreurDefinitive(`SMS ${smsId} introuvable.`);
  if (sms.statut !== "A_ENVOYER") return { statut: sms.statut };

  const echouer = async (message: string) => {
    await prisma.sms.update({ where: { id: smsId }, data: { statut: "ECHEC", erreur: message.slice(0, 500) } });
    publierEvenementSms({ genre: "STATUT", conversationId: sms.conversationId, smsId });
  };
  if (sms.conversation.stopLe) {
    await echouer("Le destinataire a répondu STOP avant l'envoi.");
    throw new ErreurDefinitive("Destinataire en STOP : envoi annulé.");
  }
  const fournisseur = fournisseurSms();
  if (!fournisseur) {
    const message = "Aucun fournisseur de SMS configuré (voir Paramètres → Messagerie SMS).";
    if (tentative >= TENTATIVES_ENVOI) await echouer(message);
    throw new Error(message);
  }

  try {
    const accuse = await fournisseur.envoyer({ numero: sms.conversation.numero, texte: sms.texte, reference: sms.id });
    const parti = { statut: "ENVOYE", fournisseur: fournisseur.nom, envoyeLe: new Date(), erreur: null, ...(accuse.segments ? { segments: accuse.segments } : {}) };
    try {
      await prisma.sms.update({ where: { id: smsId }, data: { ...parti, identifiantFournisseur: accuse.identifiant } });
    } catch (erreurEcriture) {
      // Le SMS EST parti : il ne doit surtout pas repartir parce que sa trace n'a pas pu s'écrire
      // (identifiant déjà connu, par exemple). On garde l'envoi, sans le suivi de remise.
      console.error(`[sms] identifiant ${accuse.identifiant} non enregistré pour le message ${smsId} :`, erreurEcriture);
      await prisma.sms.update({ where: { id: smsId }, data: parti });
    }
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    if (erreur instanceof EchecDefinitifSms) {
      await echouer(message);
      throw new ErreurDefinitive(message);
    }
    if (tentative >= TENTATIVES_ENVOI) await echouer(`${message} (après ${tentative} essais)`);
    throw erreur;
  }

  publierEvenementSms({ genre: "STATUT", conversationId: sms.conversationId, smsId });
  await tracerDansLHistoire({ dossierId: sms.dossierId, leadId: sms.leadId, sens: "SORTANT", texte: sms.texte, smsId: sms.id, origine: sms.origine, modele: sms.modele });
  return { statut: "ENVOYE", fournisseur: fournisseur.nom };
}

/**
 * Chaque SMS écrit un événement dans l'histoire du contact : sur le dossier s'il
 * y en a un, sinon dans les échanges du contact entrant. Jamais bloquant.
 */
export async function tracerDansLHistoire(trace: { dossierId: string | null; leadId: string | null; sens: "ENTRANT" | "SORTANT"; texte: string; smsId: string; origine?: string; modele?: string | null }): Promise<void> {
  try {
    if (trace.dossierId) {
      await prisma.dossierEvenement.create({
        data: {
          dossierId: trace.dossierId,
          type: trace.sens === "ENTRANT" ? "SMS_RECU" : "SMS_ENVOYE",
          direction: trace.sens,
          contenu: trace.texte.slice(0, 1600),
          metadata: JSON.stringify({ smsId: trace.smsId, ...(trace.origine ? { origine: trace.origine } : {}), ...(trace.modele ? { modele: trace.modele } : {}) }),
        },
      });
      // Un SMS reçu rend la main ; le lien de l'espace envoyé la passe au client (dossiers/main.ts).
      await recalculerMain(trace.dossierId);
      return;
    }
    if (trace.leadId) {
      await prisma.$transaction(async (tx) => {
        await tx.interaction.create({ data: { leadId: trace.leadId!, type: "SMS", contenu: `${trace.sens === "ENTRANT" ? "SMS reçu" : "SMS envoyé"} : ${trace.texte.slice(0, 1500)}` } });
        // Un SMS envoyé à la main vaut prise de contact ; l'accusé automatique, non : personne n'a encore parlé à la personne.
        if (trace.sens === "SORTANT" && trace.origine !== "ACCUSE_AUTO") {
          await tx.lead.updateMany({ where: { id: trace.leadId!, statut: { in: ["NOUVEAU", "DEVIS_DEMANDE"] } }, data: { statut: "CONTACTE" } });
        }
      });
    }
  } catch (erreur) {
    console.error("[sms] trace dans l'histoire du contact non écrite :", erreur);
  }
}
