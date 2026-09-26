import { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { imputerSurFacture, planImputationFacture } from "@/lib/encaissements/service";
import { LIBELLES_TYPE_DOCUMENT, PROCHAINE_ACTION_APRES_DEVIS, PROCHAINE_ACTION_PREPARER_DEVIS, type TypeDocument } from "./constants";
import { dateDepuisJour, estJourValide, formatDateCourte, jourParis } from "./dates";
import { ErreurMetier } from "./erreurs";
import type { CategorieDestinataire } from "./mentions";
import { formatCentimes, versCentimes } from "./montants";
import { cleNumero, lireNumero } from "./numerotation";
import { inscrireNumeroManuel } from "./registre";
import { archiverFichier, enregistrerPdf, lireFichier } from "./stockage";

/**
 * Documents émis avant le CRM (devis, factures faits à la main) : rattachés au
 * dossier avec leur numéro du registre, leur date d'émission réelle, leur
 * montant et, si on l'a, leur PDF. Rien n'est généré : le compteur ne bouge
 * pas, le numéro est seulement lié au document (origine « REPRISE »).
 *
 * Restent protégés : un numéro déjà rattaché ne se rattache pas une seconde
 * fois, un numéro ne change jamais, et un numéro absent du registre ne s'y
 * inscrit que sur demande explicite (une faute de frappe y resterait pour
 * toujours). Le reste d'un document repris se corrige.
 */

export const TYPES_DOCUMENT_EXISTANT = ["DEVIS", "FACTURE"] as const;
export const STATUTS_DOCUMENT_EXISTANT = { DEVIS: ["ENVOYE", "ACCEPTE", "REFUSE"], FACTURE: ["GENERE"] } as const;

export const PDF_OCTETS_MAX = 9 * 1024 * 1024;

const jourPasse = (message: string) =>
  z
    .string(message)
    .refine(estJourValide, message)
    .refine((jour) => jour <= jourParis(new Date()), "La date d'émission est à venir.");

const champsDocument = {
  dateEmission: jourPasse("Date d'émission invalide."),
  montant: z.number("Montant invalide.").gt(0, "Le montant doit être supérieur à zéro.").max(10_000_000, "Montant invalide."),
  objet: z.string("Objet invalide.").trim().max(160, "Objet trop long : 160 caractères maximum.").nullable().optional(),
  statut: z.enum(["ENVOYE", "ACCEPTE", "REFUSE", "GENERE"], "Statut invalide.").optional(),
  acomptePct: z.number("Acompte invalide.").int("Acompte invalide.").min(0, "Acompte invalide.").max(100, "Acompte invalide.").nullable().optional(),
};

export const schemaDocumentExistant = z.object({
  type: z.enum(TYPES_DOCUMENT_EXISTANT, "Type de document invalide."),
  numero: z.string("Numéro manquant.").trim().min(6, "Numéro invalide : format attendu 2026-012 ou F2026-012.").max(30, "Numéro invalide."),
  ...champsDocument,
  /** Numéro absent du registre : l'y inscrire (émis hors du CRM), sur demande explicite seulement. */
  inscrireAuRegistre: z.boolean().optional(),
  /** Mission 11 : libellé de variante et visibilité dans l'espace client. */
  libelleVariante: z.string("Libellé invalide.").trim().max(80, "Libellé trop long : 80 caractères maximum.").nullable().optional(),
  visibleEspace: z.boolean("Visibilité invalide.").optional(),
});
export type EntreeDocumentExistant = z.output<typeof schemaDocumentExistant>;

export const schemaModificationDocumentExistant = z
  .object({
    dateEmission: champsDocument.dateEmission.optional(),
    montant: champsDocument.montant.optional(),
    objet: champsDocument.objet,
    statut: champsDocument.statut,
    acomptePct: champsDocument.acomptePct,
    libelleVariante: z.string("Libellé invalide.").trim().max(80, "Libellé trop long : 80 caractères maximum.").nullable().optional(),
    visibleEspace: z.boolean("Visibilité invalide.").optional(),
  })
  .refine((entree) => Object.values(entree).some((valeur) => valeur !== undefined), { message: "Rien à modifier." });

export type ResultatDocumentExistant = { documentId: string; numero: string; avertissements: string[] };

function statutDe(type: TypeDocument, statut: string | undefined): string {
  if (type === "FACTURE") return "GENERE";
  return statut && (STATUTS_DOCUMENT_EXISTANT.DEVIS as readonly string[]).includes(statut) ? statut : "ENVOYE";
}

/**
 * Rattache un document déjà émis au dossier, dans la transaction de l'appelant
 * (depuis le dossier, ou pendant la reprise d'un dossier entier). Une facture
 * reprise reçoit les paiements déjà enregistrés sur le dossier, comme une
 * facture générée.
 */
export async function rattacherDocumentExistant(tx: Transaction, dossierId: string, entree: EntreeDocumentExistant): Promise<ResultatDocumentExistant> {
  const dossier = await tx.dossier.findUnique({
    where: { id: dossierId },
    select: { clientNom: true, clientAdresse: true, clientCp: true, clientVille: true, clientId: true, objet: true, client: { select: { categorie: true, siret: true } } },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);

  const lu = lireNumero(entree.numero);
  if (!lu) throw new ErreurMetier("Numéro illisible : format attendu 2026-012, F2026-012 ou FACT-2026-0012.", 400);
  const avertissements: string[] = [];
  const dateEmission = dateDepuisJour(entree.dateEmission);
  const libelleType = LIBELLES_TYPE_DOCUMENT[entree.type].toLowerCase();

  let ligne = await tx.numeroDocument.findUnique({ where: { cle: cleNumero(lu.famille, lu.annee, lu.rang) } });
  if (!ligne) {
    if (!entree.inscrireAuRegistre) {
      throw new ErreurMetier(`Le numéro ${entree.numero} n'est pas au registre : vérifie la saisie, ou inscris-le (émis hors du CRM).`, 404, { absentDuRegistre: true });
    }
    ligne = await inscrireNumeroManuel(tx, {
      numero: entree.numero,
      type: entree.type,
      emisLe: entree.dateEmission,
      destinataire: dossier.clientNom,
      montant: entree.montant,
      note: "Inscrit en rattachant un document émis avant le CRM",
    });
    avertissements.push(`${ligne.numero} est inscrit au registre des numéros : le CRM ne l'attribuera jamais.`);
  } else {
    if (ligne.documentId) {
      const deja = await tx.document.findUnique({ where: { id: ligne.documentId }, select: { type: true, dossier: { select: { id: true, clientNom: true } } } });
      throw new ErreurMetier(
        `Le numéro ${ligne.numero} est déjà rattaché${deja ? ` (${LIBELLES_TYPE_DOCUMENT[deja.type as TypeDocument].toLowerCase()} du dossier « ${deja.dossier.clientNom} »)` : ""} : un numéro émis ne sert qu'une fois.`,
        409,
        deja ? { dossierId: deja.dossier.id } : undefined
      );
    }
    if (ligne.type !== entree.type && ligne.type !== "INCONNU") {
      avertissements.push(`Le registre notait ${ligne.numero} comme ${LIBELLES_TYPE_DOCUMENT[ligne.type as TypeDocument]?.toLowerCase() ?? ligne.type.toLowerCase()} : il devient ${libelleType}.`);
    }
    if (ligne.emisLe && jourParis(ligne.emisLe) !== entree.dateEmission) {
      avertissements.push(`Le registre date ${ligne.numero} du ${formatDateCourte(ligne.emisLe)} : cette date y reste, le document porte le ${formatDateCourte(dateEmission)}.`);
    }
    if (ligne.montant !== null && versCentimes(ligne.montant) !== versCentimes(entree.montant)) {
      avertissements.push(`Le registre indiquait ${formatCentimes(versCentimes(ligne.montant))} pour ${ligne.numero} : le montant du document fait foi.`);
    }
  }

  const categorie = (dossier.client?.categorie ?? "PARTICULIER") as CategorieDestinataire;
  const destinataire = {
    nom: dossier.clientNom,
    adresse: dossier.clientAdresse,
    codePostal: dossier.clientCp,
    ville: dossier.clientVille,
    siret: categorie === "PARTICULIER" ? null : (dossier.client?.siret ?? null),
    categorie,
  };
  let document;
  try {
    document = await tx.document.create({
      data: {
        dossierId,
        clientId: dossier.clientId,
        type: entree.type,
        numero: ligne.numero,
        dateEmission,
        objet: (entree.objet || dossier.objet || `${LIBELLES_TYPE_DOCUMENT[entree.type]} ${ligne.numero}`).slice(0, 160),
        lignes: "[]",
        totalHt: versCentimes(entree.montant) / 100,
        acomptePct: entree.type === "DEVIS" ? (entree.acomptePct ?? null) : null,
        noteMl: false,
        statut: statutDe(entree.type, entree.statut),
        origine: "REPRISE",
        destinataire: JSON.stringify(destinataire),
        categorieClient: categorie,
        libelleVariante: entree.libelleVariante || null,
        visibleEspace: entree.visibleEspace ?? true,
      },
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new ErreurMetier(`Un ${libelleType} porte déjà le numéro ${ligne.numero}.`, 409);
    }
    throw erreur;
  }

  await tx.numeroDocument.update({
    where: { id: ligne.id },
    data: {
      documentId: document.id,
      type: entree.type,
      montant: document.totalHt,
      ...(ligne.destinataire ? {} : { destinataire: dossier.clientNom }),
      ...(ligne.emisLe ? {} : { emisLe: dateEmission }),
    },
  });

  // Facture reprise : les paiements déjà reçus sur le dossier la règlent, comme à la génération.
  if (entree.type === "FACTURE") {
    const totalCentimes = versCentimes(document.totalHt);
    const plan = await planImputationFacture(tx, dossierId, totalCentimes);
    await imputerSurFacture(tx, { dossierId, registreId: ligne.id, numero: ligne.numero, totalCentimes }, plan);
  }

  // Mission 13 (B1) : comme à la génération (documents.ts › emettre), « Préparer le devis », posé par l'espace quand le
  // client a choisi, est fait dès qu'un devis est rattaché — généré ou déposé. Une action écrite par Lucas reste.
  if (entree.type === "DEVIS") {
    await tx.dossier.updateMany({
      where: { id: dossierId, prochaineAction: { startsWith: PROCHAINE_ACTION_PREPARER_DEVIS } },
      data: { prochaineAction: PROCHAINE_ACTION_APRES_DEVIS, prochaineActionDate: null },
    });
  }

  await tx.dossierEvenement.create({
    data: {
      dossierId,
      type: "DOCUMENT_REPRIS",
      direction: "INTERNE",
      contenu: `${LIBELLES_TYPE_DOCUMENT[entree.type]} ${ligne.numero}${entree.libelleVariante ? ` « ${entree.libelleVariante} »` : ""} du ${formatDateCourte(dateEmission)} rattaché (émis avant le CRM) : ${formatCentimes(versCentimes(document.totalHt))}`,
      metadata: JSON.stringify({ documentId: document.id, numero: ligne.numero, totalHt: document.totalHt, origine: "REPRISE" }),
      survenuLe: dateEmission,
    },
  });
  return { documentId: document.id, numero: ligne.numero, avertissements };
}

/** Rattachement demandé depuis le dossier. */
export async function enregistrerDocumentExistant(dossierId: string, entree: EntreeDocumentExistant): Promise<ResultatDocumentExistant> {
  return prisma.$transaction((tx) => rattacherDocumentExistant(tx, dossierId, entree));
}

async function documentRepris(dossierId: string, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, dossierId } });
  if (!document?.numero) throw new ErreurMetier("Document introuvable dans ce dossier.", 404);
  if (document.origine !== "REPRISE") {
    throw new ErreurMetier("Document généré par le CRM : il est figé à l'émission. Une facture s'annule par un avoir, un devis se refait.", 409);
  }
  return document;
}

/** Un document repris se corrige (date, montant, objet, statut, acompte) ; son numéro ne change jamais. */
export async function modifierDocumentExistant(dossierId: string, documentId: string, entree: z.output<typeof schemaModificationDocumentExistant>): Promise<string[]> {
  const document = await documentRepris(dossierId, documentId);
  const avertissements: string[] = [];
  await prisma.$transaction(async (tx) => {
    const totalHt = entree.montant !== undefined ? versCentimes(entree.montant) / 100 : undefined;
    await tx.document.update({
      where: { id: document.id },
      data: {
        ...(entree.dateEmission ? { dateEmission: dateDepuisJour(entree.dateEmission) } : {}),
        ...(totalHt !== undefined ? { totalHt } : {}),
        ...(entree.objet !== undefined ? { objet: (entree.objet || document.objet).slice(0, 160) } : {}),
        ...(entree.statut !== undefined ? { statut: statutDe(document.type as TypeDocument, entree.statut) } : {}),
        ...(entree.acomptePct !== undefined && document.type === "DEVIS" ? { acomptePct: entree.acomptePct } : {}),
        ...(entree.libelleVariante !== undefined ? { libelleVariante: entree.libelleVariante || null } : {}),
        ...(entree.visibleEspace !== undefined ? { visibleEspace: entree.visibleEspace } : {}),
      },
    });
    if (totalHt !== undefined) {
      const ligne = await tx.numeroDocument.findUnique({ where: { documentId: document.id }, include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } } });
      if (ligne) {
        await tx.numeroDocument.update({ where: { id: ligne.id }, data: { montant: totalHt } });
        const regle = ligne.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
        if (regle > versCentimes(totalHt)) {
          avertissements.push(`Les paiements imputés (${formatCentimes(regle)}) dépassent le nouveau montant : le trop-perçu reste à régulariser.`);
        }
      }
    }
    if (entree.dateEmission) {
      const ligne = await tx.numeroDocument.findUnique({ where: { documentId: document.id }, select: { numero: true, emisLe: true } });
      if (ligne?.emisLe && jourParis(ligne.emisLe) !== entree.dateEmission) {
        avertissements.push(`Le registre garde la date du ${formatDateCourte(ligne.emisLe)} pour ${ligne.numero}.`);
      }
    }
  });
  return avertissements;
}

/** PDF d'un document repris : importé, ou remplacé (l'ancien reste aux archives). */
export async function importerPdfDocument(dossierId: string, documentId: string, fichier: File): Promise<void> {
  const document = await documentRepris(dossierId, documentId);
  if (fichier.size === 0) throw new ErreurMetier("Le PDF est vide.", 400);
  if (fichier.size > PDF_OCTETS_MAX) throw new ErreurMetier("PDF trop lourd : 9 Mo maximum.", 413);
  const contenu = Buffer.from(await fichier.arrayBuffer());
  if (contenu.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ErreurMetier("Ce fichier n'est pas un PDF.", 415);

  if (document.pdfPath && (await lireFichier(document.pdfPath))) await archiverFichier(document.pdfPath, "pdf-remplace");
  const chemin = await enregistrerPdf(dossierId, document.type as TypeDocument, document.numero!, contenu);
  await prisma.document.update({ where: { id: document.id }, data: { pdfPath: chemin } });
}
