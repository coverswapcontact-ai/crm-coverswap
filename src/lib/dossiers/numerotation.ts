import { Prisma } from "@prisma/client";
import prisma, { type Transaction } from "@/lib/prisma";
import { ecritureCourante } from "@/lib/journal/extension";
import { AMORCES_COMPTEURS, NUMEROTATION, type TypeDocument } from "./constants";
import { anneeParis } from "./dates";
import { ErreurMetier } from "./erreurs";

export function formaterNumero(prefixe: string, annee: number, rang: number): string {
  return `${prefixe}${annee}-${String(rang).padStart(3, "0")}`;
}

/** « F2026-012 », « FACT-2026-0007 », « 2026-038 » → famille, année, rang ; null si illisible. */
export function lireNumero(numero: string): { famille: string; annee: number; rang: number } | null {
  const lu = /^([A-Za-z]*)[-\s]?(\d{4})-(\d{1,6})$/.exec(numero.trim());
  if (!lu) return null;
  return { famille: lu[1].toUpperCase(), annee: Number(lu[2]), rang: Number(lu[3]) };
}

export function cleNumero(famille: string, annee: number, rang: number): string {
  return `${famille}:${annee}:${rang}`;
}

function amorceStatique(compteur: string, annee: number): number {
  return AMORCES_COMPTEURS[compteur]?.[annee] ?? 0;
}

/**
 * Attribue le prochain numéro de la série du type de document et l'inscrit au
 * registre. À appeler DANS la transaction qui crée le document : si elle
 * échoue, compteur et registre reviennent en arrière et le numéro n'a jamais
 * existé.
 *
 * - Une seule instruction lit et incrémente le compteur (UPSERT … RETURNING) :
 *   deux générations simultanées n'obtiennent jamais la même valeur.
 * - À sa création, le compteur démarre après le plus haut rang inscrit au
 *   registre pour ses familles précédentes (et au moins après l'amorce).
 * - Un numéro déjà inscrit (numérotation manuelle déclarée, ancien écran) est
 *   sauté, jamais réattribué.
 * - Une facture ou un avoir ne peut pas être daté avant le dernier de sa série.
 */
export async function attribuerNumero(
  tx: Transaction,
  type: TypeDocument,
  dateEmission: Date
): Promise<{ numero: string; registreId: string }> {
  const { compteur, prefixe, famillesPrecedentes } = NUMEROTATION[type];
  const annee = anneeParis(dateEmission);

  if (type !== "DEVIS") {
    const dernier = await tx.numeroDocument.findFirst({
      where: { famille: prefixe.toUpperCase(), annee, emisLe: { not: null } },
      orderBy: { rang: "desc" },
      select: { emisLe: true, numero: true },
    });
    if (dernier?.emisLe && dernier.emisLe > dateEmission) {
      throw new ErreurMetier(
        `Numérotation chronologique : ${dernier.numero} est daté après ce document. Vérifie l'horloge du serveur avant de continuer.`,
        409
      );
    }
  }

  const ecriture = await ecritureCourante();
  for (let essai = 0; essai < 200; essai++) {
    const lignes = await tx.$queryRaw<{ valeur: number | bigint }[]>`
      INSERT INTO "CompteurNumerotation" ("serie", "annee", "valeur", "ecriture")
      VALUES (
        ${compteur},
        ${annee},
        MAX(
          ${amorceStatique(compteur, annee)},
          COALESCE((SELECT MAX("rang") FROM "NumeroDocument" WHERE "annee" = ${annee} AND "famille" IN (${Prisma.join([...famillesPrecedentes])})), 0)
        ) + 1,
        ${ecriture}
      )
      ON CONFLICT ("serie", "annee") DO UPDATE SET "valeur" = "valeur" + 1, "ecriture" = excluded."ecriture"
      RETURNING "valeur"`;
    const rang = Number(lignes[0]?.valeur);
    if (!Number.isInteger(rang) || rang < 1) throw new Error(`Compteur de numérotation illisible (${compteur} ${annee})`);

    const famille = prefixe.toUpperCase();
    const cle = cleNumero(famille, annee, rang);
    if (await tx.numeroDocument.findUnique({ where: { cle }, select: { id: true } })) continue;

    const numero = formaterNumero(prefixe, annee, rang);
    const inscrit = await tx.numeroDocument.create({
      data: { cle, numero, famille, annee, rang, type, origine: "CRM", emisLe: dateEmission },
    });
    return { numero, registreId: inscrit.id };
  }
  throw new Error(`Numérotation ${compteur} ${annee} : 200 numéros déjà pris d'affilée, registre à vérifier`);
}

/** Numéro que recevrait le prochain document : indicatif, rien n'est réservé. */
export async function prochainNumero(type: TypeDocument, date: Date = new Date()): Promise<string> {
  const { compteur, prefixe, famillesPrecedentes } = NUMEROTATION[type];
  const annee = anneeParis(date);
  const [ligne, plusHaut] = await Promise.all([
    prisma.compteurNumerotation.findUnique({ where: { serie_annee: { serie: compteur, annee } } }),
    prisma.numeroDocument.aggregate({
      where: { annee, famille: { in: [...famillesPrecedentes] } },
      _max: { rang: true },
    }),
  ]);
  const famille = prefixe.toUpperCase();
  let rang = (ligne?.valeur ?? Math.max(amorceStatique(compteur, annee), plusHaut._max.rang ?? 0)) + 1;
  for (let essai = 0; essai < 200; essai++, rang++) {
    const pris = await prisma.numeroDocument.findUnique({ where: { cle: cleNumero(famille, annee, rang) }, select: { id: true } });
    if (!pris) break;
  }
  return formaterNumero(prefixe, annee, rang);
}

/** Numéro factice de même longueur, pour une mise en page d'essai du PDF. */
export function numeroFactice(type: TypeDocument, date: Date = new Date()): string {
  return formaterNumero(NUMEROTATION[type].prefixe, anneeParis(date), 999);
}
