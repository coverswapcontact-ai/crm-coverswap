import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { LIBELLES_STATUT_DOCUMENT, MOTIFS_AVOIR } from "@/lib/dossiers/constants";
import { deposerDocument, schemaDepotDocument } from "@/lib/dossiers/depot-document";
import { annulerDevis, genererAvoir, modifierPresentationDevis } from "@/lib/dossiers/documents";
import { retirerAccord } from "@/lib/espace/validations";
import { definirOutil, format, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";

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

export const outilDeposerDocument = definirOutil({
  nom: "deposer_document",
  titre: "Déposer un PDF fait ailleurs (devis, facture, BAT…)",
  description:
    "Rattache à un dossier un document fait hors du CRM : un devis ou une facture (PDF, numéro, montant HT, date ; un devis reçoit un libellé de variante et est proposé au client dans son espace à côté des autres devis, rien n'est envoyé), ou tout autre document (BAT fournisseur, plan, attestation : type AUTRE, conservé et lisible depuis le dossier). Le fichier vient d'une pièce jointe conservée d'un mail (message_id + piece_id, voir « lire_mail »), d'un fichier déjà conservé (fichier_id) ou de son contenu en base64. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend(schemaDepotDocument.shape),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (« ouvrir_dossier »).`, 409);
    const origine = e.source.fichier_id ? `fichier conservé ${e.source.fichier_id}` : e.source.piece_id ? `pièce ${e.source.piece_id} du mail ${e.source.message_id}` : `contenu fourni (${e.source.nom ?? "document.pdf"})`;
    if (e.type === "AUTRE") return `Je vais déposer sur le dossier de ${r.ids.nom} le document « ${e.libelle ?? e.source.nom ?? "document"} » (${origine}). Il sera conservé et lisible depuis le dossier ; rien n'est envoyé au client.`;
    return `Je vais rattacher au dossier de ${r.ids.nom} ${e.type === "DEVIS" ? "le devis" : "la facture"} ${e.numero ?? "(numéro manquant)"}${e.libelle ? ` « ${e.libelle} »` : ""} : ${e.montant !== undefined ? format.euros(e.montant) : "(montant manquant)"} HT, ${e.date_emission ?? "daté d'aujourd'hui"}, PDF ${origine}${e.type === "DEVIS" ? `, ${e.visible_espace === false ? "masqué dans son espace" : "visible dans son espace, à côté des autres devis proposés"}` : ""}. Aucun mail n'est envoyé.${e.inscrire_au_registre ? " Le numéro sera inscrit au registre s'il n'y est pas." : ""}`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier ouvert : ouvre-le d'abord (« ouvrir_dossier »).`, 409);
    const { dossierId: _d, clientId: _c, leadId: _l, nom: _n, ...entree } = e;
    void _d;
    void _c;
    void _l;
    void _n;
    const resultat = await deposerDocument(r.ids.dossierId, entree);
    if (resultat.nature === "FICHIER") {
      return { texte: `Document « ${resultat.libelle} » déposé sur le dossier de ${r.ids.nom} (${resultat.nom}, ${Math.round(resultat.octets / 1024)} Ko). Lisible depuis le dossier ; rien n'est envoyé au client.`, donnees: { fichierId: resultat.fichierId, dossierId: r.ids.dossierId, nom: resultat.nom, typeMime: resultat.typeMime }, liens: [lien("Le document", `/api/fichiers/${resultat.fichierId}`), lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
    }
    return {
      texte: `${resultat.type === "DEVIS" ? "Devis" : "Facture"} ${resultat.numero} rattaché${resultat.type === "FACTURE" ? "e" : ""} au dossier de ${r.ids.nom} avec son PDF (${Math.round(resultat.octets / 1024)} Ko).${resultat.type === "DEVIS" ? ` ${entree.visible_espace === false ? "Masqué dans son espace." : "Proposé dans son espace, à côté des autres devis."}` : ""}${resultat.avertissements.length ? ` ${resultat.avertissements.join(" ")}` : ""}`,
      donnees: { documentId: resultat.documentId, numero: resultat.numero, dossierId: r.ids.dossierId, avertissements: resultat.avertissements },
      liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)],
    };
  },
});

/** Mission 11 : l'interrupteur « visible dans l'espace » et le libellé d'un devis émis, comme dans le panneau du dossier. */
export const outilPresenterDevis = definirOutil({
  nom: "presenter_devis",
  titre: "Libellé et visibilité d'un devis émis",
  description:
    "Change la présentation d'un devis déjà émis (généré ou repris), jamais son contenu : son libellé de variante (« façades seules ») et sa visibilité dans l'espace client (masqué : le client ne le voit plus, il reste dans le dossier). C'est l'interrupteur du panneau « Devis et accord ». Réversible (remettre l'ancienne valeur).",
  niveau: "REVERSIBLE",
  schema: z.object({
    dossierId: z.string().max(40),
    documentId: z.string().max(40),
    libelle_variante: z.string().trim().max(80).nullable().optional().describe("Nouveau libellé ; null l'efface."),
    visible_espace: z.boolean().optional(),
  }),
  executer: async (e) => {
    if (e.libelle_variante === undefined && e.visible_espace === undefined) throw new ErreurMetier("Rien à changer : donne libelle_variante et/ou visible_espace.", 400);
    const r = await modifierPresentationDevis(e.dossierId, e.documentId, { libelleVariante: e.libelle_variante, visibleEspace: e.visible_espace });
    return { texte: `Devis ${r.numero} : libellé ${r.libelleVariante ? `« ${r.libelleVariante} »` : "aucun"}, ${r.visibleEspace ? "visible dans l'espace client" : "masqué dans l'espace client"}.`, donnees: r, liens: [lien("Dossier", `/dossiers?dossier=${e.dossierId}`)] };
  },
});

/** Mission 11 : retirer un bon pour accord à la place du client (le geste du panneau) ; les autres devis proposés redeviennent au choix. */
export const outilRetirerAccord = definirOutil({
  nom: "retirer_accord",
  titre: "Retirer le bon pour accord d'un dossier",
  description:
    "Retire l'accord donné sur le devis d'un dossier (le client a changé d'avis, erreur) : la preuve reste gardée, le dossier revient à « Devis envoyé », le devis redevient un devis émis et les autres devis proposés redeviennent au choix dans l'espace. Refusé si un paiement est déjà engagé. Sensible : aperçu puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ motif: z.string().trim().max(500).optional() }),
  apercu: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
    const accord = await prisma.accordDevis.findFirst({ where: { dossierId: r.ids.dossierId, retireLe: null }, orderBy: { createdAt: "desc" } });
    if (!accord) throw new ErreurMetier(`Aucun bon pour accord en vigueur chez ${r.ids.nom}.`, 409);
    return `Je vais retirer le bon pour accord de ${r.ids.nom} sur le devis ${accord.numeroDevis ?? ""} (donné le ${format.jourCourt(accord.createdAt)} par ${accord.nomSignataire})${e.motif ? ` — motif : ${e.motif}` : ""}. La preuve reste gardée ; le dossier revient à « Devis envoyé » ; les autres devis proposés redeviennent au choix.`;
  },
  executer: async (e) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
    const espace = await prisma.espaceClient.findFirst({ where: { dossierId: r.ids.dossierId, archiveLe: null }, orderBy: { createdAt: "desc" } });
    if (!espace) throw new ErreurMetier(`${r.ids.nom} n'a pas d'espace client : l'accord ne vient pas de l'espace.`, 409);
    await retirerAccord(espace, "LUCAS", e.motif ?? "");
    return { texte: `Bon pour accord retiré chez ${r.ids.nom} : preuve gardée, dossier revenu à « Devis envoyé », devis proposés de nouveau au choix.`, donnees: { dossierId: r.ids.dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
  },
});

export const OUTILS_DOCUMENTS = [outilAnnulerDocument, outilDeposerDocument, outilPresenterDevis, outilRetirerAccord];
