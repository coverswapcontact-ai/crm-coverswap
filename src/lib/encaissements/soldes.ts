import type { Transaction } from "@/lib/prisma";
import { versCentimes } from "@/lib/dossiers/montants";
import type { MoyenPaiement, StatutAffectation, StatutEncaissement } from "./constantes";
import type { PaiementsDossier } from "./types";

/**
 * Lectures des soldes, sans écriture : ce qu'un dossier a facturé, reçu et
 * doit encore. Tous les calculs se font en centimes.
 */

export type PieceSolde = {
  registreId: string;
  numero: string;
  type: "DEVIS" | "FACTURE";
  documentId: string | null;
  statutDocument: string | null;
  emisLe: Date | null;
  /** Devis : son total ; facture : le montant dû ; null si inconnu. */
  totalCentimes: number | null;
  /** Somme des affectations actives. */
  regleCentimes: number;
  /** Facture active : reste à payer (jamais négatif) ; sinon null. */
  resteCentimes: number | null;
  active: boolean;
};

const centimes = (montants: { montant: number }[]) => montants.reduce((somme, ligne) => somme + versCentimes(ligne.montant), 0);

/** Devis et factures émis d'un dossier, avec ce qui les règle. */
export async function piecesDuDossier(lecteur: Transaction, dossierId: string): Promise<PieceSolde[]> {
  const documents = await lecteur.document.findMany({
    where: { dossierId, type: { in: ["DEVIS", "FACTURE"] }, numero: { not: null } },
    select: { id: true, type: true, numero: true, statut: true, totalHt: true, dateEmission: true },
    orderBy: [{ dateEmission: "asc" }, { createdAt: "asc" }],
  });
  if (documents.length === 0) return [];
  const registre = await lecteur.numeroDocument.findMany({
    where: { documentId: { in: documents.map((document) => document.id) } },
    select: { id: true, documentId: true, affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
  });
  const ligneDe = new Map(registre.map((ligne) => [ligne.documentId, ligne]));

  return documents.flatMap((document): PieceSolde[] => {
    const ligne = ligneDe.get(document.id);
    if (!ligne || !document.numero) return [];
    const type = document.type as "DEVIS" | "FACTURE";
    const active = type === "FACTURE" ? document.statut !== "ANNULEE" : document.statut !== "REMPLACE";
    const total = versCentimes(document.totalHt);
    const regle = centimes(ligne.affectations);
    return [
      {
        registreId: ligne.id,
        numero: document.numero,
        type,
        documentId: document.id,
        statutDocument: document.statut,
        emisLe: document.dateEmission,
        totalCentimes: total,
        regleCentimes: regle,
        resteCentimes: type === "FACTURE" && active ? Math.max(0, total - regle) : null,
        active,
      },
    ];
  });
}

/** Faits de paiement qui conditionnent les étapes « Signé » et « Encaissé ». */
export async function faitsPaiements(lecteur: Transaction, dossierId: string) {
  const [valides, pieces] = await Promise.all([
    lecteur.encaissement.count({ where: { dossierId, statut: "VALIDE" } }),
    piecesDuDossier(lecteur, dossierId),
  ]);
  const factures = pieces.filter((piece) => piece.type === "FACTURE" && piece.active);
  const resteCentimes = factures.reduce((somme, facture) => somme + (facture.resteCentimes ?? 0), 0);
  return {
    acompteEnregistre: valides > 0,
    soldeEncaisse: factures.length > 0 && resteCentimes === 0,
    resteCentimes,
    pieces,
  };
}

/** Paiements d'un dossier, tels que le panneau les affiche. */
export async function chargerPaiementsDossier(lecteur: Transaction, dossierId: string): Promise<PaiementsDossier> {
  const [faits, encaissements] = await Promise.all([
    faitsPaiements(lecteur, dossierId),
    lecteur.encaissement.findMany({
      where: { dossierId },
      orderBy: [{ recuLe: "desc" }, { createdAt: "desc" }],
      include: {
        affectations: {
          orderBy: { createdAt: "asc" },
          include: { numeroDocument: { select: { numero: true, type: true } } },
        },
      },
    }),
  ]);

  let nonAffecteCentimes = 0;
  const vues = encaissements.map((encaissement) => {
    const actives = encaissement.affectations.filter((affectation) => affectation.statut === "ACTIVE");
    const libre = encaissement.statut === "VALIDE" ? Math.max(0, versCentimes(encaissement.montant) - centimes(actives)) : 0;
    nonAffecteCentimes += libre;
    return {
      id: encaissement.id,
      payeur: encaissement.payeur,
      montant: encaissement.montant,
      moyen: encaissement.moyen as MoyenPaiement | null,
      reference: encaissement.reference,
      recuLe: encaissement.recuLe.toISOString(),
      crediteLe: encaissement.crediteLe?.toISOString() ?? null,
      statut: encaissement.statut as StatutEncaissement,
      finLe: encaissement.finLe?.toISOString() ?? null,
      motifFin: encaissement.motifFin,
      origine: encaissement.origine,
      note: encaissement.note,
      affectations: encaissement.affectations.map((affectation) => ({
        id: affectation.id,
        numero: affectation.numeroDocument.numero,
        type: affectation.numeroDocument.type as "DEVIS" | "FACTURE",
        montant: affectation.montant,
        statut: affectation.statut as StatutAffectation,
        motifFin: affectation.motifFin,
      })),
      nonAffecte: libre / 100,
    };
  });

  return {
    encaissements: vues,
    pieces: faits.pieces.map((piece) => ({
      registreId: piece.registreId,
      numero: piece.numero,
      type: piece.type,
      total: piece.totalCentimes === null ? null : piece.totalCentimes / 100,
      regle: piece.regleCentimes / 100,
      reste: piece.resteCentimes === null ? null : piece.resteCentimes / 100,
      active: piece.active,
    })),
    nonAffecte: nonAffecteCentimes / 100,
    resteDu: faits.resteCentimes / 100,
    acompteEnregistre: faits.acompteEnregistre,
    soldeEncaisse: faits.soldeEncaisse,
  };
}
