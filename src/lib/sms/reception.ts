import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { alerter } from "@/lib/alertes/canaux";
import { conversationDuNumero, dossierDeLaConversation } from "./conversations";
import { tracerDansLHistoire } from "./envoi";
import type { SmsEntrant } from "./fournisseurs";
import { publierEvenementSms } from "./flux";
import { estDemandeArret } from "./texte";

/**
 * Un SMS arrive (relève du fournisseur ou webhook) : il rejoint la conversation
 * de son numéro — créée orpheline si le numéro est inconnu, jamais perdue —,
 * écrit un événement dans l'histoire du contact et prévient Lucas.
 *
 * Idempotent par l'identifiant du fournisseur : une relève qui repasse sur les
 * mêmes messages, ou un webhook rejoué, ne crée pas de doublon.
 *
 * STOP : le numéro est bloqué pour tout envoi futur, les SMS encore en attente
 * et les messages proposés pour lui sont annulés, et c'est enregistré.
 */
export type ResultatReception = { smsId: string; conversationId: string; nouveau: boolean; stop: boolean };

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

export async function enregistrerSmsEntrant(entrant: SmsEntrant, fournisseur: string): Promise<ResultatReception | null> {
  const numero = normaliserTelephone(entrant.numero);
  if (!numero) {
    // Expéditeur illisible (numéro court d'opérateur, nom alphanumérique) : on le garde en journal, pas en conversation.
    console.warn(`[sms] message entrant ignoré : expéditeur illisible (${String(entrant.numero).slice(0, 12)}).`);
    return null;
  }
  const existant = await prisma.sms.findFirst({ where: { fournisseur, identifiantFournisseur: entrant.identifiant }, select: { id: true, conversationId: true } });
  if (existant) return { smsId: existant.id, conversationId: existant.conversationId, nouveau: false, stop: false };

  const conversation = await conversationDuNumero(numero);
  const dossier = await dossierDeLaConversation(conversation);
  const stop = estDemandeArret(entrant.texte);
  const texte = entrant.texte.trim() || "(message vide)";

  let smsId: string;
  try {
    smsId = await prisma.$transaction(async (tx) => {
      const sms = await tx.sms.create({
        data: {
          conversationId: conversation.id,
          sens: "ENTRANT",
          texte,
          statut: "RECU",
          fournisseur,
          identifiantFournisseur: entrant.identifiant,
          origine: "MANUEL",
          recuLe: entrant.recuLe,
          clientId: conversation.clientId,
          leadId: conversation.leadId,
          dossierId: dossier?.id ?? null,
        },
      });
      await tx.conversationSms.update({
        where: { id: conversation.id },
        data: {
          dernierMessageLe: new Date(),
          dernierExtrait: texte.slice(0, 140),
          dernierSens: "ENTRANT",
          nonLus: { increment: 1 },
          archiveLe: null,
          archiveMotif: null,
          ...(stop && !conversation.stopLe ? { stopLe: new Date(), stopTexte: texte.slice(0, 160) } : {}),
        },
      });
      if (stop) {
        // Plus rien ne doit partir vers ce numéro : ni ce qui attend en file, ni ce qui attend une validation.
        await tx.sms.updateMany({ where: { conversationId: conversation.id, sens: "SORTANT", statut: "A_ENVOYER" }, data: { statut: "ECHEC", erreur: "Annulé : le destinataire a répondu STOP." } });
      }
      return sms.id;
    });
  } catch (erreur) {
    // Deux relèves simultanées du même message : l'unicité (fournisseur, identifiant) a tranché.
    const gagnant = await prisma.sms.findFirst({ where: { fournisseur, identifiantFournisseur: entrant.identifiant }, select: { id: true, conversationId: true } });
    if (gagnant) return { smsId: gagnant.id, conversationId: gagnant.conversationId, nouveau: false, stop };
    throw erreur;
  }

  publierEvenementSms({ genre: "MESSAGE", conversationId: conversation.id, smsId });
  if (stop) await annulerPropositionsSms(conversation.id);
  await tracerDansLHistoire({ dossierId: dossier?.id ?? null, leadId: conversation.leadId, sens: "ENTRANT", texte, smsId });

  const qui = conversation.nomAffiche ?? conversation.numero;
  await alerter(
    {
      titre: stop ? `STOP reçu — ${qui}` : `SMS de ${qui}`,
      texte: stop ? `« ${texte} »\n\nCe numéro ne recevra plus aucun SMS du CRM.` : `${texte}${conversation.leadId || conversation.clientId ? "" : "\n\nNuméro inconnu : conversation à rattacher."}`,
      lien: `${appUrl()}/sms?c=${conversation.id}`,
      libelleLien: "Ouvrir la conversation",
      telephone: conversation.numero,
      urgence: stop ? 3 : 4,
      application: "messages",
      etiquette: `sms-${conversation.id}`,
    },
    { origine: stop ? "sms-stop" : "sms-recu", canaux: ["telegram", "ntfy", "pushweb"] }
  );
  return { smsId, conversationId: conversation.id, nouveau: true, stop };
}

/** Les messages proposés (relances) pour un numéro qui vient de dire STOP n'ont plus lieu d'être. */
async function annulerPropositionsSms(conversationId: string): Promise<void> {
  try {
    const enAttente = await prisma.proposition.findMany({ where: { type: "ENVOI_SMS", statut: "EN_ATTENTE" }, select: { id: true, contenu: true } });
    const aAnnuler = enAttente.filter((p) => {
      try {
        return (JSON.parse(p.contenu) as { conversationId?: string }).conversationId === conversationId;
      } catch {
        return false;
      }
    });
    for (const proposition of aAnnuler) {
      await prisma.proposition.update({ where: { id: proposition.id }, data: { statut: "ANNULEE", decideLe: new Date(), decidePar: "SYSTEME:sms", commentaireRejet: "Le destinataire a répondu STOP." } });
    }
  } catch (erreur) {
    console.error("[sms] annulation des propositions après STOP (non bloquant) :", erreur);
  }
}
