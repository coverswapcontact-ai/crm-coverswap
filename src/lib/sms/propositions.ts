import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { definirProposition } from "@/lib/validation/definitions";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { LONGUEUR_MAX_SMS, envoyerSms } from "./envoi";
import { publierEvenementSms } from "./flux";

/**
 * Tout SMS que le CRM voudrait envoyer de lui-même (relance, suite d'un appel
 * sans réponse…) passe par cette proposition : pré-rédigé, il attend dans « À
 * valider ». Lucas le lit, le corrige, l'envoie ou le rejette avec un motif.
 * Rien ne part sans lui — la seule exception est l'accusé de réception.
 *
 * Le texte proposé reste sur la proposition (`contenu`), le texte validé aussi
 * (`contenuValide`), et tous deux sont recopiés sur le SMS envoyé : dans un
 * mois, on saura quelles formulations Lucas garde et lesquelles il réécrit.
 */
export const MOTIFS_SMS = ["INJOIGNABLE_LIEN", "INJOIGNABLE_J3", "RELANCE_PHOTOS", "RELANCE_SIMULATION", "RELANCE_DEVIS", "RELANCE_DERNIERE", "AUTRE"] as const;
export type MotifSms = (typeof MOTIFS_SMS)[number];

export const LIBELLES_MOTIF_SMS: Record<MotifSms, string> = {
  INJOIGNABLE_LIEN: "Pas de réponse à l'appel : SMS avec le lien",
  INJOIGNABLE_J3: "Toujours injoignable : second SMS",
  RELANCE_PHOTOS: "Photos non déposées",
  RELANCE_SIMULATION: "Simulation sans retour",
  RELANCE_DEVIS: "Devis non signé",
  RELANCE_DERNIERE: "Dernière relance",
  AUTRE: "Message",
};

/** Étapes auxquelles chaque relance a encore un sens. */
const ETAPES_DU_MOTIF: Partial<Record<MotifSms, readonly EtapeDossier[]>> = {
  RELANCE_PHOTOS: ["QUALIFICATION"],
  RELANCE_SIMULATION: ["SIMULATION"],
  // Un devis généré est visible dans l'espace du client même si le dossier est encore à « Simulation ».
  RELANCE_DEVIS: ["SIMULATION", "DEVIS_ENVOYE", "RELANCE"],
  RELANCE_DERNIERE: ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"],
};

export const propositionEnvoiSms = definirProposition({
  type: "ENVOI_SMS",
  libelle: "Envoyer un SMS au client",
  schema: z.object({
    motif: z.enum(MOTIFS_SMS, "Motif du SMS invalide."),
    conversationId: z.string().min(1).max(40),
    dossierId: z.string().max(40).nullable().optional(),
    /** Message type d'où vient le texte. */
    modele: z.string().max(60).nullable().optional(),
    texte: z.string("Message vide.").trim().min(1, "Message vide.").max(LONGUEUR_MAX_SMS, "Message trop long pour un SMS."),
    /** Proposée le : sert à savoir si le client a répondu depuis. */
    proposeLe: z.iso.datetime().optional(),
  }),
  sensible: true,
  validationGroupee: false,
  champs: [{ cle: "texte", libelle: "Message", nature: "texteLong", obligatoire: true, aide: "Relisez, corrigez si besoin : c'est ce texte qui partira." }],
  motifsRejet: [
    { code: "PAS_MAINTENANT", libelle: "Pas maintenant" },
    { code: "DEJA_FAIT", libelle: "Déjà fait autrement (appel, en personne…)" },
    { code: "CLIENT_A_REPONDU", libelle: "Le client a déjà répondu" },
    { code: "TROP_INSISTANT", libelle: "Ce serait trop insistant" },
  ],
  execution: "FILE",
  liens: (contenu) => [{ libelle: "Conversation", href: `/sms?c=${contenu.conversationId}` }, ...(contenu.dossierId ? [{ libelle: "Dossier", href: `/dossiers?dossier=${contenu.dossierId}` }] : [])],
  async pertinente(contenu) {
    const conversation = await prisma.conversationSms.findUnique({ where: { id: contenu.conversationId }, select: { stopLe: true, archiveLe: true } });
    if (!conversation) return "la conversation n'existe plus";
    if (conversation.stopLe) return "le client a répondu STOP";
    if (contenu.proposeLe) {
      const reponse = await prisma.sms.findFirst({ where: { conversationId: contenu.conversationId, sens: "ENTRANT", createdAt: { gt: new Date(contenu.proposeLe) } }, select: { id: true } });
      if (reponse) return "le client a répondu depuis";
    }
    if (contenu.dossierId) {
      const dossier = await prisma.dossier.findUnique({ where: { id: contenu.dossierId }, select: { etape: true, archiveLe: true } });
      if (!dossier || dossier.archiveLe) return "le dossier n'existe plus";
      const attendues = ETAPES_DU_MOTIF[contenu.motif];
      if (attendues && !attendues.includes(dossier.etape as EtapeDossier)) return `le dossier est passé à l'étape « ${LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} »`;
    }
    return null;
  },
  async executer(contenu, { propositionId }) {
    const proposition = await prisma.proposition.findUnique({ where: { id: propositionId }, select: { contenu: true } });
    let textePropose: string | null = null;
    try {
      textePropose = (JSON.parse(proposition?.contenu ?? "{}") as { texte?: string }).texte ?? null;
    } catch {
      textePropose = null;
    }
    try {
      // La clé d'envoi rend l'exécution rejouable : une tâche relancée ne renvoie pas le SMS.
      const sms = await envoyerSms({ conversationId: contenu.conversationId, texte: contenu.texte, origine: "RELANCE", modele: contenu.modele ?? contenu.motif, textePropose, propositionId, cleEnvoi: `proposition:${propositionId}` });
      publierEvenementSms({ genre: "MESSAGE", conversationId: contenu.conversationId, smsId: sms.id });
      return { resultat: { smsId: sms.id, corrige: textePropose !== null && textePropose.trim() !== contenu.texte.trim() } };
    } catch (erreur) {
      // STOP, numéro fixe, message vide : réessayer ne changera rien.
      if ((erreur as { status?: number }).status) throw new ErreurDefinitive(erreur instanceof Error ? erreur.message : "Envoi refusé.");
      throw erreur;
    }
  },
});
