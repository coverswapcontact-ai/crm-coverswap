import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { rendreDocumentPdf, type DonneesDocumentPdf } from "@/lib/pdf/DocumentPdf";
import {
  ACOMPTE_PCT_DEFAUT,
  TYPES_DOCUMENT,
  UNITES,
  type EtapeDossier,
  type LigneDocument,
  type TypeDocument,
} from "./constants";
import { ErreurMetier } from "./erreurs";
import { calculerMontants, formatCentimes, versCentimes } from "./montants";
import { attribuerNumero, numeroFactice } from "./numerotation";
import { estEtape } from "./regles";
import { enregistrerPdf, lireFichier, lireLignes, supprimerFichier } from "./stockage";
import { appliquerChangementEtape, effetsDuChangementEtape, type ChangementEtape } from "./transitions";

const arrondiCentieme = (valeur: number) => versCentimes(valeur) / 100;

const schemaPrestation = z.object({
  type: z.literal("PRESTATION"),
  designation: z
    .string("Désignation invalide.")
    .trim()
    .min(1, "Chaque prestation doit avoir une désignation.")
    .max(200, "Désignation trop longue : 200 caractères maximum."),
  sousDesignation: z
    .string("Sous-désignation invalide.")
    .trim()
    .max(200, "Sous-désignation trop longue : 200 caractères maximum.")
    .optional()
    .transform((valeur) => valeur || undefined),
  quantite: z
    .number("Quantité invalide.")
    .min(0.01, "Chaque quantité doit être supérieure à zéro.")
    .max(100_000, "Quantité invalide.")
    .transform(arrondiCentieme),
  unite: z.enum(UNITES, "Unité invalide."),
  prixUnitaire: z
    .number("Prix unitaire invalide.")
    .min(0, "Un prix unitaire ne peut pas être négatif.")
    .max(1_000_000, "Prix unitaire invalide.")
    .transform(arrondiCentieme),
});

const schemaSection = z.object({
  type: z.literal("SECTION"),
  libelle: z
    .string("Libellé de section invalide.")
    .trim()
    .min(1, "Chaque ligne de section doit avoir un libellé.")
    .max(120, "Libellé de section trop long : 120 caractères maximum."),
});

export const schemaGeneration = z
  .object({
    type: z.enum(TYPES_DOCUMENT, "Type de document invalide."),
    objet: z
      .string("Objet invalide.")
      .trim()
      .min(1, "L'objet du document est obligatoire.")
      .max(160, "Objet trop long : 160 caractères maximum."),
    lignes: z
      .array(z.discriminatedUnion("type", [schemaPrestation, schemaSection]), "Lignes invalides.")
      .min(1, "Ajoute au moins une prestation.")
      .max(80, "80 lignes maximum par document."),
    noteMl: z.boolean("Mention mètre linéaire invalide."),
    acomptePct: z
      .number("Pourcentage d'acompte invalide.")
      .int("Le pourcentage d'acompte doit être un nombre entier.")
      .min(0, "Le pourcentage d'acompte doit être compris entre 0 et 100.")
      .max(100, "Le pourcentage d'acompte doit être compris entre 0 et 100.")
      .nullable(),
  })
  .refine((entree) => entree.lignes.some((ligne) => ligne.type === "PRESTATION"), {
    message: "Ajoute au moins une prestation.",
    path: ["lignes"],
  });

export type EntreeGeneration = z.output<typeof schemaGeneration>;

// Génération d'un devis : le dossier passe à « Devis envoyé » s'il n'y est pas
// encore et n'a pas dépassé ce stade. Génération d'une facture : le dossier
// passe à « Facturé » depuis « Chantier ». Ailleurs l'étape ne bouge pas.
function etapeApresGeneration(type: TypeDocument, etape: EtapeDossier): EtapeDossier | null {
  if (type === "DEVIS" && (etape === "QUALIFICATION" || etape === "SIMULATION" || etape === "RELANCE")) {
    return "DEVIS_ENVOYE";
  }
  if (type === "FACTURE" && etape === "CHANTIER") return "FACTURE";
  return null;
}

type ClientFige = DonneesDocumentPdf["client"];

/**
 * Génère un devis ou une facture : numéro, PDF archivé, document, événement,
 * et changement d'étape automatique, le tout dans une transaction.
 */
export async function genererDocument(dossierId: string, entree: EntreeGeneration) {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { etape: true, clientNom: true, clientAdresse: true, clientCp: true, clientVille: true },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  if (!estEtape(dossier.etape)) throw new Error(`Étape inconnue en base : ${dossier.etape}`);
  const etape = dossier.etape;
  if (etape === "PERDU" || etape === "EN_PAUSE") {
    throw new ErreurMetier("Reprends le dossier avant de générer un document.", 409);
  }
  if (etape === "ENCAISSE") {
    throw new ErreurMetier("Dossier encaissé : ouvre un nouveau dossier pour une nouvelle prestation.", 409);
  }

  const lignes: LigneDocument[] = entree.lignes;
  const acomptePct = entree.type === "DEVIS" ? (entree.acomptePct ?? ACOMPTE_PCT_DEFAUT) : null;
  const { totalHtCentimes } = calculerMontants(lignes, acomptePct);
  if (totalHtCentimes <= 0) {
    throw new ErreurMetier("Le total du document est nul : vérifie les quantités et les prix.");
  }

  const dateEmission = new Date();
  const client: ClientFige = {
    nom: dossier.clientNom,
    adresse: dossier.clientAdresse,
    codePostal: dossier.clientCp,
    ville: dossier.clientVille,
  };
  const donneesPdf: DonneesDocumentPdf = {
    type: entree.type,
    numero: numeroFactice(entree.type, dateEmission),
    dateEmission,
    objet: entree.objet,
    lignes,
    acomptePct,
    noteMl: entree.noteMl,
    client,
  };

  // Mise en page d'essai hors transaction, avec un numéro factice de même
  // longueur : elle fixe le mode (normal ou compact) sans garder la base
  // verrouillée pendant le rendu.
  const essai = await rendreDocumentPdf(donneesPdf);

  const ecrit: { chemin?: string } = {};
  try {
    const resultat = await prisma.$transaction(
      async (tx) => {
        const numero = await attribuerNumero(tx, entree.type, dateEmission);
        const rendu = await rendreDocumentPdf({ ...donneesPdf, numero }, { compact: essai.compact });
        ecrit.chemin = await enregistrerPdf(dossierId, entree.type, numero, rendu.contenu);

        const document = await tx.document.create({
          data: {
            dossierId,
            type: entree.type,
            numero,
            dateEmission,
            objet: entree.objet,
            lignes: JSON.stringify(lignes),
            totalHt: totalHtCentimes / 100,
            acomptePct,
            noteMl: entree.noteMl,
            pdfPath: ecrit.chemin,
            statut: "GENERE",
          },
        });

        const libelle = entree.type === "DEVIS" ? `Devis ${numero} généré` : `Facture ${numero} générée`;
        await tx.dossierEvenement.create({
          data: {
            dossierId,
            type: entree.type === "DEVIS" ? "DEVIS_GENERE" : "FACTURE_GENEREE",
            direction: "INTERNE",
            contenu: `${libelle} : ${formatCentimes(totalHtCentimes)}`,
            // Le bloc client est figé ici : un PDF reconstitué plus tard
            // gardera l'adresse imprimée à l'émission.
            metadata: JSON.stringify({ documentId: document.id, numero, totalHt: document.totalHt, client }),
          },
        });

        const vers = etapeApresGeneration(entree.type, etape);
        const changement: ChangementEtape | null = vers
          ? await appliquerChangementEtape(tx, { dossierId, de: etape, vers, nature: "AUTOMATIQUE", documentId: document.id })
          : null;
        return { document, changement };
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    if (resultat.changement) await effetsDuChangementEtape(resultat.changement);
    return resultat;
  } catch (erreur) {
    // Transaction annulée : le numéro retourne au compteur, le PDF écrit part avec lui.
    if (ecrit.chemin) await supprimerFichier(ecrit.chemin).catch(() => {});
    throw erreur;
  }
}

function lireClientFige(metadata: string | undefined): ClientFige | null {
  if (!metadata) return null;
  try {
    const client = (JSON.parse(metadata) as { client?: Partial<ClientFige> }).client;
    if (client && typeof client.nom === "string" && typeof client.adresse === "string"
      && typeof client.codePostal === "string" && typeof client.ville === "string") {
      return { nom: client.nom, adresse: client.adresse, codePostal: client.codePostal, ville: client.ville };
    }
  } catch {
    // metadata illisible : repli sur le dossier
  }
  return null;
}

export function nomFichierPdf(type: string, numero: string, clientNom: string): string {
  const client = clientNom
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 40);
  return `${type === "DEVIS" ? "Devis" : "Facture"}-${numero}${client ? `-${client}` : ""}.pdf`;
}

/**
 * PDF archivé d'un document. S'il manque sur le volume, il est reconstitué
 * à partir des données enregistrées (lignes, date, numéro, bloc client figé
 * à la génération) puis réarchivé.
 */
export async function lirePdfDocument(dossierId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, dossierId },
    include: { dossier: { select: { clientNom: true, clientAdresse: true, clientCp: true, clientVille: true } } },
  });
  if (!document || !document.numero || !document.dateEmission) {
    throw new ErreurMetier("Document introuvable.", 404);
  }
  const type = document.type as TypeDocument;
  const nomFichier = nomFichierPdf(type, document.numero, document.dossier.clientNom);

  const archive = document.pdfPath ? await lireFichier(document.pdfPath) : null;
  if (archive) return { contenu: archive, nomFichier };

  const generation = await prisma.dossierEvenement.findFirst({
    where: { dossierId, type: { in: ["DEVIS_GENERE", "FACTURE_GENEREE"] }, metadata: { contains: document.id } },
    select: { metadata: true },
  });
  const client = lireClientFige(generation?.metadata) ?? {
    nom: document.dossier.clientNom,
    adresse: document.dossier.clientAdresse,
    codePostal: document.dossier.clientCp,
    ville: document.dossier.clientVille,
  };
  const rendu = await rendreDocumentPdf({
    type,
    numero: document.numero,
    dateEmission: document.dateEmission,
    objet: document.objet,
    lignes: lireLignes(document.lignes),
    acomptePct: document.acomptePct,
    noteMl: document.noteMl,
    client,
  });
  const chemin = await enregistrerPdf(dossierId, type, document.numero, rendu.contenu);
  await prisma.document.update({ where: { id: document.id }, data: { pdfPath: chemin } });
  console.warn(`[dossiers] PDF ${type} ${document.numero} absent du volume : reconstitué`);
  return { contenu: rendu.contenu, nomFichier };
}
