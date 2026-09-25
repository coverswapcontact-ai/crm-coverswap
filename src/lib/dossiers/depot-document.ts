import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { enregistrerDocumentExistant, importerPdfDocument, schemaDocumentExistant } from "@/lib/dossiers/documents-existants";
import { enregistrerFichier, lireFichierConserve } from "@/lib/fichiers/stockage";
import { lirePieceMessage } from "@/lib/messages/consultation";

/**
 * « deposer_document » (mission 11) : un PDF fait ailleurs — devis, facture,
 * BAT fournisseur, plan — rattaché à un dossier. Un devis ou une facture
 * devient un document repris (numéro, montant, date, PDF), proposé au client
 * comme les autres ; tout autre document est un fichier conservé, écrit dans
 * l'historique du dossier et servi par /api/fichiers/[id]. Le fichier vient
 * d'une pièce de mail conservée, d'un fichier déjà conservé, ou du contenu
 * lui-même (base64). Rien n'est envoyé au client.
 */

export const OCTETS_MAX_DEPOT = 9 * 1024 * 1024;
export const RACINE_DOCUMENTS = "documents";

export const schemaSourceDocument = z
  .object({
    fichier_id: z.string().max(40).optional().describe("Un fichier déjà conservé dans le CRM (identifiant)."),
    message_id: z.string().max(40).optional().describe("Avec piece_id : une pièce jointe conservée d'un mail (« lire_mail » les liste)."),
    piece_id: z.string().max(40).optional(),
    contenu_base64: z.string().max(13_000_000).optional().describe("Le fichier lui-même, en base64 (PDF ; image acceptée pour un document « AUTRE »)."),
    nom: z.string().trim().max(200).optional().describe("Nom du fichier, avec contenu_base64 (« devis-cuisine.pdf »)."),
    type_mime: z.string().trim().max(80).optional().describe("Avec contenu_base64 : application/pdf par défaut."),
  })
  .refine((s) => Boolean(s.fichier_id || (s.message_id && s.piece_id) || s.contenu_base64), { message: "Donne le fichier : fichier_id, ou message_id + piece_id, ou contenu_base64." });

export const schemaDepotDocument = z.object({
  type: z.enum(["DEVIS", "FACTURE", "AUTRE"]).describe("DEVIS ou FACTURE : document repris avec son numéro ; AUTRE : BAT fournisseur, plan, attestation…"),
  numero: z.string().trim().max(40).optional().describe("Devis ou facture : son numéro (celui du registre s'il y est)."),
  libelle: z.string().trim().max(80).optional().describe("Devis : libellé de la variante (« façades + plan de travail ») ; AUTRE : nature du document (« BAT fournisseur »)."),
  montant: z.number().positive().max(1_000_000).optional().describe("Devis ou facture : montant HT en euros."),
  date_emission: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "AAAA-MM-JJ").optional().describe("Devis ou facture : date d'émission (AAAA-MM-JJ) ; aujourd'hui par défaut."),
  statut: z.enum(["ENVOYE", "ACCEPTE", "REFUSE"]).optional().describe("Devis : où il en est (ENVOYE par défaut)."),
  acompte_pct: z.number().int().min(0).max(100).optional(),
  objet: z.string().trim().max(160).optional(),
  visible_espace: z.boolean().optional().describe("Devis : visible dans l'espace client (vrai par défaut)."),
  inscrire_au_registre: z.boolean().optional().describe("Numéro absent du registre : l'y inscrire (sur demande explicite de Lucas seulement)."),
  source: schemaSourceDocument,
});
export type EntreeDepotDocument = z.output<typeof schemaDepotDocument>;

export type FichierDepose = { contenu: Buffer; nom: string; typeMime: string };

/** Le fichier à déposer, d'où qu'il vienne. */
export async function lireSource(source: z.output<typeof schemaSourceDocument>): Promise<FichierDepose> {
  let fichier: FichierDepose;
  if (source.fichier_id) fichier = await lireFichierConserve(source.fichier_id);
  else if (source.message_id && source.piece_id) fichier = await lirePieceMessage(source.message_id, source.piece_id);
  else {
    const contenu = Buffer.from(source.contenu_base64!.replace(/^data:[^;]+;base64,/, ""), "base64");
    fichier = { contenu, nom: source.nom || "document.pdf", typeMime: source.type_mime || "application/pdf" };
  }
  if (fichier.contenu.length === 0) throw new ErreurMetier("Le fichier est vide.", 400);
  if (fichier.contenu.length > OCTETS_MAX_DEPOT) throw new ErreurMetier("Fichier trop lourd : 9 Mo maximum.", 413);
  return fichier;
}

const versFile = (f: FichierDepose) => new File([new Uint8Array(f.contenu)], f.nom, { type: f.typeMime });

export type ResultatDepot =
  | { nature: "DOCUMENT"; documentId: string; numero: string; type: "DEVIS" | "FACTURE"; avertissements: string[]; nom: string; octets: number }
  | { nature: "FICHIER"; fichierId: string; nom: string; typeMime: string; octets: number; libelle: string };

export async function deposerDocument(dossierId: string, entree: EntreeDepotDocument): Promise<ResultatDepot> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, archiveLe: true, objet: true } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const fichier = await lireSource(entree.source);

  if (entree.type === "AUTRE") {
    const conserve = await enregistrerFichier(RACINE_DOCUMENTS, versFile(fichier));
    const libelle = entree.libelle || fichier.nom;
    await prisma.dossierEvenement.create({
      data: { dossierId, type: "DOCUMENT_DEPOSE", direction: "INTERNE", contenu: `Document déposé : ${libelle}${libelle !== fichier.nom ? ` (${fichier.nom})` : ""}, ${Math.round(fichier.contenu.length / 1024)} Ko`, metadata: JSON.stringify({ fichierId: conserve.id, nom: fichier.nom, typeMime: fichier.typeMime, taille: fichier.contenu.length, libelle }) },
    });
    return { nature: "FICHIER", fichierId: conserve.id, nom: fichier.nom, typeMime: fichier.typeMime, octets: fichier.contenu.length, libelle };
  }

  if (fichier.typeMime !== "application/pdf") throw new ErreurMetier("Un devis ou une facture se dépose en PDF.", 400);
  if (!entree.numero) throw new ErreurMetier(`Le numéro ${entree.type === "DEVIS" ? "du devis" : "de la facture"} est obligatoire.`, 400);
  if (!entree.montant) throw new ErreurMetier("Le montant HT est obligatoire.", 400);
  const enregistre = await enregistrerDocumentExistant(
    dossierId,
    schemaDocumentExistant.parse({
      type: entree.type,
      numero: entree.numero,
      dateEmission: entree.date_emission ?? new Date().toISOString().slice(0, 10),
      montant: entree.montant,
      objet: entree.objet ?? null,
      ...(entree.type === "DEVIS" ? { statut: entree.statut ?? "ENVOYE", acomptePct: entree.acompte_pct ?? null, libelleVariante: entree.libelle ?? null, visibleEspace: entree.visible_espace ?? true } : {}),
      inscrireAuRegistre: entree.inscrire_au_registre ?? false,
    })
  );
  await importerPdfDocument(dossierId, enregistre.documentId, versFile(fichier));
  return { nature: "DOCUMENT", documentId: enregistre.documentId, numero: enregistre.numero, type: entree.type, avertissements: enregistre.avertissements, nom: fichier.nom, octets: fichier.contenu.length };
}
