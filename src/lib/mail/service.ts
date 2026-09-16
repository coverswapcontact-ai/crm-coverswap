import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { proposer, validerProposition } from "@/lib/validation/service";
import type { PropositionVue } from "@/lib/validation/types";

/**
 * Envoi d'un devis ou d'une facture par mail, décidé par la personne depuis le
 * dossier : même circuit que les propositions de l'agent (proposition
 * ENVOI_MAIL validée, envoi par la file de tâches, trace dans le dossier), la
 * personne en est l'autrice et la décideuse.
 */

export const schemaEnvoiDocument = z.object({
  a: z.email("Adresse du destinataire invalide.").trim().max(160),
  objet: z.string("Objet manquant.").trim().min(1, "Objet manquant.").max(200, "Objet trop long."),
  texte: z.string("Message vide.").trim().min(1, "Message vide.").max(10_000, "Message trop long."),
});

async function documentEnvoyable(dossierId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, dossierId, numero: { not: null } },
    include: { dossier: { select: { clientNom: true, clientEmail: true, clientId: true, objet: true, client: { select: { prenom: true, emails: { orderBy: [{ principale: "desc" }], select: { adresse: true } } } } } } },
  });
  if (!document?.numero) throw new ErreurMetier("Document introuvable dans ce dossier.", 404);
  if (document.type !== "DEVIS" && document.type !== "FACTURE") throw new ErreurMetier("Seuls un devis ou une facture s'envoient par mail d'ici.", 400);
  if (document.statut === "REMPLACE") throw new ErreurMetier("Ce devis a été remplacé : envoyer le nouveau.", 409);
  if (document.statut === "ANNULEE") throw new ErreurMetier("Cette facture est annulée par un avoir : envoyer la nouvelle.", 409);
  if (document.origine === "REPRISE" && !document.pdfPath) throw new ErreurMetier("Document repris sans PDF : importe son PDF avant de l'envoyer.", 409);
  return document;
}

/** Brouillon pré-rempli : destinataire connu, objet et message types, modifiables. */
export async function brouillonEnvoiDocument(dossierId: string, documentId: string): Promise<z.output<typeof schemaEnvoiDocument>> {
  const document = await documentEnvoyable(dossierId, documentId);
  const { dossier } = document;
  const bonjour = dossier.client?.prenom ? `Bonjour ${dossier.client.prenom},` : "Bonjour,";
  const signature = `Bien cordialement,\n\nLucas Villemin\nCoverSwap\n${EMETTEUR.telephone}`;
  const texte =
    document.type === "DEVIS"
      ? `${bonjour}\n\nVeuillez trouver ci-joint le devis n° ${document.numero} pour ${dossier.objet.toLowerCase()}, d'un montant de ${formatMontant(document.totalHt)}.\n\nJe reste à votre disposition pour toute question ou tout ajustement.\n\n${signature}`
      : `${bonjour}\n\nVeuillez trouver ci-joint la facture n° ${document.numero} d'un montant de ${formatMontant(document.totalHt)}. Les coordonnées bancaires figurent sur la facture.\n\nMerci pour votre confiance.\n\n${signature}`;
  return {
    a: dossier.clientEmail ?? dossier.client?.emails[0]?.adresse ?? "",
    objet: `${document.type === "DEVIS" ? "Devis" : "Facture"} n° ${document.numero} — CoverSwap`,
    texte,
  };
}

export async function envoyerDocumentParMail(dossierId: string, documentId: string, entree: z.output<typeof schemaEnvoiDocument>): Promise<PropositionVue> {
  const document = await documentEnvoyable(dossierId, documentId);
  const { id } = await proposer({
    type: "ENVOI_MAIL",
    titre: `Envoyer ${document.type === "DEVIS" ? "le devis" : "la facture"} ${document.numero} à ${document.dossier.clientNom}`,
    contenu: {
      motif: document.type === "DEVIS" ? "ENVOI_DEVIS" : "ENVOI_FACTURE",
      dossierId,
      clientId: document.dossier.clientId,
      a: entree.a,
      objet: entree.objet,
      texte: entree.texte,
      documentIds: [documentId],
    },
    dossierId,
    clientId: document.dossier.clientId ?? undefined,
  });
  return validerProposition(id);
}
