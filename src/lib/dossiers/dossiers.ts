import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
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
import { dateDepuisJour, estJourValide } from "./dates";
import { ErreurMetier } from "./erreurs";
import { versCentimes } from "./montants";
import {
  estEtape,
  estEtapeActive,
  estEtapeSortie,
  etapeAvantSortie,
  lireMetadataChangementEtape,
  rangEtape,
  type MetadataChangementEtape,
} from "./regles";
import {
  enregistrerPhoto,
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
import { completerCoordonnees, rattacherDossier } from "@/lib/clients/identification";
import { delaisCles, ecartsPrix, parcoursEtapes } from "./delais";

/* ── Validation ─────────────────────────────────────────────────── */

const texteObligatoire = (vide: string, max: number, trop: string) =>
  z.string(vide).trim().min(1, vide).max(max, trop);

const jourOuNull = (message: string) =>
  z
    .string(message)
    .nullable()
    .refine((valeur) => valeur === null || valeur === "" || estJourValide(valeur), message)
    .transform((valeur) => valeur || null);

const champsDossier = z.object({
  clientNom: texteObligatoire("Le nom du client est obligatoire.", 120, "Nom trop long : 120 caractères maximum."),
  clientAdresse: texteObligatoire("L'adresse est obligatoire.", 200, "Adresse trop longue : 200 caractères maximum."),
  clientCp: z
    .string("Code postal invalide : 5 chiffres attendus.")
    .trim()
    .regex(/^\d{5}$/, "Code postal invalide : 5 chiffres attendus."),
  clientVille: texteObligatoire("La ville est obligatoire.", 80, "Ville trop longue : 80 caractères maximum."),
  clientTelephone: z
    .string("Le téléphone est obligatoire.")
    .trim()
    .max(30, "Numéro de téléphone invalide.")
    .refine((valeur) => (valeur.match(/\d/g)?.length ?? 0) >= 9, "Numéro de téléphone invalide."),
  clientEmail: z
    .string("Adresse e-mail invalide.")
    .trim()
    .max(160, "Adresse e-mail trop longue.")
    .refine((valeur) => valeur === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur), "Adresse e-mail invalide.")
    .nullable()
    .transform((valeur) => valeur || null),
  objet: texteObligatoire("L'objet du chantier est obligatoire.", 160, "Objet trop long : 160 caractères maximum."),
  source: z.enum(SOURCES_DOSSIER, "Source invalide."),
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

export const schemaCreation = champsDossier.extend({
  leadId: z.string().max(40).nullable(),
  prospectId: z.string().max(40).nullable(),
  // Nouveau dossier ouvert depuis une fiche client.
  clientId: z.string().max(40).nullable().optional(),
});
export type EntreeCreation = z.output<typeof schemaCreation>;

export const schemaModification = champsDossier
  .extend({ dateChantier: jourOuNull("Date de chantier invalide.") })
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
  avantSortie: EtapeActive | null
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
    createdAt: dossier.createdAt.toISOString(),
    updatedAt: dossier.updatedAt.toISOString(),
  };
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

  return dossiers.map((dossier) => versResume(dossier, etapeAvantSortie(parDossier.get(dossier.id) ?? [])));
}

export async function chargerDetail(dossierId: string): Promise<DossierDetail> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    include: {
      lead: { select: { id: true, prenom: true, nom: true } },
      prospect: { select: { id: true, nom: true } },
      notes: { orderBy: { createdAt: "asc" } },
      evenements: { orderBy: { createdAt: "desc" }, take: 300 },
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
    where: { dossierId, type: "CHANGEMENT_ETAPE" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, metadata: true },
  });
  const parcours = parcoursEtapes(
    passages
      .map((passage) => ({ createdAt: passage.createdAt, vers: lireMetadataChangementEtape(passage.metadata)?.vers ?? "" }))
      .filter((passage) => passage.vers)
  );

  const paiements = await chargerPaiementsDossier(prisma, dossierId);

  const photos: PhotoVue[] = lirePhotos(dossier.photos).map((chemin) => ({
    id: idPhoto(chemin),
    url: urlPhoto(dossier.id, chemin),
    type: typeMimePhoto(chemin),
  }));

  return {
    ...versResume({ ...dossier, documents: dernierDevis ? [dernierDevis] : [] }, etapeAvantSortie(changements)),
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
    evenements: dossier.evenements.map((evenement) => ({
      id: evenement.id,
      type: evenement.type as TypeEvenement,
      direction: evenement.direction as DirectionEvenement,
      contenu: evenement.contenu,
      createdAt: evenement.createdAt.toISOString(),
    })),
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
      pdfUrl: document.numero ? urlPdf(dossier.id, document.id) : null,
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
 * Ouvre un dossier : règle de conversion vérifiée (coordonnées complètes,
 * objet, au moins une photo), événement d'ouverture, photos archivées.
 * Si une photo ne peut pas être écrite, la création est annulée.
 */
export async function creerDossier(entree: EntreeCreation, photos: File[]): Promise<string> {
  if (photos.length === 0) throw new ErreurMetier("Ajoute au moins une photo du chantier.");
  photos.forEach(verifierPhoto);
  if (entree.leadId && entree.prospectId) {
    throw new ErreurMetier("Un dossier vient d'un lead ou d'un prospect, pas des deux.");
  }
  const [lead, prospect] = await Promise.all([
    entree.leadId ? prisma.lead.findUnique({ where: { id: entree.leadId }, select: { id: true, statut: true } }) : null,
    entree.prospectId
      ? prisma.prospect.findUnique({ where: { id: entree.prospectId }, select: { id: true, statut: true } })
      : null,
  ]);
  if (entree.leadId && !lead) throw new ErreurMetier("Lead introuvable.", 404);
  if (entree.prospectId && !prospect) throw new ErreurMetier("Prospect introuvable.", 404);

  const ouverture: MetadataChangementEtape = { de: null, vers: "QUALIFICATION", nature: "OUVERTURE" };
  const dossier = await prisma.$transaction(async (tx) => {
    const cree = await tx.dossier.create({
      data: {
        leadId: lead?.id ?? null,
        prospectId: prospect?.id ?? null,
        clientNom: entree.clientNom,
        clientAdresse: entree.clientAdresse,
        clientCp: entree.clientCp,
        clientVille: entree.clientVille,
        clientEmail: entree.clientEmail,
        clientTelephone: entree.clientTelephone,
        objet: entree.objet,
        source: entree.source,
        montantEstime: entree.montantEstime,
        prochaineAction: entree.prochaineAction,
        prochaineActionDate: entree.prochaineActionDate ? dateDepuisJour(entree.prochaineActionDate) : null,
        etape: "QUALIFICATION",
      },
    });
    await tx.dossierEvenement.create({
      data: {
        dossierId: cree.id,
        type: "CHANGEMENT_ETAPE",
        direction: "INTERNE",
        contenu: `Dossier ouvert : ${LIBELLES_ETAPE.QUALIFICATION}`,
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
    const clientId = await rattacherDossier(tx, cree);
    return { ...cree, clientId };
  });

  try {
    const chemins: string[] = [];
    for (const photo of photos) chemins.push(await enregistrerPhoto(dossier.id, photo));
    await prisma.dossier.update({ where: { id: dossier.id }, data: { photos: JSON.stringify(chemins) } });
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

  // Le lead B2C passe à « Contacté » ; le prospect B2B est converti en client
  // (il sort des séquences de prospection), sauf s'il s'est désinscrit.
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
            details: JSON.stringify({ message: "Dossier ouvert", dossierId: dossier.id }),
          },
        }),
      ]);
    }
  } catch (erreur) {
    console.error("[dossiers] mise à jour du lead d'origine :", erreur);
  }

  return dossier.id;
}

/* ── Modification ───────────────────────────────────────────────── */

export async function modifierDossier(dossierId: string, entree: EntreeModification): Promise<void> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const etape = etapeLue(dossier.etape);
  if (entree.dateChantier === null && estEtapeActive(etape) && rangEtape(etape) >= rangEtape("PLANIFIE")) {
    throw new ErreurMetier("La date de chantier est exigée à partir de l'étape « Planifié ».", 409);
  }

  const { prochaineActionDate, dateChantier, ...champs } = entree;
  const data: Prisma.DossierUpdateInput = { ...champs };
  if (prochaineActionDate !== undefined) {
    data.prochaineActionDate = prochaineActionDate ? dateDepuisJour(prochaineActionDate) : null;
  }
  if (dateChantier !== undefined) data.dateChantier = dateChantier ? dateDepuisJour(dateChantier) : null;
  await prisma.dossier.update({ where: { id: dossierId }, data });
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

export async function ajouterPhoto(dossierId: string, fichier: File): Promise<PhotoVue> {
  verifierPhoto(fichier);
  await photosDuDossier(dossierId);
  const chemin = await enregistrerPhoto(dossierId, fichier);
  for (let essai = 0; essai < 3; essai++) {
    const { brut, chemins } = await photosDuDossier(dossierId);
    if (await remplacerPhotos(dossierId, brut, [...chemins, chemin])) {
      return { id: idPhoto(chemin), url: urlPhoto(dossierId, chemin), type: typeMimePhoto(chemin) };
    }
  }
  await archiverFichier(chemin, "photo-non-rattachee").catch(() => {});
  throw new ErreurMetier("Les photos ont changé entre-temps : réessaie.", 409);
}

export async function supprimerPhoto(dossierId: string, photoId: string): Promise<void> {
  const { brut, chemins } = await photosDuDossier(dossierId);
  const chemin = ID_PHOTO.test(photoId) ? chemins.find((c) => idPhoto(c) === photoId) : undefined;
  if (!chemin) throw new ErreurMetier("Photo introuvable.", 404);
  if (chemins.length <= 1) throw new ErreurMetier("Un dossier garde au moins une photo du chantier.", 409);
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
