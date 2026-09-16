import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AMORCES_COMPTEURS, NUMEROTATION, type TypeDocument } from "./constants";
import { anneeParis } from "./dates";

function formaterNumero(type: TypeDocument, annee: number, valeur: number): string {
  return `${NUMEROTATION[type].prefixe}${annee}-${String(valeur).padStart(3, "0")}`;
}

function amorce(compteur: string, annee: number): number {
  return AMORCES_COMPTEURS[compteur]?.[annee] ?? 0;
}

/**
 * Attribue le prochain numéro de la série du type de document.
 *
 * Une seule instruction SQL (UPSERT … RETURNING) lit et incrémente le
 * compteur : deux générations simultanées ne peuvent pas obtenir la même
 * valeur. À appeler DANS la transaction qui crée le document : si la
 * création échoue, l'incrément est annulé avec elle et aucun numéro n'est
 * perdu. Un numéro validé n'est jamais réattribué (le compteur ne recule pas,
 * et l'index unique Document(type, numero) refuse un doublon).
 */
export async function attribuerNumero(
  tx: Prisma.TransactionClient,
  type: TypeDocument,
  dateEmission: Date
): Promise<string> {
  const { compteur } = NUMEROTATION[type];
  const annee = anneeParis(dateEmission);
  const lignes = await tx.$queryRaw<{ valeur: number | bigint }[]>`
    INSERT INTO "CompteurNumerotation" ("serie", "annee", "valeur")
    VALUES (${compteur}, ${annee}, ${amorce(compteur, annee) + 1})
    ON CONFLICT ("serie", "annee") DO UPDATE SET "valeur" = "valeur" + 1
    RETURNING "valeur"`;
  const valeur = Number(lignes[0]?.valeur);
  if (!Number.isInteger(valeur) || valeur < 1) {
    throw new Error(`Compteur de numérotation illisible (${compteur} ${annee})`);
  }
  return formaterNumero(type, annee, valeur);
}

/** Numéro que recevrait le prochain document : indicatif, rien n'est réservé. */
export async function prochainNumero(type: TypeDocument, date: Date = new Date()): Promise<string> {
  const { compteur } = NUMEROTATION[type];
  const annee = anneeParis(date);
  const ligne = await prisma.compteurNumerotation.findUnique({
    where: { serie_annee: { serie: compteur, annee } },
  });
  return formaterNumero(type, annee, (ligne?.valeur ?? amorce(compteur, annee)) + 1);
}

/** Numéro factice de même longueur, pour une mise en page d'essai du PDF. */
export function numeroFactice(type: TypeDocument, date: Date = new Date()): string {
  return formaterNumero(type, anneeParis(date), 999);
}
