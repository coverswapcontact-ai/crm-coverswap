import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import { lireSelection, lireTeintes } from "@/lib/prestations/prestations";
import prisma, { type Transaction } from "@/lib/prisma";
import { chargerPaiementsDossier } from "@/lib/encaissements/soldes";
import {
  ETAPES,
  LIBELLES_ETAPE,
  SOURCES_DOSSIER,
  type DirectionEvenement,
  type EtapeActive,
  type EtapeDossier,
  type MotifPerte,
  type SourceDossier,
  type StatutDocument,
  type TypeDocument,
  type TypeEvenement,
} from "./constants";
import { dateDepuisJour, estJourValide, instantDuJour, jourParis } from "./dates";
import { ErreurMetier } from "./erreurs";
import { versCentimes } from "./montants";
import { estEtape, estEtapeSortie, etapeAvantSortie, lireMetadataChangementEtape, type MetadataChangementEtape } from "./regles";
import {
  enregistrerPhoto,
  estPhotoApres,
  idPhoto,
  lireFichier,
  lireLignes,
  lirePhotos,
  archiverFichier,
  archiverFichiersDossier,
  typeMimePhoto,
  verifierPhoto,
} from "./stockage";
import type { DossierDetail, DossierResume, NoteVue, PhotoVue } from "./types";
import { CATEGORIES_CLIENT } from "@/lib/clients/constantes";
import { completerCoordonnees, rattacherDossier } from "@/lib/clients/identification";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { alertesACompleter, LIBELLES_QUALITE_DOSSIERS, lireMasques, pointsACompleter, type CodeCompletude, type PointACompleter } from "./completude";
import { delaisCles, ecartsPrix, parcoursEtapes } from "./delais";

/* ── Validation ─────────────────────────────────────────────────── */

// Signaler, jamais bloquer : seul le nom du client est exigé. Ce qui manque
// (adresse, téléphone, objet, source, photos) est signalé sur le dossier
// (completude.ts). Est refusé seulement ce qui ne peut pas s'enregistrer tel
// quel : un texte trop long, une adresse e-mail illisible, un montant qui
// n'est pas un nombre, une date impossible.

/** Texte facultatif d'une colonne non nulle : vide = « » (null accepté). */
const texteLibre = (max: number, trop: string) =>
  z
    .string(trop)
    .trim()
    .max(max, trop)
    .nullable()
    .transform((valeur) => valeur ?? "");

/** Jour passé ou présent : une date réelle n'est jamais à venir. */
const jourPasse = (message: string, avenir: string) =>
  z
    .string(message)
    .refine(estJourValide, message)
    .refine((jour) => jour <= jourParis(new Date()), avenir);

const jourOuNull = (message: string) =>
  z
    .string(message)
    .nullable()
    .refine((valeur) => valeur === null || valeur === "" || estJourValide(valeur), message)
    .transform((valeur) => valeur || null);

const champsDossier = z.object({
  clientNom: z
    .string("Le nom du client est obligatoire.")
    .trim()
    .min(1, "Le nom du client est obligatoire.")
    .max(120, "Nom trop long : 120 caractères maximum."),
  clientAdresse: texteLibre(200, "Adresse trop longue : 200 caractères maximum."),
  clientCp: texteLibre(10, "Code postal trop long : 10 caractères maximum."),
  clientVille: texteLibre(80, "Ville trop longue : 80 caractères maximum."),
  clientTelephone: texteLibre(30, "Numéro de téléphone trop long : 30 caractères maximum."),
  clientEmail: z
    .string("Adresse e-mail invalide.")
    .trim()
    .max(160, "Adresse e-mail trop longue.")
    .refine((valeur) => valeur === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur), "Adresse e-mail invalide.")
    .nullable()
    .transform((valeur) => valeur || null),
  objet: texteLibre(160, "Objet trop long : 160 caractères maximum."),
  source: z
    .enum(SOURCES_DOSSIER, "Source invalide.")
    .nullable()
    .transform((valeur) => valeur ?? "INCONNUE"),
  montantEstime: z
    .number("Montant estimé invalide.")
    .min(0, "Le montant estimé ne peut pas être négatif.")
    .max(10_000_000, "Montant estimé invalide.")
    .nullable()
    .transform((valeur) => (valeur === null ? null : versCentimes(valeur) / 100)),
  prochaineAction: z
    .string("Prochaine action invalide.")
    .trim()
    .max(140, "Prochaine action trop longue : 140 caractères maximum.")
    .nullable()
    .transform((valeur) => valeur || null),
  prochaineActionDate: jourOuNull("Date de prochaine action invalide."),
});

export const schemaCreation = champsDossier
  .partial()
  .required({ clientNom: true })
  .extend({
    leadId: z.string().max(40).nullable().optional(),
    prospectId: z.string().max(40).nullable().optional(),
    // Nouveau dossier ouvert depuis une fiche client.
    clientId: z.string().max(40).nullable().optional(),
    /** Étape de départ : un dossier déjà avancé naît à son étape actuelle. */
    etape: z.enum(ETAPES, "Étape invalide.").optional(),
    dateChantier: jourOuNull("Date de chantier invalide.").optional(),
    /** Sans fiche choisie : le client est un particulier ou une entreprise (sinon déduit de la source). */
    clientCategorie: z.enum(CATEGORIES_CLIENT, "Type de client invalide.").nullable().optional(),
    clientSiret: z
      .string("SIRET invalide : 14 chiffres attendus.")
      .transform((valeur) => valeur.replace(/\s/g, ""))
      .refine((valeur) => valeur === "" || /^\d{14}$/.test(valeur), "SIRET invalide : 14 chiffres attendus.")
      .transform((valeur) => valeur || null)
      .nullable()
      .optional(),
  });
export type EntreeCreation = z.output<typeof schemaCreation>;

export const schemaModification = champsDossier
  .extend({
    dateChantier: jourOuNull("Date de chantier invalide."),
    dateSouhaitee: jourOuNull("Date souhaitée invalide."),
    dateFinChantier: jourOuNull("Date de fin de chantier invalide."),
    /** Fiche client rattachée : ses documents et paiements la suivent. */
    clientId: z.string("Fiche client invalide.").min(1, "Fiche client invalide.").max(40, "Fiche client invalide."),
    /** Date réelle d'ouverture (dossier commencé avant le CRM). */
    ouvertLe: jourPasse("Date d'ouverture invalide.", "La date d'ouverture est à venir."),
  })
  .partial();
export type EntreeModification = z.output<typeof schemaModification>;

export const schemaNote = z.object({
  etape: z.enum(ETAPES, "Étape invalide."),
  contenu: z
    .string("La note est vide.")
    .trim()
    .min(1, "La note est vide.")
    .max(4000, "Note trop longue : 4 000 caractères maximum."),
});

/* ── Lecture ────────────────────────────────────────────────────── */

const urlPhoto = (dossierId: string, chemin: string) => `/api/dossiers/${dossierId}/photos/${idPhoto(chemin)}`;
const urlPdf = (dossierId: string, documentId: string) => `/api/dossiers/${dossierId}/documents/${documentId}/pdf`;

function etapeLue(valeur: string): EtapeDossier {
  if (!estEtape(valeur)) throw new Error(`Étape inconnue en base : ${valeur}`);
  return valeur;
}

type DossierAvecDernierDevis = Prisma.DossierGetPayload<{
  include: { documents: { select: { totalHt: true } } };
}>;

function versResume(
  dossier: Omit<DossierAvecDernierDevis, "photos">,
  avantSortie: EtapeActive | null,
  points: readonly PointACompleter[]
): DossierResume {
  return {
    id: dossier.id,
    clientNom: dossier.clientNom,
    clientVille: dossier.clientVille,
    objet: dossier.objet,
    etape: etapeLue(dossier.etape),
    source: dossier.source as SourceDossier,
    montantEstime: dossier.montantEstime,
    montantDernierDevis: dossier.documents[0]?.totalHt ?? null,
    prochaineAction: dossier.prochaineAction,
    prochaineActionDate: dossier.prochaineActionDate?.toISOString() ?? null,
    etapeAvantSortie: avantSortie,
    aCompleter: alertesACompleter(points).length,
    attenteClient: points.filter((p) => !p.masque && p.attenteClient).length,
    main: dossier.main === "MOI" || dossier.main === "CLIENT" ? dossier.main : null,
    mainLe: dossier.mainLe?.toISOString() ?? null,
    mainMotif: dossier.mainMotif ?? null,
    ouvertLe: (dossier.ouvertLe ?? dossier.createdAt).toISOString(),
    createdAt: dossier.createdAt.toISOString(),
    updatedAt: dossier.updatedAt.toISOString(),
    prestations: lireSelection(dossier.prestations),
    teintes: lireTeintes(dossier.teintes),
  };
}

/**
 * Points à compléter de dossiers (ceux du filtre, archivés exclus par défaut),
 * en quelques requêtes : liste, panneau et synthèse lisent les mêmes.
 */
export async function pointsACompleterDossiers(
  lecteur: Transaction,
  filtre: Prisma.DossierWhereInput = {}
): Promise<Map<string, PointACompleter[]>> {
  const dossiers = await lecteur.dossier.findMany({
    where: filtre,
    select: {
      id: true,
      etape: true,
      clientId: true,
      clientAdresse: true,
      clientCp: true,
      clientVille: true,
      clientTelephone: true,
      objet: true,
      source: true,
      photos: true,
      dateChantier: true,
      motifPerte: true,
      completudeMasquee: true,
      espaces: { select: { revoqueLe: true, archiveLe: true, permanent: { select: { revoqueLe: true } } } },
      documents: { where: { numero: { not: null }, archiveLe: null }, select: { type: true, statut: true, totalHt: true } },
      encaissements: { where: { statut: "VALIDE" }, select: { montant: true } },
      evenements: {
        where: { type: "CHANGEMENT_ETAPE", archiveLe: null },
        select: { metadata: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
  const resultat = new Map<string, PointACompleter[]>();
  for (const dossier of dossiers) {
    const changements = dossier.evenements
      .map((evenement) => lireMetadataChangementEtape(evenement.metadata))
      .filter((metadata): metadata is MetadataChangementEtape => metadata !== null);
    const factures = dossier.documents.filter((document) => document.type === "FACTURE" && document.statut !== "ANNULEE");
    const factureCentimes = factures.reduce((somme, document) => somme + versCentimes(document.totalHt), 0);
    const recuCentimes = dossier.encaissements.reduce((somme, encaissement) => somme + versCentimes(encaissement.montant), 0);
    resultat.set(
      dossier.id,
      pointsACompleter({
        etape: etapeLue(dossier.etape),
        etapeAvantSortie: etapeAvantSortie(changements),
        clientId: dossier.clientId,
        clientAdresse: dossier.clientAdresse,
        clientCp: dossier.clientCp,
        clientVille: dossier.clientVille,
        clientTelephone: dossier.clientTelephone,
        objet: dossier.objet,
        source: dossier.source,
        nbPhotos: lirePhotos(dossier.photos).length,
        dateChantier: dossier.dateChantier,
        nbDevis: dossier.documents.filter((document) => document.type === "DEVIS").length,
        nbFactures: factures.length,
        nbPaiements: dossier.encaissements.length,
        sansAcompteMotive: changements.some((changement) => Boolean(changement.sansAcompte)),
        resteDu: Math.max(0, factureCentimes - recuCentimes) / 100,
        motifPerte: dossier.motifPerte,
        nbDatesInconnues: changements.filter((changement) => changement.dateInconnue).length,
        espaceActif: dossier.espaces.some((e) => !e.revoqueLe && !e.archiveLe && !e.permanent?.revoqueLe),
        masques: lireMasques(dossier.completudeMasquee).map((m) => m.code),
      })
    );
  }
  return resultat;
}

const DERNIER_DEVIS = {
  where: { type: "DEVIS", statut: { not: "BROUILLON" } },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { totalHt: true },
} satisfies Prisma.Dossier$documentsArgs;

export async function listerDossiers(): Promise<DossierResume[]> {
  const dossiers = await prisma.dossier.findMany({
    orderBy: { updatedAt: "desc" },
    include: { documents: DERNIER_DEVIS },
  });

  // Perdus et en pause : la barre de progression reste à l'étape quittée,
  // lue dans leurs changements d'étape (du plus récent au plus ancien).
  const sortis = dossiers.filter((dossier) => estEtapeSortie(dossier.etape)).map((dossier) => dossier.id);
  const changements =
    sortis.length > 0
      ? await prisma.dossierEvenement.findMany({
          where: { dossierId: { in: sortis }, type: "CHANGEMENT_ETAPE" },
          orderBy: { createdAt: "desc" },
          select: { dossierId: true, metadata: true },
        })
      : [];
  const parDossier = new Map<string, MetadataChangementEtape[]>();
  for (const changement of changements) {
    const metadata = lireMetadataChangementEtape(changement.metadata);
    if (metadata) parDossier.set(changement.dossierId, [...(parDossier.get(changement.dossierId) ?? []), metadata]);
  }

  const completude = await pointsACompleterDossiers(prisma);
  return dossiers.map((dossier) =>
    versResume(dossier, etapeAvantSortie(parDossier.get(dossier.id) ?? []), completude.get(dossier.id) ?? [])
  );
}

function messageDeLEvenement(metadata: string): string | null {
  try {
    const valeur = (JSON.parse(metadata) as { messageId?: unknown }).messageId;
    return typeof valeur === "string" ? valeur : null;
  } catch {
    return null;
  }
}

export async function chargerDetail(dossierId: string): Promise<DossierDetail> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      lead: { select: { id: true, prenom: true, nom: true } },
      prospect: { select: { id: true, nom: true } },
      client: { select: { id: true, nom: true } },
      notes: { orderBy: { createdAt: "asc" } },
      // Un mail rangé puis déplacé ailleurs laisse une trace archivée, hors de l'historique affiché.
      evenements: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 300 },
      documents: {
        orderBy: { createdAt: "desc" },
        include: {
          documentOrigine: { select: { id: true, numero: true } },
          documentsLies: { select: { id: true, type: true, numero: true } },
        },
      },
    },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);

  const dernierDevis = dossier.documents.find((document) => document.type === "DEVIS" && document.statut !== "BROUILLON");
  const changements = dossier.evenements
    .filter((evenement) => evenement.type === "CHANGEMENT_ETAPE")
    .map((evenement) => lireMetadataChangementEtape(evenement.metadata))
    .filter((metadata): metadata is MetadataChangementEtape => metadata !== null);

  const passages = await prisma.dossierEvenement.findMany({
    where: { dossierId, type: "CHANGEMENT_ETAPE", archiveLe: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true, survenuLe: true, metadata: true },
  });
  const parcours = parcoursEtapes(
    passages.flatMap((passage) => {
      const metadata = lireMetadataChangementEtape(passage.metadata);
      if (!metadata) return [];
      return [
        {
          createdAt: passage.createdAt,
          survenuLe: passage.survenuLe,
          vers: metadata.vers,
          evenementId: passage.id,
          ouverture: metadata.nature === "OUVERTURE",
          dateInconnue: metadata.dateInconnue === true,
        },
      ];
    })
  );

  const [paiements, completude] = await Promise.all([
    chargerPaiementsDossier(prisma, dossierId),
    pointsACompleterDossiers(prisma, { ...AVEC_ARCHIVES, id: dossierId }).then((points) => points.get(dossierId) ?? []),
  ]);

  const photos: PhotoVue[] = lirePhotos(dossier.photos).map((chemin) => ({
    id: idPhoto(chemin),
    url: urlPhoto(dossier.id, chemin),
    type: typeMimePhoto(chemin),
    apres: estPhotoApres(chemin),
  }));

  return {
    ...versResume({ ...dossier, documents: dernierDevis ? [dernierDevis] : [] }, etapeAvantSortie(changements), completude),
    completude,
    client: dossier.client,
    clientAdresse: dossier.clientAdresse,
    clientCp: dossier.clientCp,
    clientEmail: dossier.clientEmail,
    clientTelephone: dossier.clientTelephone,
    motifPerte: dossier.motifPerte as MotifPerte | null,
    perte:
      dossier.etape === "PERDU"
        ? {
            le: dossier.perteLe?.toISOString() ?? null,
            etape: dossier.perteEtape && estEtape(dossier.perteEtape) ? dossier.perteEtape : null,
            concurrent: dossier.perteConcurrent,
            montantConcurrent: dossier.perteMontantConcurrent,
            montantPropose: dossier.perteMontantPropose,
            commentaire: dossier.perteCommentaire,
          }
        : null,
    parcours,
    delais: delaisCles(parcours),
    ecarts: ecartsPrix(dossier.documents, dossier.montantEstime),
    dateChantier: dossier.dateChantier?.toISOString() ?? null,
    dateSouhaitee: dossier.dateSouhaitee?.toISOString() ?? null,
    dateFinChantier: dossier.dateFinChantier?.toISOString() ?? null,
    origine: dossier.lead
      ? {
          type: "LEAD",
          id: dossier.lead.id,
          nom: dossier.lead.prenom === dossier.lead.nom ? dossier.lead.nom : `${dossier.lead.prenom} ${dossier.lead.nom}`,
        }
      : dossier.prospect
        ? { type: "PROSPECT", id: dossier.prospect.id, nom: dossier.prospect.nom }
        : null,
    photos,
    notes: dossier.notes.map((note) => ({
      id: note.id,
      etape: etapeLue(note.etape),
      contenu: note.contenu,
      createdAt: note.createdAt.toISOString(),
    })),
    // Du plus récent au plus ancien, à leur date réelle ; la date de saisie reste lisible.
    evenements: dossier.evenements
      .map((evenement) => ({
        id: evenement.id,
        type: evenement.type as TypeEvenement,
        direction: evenement.direction as DirectionEvenement,
        contenu: evenement.contenu,
        createdAt: evenement.createdAt.toISOString(),
        date: (evenement.survenuLe ?? evenement.createdAt).toISOString(),
        saisiLe: evenement.survenuLe ? evenement.createdAt.toISOString() : null,
        messageId: messageDeLEvenement(evenement.metadata),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    documents: dossier.documents.map((document) => ({
      id: document.id,
      type: document.type as TypeDocument,
      numero: document.numero,
      dateEmission: document.dateEmission?.toISOString() ?? null,
      objet: document.objet,
      lignes: lireLignes(document.lignes),
      totalHt: document.totalHt,
      acomptePct: document.acomptePct,
      noteMl: document.noteMl,
      statut: document.statut as StatutDocument,
      pdfUrl: document.numero && (document.origine === "CRM" || document.pdfPath) ? urlPdf(dossier.id, document.id) : null,
      origine: document.origine === "REPRISE" ? "REPRISE" : "CRM",
      echeanceLe: document.echeanceLe?.toISOString() ?? null,
      documentOrigine: document.documentOrigine,
      documentsLies: document.documentsLies.map((lie) => ({ ...lie, type: lie.type as TypeDocument })),
      motifAvoir: document.motifAvoir,
    })),
    paiements,
  };
}

/* ── Création ───────────────────────────────────────────────────── */

/**
 * Écritures de l'ouverture d'un dossier, dans la transaction de l'appelant :
 * le dossier, l'événement d'ouverture, le client pérenne (choisi, celui du
 * lead ou du prospect, retrouvé par e-mail ou téléphone, sinon créé). Les
 * photos s'écrivent ensuite (création depuis l'écran, ou depuis un mail validé).
 */
export async function ouvrirDossier(
  tx: Transaction,
  entree: EntreeCreation,
  origine: { leadId: string | null; prospectId: string | null } = { leadId: null, prospectId: null }
) {
  const etape = entree.etape ?? "QUALIFICATION";
  const ouverture: MetadataChangementEtape = { de: null, vers: etape, nature: "OUVERTURE" };
  const cree = await tx.dossier.create({
    data: {
      leadId: origine.leadId,
      prospectId: origine.prospectId,
      clientNom: entree.clientNom,
      clientAdresse: entree.clientAdresse ?? "",
      clientCp: entree.clientCp ?? "",
      clientVille: entree.clientVille ?? "",
      clientEmail: entree.clientEmail ?? null,
      clientTelephone: entree.clientTelephone ?? "",
      objet: entree.objet ?? "",
      source: entree.source ?? "INCONNUE",
      montantEstime: entree.montantEstime ?? null,
      prochaineAction: entree.prochaineAction ?? null,
      prochaineActionDate: entree.prochaineActionDate ? dateDepuisJour(entree.prochaineActionDate) : null,
      dateChantier: entree.dateChantier ? dateDepuisJour(entree.dateChantier) : null,
      etape,
    },
  });
  await tx.dossierEvenement.create({
    data: {
      dossierId: cree.id,
      type: "CHANGEMENT_ETAPE",
      direction: "INTERNE",
      contenu: `Dossier ouvert : ${LIBELLES_ETAPE[etape]}`,
      metadata: JSON.stringify(ouverture),
    },
  });
  // Client pérenne : celui choisi, celui du lead ou du prospect, sinon retrouvé
  // par e-mail ou téléphone, sinon créé depuis ces coordonnées.
  if (entree.clientId) {
    const choisi = await tx.client.findUnique({ where: { id: entree.clientId }, select: { id: true, archiveLe: true } });
    if (!choisi || choisi.archiveLe) throw new ErreurMetier("Client introuvable ou archivé.", 404);
    await tx.dossier.update({ where: { id: cree.id }, data: { clientId: choisi.id } });
    await completerCoordonnees(tx, choisi.id, { emails: [entree.clientEmail], telephones: [entree.clientTelephone] });
    return { ...cree, clientId: choisi.id };
  }
  const clientId = await rattacherDossier(tx, cree, { categorie: entree.clientCategorie ?? null, siret: entree.clientCategorie === "PARTICULIER" ? null : (entree.clientSiret ?? null) });
  return { ...cree, clientId };
}

/**
 * Ouvre un dossier : événement d'ouverture à l'étape choisie, photos
 * archivées (facultatives). Si une photo envoyée ne peut pas être écrite, la
 * création est annulée.
 */
export async function creerDossier(entree: EntreeCreation, photos: File[]): Promise<string> {
  photos.forEach(verifierPhoto);
  const { lead, prospect } = await originesDuDossier(entree);
  const dossier = await prisma.$transaction((tx) => ouvrirDossier(tx, entree, { leadId: lead?.id ?? null, prospectId: prospect?.id ?? null }));

  try {
    const chemins: string[] = [];
    for (const photo of photos) chemins.push(await enregistrerPhoto(dossier.id, photo));
    if (chemins.length > 0) await prisma.dossier.update({ where: { id: dossier.id }, data: { photos: JSON.stringify(chemins) } });
  } catch (erreur) {
    // Rien ne se supprime : la création interrompue reste au journal, archivée.
    await prisma.dossier
      .update({
        where: { id: dossier.id },
        data: { archiveLe: new Date(), archiveMotif: "Création interrompue : photos non enregistrées" },
      })
      .catch((archivage: unknown) => {
        console.error("[dossiers] archivage de la création interrompue impossible :", archivage);
      });
    await archiverFichiersDossier(dossier.id, "creation-interrompue").catch(() => {});
    throw erreur;
  }

  await suitesOuverture({ lead, prospect }, dossier.id);
  return dossier.id;
}

type Origines = { lead: { id: string; statut: string } | null; prospect: { id: string; statut: string } | null };

/**
 * Lead ou prospect d'origine d'un dossier à ouvrir, vérifiés. Ouvert depuis
 * une fiche client (les leads entrants y sont rattachés d'office), le contact
 * qui n'a pas encore de dossier en devient l'origine : son statut suit le
 * dossier et la conversion est comptée pour sa source.
 */
export async function originesDuDossier(entree: Pick<EntreeCreation, "leadId" | "prospectId"> & { clientId?: string | null }): Promise<Origines> {
  if (entree.leadId && entree.prospectId) {
    throw new ErreurMetier("Un dossier vient d'un lead ou d'un prospect, pas des deux.");
  }
  if (!entree.leadId && !entree.prospectId && entree.clientId) {
    const [leadDuClient, prospectDuClient] = await Promise.all([
      prisma.lead.findFirst({ where: { clientId: entree.clientId, dossiers: { none: {} } }, orderBy: { createdAt: "desc" }, select: { id: true, statut: true } }),
      prisma.prospect.findFirst({ where: { clientId: entree.clientId, dossiers: { none: {} } }, orderBy: { updatedAt: "desc" }, select: { id: true, statut: true } }),
    ]);
    if (leadDuClient) return { lead: leadDuClient, prospect: null };
    if (prospectDuClient) return { lead: null, prospect: prospectDuClient };
  }
  const [lead, prospect] = await Promise.all([
    entree.leadId ? prisma.lead.findUnique({ where: { id: entree.leadId }, select: { id: true, statut: true } }) : null,
    entree.prospectId ? prisma.prospect.findUnique({ where: { id: entree.prospectId }, select: { id: true, statut: true } }) : null,
  ]);
  if (entree.leadId && !lead) throw new ErreurMetier("Lead introuvable.", 404);
  if (entree.prospectId && !prospect) throw new ErreurMetier("Prospect introuvable.", 404);
  return { lead, prospect };
}

/**
 * Après l'ouverture, jamais bloquant : le lead B2C passe à « Contacté » ; le
 * prospect B2B est converti en client (il sort des séquences de prospection),
 * sauf s'il s'est désinscrit.
 */
export async function suitesOuverture({ lead, prospect }: Origines, dossierId: string): Promise<void> {
  try {
    if (lead?.statut === "NOUVEAU") {
      await prisma.lead.update({ where: { id: lead.id }, data: { statut: "CONTACTE" } });
    }
    if (prospect && prospect.statut !== "CLIENT" && prospect.statut !== "OPT_OUT") {
      await prisma.$transaction([
        prisma.prospect.update({ where: { id: prospect.id }, data: { statut: "CLIENT" } }),
        prisma.prospectActivity.create({
          data: {
            prospectId: prospect.id,
            type: "NOTE",
            details: JSON.stringify({ message: "Dossier ouvert", dossierId }),
          },
        }),
      ]);
    }
  } catch (erreur) {
    console.error("[dossiers] mise à jour du lead d'origine :", erreur);
  }
}

/* ── Modification ───────────────────────────────────────────────── */

/** Tout se modifie ; ce qui manque ensuite est signalé sur le dossier. Le journal garde chaque valeur. */
export async function modifierDossier(dossierId: string, entree: EntreeModification): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { clientId: true, client: { select: { nom: true } } },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);

  const { prochaineActionDate, dateChantier, dateSouhaitee, dateFinChantier, clientId, ouvertLe, ...champs } = entree;
  const data: Prisma.DossierUncheckedUpdateInput = { ...champs };
  if (dateSouhaitee !== undefined) data.dateSouhaitee = dateSouhaitee ? dateDepuisJour(dateSouhaitee) : null;
  if (dateFinChantier !== undefined) data.dateFinChantier = dateFinChantier ? dateDepuisJour(dateFinChantier) : null;
  if (prochaineActionDate !== undefined) {
    data.prochaineActionDate = prochaineActionDate ? dateDepuisJour(prochaineActionDate) : null;
  }
  if (dateChantier !== undefined) data.dateChantier = dateChantier ? dateDepuisJour(dateChantier) : null;

  await prisma.$transaction(async (tx) => {
    if (ouvertLe) {
      // La date d'ouverture est celle de l'événement d'ouverture : les deux restent d'accord.
      data.ouvertLe = instantDuJour(ouvertLe);
      const ouverture = await evenementOuverture(tx, dossierId);
      if (ouverture) await tx.dossierEvenement.update({ where: { id: ouverture.id }, data: { survenuLe: instantDuJour(ouvertLe) } });
    }
    if (clientId !== undefined && clientId !== dossier.clientId) {
      const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true, nom: true, archiveLe: true } });
      if (!client || client.archiveLe) throw new ErreurMetier("Fiche client introuvable ou archivée.", 404);
      data.clientId = client.id;
      // Les pièces et paiements du dossier suivent la fiche (le journal garde l'ancienne).
      await tx.document.updateMany({ where: { dossierId, clientId: dossier.clientId }, data: { clientId: client.id } });
      await tx.encaissement.updateMany({ where: { dossierId, clientId: dossier.clientId }, data: { clientId: client.id } });
      await tx.dossierEvenement.create({
        data: {
          dossierId,
          type: "NOTE_AJOUTEE",
          direction: "INTERNE",
          contenu: dossier.client
            ? `Dossier rattaché à la fiche client « ${client.nom} » (au lieu de « ${dossier.client.nom} »)`
            : `Dossier rattaché à la fiche client « ${client.nom} »`,
          metadata: JSON.stringify({ clientId: client.id, ancienClientId: dossier.clientId }),
        },
      });
    }
    await tx.dossier.update({ where: { id: dossierId }, data });
    if (ouvertLe || data.clientId) await reculerPremierContact(tx, dossierId);
  });
}

/* ── Points à compléter masqués ─────────────────────────────────── */

/**
 * La croix d'un point « à compléter » : Lucas juge qu'il n'est pas nécessaire
 * pour ce dossier. Le choix est gardé sur le dossier (et tracé dans son
 * historique) ; réafficher le remet. Un point rempli disparaît de lui-même.
 */
export async function masquerPointACompleter(dossierId: string, code: CodeCompletude, masquer: boolean): Promise<void> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { completudeMasquee: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const avant = lireMasques(dossier.completudeMasquee);
  const deja = avant.some((m) => m.code === code);
  if (deja === masquer) return;
  const apres = masquer ? [...avant, { code, le: new Date().toISOString() }] : avant.filter((m) => m.code !== code);
  await prisma.$transaction([
    prisma.dossier.update({ where: { id: dossierId }, data: { completudeMasquee: apres.length ? JSON.stringify(apres) : null } }),
    prisma.dossierEvenement.create({
      data: {
        dossierId,
        type: "NOTE_AJOUTEE",
        direction: "INTERNE",
        contenu: masquer ? `Point « à compléter » masqué pour ce dossier : ${LIBELLES_QUALITE_DOSSIERS[code].replace(/^Dossiers? /, "")}` : `Point « à compléter » réaffiché : ${LIBELLES_QUALITE_DOSSIERS[code].replace(/^Dossiers? /, "")}`,
        metadata: JSON.stringify({ completude: code, masque: masquer }),
      },
    }),
  ]);
}

/* ── Dates réelles ──────────────────────────────────────────────── */

/**
 * La fiche client d'un dossier était en contact au plus tard à son ouverture
 * réelle : un dossier repris en juin fait d'un client saisi en septembre un
 * client de juin (acquisition et nouveaux clients de /synthese). Le premier
 * contact recule, il n'avance jamais.
 */
export async function reculerPremierContact(tx: Transaction, dossierId: string): Promise<void> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { clientId: true, ouvertLe: true, createdAt: true } });
  if (!dossier?.clientId) return;
  const ouverture = dossier.ouvertLe ?? dossier.createdAt;
  await tx.client.updateMany({ where: { id: dossier.clientId, anonymiseLe: null, premierContactLe: { gt: ouverture } }, data: { premierContactLe: ouverture } });
}

async function evenementOuverture(tx: Transaction, dossierId: string) {
  const changements = await tx.dossierEvenement.findMany({
    where: { dossierId, type: "CHANGEMENT_ETAPE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, metadata: true },
  });
  return changements.find((changement) => lireMetadataChangementEtape(changement.metadata)?.nature === "OUVERTURE") ?? null;
}

export const schemaDateEvenement = z.object({
  survenuLe: jourPasse("Date invalide.", "La date est à venir."),
});

/**
 * Date réelle d'un passage d'étape : « signé en juillet » plutôt que le jour
 * de la saisie. La date de saisie reste sur l'événement, l'ancienne date au
 * journal ; une date « inconnue » (reprise) devient connue. Corriger
 * l'ouverture corrige aussi la date d'ouverture du dossier, une perte sa date
 * de perte.
 */
export async function modifierDateEvenement(dossierId: string, evenementId: string, entree: z.output<typeof schemaDateEvenement>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const evenement = await tx.dossierEvenement.findFirst({ where: { id: evenementId, dossierId } });
    if (!evenement) throw new ErreurMetier("Événement introuvable dans ce dossier.", 404);
    const metadata = evenement.type === "CHANGEMENT_ETAPE" ? lireMetadataChangementEtape(evenement.metadata) : null;
    if (!metadata) throw new ErreurMetier("Seule la date d'un passage d'étape se corrige ici.", 400);

    const date = instantDuJour(entree.survenuLe);
    const sansInconnue = { ...metadata };
    delete sansInconnue.dateInconnue;
    await tx.dossierEvenement.update({
      where: { id: evenementId },
      data: {
        survenuLe: date,
        ...(metadata.dateInconnue ? { metadata: JSON.stringify(sansInconnue) } : {}),
      },
    });
    if (metadata.nature === "OUVERTURE") {
      await tx.dossier.update({ where: { id: dossierId }, data: { ouvertLe: date } });
      await reculerPremierContact(tx, dossierId);
    }
    if (metadata.vers === "PERDU") {
      const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
      const dernierePerte = (await tx.dossierEvenement.findMany({
        where: { dossierId, type: "CHANGEMENT_ETAPE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, metadata: true },
      })).find((changement) => lireMetadataChangementEtape(changement.metadata)?.vers === "PERDU");
      if (dossier?.etape === "PERDU" && dernierePerte?.id === evenementId) await tx.dossier.update({ where: { id: dossierId }, data: { perteLe: date } });
    }
  });
}

/* ── Notes ──────────────────────────────────────────────────────── */

/** Écrit une note et son événement dans la transaction de l'appelant (interface ou proposition validée). */
export async function ecrireNote(tx: Transaction, dossierId: string, entree: z.output<typeof schemaNote>) {
  const existe = await tx.dossier.findUnique({ where: { id: dossierId }, select: { id: true } });
  if (!existe) throw new ErreurMetier("Dossier introuvable.", 404);
  const creee = await tx.dossierNote.create({ data: { dossierId, etape: entree.etape, contenu: entree.contenu } });
  const extrait = entree.contenu.length > 280 ? `${entree.contenu.slice(0, 279)}…` : entree.contenu;
  await tx.dossierEvenement.create({
    data: {
      dossierId,
      type: "NOTE_AJOUTEE",
      direction: "INTERNE",
      contenu: `${LIBELLES_ETAPE[entree.etape]} : ${extrait}`,
      metadata: JSON.stringify({ noteId: creee.id, etape: entree.etape }),
    },
  });
  // Une note fait bouger le dossier dans le tri « récemment modifié ».
  await tx.dossier.update({ where: { id: dossierId }, data: { updatedAt: new Date() } });
  return creee;
}

export async function ajouterNote(dossierId: string, entree: z.output<typeof schemaNote>): Promise<NoteVue> {
  const note = await prisma.$transaction((tx) => ecrireNote(tx, dossierId, entree));
  return { id: note.id, etape: entree.etape, contenu: note.contenu, createdAt: note.createdAt.toISOString() };
}

/* ── Photos ─────────────────────────────────────────────────────── */

const ID_PHOTO = /^[a-z0-9]+-[a-f0-9]{8}$/;

async function photosDuDossier(dossierId: string) {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { photos: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  return { brut: dossier.photos, chemins: lirePhotos(dossier.photos) };
}

/** Réécrit la liste des photos si personne ne l'a modifiée depuis la lecture. */
async function remplacerPhotos(dossierId: string, avant: string, chemins: string[]): Promise<boolean> {
  const { count } = await prisma.dossier.updateMany({
    where: { id: dossierId, photos: avant },
    data: { photos: JSON.stringify(chemins) },
  });
  return count === 1;
}

export async function ajouterPhoto(dossierId: string, fichier: File, apres = false): Promise<PhotoVue> {
  verifierPhoto(fichier);
  await photosDuDossier(dossierId);
  const chemin = await enregistrerPhoto(dossierId, fichier, apres);
  for (let essai = 0; essai < 3; essai++) {
    const { brut, chemins } = await photosDuDossier(dossierId);
    if (await remplacerPhotos(dossierId, brut, [...chemins, chemin])) {
      return { id: idPhoto(chemin), url: urlPhoto(dossierId, chemin), type: typeMimePhoto(chemin), apres: estPhotoApres(chemin) };
    }
  }
  await archiverFichier(chemin, "photo-non-rattachee").catch(() => {});
  throw new ErreurMetier("Les photos ont changé entre-temps : réessaie.", 409);
}

export async function supprimerPhoto(dossierId: string, photoId: string): Promise<void> {
  const { brut, chemins } = await photosDuDossier(dossierId);
  const chemin = ID_PHOTO.test(photoId) ? chemins.find((c) => idPhoto(c) === photoId) : undefined;
  if (!chemin) throw new ErreurMetier("Photo introuvable.", 404);
  if (!(await remplacerPhotos(dossierId, brut, chemins.filter((c) => c !== chemin)))) {
    throw new ErreurMetier("Les photos ont changé entre-temps : recharge le dossier.", 409);
  }
  await archiverFichier(chemin, "photo-retiree");
}

export async function lirePhoto(dossierId: string, photoId: string): Promise<{ contenu: Buffer; type: string }> {
  if (!ID_PHOTO.test(photoId)) throw new ErreurMetier("Photo introuvable.", 404);
  const { chemins } = await photosDuDossier(dossierId);
  const chemin = chemins.find((c) => idPhoto(c) === photoId);
  const contenu = chemin ? await lireFichier(chemin) : null;
  if (!chemin || !contenu) throw new ErreurMetier("Photo introuvable.", 404);
  return { contenu, type: typeMimePhoto(chemin) };
}
