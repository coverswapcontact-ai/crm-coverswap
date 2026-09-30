import prisma from "@/lib/prisma";
import { DUREES_DEPART, TYPES_TACHE, type TypeTache } from "./types";

/**
 * Mission 17 (partie A) : le temps d'une tâche, en minutes (docs/TACHES.md § 3). Valeurs de départ (`DUREES_DEPART`),
 * puis la médiane des 20 dernières durées mesurées du type — de l'ouverture du raccourci (`commenceLe`) à « Fait » ou à
 * la coche du CRM dans l'heure (`dureeReelleSec`) —, bornée entre la moitié et le triple de la valeur de départ.
 */

/** Durées mesurées retenues par type (les 20 dernières). */
export const MESURES_RETENUES = 20;
/** Au-delà d'une heure entre l'ouverture du raccourci et « Fait », la mesure ne dit plus rien (pause, oubli). */
export const MESURE_MAX_SEC = 3600;

function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2;
}

/** La durée retenue pour un type d'après ses mesures (secondes) : minutes arrondies, bornées, au moins 1. */
export function dureeDesMesures(type: TypeTache, secondes: number[]): number | null {
  if (secondes.length === 0) return null;
  const depart = DUREES_DEPART[type];
  const minutes = Math.round(mediane(secondes) / 60);
  return Math.max(1, Math.round(Math.min(depart * 3, Math.max(depart / 2, minutes))));
}

/** Par type, la médiane des 20 dernières durées mesurées ; un type jamais mesuré est absent. Une requête. */
export async function dureesMesurees(): Promise<Partial<Record<TypeTache, number>>> {
  const lignes = await prisma.tacheAFaire.findMany({
    where: { dureeReelleSec: { not: null } },
    orderBy: [{ reponduLe: "desc" }, { id: "desc" }],
    take: MESURES_RETENUES * TYPES_TACHE.length * 4,
    select: { type: true, dureeReelleSec: true },
  });
  const parType = new Map<TypeTache, number[]>();
  for (const l of lignes) {
    if (!(TYPES_TACHE as readonly string[]).includes(l.type) || l.dureeReelleSec === null) continue;
    const liste = parType.get(l.type as TypeTache) ?? [];
    if (liste.length < MESURES_RETENUES) liste.push(l.dureeReelleSec);
    parType.set(l.type as TypeTache, liste);
  }
  const sortie: Partial<Record<TypeTache, number>> = {};
  for (const [type, secondes] of parType) {
    const duree = dureeDesMesures(type, secondes);
    if (duree !== null) sortie[type] = duree;
  }
  return sortie;
}

/**
 * La durée d'une tâche : la durée propre donnée par son détecteur (plus précise que la médiane du type : une simulation
 * par l'API prend 2 minutes, une simulation à la main 10), sinon la médiane mesurée du type, sinon la valeur de départ.
 */
export function dureeDe(type: TypeTache, mesurees: Partial<Record<TypeTache, number>>, propre?: number | null): number {
  if (typeof propre === "number" && Number.isFinite(propre) && propre > 0) return Math.max(1, Math.round(propre));
  return mesurees[type] ?? DUREES_DEPART[type] ?? 5;
}

/** Durée réelle d'une tâche qui passe « faite » : seulement si le raccourci a été ouvert il y a moins d'une heure. */
export function dureeReelle(commenceLe: Date | null | undefined, maintenant: Date): number | null {
  if (!commenceLe) return null;
  const secondes = Math.round((maintenant.getTime() - commenceLe.getTime()) / 1000);
  return secondes > 0 && secondes <= MESURE_MAX_SEC ? secondes : null;
}

/**
 * Le raccourci d'une tâche vient d'être ouvert : la mesure commence (`commenceLe`). Rouvrir le raccourci recommence la
 * mesure. Sans effet sur une tâche déjà faite ou écartée. Rend vrai si la mesure a été posée.
 */
export async function noterCommencement(id: string, maintenant: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.tacheAFaire.updateMany({ where: { id, statut: { in: ["A_FAIRE", "PLUS_TARD"] }, archiveLe: null }, data: { commenceLe: maintenant } });
  return count === 1;
}
