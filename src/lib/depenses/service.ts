import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateDepuisJour, formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant, versCentimes } from "@/lib/dossiers/montants";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { archiverFichierConserve, empreinteDe, enregistrerFichier, verifierJustificatif } from "@/lib/fichiers/stockage";
import {
  CATEGORIES_DEPENSE,
  type CategorieDepense,
  type ChantierPropose,
  type DepenseVue,
  type EntreeDepense,
  type MOYENS_DEPENSE,
  schemaModificationDepense,
} from "./constantes";
import type { z } from "zod/v4";

/**
 * Dépenses : l'argent sorti, rattaché au chantier qu'il sert (pour connaître
 * la marge de chaque dossier) ou explicitement hors chantier (frais généraux).
 * Le justificatif (photo du ticket, PDF) est conservé et jamais supprimé.
 */

const INCLURE = {
  dossier: { select: { id: true, clientNom: true, objet: true } },
  justificatif: { select: { id: true, typeMime: true } },
} as const;

type DepenseLue = Awaited<ReturnType<typeof prisma.depense.findFirstOrThrow<{ include: typeof INCLURE }>>>;

function versVue(depense: DepenseLue): DepenseVue {
  return {
    id: depense.id,
    payeeLe: depense.payeeLe.toISOString(),
    montant: depense.montant,
    fournisseur: depense.fournisseur,
    categorie: depense.categorie as CategorieDepense,
    libelle: depense.libelle,
    moyen: depense.moyen as (typeof MOYENS_DEPENSE)[number] | null,
    dossier: depense.dossier,
    horsChantier: depense.horsChantier,
    justificatif: depense.justificatif ? { url: `/api/depenses/${depense.id}/justificatif`, typeMime: depense.justificatif.typeMime } : null,
    note: depense.note,
    archiveLe: depense.archiveLe?.toISOString() ?? null,
    archiveMotif: depense.archiveMotif,
  };
}

async function verifierDossier(dossierId: string | null | undefined): Promise<void> {
  if (!dossierId) return;
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true } });
  if (!dossier) throw new ErreurMetier("Chantier introuvable.", 404);
}

/**
 * Enregistre une dépense et son justificatif. Idempotente pour une saisie faite
 * sur le téléphone : renvoyée après une coupure réseau (même identifiant), la
 * dépense déjà reçue est rendue telle quelle. Un justificatif déjà attaché à
 * une autre dépense signale un doublon probable (409), sauf à forcer.
 */
export async function creerDepense(entree: EntreeDepense, justificatif: File | null): Promise<{ depense: DepenseVue; dejaRecue: boolean }> {
  if (entree.identifiantHorsLigne) {
    const recue = await prisma.depense.findUnique({ where: { identifiantHorsLigne: entree.identifiantHorsLigne }, include: INCLURE });
    if (recue) return { depense: versVue(recue), dejaRecue: true };
  }
  await verifierDossier(entree.dossierId);

  if (justificatif) {
    verifierJustificatif(justificatif);
    if (!entree.forcer) {
      const empreinte = empreinteDe(Buffer.from(await justificatif.arrayBuffer()));
      const autre = await prisma.depense.findFirst({
        where: { justificatif: { empreinte, archiveLe: null } },
        select: { id: true, payeeLe: true, fournisseur: true, montant: true },
      });
      if (autre) {
        throw new ErreurMetier(
          `Ce justificatif est déjà attaché à la dépense du ${formatDateCourte(autre.payeeLe)} (${autre.fournisseur}, ${formatMontant(autre.montant)}). Doublon ?`,
          409,
          { doublonId: autre.id }
        );
      }
    }
  }

  const fichier = justificatif ? await enregistrerFichier("justificatifs", justificatif, dateDepuisJour(entree.payeeLe)) : null;
  try {
    const depense = await prisma.depense.create({
      data: {
        payeeLe: dateDepuisJour(entree.payeeLe),
        montant: versCentimes(entree.montant) / 100,
        fournisseur: entree.fournisseur,
        categorie: entree.categorie,
        libelle: entree.libelle || null,
        moyen: entree.moyen ?? null,
        dossierId: entree.dossierId || null,
        horsChantier: entree.horsChantier ?? false,
        justificatifId: fichier?.id ?? null,
        identifiantHorsLigne: entree.identifiantHorsLigne || null,
        note: entree.note || null,
      },
      include: INCLURE,
    });
    return { depense: versVue(depense), dejaRecue: false };
  } catch (erreur) {
    // Deux envois simultanés de la même saisie : le second rend la dépense du premier.
    if (fichier) await archiverFichierConserve(fichier.id, "Dépense non enregistrée").catch(() => {});
    if (entree.identifiantHorsLigne && (erreur as { code?: string }).code === "P2002") {
      const recue = await prisma.depense.findUnique({ where: { identifiantHorsLigne: entree.identifiantHorsLigne }, include: INCLURE });
      if (recue) return { depense: versVue(recue), dejaRecue: true };
    }
    throw erreur;
  }
}

export async function modifierDepense(id: string, entree: z.output<typeof schemaModificationDepense>): Promise<DepenseVue> {
  const actuelle = await prisma.depense.findUnique({ where: { id } });
  if (!actuelle) throw new ErreurMetier("Dépense introuvable.", 404);
  if (actuelle.archiveLe) throw new ErreurMetier("Dépense retirée : elle ne se modifie plus.", 409);
  await verifierDossier(entree.dossierId);
  const rattachement =
    entree.dossierId !== undefined || entree.horsChantier !== undefined
      ? { dossierId: entree.dossierId || null, horsChantier: entree.dossierId ? false : (entree.horsChantier ?? false) }
      : {};
  const depense = await prisma.depense.update({
    where: { id },
    data: {
      ...(entree.payeeLe ? { payeeLe: dateDepuisJour(entree.payeeLe) } : {}),
      ...(entree.montant !== undefined ? { montant: versCentimes(entree.montant) / 100 } : {}),
      ...(entree.fournisseur !== undefined ? { fournisseur: entree.fournisseur } : {}),
      ...(entree.categorie !== undefined ? { categorie: entree.categorie } : {}),
      ...(entree.libelle !== undefined ? { libelle: entree.libelle || null } : {}),
      ...(entree.moyen !== undefined ? { moyen: entree.moyen } : {}),
      ...(entree.note !== undefined ? { note: entree.note || null } : {}),
      ...rattachement,
    },
    include: INCLURE,
  });
  return versVue(depense);
}

/** Dépense saisie par erreur : retirée avec son motif, jamais supprimée. */
export async function archiverDepense(id: string, motif: string): Promise<void> {
  const { count } = await prisma.depense.updateMany({ where: { id, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: motif } });
  if (count !== 1) throw new ErreurMetier("Dépense introuvable ou déjà retirée.", 404);
}

/** Nouveau justificatif : l'ancien part aux archives, le nouveau prend sa place. */
export async function remplacerJustificatif(id: string, justificatif: File): Promise<DepenseVue> {
  const actuelle = await prisma.depense.findUnique({ where: { id } });
  if (!actuelle) throw new ErreurMetier("Dépense introuvable.", 404);
  const fichier = await enregistrerFichier("justificatifs", justificatif, actuelle.payeeLe);
  const depense = await prisma.depense.update({ where: { id }, data: { justificatifId: fichier.id }, include: INCLURE });
  if (actuelle.justificatifId) await archiverFichierConserve(actuelle.justificatifId, "Remplacé par un nouveau justificatif");
  return versVue(depense);
}

export async function justificatifDe(id: string): Promise<string> {
  const depense = await prisma.depense.findUnique({ where: { id }, select: { justificatifId: true } });
  if (!depense?.justificatifId) throw new ErreurMetier("Aucun justificatif pour cette dépense.", 404);
  return depense.justificatifId;
}

export type ListeDepenses = {
  annee: number;
  depenses: DepenseVue[];
  total: number;
  parCategorie: { categorie: CategorieDepense; libelle: string; total: number }[];
  aRattacher: number;
  sansJustificatif: number;
};

export async function listerDepenses(annee: number): Promise<ListeDepenses> {
  const depenses = await prisma.depense.findMany({
    where: { payeeLe: { gte: new Date(`${annee}-01-01T00:00:00Z`), lt: new Date(`${annee + 1}-01-01T00:00:00Z`) } },
    orderBy: [{ payeeLe: "desc" }, { createdAt: "desc" }],
    include: INCLURE,
  });
  const centimes = (liste: { montant: number }[]) => liste.reduce((somme, depense) => somme + versCentimes(depense.montant), 0);
  return {
    annee,
    depenses: depenses.map(versVue),
    total: centimes(depenses) / 100,
    parCategorie: CATEGORIES_DEPENSE.map((categorie) => ({
      categorie: categorie.code,
      libelle: categorie.libelle,
      total: centimes(depenses.filter((depense) => depense.categorie === categorie.code)) / 100,
    })).filter((ligne) => ligne.total > 0),
    aRattacher: depenses.filter((depense) => !depense.dossierId && !depense.horsChantier).length,
    sansJustificatif: depenses.filter((depense) => !depense.justificatifId).length,
  };
}

/** Dépenses d'un chantier, retirées comprises (barrées à l'écran). */
export async function depensesDuDossier(dossierId: string): Promise<{ depenses: DepenseVue[]; total: number }> {
  const depenses = await prisma.depense.findMany({
    where: { ...AVEC_ARCHIVES, dossierId },
    orderBy: [{ payeeLe: "desc" }, { createdAt: "desc" }],
    include: INCLURE,
  });
  const total = depenses.filter((depense) => !depense.archiveLe).reduce((somme, depense) => somme + versCentimes(depense.montant), 0) / 100;
  return { depenses: depenses.map(versVue), total };
}

/** Une facture fournisseur arrive souvent après le paiement du client : ces chantiers restent proposés. */
const ENCAISSES_RECENTS_MS = 90 * 24 * 60 * 60_000;

/**
 * Ce qu'il faut pour saisir vite : les chantiers en cours d'abord (à la pose,
 * puis planifiés au plus près d'aujourd'hui, puis signés, facturés, encaissés
 * depuis peu), le chantier probable pré-choisi, les fournisseurs récents. Le
 * dossier d'où l'on vient est toujours proposé, en premier, quelle que soit
 * son étape.
 */
export async function suggestionsSaisie(
  dossierDemande: string | null = null
): Promise<{ chantiers: ChantierPropose[]; propose: string | null; fournisseurs: string[] }> {
  const aujourdhui = jourParis(new Date());
  const [dossiers, recents] = await Promise.all([
    prisma.dossier.findMany({
      where: {
        OR: [
          { etape: { in: ["CHANTIER", "PLANIFIE", "SIGNE", "FACTURE"] } },
          { etape: "ENCAISSE", updatedAt: { gte: new Date(Date.now() - ENCAISSES_RECENTS_MS) } },
          ...(dossierDemande ? [{ id: dossierDemande }] : []),
        ],
      },
      select: { id: true, clientNom: true, objet: true, etape: true, dateChantier: true, updatedAt: true },
    }),
    prisma.depense.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { fournisseur: true } }),
  ]);
  const RANGS: Record<string, number> = { CHANTIER: 0, PLANIFIE: 1, SIGNE: 2, FACTURE: 3, ENCAISSE: 4 };
  const rang = (dossier: { id: string; etape: string }) => (dossier.id === dossierDemande ? -1 : (RANGS[dossier.etape] ?? 5));
  const ecart = (date: Date | null) => (date ? Math.abs(Date.parse(`${jourParis(date)}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) : Number.MAX_SAFE_INTEGER);
  const chantiers = dossiers
    .sort((a, b) => rang(a) - rang(b) || ecart(a.dateChantier) - ecart(b.dateChantier) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((dossier) => ({
      id: dossier.id,
      clientNom: dossier.clientNom,
      objet: dossier.objet,
      etape: dossier.etape,
      dateChantier: dossier.dateChantier?.toISOString() ?? null,
    }));

  // Pré-choix seulement quand il n'y a pas d'ambiguïté : un seul chantier à la pose,
  // ou, sans chantier à la pose, un seul chantier planifié à trois jours près.
  const enPose = dossiers.filter((dossier) => dossier.etape === "CHANTIER");
  const imminents = dossiers.filter((dossier) => dossier.etape === "PLANIFIE" && ecart(dossier.dateChantier) <= 3 * 86_400_000);
  const propose = dossierDemande && dossiers.some((dossier) => dossier.id === dossierDemande)
    ? dossierDemande
    : enPose.length === 1 ? enPose[0].id : enPose.length === 0 && imminents.length === 1 ? imminents[0].id : null;

  const fournisseurs = [...new Set(recents.map((depense) => depense.fournisseur))].slice(0, 12);
  return { chantiers, propose, fournisseurs };
}
