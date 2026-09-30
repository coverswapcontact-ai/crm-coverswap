import { promises as fs } from "fs";
import path from "path";
import type { TravailSimulation } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { resolveUploadsDir } from "@/lib/uploads";
import type { ReferenceSimulee } from "@/lib/site/simulations";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";
import { LIBELLES_PROJET_SITE, teintesDe } from "./site";

/**
 * Mission 15 (partie 1) — lecture des travaux de simulation du site : ce que
 * le navigateur reçoit en sondant (`GET /api/simulate?id=&p=`), les images par
 * adresse (plus de base64 dans la mémoire du navigateur), l'attente estimée et
 * la rubrique « Sur le site cette semaine » du CRM. Aucune écriture ici, sauf
 * rien : les statuts se posent dans travaux.ts.
 */

export type StatutTravail = "EN_ATTENTE" | "EN_COURS" | "PRETE" | "ECHEC";
export type EtapeTravail = "analyse" | "matieres" | "rendu";

/** Attente annoncée quand aucun travail réussi ne permet d'estimer. */
export const ATTENTE_PAR_DEFAUT_S = 75;
/** Un travail EN_COURS depuis plus longtemps est perdu (tâche coupée sans écrire l'échec) : le visiteur lit un échec « delai ». */
export const TRAVAIL_PERDU_APRES_MS = 10 * 60_000;
/** Un travail jamais pris (exécuteur arrêté) au-delà de ce délai : même chose. */
export const TRAVAIL_JAMAIS_PRIS_APRES_MS = 30 * 60_000;

export const MESSAGE_INTERROMPUE = "La génération a été interrompue par une mise à jour du service. Réessayez.";
export const MESSAGE_STOCKAGE = "Le rendu n'a pas pu être enregistré de notre côté. Votre photo et vos choix sont conservés : réessayez.";
export const MESSAGE_PURGEE = "Cette simulation n'est plus disponible : les rendus sont gardés 30 jours. Relancez-la depuis vos choix.";
const ERREUR_PURGEE = { raison: "purgee", message: MESSAGE_PURGEE };

export function lireReferencesTravail(json: string | null | undefined): ReferenceSimulee[] {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(lu) ? (lu as ReferenceSimulee[]).filter((r) => r && typeof r === "object" && typeof r.ref === "string") : [];
  } catch {
    return [];
  }
}

export function lireSwatchUrls(json: string | null | undefined): string[] {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(lu) ? lu.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/** Médiane des durées des 20 derniers travaux réussis, en secondes ; 75 s sans historique. */
export async function attenteEstimeeS(): Promise<number> {
  const derniers = await prisma.travailSimulation.findMany({ where: { statut: "PRETE", dureeMs: { not: null } }, orderBy: { termineLe: "desc" }, take: 20, select: { dureeMs: true } });
  return medianeEnSecondes(derniers.map((t) => t.dureeMs ?? 0));
}

export function medianeEnSecondes(dureesMs: number[]): number {
  const valides = dureesMs.filter((d) => d > 0).sort((a, b) => a - b);
  if (valides.length === 0) return ATTENTE_PAR_DEFAUT_S;
  const milieu = Math.floor(valides.length / 2);
  const mediane = valides.length % 2 === 1 ? valides[milieu] : (valides[milieu - 1] + valides[milieu]) / 2;
  return Math.max(15, Math.round(mediane / 1000));
}

/** Les fichiers du rendu et de la photo avant : sur la SimulationSite, ou sur la Simulation du lead après rattachement. */
export async function cheminsImagesTravail(travail: Pick<TravailSimulation, "simulationSiteId">): Promise<{ apres: string | null; avant: string | null }> {
  if (!travail.simulationSiteId) return { apres: null, avant: null };
  const site = await prisma.simulationSite.findUnique({ where: { id: travail.simulationSiteId }, select: { imageAfterPath: true, imageBeforePath: true, simulationId: true, archiveLe: true } });
  if (!site || site.archiveLe) return { apres: null, avant: null };
  if (site.imageAfterPath || !site.simulationId) return { apres: site.imageAfterPath, avant: site.imageBeforePath };
  const rattachee = await prisma.simulation.findUnique({ where: { id: site.simulationId }, select: { imageAfterPath: true, imageBeforePath: true } });
  return { apres: rattachee?.imageAfterPath ?? null, avant: rattachee?.imageBeforePath ?? null };
}

function typeDe(chemin: string): string {
  return /\.png$/i.test(chemin) ? "image/png" : /\.webp$/i.test(chemin) ? "image/webp" : "image/jpeg";
}

async function lireFichierImage(relatif: string | null): Promise<{ contenu: Buffer; type: string } | null> {
  if (!relatif) return null;
  try {
    return { contenu: await fs.readFile(path.join(resolveUploadsDir(), relatif)), type: typeDe(relatif) };
  } catch {
    return null;
  }
}

/** Le rendu (« apres ») ou la photo avant (« avant ») d'un travail PRETE, pour ce parcours seulement ; null sinon. */
export async function imageTravail(id: string, parcoursId: string, quoi: "apres" | "avant"): Promise<{ contenu: Buffer; type: string } | null> {
  const travail = await prisma.travailSimulation.findFirst({ where: { id, parcoursId, statut: "PRETE" }, select: { simulationSiteId: true } });
  if (!travail) return null;
  const chemins = await cheminsImagesTravail(travail);
  return lireFichierImage(quoi === "apres" ? chemins.apres : chemins.avant);
}

const enDataUrl = (image: { contenu: Buffer; type: string } | null) => (image ? `data:${image.type};base64,${image.contenu.toString("base64")}` : null);

export type SuiviTravail = {
  statut: StatutTravail;
  etape: string | null;
  attenteEstimeeS: number;
  demarreLe: string | null;
  termineLe: string | null;
  simulationSiteId: string | null;
  references: ReferenceSimulee[];
  /** Data URL du rendu, seulement PRETE (l'adresse /api/simulate/image sert ensuite). */
  image?: string;
  imageAvant?: string | null;
  erreur?: { raison: string; message: string };
};

/** Statut lu par le visiteur : un travail perdu (tâche coupée, exécuteur arrêté) se lit comme un échec « delai ». */
export function statutLu(travail: Pick<TravailSimulation, "statut" | "demarreLe" | "createdAt" | "erreurRaison" | "erreurMessage">, maintenant: number = Date.now()): { statut: StatutTravail; erreur?: { raison: string; message: string } } {
  if (travail.statut === "PRETE") return { statut: "PRETE" };
  if (travail.statut === "ECHEC") return { statut: "ECHEC", erreur: { raison: travail.erreurRaison ?? "erreur", message: travail.erreurMessage ?? MESSAGES_ECHEC.erreur } };
  const perdu = travail.statut === "EN_COURS" ? !!travail.demarreLe && maintenant - travail.demarreLe.getTime() > TRAVAIL_PERDU_APRES_MS : maintenant - travail.createdAt.getTime() > TRAVAIL_JAMAIS_PRIS_APRES_MS;
  if (perdu) return { statut: "ECHEC", erreur: { raison: "delai", message: MESSAGES_ECHEC.delai } };
  return { statut: travail.statut === "EN_COURS" ? "EN_COURS" : "EN_ATTENTE" };
}

/**
 * Ce que le navigateur reçoit en sondant ; null si le travail n'est pas celui
 * de ce parcours (404 sans détail). Un travail archivé par la purge (30 jours)
 * répond encore, en échec « purgee » : le lien d'un vieux mail dit pourquoi
 * plutôt que « introuvable ».
 */
export async function suivreTravail(id: string, parcoursId: string, maintenant: number = Date.now()): Promise<SuiviTravail | null> {
  // Lu AVEC les archives (l'extension Prisma écarte les lignes archivées par défaut) : un travail purgé répond « purgee ».
  const travail = await prisma.travailSimulation.findFirst({ where: { ...AVEC_ARCHIVES, id, parcoursId } });
  if (!travail) return null;
  const lu = travail.archiveLe ? { statut: "ECHEC" as const, erreur: ERREUR_PURGEE } : statutLu(travail, maintenant);
  const suivi: SuiviTravail = {
    statut: lu.statut,
    etape: lu.statut === "PRETE" ? "rendu" : travail.etape,
    attenteEstimeeS: await attenteEstimeeS(),
    demarreLe: travail.demarreLe?.toISOString() ?? null,
    termineLe: travail.termineLe?.toISOString() ?? null,
    simulationSiteId: travail.simulationSiteId,
    references: lireReferencesTravail(travail.references),
    ...(lu.erreur ? { erreur: lu.erreur } : {}),
  };
  if (lu.statut === "PRETE") {
    const chemins = await cheminsImagesTravail(travail);
    const apres = await lireFichierImage(chemins.apres);
    if (!apres) return { ...suivi, statut: "ECHEC", erreur: ERREUR_PURGEE };
    suivi.image = enDataUrl(apres) ?? undefined;
    suivi.imageAvant = enDataUrl(await lireFichierImage(chemins.avant));
  }
  return suivi;
}

/* ── Rubrique « Sur le site cette semaine » (CRM) ────────────────── */

export type TravailSiteLigne = {
  id: string;
  le: string;
  statut: StatutTravail;
  projetLibelle: string;
  teintes: string;
  erreurRaison: string | null;
  erreurMessage: string | null;
  /** Le visiteur a demandé à être prévenu (e-mail ou téléphone). */
  prevenir: boolean;
  notifie: boolean;
};

export type TravauxSiteRecents = { enCours: number; enEchec: number; lignes: TravailSiteLigne[] };

/** Les travaux des `jours` derniers jours encore en cours ou en échec (les réussis sont les simulations listées à côté). */
export async function travauxSiteRecents(jours = 7, maintenant: Date = new Date(), limite = 20): Promise<TravauxSiteRecents> {
  const depuis = new Date(maintenant.getTime() - jours * 24 * 60 * 60_000);
  // Les compteurs portent sur toute la semaine (200 au plus), la liste sur les `limite` plus récents.
  const lignes = await prisma.travailSimulation.findMany({ where: { createdAt: { gte: depuis }, archiveLe: null, statut: { in: ["EN_ATTENTE", "EN_COURS", "ECHEC"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const vues = lignes.map((t) => {
    const lu = statutLu(t, maintenant.getTime());
    return {
      id: t.id,
      le: t.createdAt.toISOString(),
      statut: lu.statut,
      projetLibelle: LIBELLES_PROJET_SITE[t.projet] ?? t.projet,
      teintes: teintesDe(lireReferencesTravail(t.references)),
      erreurRaison: lu.erreur?.raison ?? null,
      erreurMessage: lu.erreur?.message ?? null,
      prevenir: Boolean(t.notifierEmail || t.notifierTelephone),
      notifie: Boolean(t.notifieLe),
    };
  });
  return { enCours: vues.filter((v) => v.statut === "EN_ATTENTE" || v.statut === "EN_COURS").length, enEchec: vues.filter((v) => v.statut === "ECHEC").length, lignes: vues.slice(0, limite) };
}
