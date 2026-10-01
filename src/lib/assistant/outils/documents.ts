import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { LIBELLES_STATUT_DOCUMENT, MOTIFS_AVOIR } from "@/lib/dossiers/constants";
import { annulerDevis, genererAvoir } from "@/lib/dossiers/documents";
import { definirOutil, format, lien } from "../definition";

/**
 * Les documents (mission 11) : annuler un devis ou une facture, déposer un PDF
 * fait ailleurs. « generer_document » reste dans ecriture.ts, étendu (libellé
 * de variante, mail débrayable, remplacement explicite, avenant, passage devis
 * → facture, remise, acompte).
 */

const CODES_MOTIF_AVOIR = ["ERREUR_MONTANT", "ERREUR_CLIENT", "PRESTATION_ANNULEE", "GESTE_COMMERCIAL", "AUTRE"] as const;

async function documentDe(dossierId: string, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, dossierId, archiveLe: null }, include: { dossier: { select: { clientNom: true } } } });
  if (!document?.numero) throw new ErreurMetier("Document introuvable dans ce dossier (identifiant rendu par « lire_fiche »).", 404);
  return document;
}

export const outilAnnulerDocument = definirOutil({
  nom: "annuler_document",
  titre: "Annuler un devis ou une facture",
  description:
    "Un devis émis qui ne sera pas signé (erreur, client parti) passe « Annulé » : il reste dans l'historique, le client ne le voit plus, son numéro n'est jamais réutilisé ; un devis accepté ne s'annule pas (retirer l'accord d'abord). Une facture ne se modifie ni ne s'efface : elle s'annule par un avoir du même montant (motif_avoir : ERREUR_MONTANT, ERREUR_CLIENT, PRESTATION_ANNULEE, GESTE_COMMERCIAL, AUTRE + précision). Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: z.object({
    dossierId: z.string().max(40),
    documentId: z.string().max(40),
    motif: z.string().trim().max(300).optional().describe("Devis : pourquoi (facultatif). Facture avec motif_avoir AUTRE : la précision (obligatoire)."),
    motif_avoir: z.enum(CODES_MOTIF_AVOIR).optional().describe("Facture seulement."),
  }),
  apercu: async (e) => {
    const d = await documentDe(e.dossierId, e.documentId);
    if (d.type === "DEVIS") {
      if (d.statut === "ACCEPTE") throw new ErreurMetier(`Le devis ${d.numero} est accepté : il ne s'annule pas. Retire d'abord l'accord (retirer-accord depuis le dossier).`, 409);
      return `Je vais annuler le devis ${d.numero}${d.libelleVariante ? ` « ${d.libelleVariante} »` : ""} de ${d.dossier.clientNom} (${format.euros(d.totalHt)}, ${LIBELLES_STATUT_DOCUMENT[d.statut as keyof typeof LIBELLES_STATUT_DOCUMENT]?.toLowerCase() ?? d.statut})${e.motif ? ` — motif : ${e.motif}` : ""}. Il passe « Annulé », reste dans l'historique, le client ne le voit plus dans son espace. Aucun mail n'est envoyé.`;
    }
    if (d.type === "FACTURE") {
      if (!e.motif_avoir) throw new ErreurMetier("Une facture s'annule par un avoir : donne motif_avoir (ERREUR_MONTANT, ERREUR_CLIENT, PRESTATION_ANNULEE, GESTE_COMMERCIAL, AUTRE).", 400);
      const libelle = MOTIFS_AVOIR.find((m) => m.code === e.motif_avoir)?.libelle ?? e.motif_avoir;
      return `Je vais annuler la facture ${d.numero} de ${d.dossier.clientNom} par un avoir de ${format.euros(d.totalHt)} (motif : ${libelle}${e.motif ? ` — ${e.motif}` : ""}). La facture et l'avoir restent, numérotés ; l'avoir sera à envoyer au client (« envoyer_document »).`;
    }
    throw new ErreurMetier("Un avoir ne s'annule pas.", 409);
  },
  executer: async (e) => {
    const d = await documentDe(e.dossierId, e.documentId);
    if (d.type === "DEVIS") {
      const r = await annulerDevis(e.dossierId, e.documentId, e.motif ?? "");
      return { texte: `Devis ${r.numero} de ${d.dossier.clientNom} annulé : gardé en historique, plus proposé dans son espace.`, donnees: { documentId: r.id, numero: r.numero, dossierId: e.dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${e.dossierId}`)] };
    }
    if (d.type === "FACTURE") {
      if (!e.motif_avoir) throw new ErreurMetier("Une facture s'annule par un avoir : donne motif_avoir.", 400);
      const { document: avoir } = await genererAvoir(e.dossierId, e.documentId, { motif: e.motif_avoir, precision: e.motif });
      return { texte: `Avoir ${avoir.numero} généré (${format.euros(avoir.totalHt)}) : la facture ${d.numero} de ${d.dossier.clientNom} est annulée. À envoyer au client si besoin (« envoyer_document », documentId ${avoir.id}).`, donnees: { avoirId: avoir.id, numero: avoir.numero, factureId: d.id, dossierId: e.dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${e.dossierId}`)] };
    }
    throw new ErreurMetier("Un avoir ne s'annule pas.", 409);
  },
});

export const OUTILS_DOCUMENTS = [outilAnnulerDocument];
