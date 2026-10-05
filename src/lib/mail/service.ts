import { createHash } from "node:crypto";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { proposer, validerProposition, vueProposition } from "@/lib/validation/service";
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

/** Une nouvelle tentative du même envoi dans ce délai (outil relancé après une coupure, double clic) est sans effet. */
const FENETRE_NOUVELLE_TENTATIVE_MS = 30 * 60_000;

/** Les statuts où l'envoi est décidé et pas fini, ou fini depuis peu : le même mail ne repart pas. */
const STATUTS_EN_COURS = ["VALIDEE", "ECHEC"];

/** L'empreinte d'un envoi : même document, même destinataire, même objet, même texte. */
export function cleEnvoiDocument(documentId: string, entree: z.output<typeof schemaEnvoiDocument>): string {
  const empreinte = createHash("sha256").update(JSON.stringify([entree.a.toLowerCase(), entree.objet, entree.texte])).digest("hex").slice(0, 16);
  return `envoi-document:${documentId}:${empreinte}`;
}

export type EnvoiDocument = {
  proposition: PropositionVue;
  /** Vrai : ce même envoi était déjà décidé (validé, parti depuis moins de 30 min, ou en échec) ; rien de nouveau ne part. */
  deja: boolean;
};

/**
 * Envoie un devis ou une facture par mail : une proposition ENVOI_MAIL validée tout de suite (la personne décide),
 * envoyée par la file. Mission 18 (B2) : idempotent — la clé d'unicité porte l'empreinte de l'envoi ; une nouvelle
 * tentative identique (outil relancé, double clic) rend l'envoi déjà décidé sans rien revalider ni renvoyer. Un envoi
 * identique écarté (rejeté, annulé, expiré) ou parti depuis plus de 30 minutes peut être refait : l'ancienne
 * proposition garde sa trace sous une clé close.
 */
export async function envoyerDocumentParMail(dossierId: string, documentId: string, entree: z.output<typeof schemaEnvoiDocument>): Promise<EnvoiDocument> {
  const document = await documentEnvoyable(dossierId, documentId);
  const cleUnicite = cleEnvoiDocument(documentId, entree);
  const existante = await prisma.proposition.findUnique({ where: { cleUnicite } });
  if (existante && existante.statut !== "EN_ATTENTE") {
    const recente = existante.statut === "EXECUTEE" && (existante.executeLe ?? existante.decideLe ?? existante.createdAt).getTime() > Date.now() - FENETRE_NOUVELLE_TENTATIVE_MS;
    if (recente || STATUTS_EN_COURS.includes(existante.statut)) return { proposition: vueProposition(existante), deja: true };
    // Écartée, ou partie depuis longtemps : un nouvel envoi, l'ancienne proposition reste (clé close).
    await prisma.proposition.update({ where: { id: existante.id }, data: { cleUnicite: `${cleUnicite}:${existante.id}` } });
  }
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
    cleUnicite,
    dossierId,
    clientId: document.dossier.clientId ?? undefined,
  });
  try {
    return { proposition: await validerProposition(id), deja: false };
  } catch (erreur) {
    // Validée entre-temps par une tentative concurrente : c'est le même envoi, rien de plus ne part.
    const lue = await prisma.proposition.findUnique({ where: { id } });
    if (erreur instanceof ErreurMetier && erreur.status === 409 && lue && lue.statut !== "EN_ATTENTE" && lue.statut !== "ANNULEE") return { proposition: vueProposition(lue), deja: true };
    throw erreur;
  }
}
