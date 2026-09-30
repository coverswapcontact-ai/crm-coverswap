import { jourParis } from "@/lib/dossiers/dates";
import { mettreEnFile } from "@/lib/taches/file";
import { ErreurDefinitive, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { purgerMesureSite } from "./mesure";
import { estSourceSynchronisee, jourDecale, moisDecale, type BilanSynchro, type SourceSynchronisee } from "./suivi";

/**
 * Mission 17 (partie B) — les synchronisations de l'Analytique passent TOUTES par la file de tâches (docs/ANALYTIQUE.md
 * § 3) : un traitement `ANALYTIQUE_SYNCHRO` (charge { source, depuis?, jusqua? }) appelle le connecteur de la source ;
 * des travaux périodiques ne font que mettre ces tâches en file (une attente ou une panne se gère dans la tâche, pas
 * dans le travail) :
 *   - « analytique-meta-recent » : toutes les 3 h, la dépense Meta des 3 derniers jours (révisée par Meta) ;
 *   - « analytique-nuit » : regardé toutes les 30 min, met en file UNE fois par jour à partir de 4 h (Paris) la
 *     dépense Meta de toute la campagne (au moins 90 jours), Search Console et la fiche Google (clé datée du jour) ;
 *   - « analytique-purge-mesure » : chaque jour, les événements du site de plus de 25 mois (CNIL).
 * `relancerSynchro(source)` : la relance à la main depuis l'écran (clé horodatée : toujours une tâche neuve).
 * Google Ads : aucun connecteur (aucune campagne Google Ads) — la tâche rend NON_BRANCHEE sans rien appeler.
 *
 * Un échec est noté dans `SourceAnalytique` par le connecteur (analytique/suivi.ts) ; il remonte en tâche système
 * `SYSTEME:synchro-<source>` (a-faire/detecteurs/systeme.ts) — pas en « tâche de fond en échec » (type mis à part).
 */

export const TYPE_TACHE_SYNCHRO = "ANALYTIQUE_SYNCHRO";
export const NOM_TRAVAIL_META_RECENT = "analytique-meta-recent";
export const NOM_TRAVAIL_NUIT = "analytique-nuit";
export const NOM_TRAVAIL_PURGE = "analytique-purge-mesure";
export const HEURE_NUIT_PARIS = 4;
export const JOURS_MIN_CAMPAGNE_META = 90;
const ACTEUR = "SYSTEME:analytique";

export type ChargeSynchro = { source: SourceSynchronisee; depuis?: string; jusqua?: string };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Lit et vérifie une charge de tâche (source connue, dates AAAA-MM-JJ). */
export function lireCharge(charge: unknown): ChargeSynchro {
  const c = (charge ?? {}) as Record<string, unknown>;
  if (!estSourceSynchronisee(c.source)) throw new ErreurDefinitive(`Source inconnue : ${String(c.source)}.`);
  const jour = (v: unknown, nom: string) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !JOUR.test(v)) throw new ErreurDefinitive(`${nom} invalide : ${String(v)} (AAAA-MM-JJ attendu).`);
    return v;
  };
  return { source: c.source, depuis: jour(c.depuis, "depuis"), jusqua: jour(c.jusqua, "jusqua") };
}

/** Exécute la synchronisation d'une source (connecteurs importés à l'exécution). */
export async function synchroniser(charge: ChargeSynchro): Promise<BilanSynchro> {
  const periode = { depuis: charge.depuis, jusqua: charge.jusqua };
  switch (charge.source) {
    case "META":
      return (await import("@/lib/meta/depense")).synchroniserDepenseMeta(periode);
    case "SEARCH_CONSOLE":
      return (await import("@/lib/google/search-console")).synchroniserSearchConsole(periode);
    case "FICHE_GOOGLE":
      return (await import("@/lib/google/fiche")).synchroniserFicheGoogle(periode);
    case "GOOGLE_ADS":
      return { source: "GOOGLE_ADS", etat: "NON_BRANCHEE", lignes: 0, appels: 0, message: "Aucun connecteur Google Ads : aucune campagne Google Ads ne tourne." };
  }
}

/** Relance à la main (écran Analytique, bouton « Relancer ») : une tâche neuve, période par défaut du connecteur. */
export async function relancerSynchro(source: SourceSynchronisee, periode: { depuis?: string; jusqua?: string } = {}): Promise<string> {
  const charge = lireCharge({ source, ...periode });
  return mettreEnFile({ type: TYPE_TACHE_SYNCHRO, cle: `analytique:${source}:main:${Date.now()}`, charge, priorite: 1, tentativesMax: 3 });
}

/** L'heure à Paris (0-23). */
export function heureParis(maintenant: Date): number {
  return Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hour12: false }).formatToParts(maintenant).find((p) => p.type === "hour")?.value ?? "0") % 24;
}

/** Le début de la dépense Meta à relire la nuit : la campagne en cours (CAMPAGNE_DEBUT) ou 90 jours, le plus ancien ; jamais au-delà de 36 mois. */
export async function debutNuitMeta(maintenant: Date): Promise<string> {
  const aujourdhui = jourParis(maintenant);
  let debut = jourDecale(aujourdhui, -JOURS_MIN_CAMPAGNE_META);
  try {
    const { lireParametre } = await import("@/lib/parametres/service");
    const valeur = await lireParametre("CAMPAGNE_DEBUT", maintenant);
    if (typeof valeur === "string" && JOUR.test(valeur) && valeur < debut) debut = valeur;
  } catch {
    /* paramètre illisible : 90 jours */
  }
  const plancher = moisDecale(aujourdhui, -36);
  return debut < plancher ? plancher : debut;
}

/** Met en file les synchronisations de la nuit (une fois par jour, à partir de 4 h à Paris). Rend les clés mises en file. */
export async function planifierNuit(maintenant: Date = new Date()): Promise<string[]> {
  if (heureParis(maintenant) < HEURE_NUIT_PARIS) return [];
  const jour = jourParis(maintenant);
  const { configurationPublicite } = await import("@/lib/meta/config");
  const { configurationSearchConsole } = await import("@/lib/google/search-console");
  const { configurationFiche } = await import("@/lib/google/fiche");
  const demandes: ChargeSynchro[] = [];
  if (configurationPublicite()) demandes.push({ source: "META", depuis: await debutNuitMeta(maintenant), jusqua: jour });
  if (configurationSearchConsole().branchee) demandes.push({ source: "SEARCH_CONSOLE" });
  if (configurationFiche().branchee) demandes.push({ source: "FICHE_GOOGLE" });
  const cles: string[] = [];
  for (const charge of demandes) {
    const cle = `analytique:${charge.source}:nuit:${jour}`;
    await mettreEnFile({ type: TYPE_TACHE_SYNCHRO, cle, charge, priorite: -1, tentativesMax: 4 });
    cles.push(cle);
  }
  return cles;
}

export function enregistrerTachesAnalytique(): void {
  enregistrerTraitement(TYPE_TACHE_SYNCHRO, {
    libelle: "Analytique : synchronisation d'une source (dépense Meta, Search Console, fiche Google)",
    acteur: ACTEUR,
    tentativesMax: 4,
    delaiMaxMs: 10 * 60_000,
    executer: async (charge) => synchroniser(lireCharge(charge)),
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_META_RECENT,
    libelle: "Analytique : dépense Meta des 3 derniers jours, toutes les 3 h",
    acteur: ACTEUR,
    intervalleMs: 3 * 60 * 60_000,
    estActif: async () => Boolean((await import("@/lib/meta/config")).configurationPublicite()),
    executer: async () => {
      const maintenant = new Date();
      const jour = jourParis(maintenant);
      const tranche = Math.floor(heureParis(maintenant) / 3);
      await mettreEnFile({ type: TYPE_TACHE_SYNCHRO, cle: `analytique:META:recent:${jour}:${tranche}`, charge: { source: "META", depuis: jourDecale(jour, -2), jusqua: jour }, priorite: -1, tentativesMax: 3 });
    },
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_NUIT,
    libelle: "Analytique : synchronisations de la nuit (Meta, Search Console, fiche Google), à partir de 4 h",
    acteur: ACTEUR,
    intervalleMs: 30 * 60_000,
    executer: async () => {
      await planifierNuit(new Date());
    },
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_PURGE,
    libelle: "Analytique : purge des événements du site de plus de 25 mois (CNIL)",
    acteur: ACTEUR,
    intervalleMs: 24 * 60 * 60_000,
    executer: async () => {
      const { supprimes } = await purgerMesureSite(new Date());
      if (supprimes > 0) console.log(`[analytique] purge : ${supprimes} événements du site de plus de 25 mois supprimés.`);
    },
  });
}
