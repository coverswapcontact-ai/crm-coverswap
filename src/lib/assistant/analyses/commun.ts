import { FAMILLES, famillesDe, lireSelection } from "@/lib/prestations/prestations";

/**
 * Petits calculs partagés par les « managers » (mission 8), purs et testés
 * par les analyses qui les emploient. Un chiffre rendu à Claude est toujours
 * daté, avec sa période et sa définition : c'est lui qui décide.
 */

export const moyenne = (valeurs: number[]): number | null => (valeurs.length ? Math.round((valeurs.reduce((t, v) => t + v, 0) / valeurs.length) * 100) / 100 : null);

export const mediane = (valeurs: number[]): number | null => {
  if (!valeurs.length) return null;
  const t = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return Math.round((t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2) * 100) / 100;
};

export const somme = (valeurs: number[]): number => Math.round(valeurs.reduce((t, v) => t + v, 0) * 100) / 100;

/** Taux a/b arrondi à 3 décimales ; null si b vaut 0 (jamais une division par zéro déguisée en 0 %). */
export const taux = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);

export const arrondi = (v: number, decimales = 2): number => Math.round(v * 10 ** decimales) / 10 ** decimales;

export function grouper<T>(elements: T[], cle: (e: T) => string | null | undefined): Map<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const e of elements) {
    const c = cle(e) || "—";
    groupes.set(c, [...(groupes.get(c) ?? []), e]);
  }
  return groupes;
}

export type Repartition = { cle: string; libelle: string; valeur: number };

export function repartir<T>(elements: T[], cle: (e: T) => string | null | undefined, libelle: (c: string) => string = (c) => c, valeur: (e: T) => number = () => 1): Repartition[] {
  return [...grouper(elements, cle).entries()].map(([c, liste]) => ({ cle: c, libelle: libelle(c), valeur: arrondi(liste.reduce((t, e) => t + valeur(e), 0)) })).sort((a, b) => b.valeur - a.valeur);
}

/** La famille principale d'un dossier (cuisine, salle de bain, mobilier, professionnel), d'après ses prestations. */
export function familleDuDossier(prestations: string | null | undefined, typeProjet?: string | null): string {
  const familles = famillesDe(lireSelection(prestations ?? null));
  if (familles[0]) return familles[0];
  const t = (typeProjet ?? "").toUpperCase();
  if (t === "CUISINE" || t === "SDB" || t === "MEUBLES" || t === "PRO") return t;
  return "AUTRE";
}

export const libelleFamille = (id: string): string => FAMILLES.find((f) => f.id === id)?.libelle ?? (id === "AUTRE" ? "Autre / non précisé" : id);

export const mois = (date: Date): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(date);

export const JOUR_MS = 86_400_000;
export const heuresEntre = (a: Date, b: Date): number => Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;
export const joursEntre = (a: Date, b: Date): number => Math.round(((b.getTime() - a.getTime()) / JOUR_MS) * 10) / 10;

/** « 12 (contre 9 sur la période précédente) ». */
export const evolution = (actuel: number | null, precedent: number | null): number | null => (actuel === null || precedent === null || precedent === 0 ? null : arrondi((actuel - precedent) / precedent, 3));

/** Moins de N éléments : on le dit, un chiffre sur trois cas ne prouve rien. */
export const SEUIL_DONNEES_MINCES = 10;
export const avertissementMinces = (nombre: number, quoi: string): string | null => (nombre < SEUIL_DONNEES_MINCES ? `Données minces : ${nombre} ${quoi} seulement sur la période, les taux ne sont pas significatifs.` : null);
