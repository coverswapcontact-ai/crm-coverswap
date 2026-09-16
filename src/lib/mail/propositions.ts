import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { EMETTEUR, LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { appliquerChangementEtape, effetsDuChangementEtape } from "@/lib/dossiers/transitions";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { definirProposition } from "@/lib/validation/definitions";
import { envoyeurMail, type PieceJointe } from "./envoi";

export const MOTIFS_ENVOI = ["ENVOI_DEVIS", "ENVOI_FACTURE", "RELANCE_DEVIS", "REPONSE"] as const;
export type MotifEnvoi = (typeof MOTIFS_ENVOI)[number];

export const LIBELLES_MOTIF_ENVOI: Record<MotifEnvoi, string> = {
  ENVOI_DEVIS: "Envoi du devis",
  ENVOI_FACTURE: "Envoi de la facture",
  RELANCE_DEVIS: "Relance du devis",
  REPONSE: "Réponse au client",
};

/**
 * Tout mail qui part chez un client passe par cette proposition : rédigée par
 * le système, l'agent ou la personne elle-même, elle n'est envoyée qu'après
 * validation humaine, avec le texte validé (modifiable), jamais en lot.
 */
export const propositionEnvoiMail = definirProposition({
  type: "ENVOI_MAIL",
  libelle: "Envoyer un mail au client",
  schema: z.object({
    motif: z.enum(MOTIFS_ENVOI, "Motif d'envoi invalide."),
    dossierId: z.string().max(40).nullable().optional(),
    clientId: z.string().max(40).nullable().optional(),
    a: z.email("Adresse du destinataire invalide.").trim().max(160),
    objet: z.string("Objet manquant.").trim().min(1, "Objet manquant.").max(200, "Objet trop long."),
    texte: z.string("Message vide.").trim().min(1, "Message vide.").max(10_000, "Message trop long."),
    /** Documents du dossier joints en PDF (devis, facture). */
    documentIds: z.array(z.string().max(40)).max(5).default([]),
  }),
  sensible: true,
  validationGroupee: false,
  champs: [
    { cle: "a", libelle: "Destinataire", nature: "texte", obligatoire: true },
    { cle: "objet", libelle: "Objet", nature: "texte", obligatoire: true },
    { cle: "texte", libelle: "Message", nature: "texteLong", obligatoire: true },
  ],
  motifsRejet: [
    { code: "PAS_MAINTENANT", libelle: "Pas maintenant" },
    { code: "DEJA_FAIT", libelle: "Déjà fait autrement (téléphone, SMS…)" },
    { code: "CLIENT_A_REPONDU", libelle: "Le client a déjà répondu" },
  ],
  execution: "FILE",
  liens: (contenu) => (contenu.dossierId ? [{ libelle: "Dossier", href: `/dossiers?dossier=${contenu.dossierId}` }] : []),
  async pertinente(contenu) {
    if (!contenu.dossierId) return null;
    const dossier = await prisma.dossier.findUnique({ where: { id: contenu.dossierId }, select: { etape: true, archiveLe: true } });
    if (!dossier || dossier.archiveLe) return "le dossier n'existe plus";
    if (contenu.motif === "RELANCE_DEVIS" && dossier.etape !== "DEVIS_ENVOYE" && dossier.etape !== "RELANCE") {
      return `le dossier est passé à l'étape « ${LIBELLES_ETAPE[dossier.etape as keyof typeof LIBELLES_ETAPE] ?? dossier.etape} »`;
    }
    const documents = await prisma.document.findMany({ where: { id: { in: contenu.documentIds } }, select: { numero: true, statut: true } });
    const perime = documents.find((document) => document.statut === "REMPLACE" || document.statut === "ANNULEE");
    if (perime) return `le document ${perime.numero} a été ${perime.statut === "REMPLACE" ? "remplacé" : "annulé"}`;
    return null;
  },
  async executer(contenu, { propositionId }) {
    // Tâche rejouée après un envoi réussi : le mail ne repart pas.
    if (contenu.dossierId) {
      const deja = await prisma.dossierEvenement.findFirst({
        where: { dossierId: contenu.dossierId, type: "MAIL_ENVOYE", metadata: { contains: propositionId } },
        select: { id: true },
      });
      if (deja) return { resultat: { dejaEnvoye: true } };
    }
    const envoyeur = envoyeurMail();
    if (!envoyeur) {
      throw new ErreurDefinitive("Aucun envoi de mail configuré (boîte Gmail connectée, ou RESEND_API_KEY et EMAIL_FROM) : rien n'est parti.");
    }
    const pieces: PieceJointe[] = [];
    // Import à la demande : le rendu PDF ne charge que là où un mail part avec pièce jointe.
    const { lirePdfDocument } = await import("@/lib/dossiers/documents");
    for (const documentId of contenu.documentIds) {
      if (!contenu.dossierId) throw new ErreurDefinitive("Pièce jointe sans dossier.");
      const pdf = await lirePdfDocument(contenu.dossierId, documentId);
      pieces.push({ nom: pdf.nomFichier, type: "application/pdf", contenu: pdf.contenu });
    }

    const { identifiant } = await envoyeur.envoyer({ a: contenu.a, objet: contenu.objet, texte: contenu.texte, repondreA: EMETTEUR.email, pieces });

    if (contenu.dossierId) {
      const dossierId = contenu.dossierId;
      // Trace écrite dès l'envoi, avant tout autre effet : c'est elle qui empêche un second envoi.
      await prisma.dossierEvenement.create({
        data: {
          dossierId,
          type: "MAIL_ENVOYE",
          direction: "SORTANT",
          contenu: `${LIBELLES_MOTIF_ENVOI[contenu.motif]} à ${contenu.a} : « ${contenu.objet} »${pieces.length ? ` (${pieces.map((piece) => piece.nom).join(", ")})` : ""}`,
          metadata: JSON.stringify({ propositionId, motif: contenu.motif, a: contenu.a, documentIds: contenu.documentIds, identifiant, envoyeur: envoyeur.nom, texte: contenu.texte }),
        },
      });
      const changement = await prisma.$transaction(async (tx) => {
        if (contenu.documentIds.length > 0) {
          await tx.document.updateMany({ where: { id: { in: contenu.documentIds }, statut: "GENERE" }, data: { statut: "ENVOYE" } });
        }
        if (contenu.motif !== "RELANCE_DEVIS") return null;
        const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
        return dossier?.etape === "DEVIS_ENVOYE"
          ? appliquerChangementEtape(tx, { dossierId, de: "DEVIS_ENVOYE", vers: "RELANCE", nature: "AUTOMATIQUE", raison: "relance envoyée par mail" })
          : null;
      });
      if (changement) await effetsDuChangementEtape(changement);
    }
    return { resultat: { identifiant, envoyeur: envoyeur.nom } };
  },
});
