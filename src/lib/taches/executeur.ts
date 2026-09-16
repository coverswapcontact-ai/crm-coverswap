import type { Tache } from "@prisma/client";
import prisma from "@/lib/prisma";
import { avecActeur } from "@/lib/journal/contexte";
import { surNouvelleTache } from "./file";
import { ErreurDefinitive, traitementDe, travauxPeriodiques, type TravailPeriodique } from "./registre";

const DELAI_MAX_DEFAUT_MS = 5 * 60_000;
const MARGE_BAIL_MS = 60_000;
const INTERVALLE_TOUR_MS = 15_000;
const TACHES_PAR_TOUR = 10;
const ATTENTE_MIN_MS = 30_000;
const ATTENTE_MAX_MS = 6 * 60 * 60_000;

/** Attente avant la tentative suivante : 30 s, 1 min, 2 min… plafonnée à 6 h, avec un peu d'aléa. */
export function attenteAvantNouvelEssai(tentatives: number): number {
  const base = Math.min(ATTENTE_MAX_MS, ATTENTE_MIN_MS * 2 ** Math.max(0, tentatives - 1));
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

function messageDe(erreur: unknown): string {
  const texte = erreur instanceof Error ? `${erreur.name}: ${erreur.message}` : String(erreur);
  return texte.slice(0, 2000);
}

async function avecDelai<T>(delaiMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controleur = new AbortController();
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const depassement = new Promise<never>((_, rejeter) => {
    minuterie = setTimeout(() => {
      controleur.abort();
      rejeter(new Error(`Délai maximal dépassé (${Math.round(delaiMs / 1000)} s)`));
    }, delaiMs);
  });
  try {
    return await Promise.race([fn(controleur.signal), depassement]);
  } finally {
    clearTimeout(minuterie);
  }
}

/** Réclame une tâche due : une seule exécution à la fois, même avec plusieurs processus. */
async function reclamer(tache: Tache, maintenant: Date, delaiMaxMs: number): Promise<boolean> {
  const { count } = await prisma.tache.updateMany({
    where: {
      id: tache.id,
      OR: [
        { statut: "EN_ATTENTE", prochainEssaiLe: { lte: maintenant } },
        { statut: "EN_COURS", verrouJusqua: { lt: maintenant } },
      ],
    },
    data: {
      statut: "EN_COURS",
      verrouJusqua: new Date(maintenant.getTime() + delaiMaxMs + MARGE_BAIL_MS),
      commenceLe: maintenant,
      tentatives: { increment: 1 },
      aRejouer: false,
    },
  });
  return count === 1;
}

async function executerTache(tache: Tache, maintenant: Date): Promise<void> {
  const traitement = traitementDe(tache.type);
  if (!traitement) {
    await prisma.tache.updateMany({
      where: { id: tache.id, statut: { in: ["EN_ATTENTE", "EN_COURS"] } },
      data: {
        statut: "ECHEC_DEFINITIF",
        derniereErreur: `Type de tâche inconnu : ${tache.type}`,
        termineLe: maintenant,
        verrouJusqua: null,
      },
    });
    return;
  }
  const delaiMaxMs = traitement.delaiMaxMs ?? DELAI_MAX_DEFAUT_MS;
  if (!(await reclamer(tache, maintenant, delaiMaxMs))) return;
  const tentative = tache.tentatives + 1;
  const tentativesMax = traitement.tentativesMax ?? tache.tentativesMax;

  let charge: unknown;
  try {
    charge = JSON.parse(tache.charge);
  } catch {
    charge = {};
  }

  try {
    const resultat = await avecActeur(
      { acteur: traitement.acteur, origine: `tache:${tache.type}`, requete: tache.id },
      () => avecDelai(delaiMaxMs, (signal) => traitement.executer(charge, { tacheId: tache.id, tentative, signal }))
    );
    const aRejouer = (await prisma.tache.findUnique({ where: { id: tache.id }, select: { aRejouer: true } }))?.aRejouer;
    await prisma.tache.update({
      where: { id: tache.id },
      data: aRejouer
        ? { statut: "EN_ATTENTE", tentatives: 0, aRejouer: false, verrouJusqua: null, prochainEssaiLe: new Date() }
        : {
            statut: "TERMINEE",
            termineLe: new Date(),
            verrouJusqua: null,
            derniereErreur: null,
            resultat: resultat === undefined ? null : JSON.stringify(resultat),
          },
    });
  } catch (erreur) {
    const definitive = erreur instanceof ErreurDefinitive || tentative >= tentativesMax;
    console.error(`[taches] ${tache.type} ${tache.id}, tentative ${tentative} :`, messageDe(erreur));
    await prisma.tache.update({
      where: { id: tache.id },
      data: definitive
        ? { statut: "ECHEC_DEFINITIF", derniereErreur: messageDe(erreur), termineLe: new Date(), verrouJusqua: null }
        : {
            statut: "EN_ATTENTE",
            derniereErreur: messageDe(erreur),
            verrouJusqua: null,
            prochainEssaiLe: new Date(Date.now() + attenteAvantNouvelEssai(tentative)),
          },
    });
  }
}

async function executerTravail(travail: TravailPeriodique, maintenant: Date): Promise<void> {
  const etat = await prisma.planification.upsert({
    where: { nom: travail.nom },
    create: { nom: travail.nom, prochainPassage: maintenant },
    update: {},
  });
  if (!etat.actif || etat.prochainPassage > maintenant) return;

  // Réservation du passage : un second processus ne lance pas le même travail.
  const { count } = await prisma.planification.updateMany({
    where: { nom: travail.nom, prochainPassage: etat.prochainPassage },
    data: { prochainPassage: new Date(maintenant.getTime() + travail.intervalleMs), dernierDebut: maintenant },
  });
  if (count !== 1) return;

  try {
    if (travail.estActif && !(await travail.estActif())) {
      await prisma.planification.update({
        where: { nom: travail.nom },
        data: { dernierStatut: "IGNORE", dernierFin: new Date() },
      });
      return;
    }
    await avecActeur({ acteur: travail.acteur, origine: `travail:${travail.nom}` }, () =>
      avecDelai(Math.max(travail.intervalleMs, DELAI_MAX_DEFAUT_MS), (signal) => travail.executer(signal))
    );
    await prisma.planification.update({
      where: { nom: travail.nom },
      data: { dernierStatut: "SUCCES", dernierFin: new Date(), derniereErreur: null, echecsConsecutifs: 0 },
    });
  } catch (erreur) {
    console.error(`[taches] travail ${travail.nom} :`, messageDe(erreur));
    await prisma.planification.update({
      where: { nom: travail.nom },
      data: {
        dernierStatut: "ECHEC",
        dernierFin: new Date(),
        derniereErreur: messageDe(erreur),
        echecsConsecutifs: { increment: 1 },
      },
    });
  }
}

/** Un tour : les tâches dues, puis les travaux périodiques dus. Rend le nombre de tâches examinées. */
export async function executerTour(maintenant = new Date()): Promise<number> {
  const dues = await prisma.tache.findMany({
    where: {
      OR: [
        { statut: "EN_ATTENTE", prochainEssaiLe: { lte: maintenant } },
        { statut: "EN_COURS", verrouJusqua: { lt: maintenant } },
      ],
    },
    orderBy: [{ priorite: "desc" }, { prochainEssaiLe: "asc" }],
    take: TACHES_PAR_TOUR,
  });
  for (const tache of dues) await executerTache(tache, maintenant);
  for (const travail of travauxPeriodiques()) await executerTravail(travail, maintenant);
  return dues.length;
}

type EtatExecuteur = {
  actif: boolean;
  enCours: boolean;
  relancer: boolean;
  minuterie?: ReturnType<typeof setTimeout>;
};
const CLE = "__coverswapExecuteurTaches";
const globalExecuteur = globalThis as unknown as Record<string, EtatExecuteur | undefined>;

/**
 * Démarre la boucle de l'exécuteur dans ce processus (une seule fois) : un tour
 * toutes les 15 s, ou tout de suite quand une tâche est mise en file ; les tours
 * s'enchaînent tant qu'il reste du travail. Aucune erreur ne l'arrête.
 */
export function demarrerExecuteur(): void {
  if (globalExecuteur[CLE]?.actif) return;
  const etat: EtatExecuteur = { actif: true, enCours: false, relancer: false };
  globalExecuteur[CLE] = etat;

  const planifier = (delaiMs: number) => {
    if (!etat.actif) return;
    clearTimeout(etat.minuterie);
    etat.minuterie = setTimeout(() => void boucle(), delaiMs);
    etat.minuterie.unref?.();
  };

  async function boucle() {
    if (!etat.actif) return;
    if (etat.enCours) {
      etat.relancer = true;
      return;
    }
    etat.enCours = true;
    let examinees = 0;
    try {
      examinees = await executerTour();
    } catch (erreur) {
      console.error("[taches] tour interrompu :", messageDe(erreur));
    } finally {
      etat.enCours = false;
    }
    const encore = examinees >= TACHES_PAR_TOUR || etat.relancer;
    etat.relancer = false;
    planifier(encore ? 250 : INTERVALLE_TOUR_MS);
  }

  surNouvelleTache(() => planifier(100));
  planifier(2_000);
  console.log("[taches] Exécuteur démarré.");
}

export function arreterExecuteur(): void {
  const etat = globalExecuteur[CLE];
  if (!etat) return;
  etat.actif = false;
  clearTimeout(etat.minuterie);
}
