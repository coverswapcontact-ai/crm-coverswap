import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import {
  CLES_PARAMETRES,
  DEFINITIONS_PARAMETRES,
  type CleParametre,
  type DefinitionParametre,
  type ParametreVue,
  type ValeurParametre,
} from "./definitions";

/**
 * Paramètres datés : chaque saisie est une ligne (jamais modifiée) avec sa
 * date d'effet. La valeur applicable à une date est la plus récente dont la
 * date d'effet est passée. Une recette de mars se calcule avec le taux de
 * mars, même si le taux a changé en juillet.
 */

export class ParametresManquants extends ErreurMetier {
  constructor(cles: CleParametre[]) {
    super(
      `À renseigner avant de continuer : ${cles.map((cle) => DEFINITIONS_PARAMETRES[cle].libelle.toLowerCase()).join(" ; ")}.`,
      428,
      { parametresManquants: cles }
    );
    this.name = "ParametresManquants";
  }
}

function lireValeur(texte: string): ValeurParametre {
  try {
    const valeur: unknown = JSON.parse(texte);
    return typeof valeur === "number" || typeof valeur === "string" ? valeur : texte;
  } catch {
    return texte;
  }
}

export async function lireParametres<C extends CleParametre>(
  cles: readonly C[],
  date: Date = new Date()
): Promise<Partial<Record<C, ValeurParametre>>> {
  const lignes = await prisma.parametre.findMany({
    where: { cle: { in: [...cles] }, valableDu: { lte: date } },
    orderBy: [{ valableDu: "desc" }, { createdAt: "desc" }],
  });
  const valeurs: Partial<Record<C, ValeurParametre>> = {};
  for (const ligne of lignes) {
    const cle = ligne.cle as C;
    if (!(cle in valeurs)) valeurs[cle] = lireValeur(ligne.valeur);
  }
  return valeurs;
}

export async function lireParametre(cle: CleParametre, date: Date = new Date()): Promise<ValeurParametre | null> {
  return (await lireParametres([cle], date))[cle] ?? null;
}

/**
 * Valeurs exigées pour un calcul ou un document : si l'une manque à la date
 * voulue, rien ne se calcule au hasard — l'interface demande la saisie (428).
 */
export async function exigerParametres<C extends CleParametre>(
  cles: readonly C[],
  date: Date = new Date()
): Promise<Record<C, ValeurParametre>> {
  const valeurs = await lireParametres(cles, date);
  const manquants = cles.filter((cle) => valeurs[cle] === undefined);
  if (manquants.length > 0) throw new ParametresManquants(manquants);
  return valeurs as Record<C, ValeurParametre>;
}

export function validerValeur(cle: CleParametre, brute: unknown): ValeurParametre {
  const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
  const nombre = typeof brute === "number" ? brute : typeof brute === "string" ? Number(brute.replace(/\s/g, "").replace(",", ".")) : NaN;
  switch (definition.nature) {
    case "euros":
      if (!Number.isFinite(nombre) || nombre < 0 || nombre > 100_000_000) throw new ErreurMetier(`${definition.libelle} : montant invalide.`);
      return Math.round(nombre * 100) / 100;
    case "pourcentage":
      if (!Number.isFinite(nombre) || nombre < 0 || nombre > 100) throw new ErreurMetier(`${definition.libelle} : pourcentage entre 0 et 100 attendu.`);
      return Math.round(nombre * 1000) / 1000;
    case "jours":
      if (!Number.isInteger(nombre) || nombre < 0 || nombre > 3650) throw new ErreurMetier(`${definition.libelle} : nombre de jours invalide.`);
      return nombre;
    case "mois":
      if (!Number.isInteger(nombre) || nombre < 1 || nombre > 600) throw new ErreurMetier(`${definition.libelle} : nombre de mois entier attendu (1 à 600).`);
      return nombre;
    case "choix": {
      const valeur = String(brute ?? "");
      if (!definition.options?.some((option) => option.valeur === valeur)) throw new ErreurMetier(`${definition.libelle} : choix invalide.`);
      return valeur;
    }
    case "texte": {
      const valeur = String(brute ?? "").trim();
      if (!valeur || valeur.length > 300) throw new ErreurMetier(`${definition.libelle} : texte manquant ou trop long.`);
      return valeur;
    }
  }
}

export function estCleParametre(cle: string): cle is CleParametre {
  return (CLES_PARAMETRES as string[]).includes(cle);
}

export async function enregistrerParametre(saisie: {
  cle: string;
  valeur: unknown;
  valableDu: Date;
  source?: string | null;
}): Promise<void> {
  if (!estCleParametre(saisie.cle)) throw new ErreurMetier("Paramètre inconnu.", 400);
  const valeur = validerValeur(saisie.cle, saisie.valeur);
  await prisma.parametre.create({
    data: {
      cle: saisie.cle,
      valeur: JSON.stringify(valeur),
      valableDu: saisie.valableDu,
      source: saisie.source?.trim().slice(0, 300) || null,
    },
  });
}

export async function parametresPourEcran(maintenant: Date = new Date()): Promise<ParametreVue[]> {
  const lignes = await prisma.parametre.findMany({ orderBy: [{ valableDu: "desc" }, { createdAt: "desc" }] });
  const auteurs = new Map<string, string | null>();
  for (const ligne of lignes) {
    try {
      auteurs.set(ligne.id, (JSON.parse(ligne.ecriture ?? "{}") as { acteur?: string }).acteur ?? null);
    } catch {
      auteurs.set(ligne.id, null);
    }
  }
  return CLES_PARAMETRES.map((cle) => {
    const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
    const historique = lignes.filter((ligne) => ligne.cle === cle);
    const courante = historique.find((ligne) => ligne.valableDu <= maintenant);
    return {
      cle,
      libelle: definition.libelle,
      aide: definition.aide,
      nature: definition.nature,
      options: definition.options ?? [],
      groupe: definition.groupe,
      courante: courante
        ? { valeur: lireValeur(courante.valeur), valableDu: courante.valableDu.toISOString(), source: courante.source }
        : null,
      historique: historique.map((ligne) => ({
        id: ligne.id,
        valeur: lireValeur(ligne.valeur),
        valableDu: ligne.valableDu.toISOString(),
        source: ligne.source,
        saisiLe: ligne.createdAt.toISOString(),
        saisiPar: auteurs.get(ligne.id) ?? null,
      })),
    };
  });
}

/**
 * Toutes les valeurs datées de quelques paramètres, lues en une fois : pour
 * appliquer à chaque recette le taux ou la règle en vigueur à sa date.
 */
export async function historiqueParametres<C extends CleParametre>(
  cles: readonly C[]
): Promise<(cle: C, date: Date) => ValeurParametre | null> {
  const lignes = await prisma.parametre.findMany({
    where: { cle: { in: [...cles] } },
    orderBy: [{ valableDu: "desc" }, { createdAt: "desc" }],
    select: { cle: true, valeur: true, valableDu: true },
  });
  return (cle, date) => {
    const ligne = lignes.find((candidate) => candidate.cle === cle && candidate.valableDu <= date);
    return ligne ? lireValeur(ligne.valeur) : null;
  };
}
