import prisma, { type Transaction } from "@/lib/prisma";
import { AMORCES_COMPTEURS, NUMEROTATION, type TypeDocument } from "./constants";
import { anneeParis } from "./dates";
import { ErreurMetier } from "./erreurs";
import { formaterNumero, lireNumero, prochainNumero } from "./numerotation";

/**
 * Les compteurs de numérotation (mission 12) : une valeur lisible et
 * modifiable dans Paramètres, et par l'assistant. Le compteur d'une série
 * vaut le dernier rang attribué ; le prochain document reçoit rang + 1, en
 * sautant ce qui est déjà inscrit au registre. Un devis fait hors du CRM et
 * inscrit avec un numéro plus grand fait avancer le compteur : la série ne
 * repasse jamais derrière un numéro qui existe.
 */

export const SERIES = ["DEVIS", "FACTURE"] as const;
export type Serie = (typeof SERIES)[number];
export const LIBELLES_SERIE: Record<Serie, string> = { DEVIS: "Devis", FACTURE: "Factures et avoirs" };

export type CompteurVue = {
  serie: Serie;
  libelle: string;
  annee: number;
  /** Dernier rang attribué par le CRM ; null tant que le CRM n'a rien émis dans l'année. */
  valeur: number | null;
  /** Plus haut rang inscrit au registre (CRM, ancien écran, numéros déclarés), amorce comprise. */
  plusHautRegistre: number;
  prochain: string;
  prefixe: string;
};

const plancherDe = async (client: Transaction | typeof prisma, serie: Serie, annee: number): Promise<number> => {
  const { famillesPrecedentes } = NUMEROTATION[serie];
  const plusHaut = await client.numeroDocument.aggregate({ where: { annee, famille: { in: [...famillesPrecedentes] } }, _max: { rang: true } });
  return Math.max(plusHaut._max.rang ?? 0, AMORCES_COMPTEURS[serie]?.[annee] ?? 0);
};

export async function lireCompteurs(date: Date = new Date(), client: Transaction | typeof prisma = prisma): Promise<CompteurVue[]> {
  const annee = anneeParis(date);
  return Promise.all(
    SERIES.map(async (serie) => {
      const { prefixe } = NUMEROTATION[serie];
      const [ligne, plusHautRegistre, prochain] = await Promise.all([
        client.compteurNumerotation.findUnique({ where: { serie_annee: { serie, annee } } }),
        plancherDe(client, serie, annee),
        prochainNumero(serie, date),
      ]);
      return { serie, libelle: LIBELLES_SERIE[serie], annee, valeur: ligne?.valeur ?? null, plusHautRegistre, prochain, prefixe };
    })
  );
}

/**
 * Pose le prochain numéro d'une série (« 2026-043 », ou le rang 43) : le
 * compteur vaut prochain − 1. Refusé en dessous du plus haut numéro inscrit au
 * registre : un numéro qui existe ne se réattribue jamais.
 */
export async function poserCompteur(entree: { serie: Serie; prochain: string | number; annee?: number }, client: Transaction | typeof prisma = prisma): Promise<CompteurVue> {
  const { prefixe } = NUMEROTATION[entree.serie];
  let annee = entree.annee ?? anneeParis(new Date());
  let rang: number;
  if (typeof entree.prochain === "number") rang = entree.prochain;
  else {
    const lu = lireNumero(String(entree.prochain));
    if (!lu) throw new ErreurMetier("Numéro illisible : attendu 2026-043 (devis) ou F2026-012 (facture).", 400);
    if (lu.famille !== prefixe.toUpperCase()) throw new ErreurMetier(`« ${entree.prochain} » n'est pas un numéro de la série ${LIBELLES_SERIE[entree.serie].toLowerCase()} (préfixe « ${prefixe || "aucun"} »).`, 400);
    annee = lu.annee;
    rang = lu.rang;
  }
  if (!Number.isInteger(rang) || rang < 1 || rang > 99_999) throw new ErreurMetier("Prochain numéro invalide.", 400);
  const plancher = await plancherDe(client, entree.serie, annee);
  if (rang <= plancher) {
    throw new ErreurMetier(`Le prochain numéro doit dépasser le dernier inscrit au registre (${formaterNumero(prefixe, annee, plancher)}) : au plus tôt ${formaterNumero(prefixe, annee, plancher + 1)}.`, 409);
  }
  await client.compteurNumerotation.upsert({
    where: { serie_annee: { serie: entree.serie, annee } },
    create: { serie: entree.serie, annee, valeur: rang - 1 },
    update: { valeur: rang - 1 },
  });
  const vues = await lireCompteurs(new Date(Date.UTC(annee, 5, 15, 12)), client);
  return vues.find((c) => c.serie === entree.serie)!;
}

/**
 * Un numéro inscrit hors du CRM (déclaration, document repris) plus grand que
 * le compteur de sa série le fait avancer. Rien si le compteur n'existe pas
 * encore : à sa naissance il part déjà après le plus haut numéro inscrit.
 * « FACT-… » (ancien écran) n'est pas la série « F » du CRM : ignoré.
 */
export async function avancerCompteur(client: Transaction | typeof prisma, type: TypeDocument | "INCONNU", lu: { famille: string; annee: number; rang: number }): Promise<boolean> {
  const serie: Serie | null = type === "DEVIS" ? "DEVIS" : type === "FACTURE" || type === "AVOIR" ? "FACTURE" : null;
  if (!serie || NUMEROTATION[serie].prefixe.toUpperCase() !== lu.famille) return false;
  const { count } = await client.compteurNumerotation.updateMany({ where: { serie, annee: lu.annee, valeur: { lt: lu.rang } }, data: { valeur: lu.rang } });
  return count > 0;
}
