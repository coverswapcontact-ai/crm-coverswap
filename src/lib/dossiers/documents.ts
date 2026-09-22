import { z } from "zod/v4";
import { recalculerMain } from "./main";
import prisma, { type Transaction } from "@/lib/prisma";
import {
  imputerSurFacture,
  libererReglementsFacture,
  mentionsReglements,
  planImputationFacture,
  suivreSoldeDossier,
} from "@/lib/encaissements/service";
import { rendreDocumentPdf, type DonneesDocumentPdf } from "@/lib/pdf/DocumentPdf";
import {
  ACOMPTE_PCT_DEFAUT,
  LIBELLES_ETAPE,
  MOTIFS_AVOIR,
  TYPES_DOCUMENT_EDITABLES,
  UNITES,
  type EtapeDossier,
  type LigneDocument,
  type TypeDocument,
} from "./constants";
import { ErreurMetier } from "./erreurs";
import { mentionsLegales, type CategorieDestinataire } from "./mentions";
import { calculerMontants, formatCentimes, versCentimes } from "./montants";
import { attribuerNumero, numeroFactice } from "./numerotation";
import { estEtape } from "./regles";
import { archiverFichier, enregistrerPdf, lireFichier, lireLignes } from "./stockage";
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
    type: z.enum(TYPES_DOCUMENT_EDITABLES, "Type de document invalide."),
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
    /** Devis refait : le devis qu'il remplace (marqué « Remplacé » à la génération). */
    remplaceDocumentId: z.string().max(40).nullable().optional(),
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

/** Destinataire tel qu'imprimé, figé sur le document à l'émission. */
export type Destinataire = DonneesDocumentPdf["client"] & { categorie: CategorieDestinataire };

async function destinataireDuDossier(dossierId: string): Promise<{ destinataire: Destinataire; clientId: string | null }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      clientNom: true,
      clientAdresse: true,
      clientCp: true,
      clientVille: true,
      clientId: true,
      client: { select: { categorie: true, siret: true } },
    },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const categorie = (dossier.client?.categorie ?? "PARTICULIER") as CategorieDestinataire;
  return {
    clientId: dossier.clientId,
    destinataire: {
      nom: dossier.clientNom,
      adresse: dossier.clientAdresse,
      codePostal: dossier.clientCp,
      ville: dossier.clientVille,
      siret: categorie === "PARTICULIER" ? null : (dossier.client?.siret ?? null),
      categorie,
    },
  };
}

export function lireDestinataire(json: string | null): Destinataire | null {
  if (!json) return null;
  try {
    const lu = JSON.parse(json) as Partial<Destinataire>;
    if (
      typeof lu.nom === "string" &&
      typeof lu.adresse === "string" &&
      typeof lu.codePostal === "string" &&
      typeof lu.ville === "string"
    ) {
      return {
        nom: lu.nom,
        adresse: lu.adresse,
        codePostal: lu.codePostal,
        ville: lu.ville,
        siret: typeof lu.siret === "string" ? lu.siret : null,
        categorie: (lu.categorie ?? "PARTICULIER") as CategorieDestinataire,
      };
    }
  } catch {
    // illisible : repli
  }
  return null;
}

export function lireMentions(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const valeur: unknown = JSON.parse(json);
    return Array.isArray(valeur) ? valeur.filter((texte): texte is string => typeof texte === "string") : null;
  } catch {
    return null;
  }
}

const LIBELLE_GENERE: Record<TypeDocument, (numero: string) => string> = {
  DEVIS: (numero) => `Devis ${numero} généré`,
  FACTURE: (numero) => `Facture ${numero} générée`,
  AVOIR: (numero) => `Avoir ${numero} généré`,
};

const EVENEMENT_GENERE: Record<TypeDocument, "DEVIS_GENERE" | "FACTURE_GENEREE" | "AVOIR_GENERE"> = {
  DEVIS: "DEVIS_GENERE",
  FACTURE: "FACTURE_GENEREE",
  AVOIR: "AVOIR_GENERE",
};

type Emission = {
  dossierId: string;
  type: TypeDocument;
  objet: string;
  lignes: LigneDocument[];
  acomptePct: number | null;
  noteMl: boolean;
  etape: EtapeDossier;
  documentOrigineId?: string | null;
  motifAvoir?: string | null;
  factureOrigine?: { numero: string; dateEmission: Date } | null;
  /** Écritures propres au type, dans la transaction de l'émission (devis remplacé, facture annulée). */
  pendant?: (tx: Transaction, document: { id: string; numero: string }) => Promise<void>;
};

/**
 * Émet un document : mentions légales calculées puis figées, numéro inscrit au
 * registre, PDF archivé, document et événement, changement d'étape éventuel,
 * le tout dans une transaction. Les paramètres manquants (factures aux
 * professionnels) sont demandés AVANT : aucun numéro n'est consommé.
 */
async function emettre(emission: Emission) {
  const { totalHtCentimes } = calculerMontants(emission.lignes, emission.acomptePct);
  if (totalHtCentimes <= 0) throw new ErreurMetier("Le total du document est nul : vérifie les quantités et les prix.");

  const dateEmission = new Date();
  const { destinataire, clientId } = await destinataireDuDossier(emission.dossierId);
  const legales = await mentionsLegales({
    type: emission.type,
    categorie: destinataire.categorie,
    dateEmission,
    factureOrigine: emission.factureOrigine,
    motifAvoir: emission.motifAvoir,
  });
  const { echeanceLe } = legales;
  // Facture : les paiements déjà reçus (acomptes) lui sont imputés et imprimés, avec le reste à payer.
  const planReglements = emission.type === "FACTURE" ? await planImputationFacture(prisma, emission.dossierId, totalHtCentimes) : [];
  const reglements = mentionsReglements(planReglements, totalHtCentimes);
  const mentions = legales.mentions || reglements.length > 0 ? [...(legales.mentions ?? []), ...reglements] : null;
  const donneesPdf: DonneesDocumentPdf = {
    type: emission.type,
    numero: numeroFactice(emission.type, dateEmission),
    dateEmission,
    objet: emission.objet,
    lignes: emission.lignes,
    acomptePct: emission.acomptePct,
    noteMl: emission.noteMl,
    client: destinataire,
    mentions,
  };

  // Mise en page d'essai hors transaction, avec un numéro factice de même
  // longueur : elle fixe le mode (normal ou compact) sans garder la base
  // verrouillée pendant le rendu.
  const essai = await rendreDocumentPdf(donneesPdf);

  const ecrit: { chemin?: string } = {};
  try {
    const resultat = await prisma.$transaction(
      async (tx) => {
        const { numero, registreId } = await attribuerNumero(tx, emission.type, dateEmission);
        const rendu = await rendreDocumentPdf({ ...donneesPdf, numero }, { compact: essai.compact });
        ecrit.chemin = await enregistrerPdf(emission.dossierId, emission.type, numero, rendu.contenu);

        const document = await tx.document.create({
          data: {
            dossierId: emission.dossierId,
            clientId,
            type: emission.type,
            numero,
            dateEmission,
            objet: emission.objet,
            lignes: JSON.stringify(emission.lignes),
            totalHt: totalHtCentimes / 100,
            acomptePct: emission.acomptePct,
            noteMl: emission.noteMl,
            pdfPath: ecrit.chemin,
            statut: "GENERE",
            destinataire: JSON.stringify(destinataire),
            categorieClient: destinataire.categorie,
            mentions: mentions ? JSON.stringify(mentions) : null,
            echeanceLe,
            documentOrigineId: emission.documentOrigineId ?? null,
            motifAvoir: emission.motifAvoir ?? null,
          },
        });
        await tx.numeroDocument.update({
          where: { id: registreId },
          data: { documentId: document.id, destinataire: destinataire.nom, montant: document.totalHt },
        });
        if (emission.type === "FACTURE") {
          await imputerSurFacture(tx, { dossierId: emission.dossierId, registreId, numero, totalCentimes: totalHtCentimes }, planReglements);
        }
        if (emission.pendant) await emission.pendant(tx, { id: document.id, numero });

        await tx.dossierEvenement.create({
          data: {
            dossierId: emission.dossierId,
            type: EVENEMENT_GENERE[emission.type],
            direction: "INTERNE",
            contenu: `${LIBELLE_GENERE[emission.type](numero)} : ${formatCentimes(totalHtCentimes)}`,
            metadata: JSON.stringify({ documentId: document.id, numero, totalHt: document.totalHt, client: destinataire }),
          },
        });

        const vers = etapeApresGeneration(emission.type, emission.etape);
        const changements: ChangementEtape[] = vers
          ? [
              await appliquerChangementEtape(tx, {
                dossierId: emission.dossierId,
                de: emission.etape,
                vers,
                nature: "AUTOMATIQUE",
                documentId: document.id,
              }),
            ]
          : [];
        // Facture déjà couverte par les acomptes : le dossier est encaissé.
        const solde = emission.type === "FACTURE" ? await suivreSoldeDossier(tx, emission.dossierId, "facture réglée par les paiements déjà reçus") : null;
        if (solde) changements.push(solde);
        // « Préparer le devis », posé par l'espace quand le client a choisi, est fait. Une action écrite par Lucas reste.
        if (emission.type === "DEVIS") {
          await tx.dossier.updateMany({
            where: { id: emission.dossierId, prochaineAction: { startsWith: "Préparer le devis" } },
            data: { prochaineAction: "Attendre l'accord du client sur le devis", prochaineActionDate: null },
          });
        }
        return { document, changements };
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    for (const changement of resultat.changements) await effetsDuChangementEtape(changement);
    // Un devis émis passe la main au client, même sans changement d'étape (main.ts).
    await recalculerMain(emission.dossierId);
    // Mission 7 : « votre devis est disponible », par mail, automatiquement (une fois par devis).
    if (emission.type === "DEVIS") {
      const { notifierClient } = await import("@/lib/mail/notifications");
      await notifierClient("DEVIS_DISPONIBLE", emission.dossierId, resultat.document.id);
    }
    return resultat;
  } catch (erreur) {
    // Transaction annulée : le numéro n'a jamais existé (compteur et registre
    // reviennent en arrière) ; le PDF écrit sous ce numéro quitte sa place (le
    // prochain document le reprendra) mais reste aux archives.
    if (ecrit.chemin) await archiverFichier(ecrit.chemin, "generation-annulee").catch(() => {});
    throw erreur;
  }
}

/** Étape du dossier : un document se génère à toute étape (perdu, en pause ou encaissé : c'est signalé à l'écran). */
async function etapeGenerable(dossierId: string): Promise<EtapeDossier> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  if (!estEtape(dossier.etape)) throw new Error(`Étape inconnue en base : ${dossier.etape}`);
  return dossier.etape;
}

/** Devis ou facture depuis l'éditeur de lignes. */
export async function genererDocument(dossierId: string, entree: EntreeGeneration) {
  const etape = await etapeGenerable(dossierId);

  let remplace: { id: string; numero: string } | null = null;
  if (entree.remplaceDocumentId) {
    if (entree.type !== "DEVIS") throw new ErreurMetier("Seul un devis se refait ; une facture s'annule par un avoir.", 400);
    const ancien = await prisma.document.findFirst({
      where: { id: entree.remplaceDocumentId, dossierId, type: "DEVIS", numero: { not: null } },
      select: { id: true, numero: true, statut: true },
    });
    if (!ancien?.numero) throw new ErreurMetier("Devis à remplacer introuvable dans ce dossier.", 404);
    if (ancien.statut === "ACCEPTE") throw new ErreurMetier("Ce devis a été accepté : il ne se remplace pas.", 409);
    if (ancien.statut === "REMPLACE") throw new ErreurMetier("Ce devis a déjà été remplacé.", 409);
    remplace = { id: ancien.id, numero: ancien.numero };
  }
  const aRemplacer = remplace;

  return emettre({
    dossierId,
    type: entree.type,
    objet: entree.objet,
    lignes: entree.lignes,
    acomptePct: entree.type === "DEVIS" ? (entree.acomptePct ?? ACOMPTE_PCT_DEFAUT) : null,
    noteMl: entree.noteMl,
    etape,
    documentOrigineId: aRemplacer?.id ?? null,
    pendant: aRemplacer
      ? async (tx) => {
          const { count } = await tx.document.updateMany({
            where: { id: aRemplacer.id, statut: { notIn: ["ACCEPTE", "REMPLACE"] } },
            data: { statut: "REMPLACE" },
          });
          if (count !== 1) throw new ErreurMetier("Le devis à remplacer a changé entre-temps : recharge le dossier.", 409);
        }
      : undefined,
  });
}

const CODES_MOTIF_AVOIR = MOTIFS_AVOIR.map((motif) => motif.code) as [string, ...string[]];

export const schemaAvoir = z.object({
  motif: z.enum(CODES_MOTIF_AVOIR, "Choisis le motif de l'avoir."),
  precision: z.string().trim().max(300, "Précision trop longue.").optional(),
});

/**
 * Avoir total d'une facture émise : la facture ne se modifie jamais, elle est
 * annulée par un avoir de même montant (dans la série des factures), puis
 * refaite si besoin. Si plus aucune facture active ne reste, le dossier revient
 * à « Chantier », en attente de la nouvelle facture.
 */
export async function genererAvoir(dossierId: string, factureId: string, entree: z.output<typeof schemaAvoir>) {
  const etape = await etapeGenerable(dossierId);
  const facture = await prisma.document.findFirst({
    where: { id: factureId, dossierId, type: "FACTURE", numero: { not: null } },
  });
  if (!facture?.numero || !facture.dateEmission) throw new ErreurMetier("Facture introuvable dans ce dossier.", 404);
  if (facture.statut === "ANNULEE") throw new ErreurMetier("Cette facture est déjà annulée par un avoir.", 409);
  // Facture reprise d'avant le CRM : pas de lignes, l'avoir porte une ligne de son montant.
  const lignesFacture = lireLignes(facture.lignes);
  const lignesAvoir: LigneDocument[] =
    lignesFacture.length > 0
      ? lignesFacture
      : [{ type: "PRESTATION", designation: `Annulation de la facture ${facture.numero}`, quantite: 1, unite: "forfait", prixUnitaire: facture.totalHt }];
  if (entree.motif === "AUTRE" && !entree.precision) throw new ErreurMetier("Précise le motif de l'avoir.", 400);

  const libelleMotif = MOTIFS_AVOIR.find((motif) => motif.code === entree.motif)?.libelle ?? entree.motif;
  const motifAvoir = entree.precision ? `${libelleMotif} (${entree.precision})` : libelleMotif;
  const numeroFacture = facture.numero;

  const resultat = await emettre({
    dossierId,
    type: "AVOIR",
    objet: `Annulation de la facture ${numeroFacture} : ${facture.objet}`.slice(0, 160),
    lignes: lignesAvoir,
    acomptePct: null,
    noteMl: facture.noteMl,
    etape,
    documentOrigineId: facture.id,
    motifAvoir,
    factureOrigine: { numero: numeroFacture, dateEmission: facture.dateEmission },
    pendant: async (tx, avoir) => {
      const { count } = await tx.document.updateMany({
        where: { id: facture.id, statut: { not: "ANNULEE" } },
        data: { statut: "ANNULEE" },
      });
      if (count !== 1) throw new ErreurMetier("La facture vient d'être annulée ailleurs : recharge le dossier.", 409);
      await libererReglementsFacture(tx, facture.id, avoir.numero);
    },
  });

  const actives = await prisma.document.count({
    where: { dossierId, type: "FACTURE", numero: { not: null }, statut: { notIn: ["ANNULEE", "BROUILLON"] } },
  });
  if (actives === 0 && (etape === "FACTURE" || etape === "ENCAISSE")) {
    const changement = await prisma.$transaction(async (tx) => {
      const retour = await appliquerChangementEtape(tx, {
        dossierId,
        de: etape,
        vers: "CHANTIER",
        nature: "RETOUR",
        documentId: resultat.document.id,
      });
      await tx.dossierEvenement.create({
        data: {
          dossierId,
          type: "NOTE_AJOUTEE",
          direction: "INTERNE",
          contenu: `Retour en « ${LIBELLES_ETAPE.CHANTIER} » : la facture ${numeroFacture} est annulée par l'avoir ${resultat.document.numero}.`,
          metadata: JSON.stringify({ avoirId: resultat.document.id, factureId: facture.id }),
        },
      });
      return retour;
    });
    await effetsDuChangementEtape(changement);
  }
  return resultat;
}

function lireClientFige(metadata: string | undefined): DonneesDocumentPdf["client"] | null {
  if (!metadata) return null;
  try {
    const client = (JSON.parse(metadata) as { client?: Partial<DonneesDocumentPdf["client"]> }).client;
    if (
      client &&
      typeof client.nom === "string" &&
      typeof client.adresse === "string" &&
      typeof client.codePostal === "string" &&
      typeof client.ville === "string"
    ) {
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
  const libelle = type === "DEVIS" ? "Devis" : type === "AVOIR" ? "Avoir" : "Facture";
  return `${libelle}-${numero}${client ? `-${client}` : ""}.pdf`;
}

/**
 * PDF archivé d'un document. S'il manque sur le volume, il est reconstitué à
 * partir des données figées à l'émission (lignes, date, numéro, destinataire,
 * mentions) puis réarchivé.
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
  const destinataire = lireDestinataire(document.destinataire);
  const nomFichier = nomFichierPdf(type, document.numero, destinataire?.nom ?? document.dossier.clientNom);

  const archive = document.pdfPath ? await lireFichier(document.pdfPath) : null;
  if (archive) return { contenu: archive, nomFichier };
  // Un document repris n'a que le PDF importé : rien ne se reconstitue à sa place.
  if (document.origine === "REPRISE") throw new ErreurMetier("PDF non importé pour ce document repris.", 404);

  let client: DonneesDocumentPdf["client"] | null = destinataire;
  if (!client) {
    const generation = await prisma.dossierEvenement.findFirst({
      where: {
        dossierId,
        type: { in: ["DEVIS_GENERE", "FACTURE_GENEREE", "AVOIR_GENERE"] },
        metadata: { contains: document.id },
      },
      select: { metadata: true },
    });
    client = lireClientFige(generation?.metadata) ?? {
      nom: document.dossier.clientNom,
      adresse: document.dossier.clientAdresse,
      codePostal: document.dossier.clientCp,
      ville: document.dossier.clientVille,
    };
  }
  const rendu = await rendreDocumentPdf({
    type,
    numero: document.numero,
    dateEmission: document.dateEmission,
    objet: document.objet,
    lignes: lireLignes(document.lignes),
    acomptePct: document.acomptePct,
    noteMl: document.noteMl,
    client,
    mentions: lireMentions(document.mentions),
  });
  const chemin = await enregistrerPdf(dossierId, type, document.numero, rendu.contenu);
  await prisma.document.update({ where: { id: document.id }, data: { pdfPath: chemin } });
  console.warn(`[dossiers] PDF ${type} ${document.numero} absent du volume : reconstitué`);
  return { contenu: rendu.contenu, nomFichier };
}
