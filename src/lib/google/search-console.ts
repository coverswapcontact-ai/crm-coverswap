import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { jourDecale, moisDecale, suivreSynchro, type BilanSynchro } from "@/lib/analytique/suivi";
import { PORTEES_ANALYTIQUE, appelCompteService, configurationCompteService, emailCompteService } from "./compte-service";

/**
 * Mission 17 (partie B) — Search Console par compte de service (docs/ANALYTIQUE.md § 3) : `searchAnalytics.query` sur la
 * propriété SEARCH_CONSOLE_SITE (défaut « sc-domain:coverswap.fr »), trois lectures par tranche d'un mois :
 *   - dimension date → `SeoJour` TOTAL (clé "") : les totaux justes de la propriété (les requêtes anonymisées manquent
 *     dans le détail ; ne jamais additionner les lignes REQUETE pour un total) ;
 *   - date + query → REQUETE ; date + page → PAGE (adresse complète, hôte compris : sert à `doublonWww`).
 * `rowLimit` 25 000 et `startRow` jusqu'à la dernière page. 16 mois au premier passage (base vide), puis les 5 derniers
 * jours chaque nuit (les données Google arrivent avec 2 à 3 jours de retard) ; écrit par upsert. Les jours sont ceux de
 * Google (heure du Pacifique).
 *
 * Position : la moyenne rendue par Google pour la ligne ; quand deux lignes tombent sur la même clé (adresse avec
 * « #ancre », clé coupée à 500 caractères), elles sont fusionnées avec une position moyenne PONDÉRÉE par les impressions.
 */

export const SITE_SEARCH_CONSOLE_DEFAUT = "sc-domain:coverswap.fr";
export const LIGNES_PAR_PAGE = 25_000;
export const MOIS_PREMIER_PASSAGE = 16;
export const JOURS_PASSAGE_NUIT = 5;
const LONGUEUR_CLE = 500;
const API = "https://searchconsole.googleapis.com/webmasters/v3/sites";

export type DimensionSeo = "TOTAL" | "REQUETE" | "PAGE";

export function configurationSearchConsole(env: NodeJS.ProcessEnv = process.env): { site: string; branchee: boolean; erreur: string | null } {
  const site = env.SEARCH_CONSOLE_SITE?.trim() || SITE_SEARCH_CONSOLE_DEFAUT;
  const { compte, erreur } = configurationCompteService(env);
  return { site, branchee: Boolean(compte), erreur };
}

type LigneApi = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
export type LigneSeo = { jour: string; dimension: DimensionSeo; cle: string; clics: number; impressions: number; position: number | null };

/** Une adresse de page sans son « #ancre » (Google en rapporte parfois) ; une requête telle quelle. */
export function cleSeo(dimension: DimensionSeo, brute: string | undefined): string {
  if (dimension === "TOTAL") return "";
  const cle = (brute ?? "").trim();
  return (dimension === "PAGE" ? cle.split("#")[0] : cle).slice(0, LONGUEUR_CLE);
}

/** Position moyenne pondérée par les impressions (null sans impression). */
export function positionPonderee(lignes: readonly { impressions: number; position: number | null }[]): number | null {
  let poids = 0;
  let somme = 0;
  for (const l of lignes) {
    if (l.position === null || !(l.impressions > 0)) continue;
    poids += l.impressions;
    somme += l.position * l.impressions;
  }
  return poids > 0 ? Math.round((somme / poids) * 100) / 100 : null;
}

/** Les lignes de l'API → les lignes `SeoJour` (pur) : clés normalisées, doublons fusionnés (position pondérée). */
export function lignesSeo(dimension: DimensionSeo, brutes: readonly LigneApi[]): LigneSeo[] {
  const parCle = new Map<string, { jour: string; cle: string; clics: number; impressions: number; positions: { impressions: number; position: number | null }[] }>();
  for (const b of brutes) {
    const jour = b.keys?.[0];
    if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) continue;
    const cle = cleSeo(dimension, b.keys?.[1]);
    const k = `${jour}|${cle}`;
    const acc = parCle.get(k) ?? { jour, cle, clics: 0, impressions: 0, positions: [] };
    acc.clics += Math.round(b.clicks ?? 0);
    acc.impressions += Math.round(b.impressions ?? 0);
    acc.positions.push({ impressions: Math.round(b.impressions ?? 0), position: typeof b.position === "number" ? b.position : null });
    parCle.set(k, acc);
  }
  return [...parCle.values()].map((a) => ({ jour: a.jour, dimension, cle: a.cle, clics: a.clics, impressions: a.impressions, position: positionPonderee(a.positions) }));
}

const DIMENSIONS: Record<DimensionSeo, string[]> = { TOTAL: ["date"], REQUETE: ["date", "query"], PAGE: ["date", "page"] };

/** Toutes les lignes d'une requête, page après page (`startRow`). */
async function interroger(site: string, dimension: DimensionSeo, du: string, au: string, env?: NodeJS.ProcessEnv): Promise<{ lignes: LigneApi[]; appels: number }> {
  const lignes: LigneApi[] = [];
  let appels = 0;
  for (let depart = 0; ; depart += LIGNES_PAR_PAGE) {
    const rep = await appelCompteService(`${API}/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: du, endDate: au, dimensions: DIMENSIONS[dimension], type: "web", rowLimit: LIGNES_PAR_PAGE, startRow: depart }),
      portees: [PORTEES_ANALYTIQUE.SEARCH_CONSOLE],
      service: "Search Console",
      aFaire: `Ajouter ${emailCompteService(env) ?? "le compte de service"} comme utilisateur (restreint) de la propriété ${site} dans Search Console, et activer l'API Google Search Console dans le projet Google Cloud.`,
      env,
    });
    appels += 1;
    const page = ((await rep.json()) as { rows?: LigneApi[] }).rows ?? [];
    lignes.push(...page);
    if (page.length < LIGNES_PAR_PAGE) return { lignes, appels };
  }
}

/** Tranches d'au plus un mois, de `du` à `au`. */
function tranches(du: string, au: string): { du: string; au: string }[] {
  const liste: { du: string; au: string }[] = [];
  for (let debut = du; debut <= au; ) {
    const fin = [jourDecale(moisDecale(debut, 1), -1), au].sort()[0];
    liste.push({ du: debut, au: fin });
    debut = jourDecale(fin, 1);
  }
  return liste;
}

/**
 * Synchronise Search Console (jours inclus). Sans période : 16 mois si aucune ligne n'est encore en base, sinon les
 * 5 derniers jours. Sans compte de service : NON_BRANCHEE, aucun appel. Accès pas encore donné : EN_ATTENTE_ACCES.
 */
export async function synchroniserSearchConsole(periode: { depuis?: string; jusqua?: string } = {}, options: { env?: NodeJS.ProcessEnv; maintenant?: Date } = {}): Promise<BilanSynchro> {
  const config = configurationSearchConsole(options.env);
  const aujourdhui = jourParis(options.maintenant ?? new Date());
  const jusqua = periode.jusqua ?? aujourdhui;
  const premierPassage = !periode.depuis && (await prisma.seoJour.count()) === 0;
  const depuis = periode.depuis ?? (premierPassage ? moisDecale(jusqua, -MOIS_PREMIER_PASSAGE) : jourDecale(jusqua, -JOURS_PASSAGE_NUIT));
  if (!config.branchee) return { source: "SEARCH_CONSOLE", etat: "NON_BRANCHEE", du: depuis, au: jusqua, lignes: 0, appels: 0, message: config.erreur ?? "GOOGLE_SERVICE_ACCOUNT_JSON absente." };

  return suivreSynchro("SEARCH_CONSOLE", { du: depuis, au: jusqua }, async () => {
    const synchroniseLe = new Date();
    let lignes = 0;
    let appels = 0;
    for (const t of tranches(depuis, jusqua)) {
      for (const dimension of ["TOTAL", "REQUETE", "PAGE"] as const) {
        const lu = await interroger(config.site, dimension, t.du, t.au, options.env);
        appels += lu.appels;
        for (const l of lignesSeo(dimension, lu.lignes)) {
          const donnees = { clics: l.clics, impressions: l.impressions, position: l.position, synchroniseLe };
          await prisma.seoJour.upsert({ where: { jour_dimension_cle: { jour: l.jour, dimension: l.dimension, cle: l.cle } }, create: { jour: l.jour, dimension: l.dimension, cle: l.cle, ...donnees }, update: donnees });
          lignes += 1;
        }
      }
    }
    return { lignes, appels, detail: { site: config.site, premierPassage } };
  });
}

/* ── www et sans www ───────────────────────────────────────────────────── */

export type DoublonWww = { detecte: boolean; exemples: string[]; hotes: { hote: string; impressions: number; clics: number }[] };

/**
 * « www et sans www indexés tous les deux » (pur) : des pages vues dans Google sous `www.<domaine>` ET sous
 * `<domaine>`. `exemples` : une adresse par hôte (la plus vue d'abord).
 */
export function doublonWwwDesPages(pages: readonly { page: string; impressions?: number; clics?: number }[]): DoublonWww {
  const parHote = new Map<string, { hote: string; impressions: number; clics: number; exemple: string; vues: number }>();
  for (const p of pages) {
    let hote: string;
    try {
      hote = new URL(p.page).hostname.toLowerCase();
    } catch {
      continue;
    }
    const a = parHote.get(hote) ?? { hote, impressions: 0, clics: 0, exemple: p.page, vues: -1 };
    a.impressions += p.impressions ?? 0;
    a.clics += p.clics ?? 0;
    if ((p.impressions ?? 0) > a.vues) {
      a.vues = p.impressions ?? 0;
      a.exemple = p.page;
    }
    parHote.set(hote, a);
  }
  const hotes = [...parHote.values()].sort((a, b) => b.impressions - a.impressions);
  const nus = new Set(hotes.map((h) => h.hote.replace(/^www\./, "")));
  const detecte = [...nus].some((nu) => parHote.has(nu) && parHote.has(`www.${nu}`));
  const concernes = hotes.filter((h) => parHote.has(h.hote.replace(/^www\./, "")) && parHote.has(`www.${h.hote.replace(/^www\./, "")}`));
  return { detecte, exemples: detecte ? concernes.map((h) => h.exemple) : [], hotes: hotes.map(({ hote, impressions, clics }) => ({ hote, impressions, clics })) };
}

/** Le doublon www sur une période (jours inclus), d'après les pages `SeoJour` en base. */
export async function doublonWww(du: string, au: string): Promise<DoublonWww> {
  const groupes = await prisma.seoJour.groupBy({ by: ["cle"], where: { dimension: "PAGE", jour: { gte: du, lte: au } }, _sum: { impressions: true, clics: true } });
  return doublonWwwDesPages(groupes.map((g) => ({ page: g.cle, impressions: g._sum.impressions ?? 0, clics: g._sum.clics ?? 0 })));
}
