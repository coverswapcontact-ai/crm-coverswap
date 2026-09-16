import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { NUMEROTATION } from "./constants";
import { dateDepuisJour, estJourValide } from "./dates";
import { ErreurMetier } from "./erreurs";
import { cleNumero, lireNumero } from "./numerotation";

export const TYPES_NUMERO = ["DEVIS", "FACTURE", "AVOIR", "INCONNU"] as const;

export type LigneRegistre = {
  id: string;
  numero: string;
  famille: string;
  annee: number;
  rang: number;
  type: (typeof TYPES_NUMERO)[number];
  origine: "CRM" | "ANCIEN_CRM" | "MANUEL";
  emisLe: string | null;
  destinataire: string | null;
  montant: number | null;
  note: string | null;
  documentId: string | null;
  dossierId: string | null;
};

export type SerieRegistre = {
  famille: string;
  annee: number;
  libelle: string;
  lignes: LigneRegistre[];
  /** Rangs absents entre le premier et le dernier : à expliquer pour une série de factures. */
  trous: number[];
};

const LIBELLES_FAMILLE: Record<string, string> = {
  "": "Série sans préfixe (numérotation manuelle 2026, puis devis)",
  F: "Factures et avoirs (F)",
  FACT: "Anciennes factures de l'ancien écran (FACT)",
};

export async function lireRegistre(): Promise<SerieRegistre[]> {
  const lignes = await prisma.numeroDocument.findMany({ orderBy: [{ annee: "desc" }, { famille: "asc" }, { rang: "asc" }] });
  const documents = await prisma.document.findMany({
    where: { id: { in: lignes.map((ligne) => ligne.documentId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, dossierId: true },
  });
  const dossierDe = new Map(documents.map((document) => [document.id, document.dossierId]));

  const series = new Map<string, SerieRegistre>();
  for (const ligne of lignes) {
    const cle = `${ligne.famille}:${ligne.annee}`;
    const serie = series.get(cle) ?? {
      famille: ligne.famille,
      annee: ligne.annee,
      libelle: `${LIBELLES_FAMILLE[ligne.famille] ?? `Série ${ligne.famille}`} — ${ligne.annee}`,
      lignes: [],
      trous: [],
    };
    serie.lignes.push({
      id: ligne.id,
      numero: ligne.numero,
      famille: ligne.famille,
      annee: ligne.annee,
      rang: ligne.rang,
      type: ligne.type as LigneRegistre["type"],
      origine: ligne.origine as LigneRegistre["origine"],
      emisLe: ligne.emisLe?.toISOString() ?? null,
      destinataire: ligne.destinataire,
      montant: ligne.montant,
      note: ligne.note,
      documentId: ligne.documentId,
      dossierId: ligne.documentId ? (dossierDe.get(ligne.documentId) ?? null) : null,
    });
    series.set(cle, serie);
  }
  for (const serie of series.values()) {
    const rangs = new Set(serie.lignes.map((ligne) => ligne.rang));
    const max = Math.max(...rangs);
    for (let rang = 1; rang <= max; rang++) if (!rangs.has(rang)) serie.trous.push(rang);
  }
  return [...series.values()];
}

export const schemaDeclaration = z.object({
  numero: z.string("Numéro manquant.").trim().min(6, "Numéro invalide : format attendu 2026-012 ou F2026-012.").max(30),
  type: z.enum(TYPES_NUMERO, "Type invalide."),
  emisLe: z.string().refine(estJourValide, "Date d'émission invalide.").nullable().optional(),
  destinataire: z.string().trim().max(160).nullable().optional(),
  montant: z.number().min(0).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * Déclare un numéro émis hors du CRM (numérotation manuelle, autre logiciel) :
 * il est inscrit au registre et ne sera jamais attribué par le CRM.
 */
export async function declarerNumero(entree: z.output<typeof schemaDeclaration>): Promise<void> {
  const lu = lireNumero(entree.numero);
  if (!lu) throw new ErreurMetier("Numéro illisible : format attendu 2026-012, F2026-012 ou FACT-2026-0012.", 400);
  const cle = cleNumero(lu.famille, lu.annee, lu.rang);
  const existant = await prisma.numeroDocument.findUnique({ where: { cle } });
  if (existant) throw new ErreurMetier(`Ce numéro est déjà inscrit au registre (${existant.numero}).`, 409);

  // Série des factures, continue et chronologique : un numéro déclaré ne se
  // glisse pas derrière la numérotation du CRM et ne rouvre pas une série que
  // le CRM a prise en relais (ancien écran).
  const { prefixe, famillesPrecedentes } = NUMEROTATION.FACTURE;
  const familleFactures = prefixe.toUpperCase();
  if (famillesPrecedentes.some((famille) => famille.toUpperCase() === lu.famille)) {
    const dernierCrm = await prisma.numeroDocument.findFirst({
      where: { famille: familleFactures, annee: lu.annee, origine: "CRM" },
      orderBy: { rang: "desc" },
    });
    if (dernierCrm && lu.famille !== familleFactures) {
      throw new ErreurMetier(`Cette série est close pour ${lu.annee} : le CRM l'a prise en relais (${dernierCrm.numero}).`, 409);
    }
    if (dernierCrm && lu.rang <= dernierCrm.rang) {
      throw new ErreurMetier(`La série des factures ${lu.annee} est tenue par le CRM jusqu'à ${dernierCrm.numero} : un numéro déclaré ne peut pas s'y glisser.`, 409);
    }
  }

  await prisma.numeroDocument.create({
    data: {
      cle,
      numero: entree.numero,
      famille: lu.famille,
      annee: lu.annee,
      rang: lu.rang,
      type: entree.type,
      origine: "MANUEL",
      emisLe: entree.emisLe ? dateDepuisJour(entree.emisLe) : null,
      destinataire: entree.destinataire || null,
      montant: entree.montant ?? null,
      note: entree.note || null,
    },
  });
}

export const schemaComplement = z.object({
  type: z.enum(TYPES_NUMERO, "Type invalide.").optional(),
  destinataire: z.string().trim().max(160).nullable().optional(),
  montant: z.number().min(0).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * Complète une ligne du registre (nature, destinataire, montant, note) ; le
 * numéro ne change jamais. Un numéro émis par le CRM se lit sur son document :
 * seule sa note se complète.
 */
export async function completerNumero(id: string, entree: z.output<typeof schemaComplement>): Promise<void> {
  const ligne = await prisma.numeroDocument.findUnique({ where: { id } });
  if (!ligne) throw new ErreurMetier("Numéro introuvable au registre.", 404);
  if (ligne.origine === "CRM" && (entree.type !== undefined || entree.destinataire !== undefined || entree.montant !== undefined)) {
    throw new ErreurMetier("Ce numéro a été émis par le CRM : nature, destinataire et montant se lisent sur son document. Seule la note se complète.", 409);
  }
  await prisma.numeroDocument.update({ where: { id }, data: entree });
}
