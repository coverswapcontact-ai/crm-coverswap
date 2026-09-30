import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { debutDeReprise, jourDecale, lireSuivi, noterProgression, suivreSynchro, verifierInterruption, type BilanSynchro } from "@/lib/analytique/suivi";
import { PORTEES_ANALYTIQUE, appelCompteService, configurationCompteService, emailCompteService } from "./compte-service";

/**
 * Mission 17 (partie B) — la fiche Google (Business Profile) par compte de service (docs/ANALYTIQUE.md § 3) :
 *  - API Business Profile Performance, `locations/<id>:fetchMultiDailyMetricsTimeSeries` : vues dans la recherche et
 *    sur la carte (ordinateur, mobile), appels, clics vers le site, itinéraires, conversations → `FicheGoogleJour`
 *    (une ligne par jour et par métrique, upsert). Une valeur absente vaut 0 (Google omet les zéros) ; les 3 derniers
 *    jours ne sont pas demandés (pas encore calculés : ils sortiraient comme des zéros trompeurs) ;
 *  - avis (API My Business v4, `accounts/*\/locations/*\/reviews`) : `totalReviewCount` et `averageRating` du jour →
 *    métriques AVIS_NOMBRE et AVIS_NOTE (seulement quand GOOGLE_BUSINESS_ACCOUNT est posée).
 *
 * Variables : GOOGLE_SERVICE_ACCOUNT_JSON (compte de service, ajouté comme gérant de la fiche), GOOGLE_BUSINESS_LOCATION
 * (« locations/<id> » ou le nombre seul), GOOGLE_BUSINESS_ACCOUNT (« accounts/<id> », pour les avis). Les API Business
 * Profile sont fermées (quota 0) tant que Google n'a pas accordé l'accès au projet : 401, 403 ou « quota 0 » →
 * état EN_ATTENTE_ACCES, jamais une erreur bruyante.
 */

export const METRIQUES_FICHE = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
] as const;
/** « Vues » de la fiche = les quatre métriques d'impressions ; « interactions » = appels, clics site, itinéraires, conversations. */
export const METRIQUES_VUES_FICHE = METRIQUES_FICHE.slice(0, 4);
export const METRIQUES_INTERACTIONS_FICHE = METRIQUES_FICHE.slice(4);
export const METRIQUE_AVIS_NOMBRE = "AVIS_NOMBRE";
export const METRIQUE_AVIS_NOTE = "AVIS_NOTE";
export const JOURS_PREMIER_PASSAGE_FICHE = 540;
export const JOURS_PASSAGE_NUIT_FICHE = 10;
export const JOURS_NON_CALCULES_FICHE = 3;

const API_PERFORMANCE = "https://businessprofileperformance.googleapis.com/v1";
const API_AVIS = "https://mybusiness.googleapis.com/v4";

const normaliser = (valeur: string | undefined, prefixe: string) => {
  const v = valeur?.trim().replace(/^\/+|\/+$/g, "");
  if (!v) return null;
  const id = v.split("/").pop()!;
  return /^\d+$/.test(id) ? `${prefixe}/${id}` : null;
};

export function configurationFiche(env: NodeJS.ProcessEnv = process.env): { emplacement: string | null; compteFiche: string | null; branchee: boolean; manquantes: string[]; erreur: string | null } {
  const { compte, erreur } = configurationCompteService(env);
  const emplacement = normaliser(env.GOOGLE_BUSINESS_LOCATION, "locations");
  const compteFiche = normaliser(env.GOOGLE_BUSINESS_ACCOUNT, "accounts");
  const manquantes = [...(compte ? [] : ["GOOGLE_SERVICE_ACCOUNT_JSON"]), ...(emplacement ? [] : ["GOOGLE_BUSINESS_LOCATION"])];
  return { emplacement, compteFiche, branchee: manquantes.length === 0, manquantes, erreur };
}

type ValeurDatee = { date?: { year?: number; month?: number; day?: number }; value?: string };
type SerieMetrique = { dailyMetric?: string; timeSeries?: { datedValues?: ValeurDatee[] } };
export type ReponsePerformance = { multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: SerieMetrique[] }[] };

/** La réponse de Performance → lignes jour × métrique (pur). Une valeur absente vaut 0. */
export function lignesFiche(reponse: ReponsePerformance): { jour: string; metrique: string; valeur: number }[] {
  const lignes: { jour: string; metrique: string; valeur: number }[] = [];
  for (const groupe of reponse.multiDailyMetricTimeSeries ?? []) {
    for (const serie of groupe.dailyMetricTimeSeries ?? []) {
      if (!serie.dailyMetric) continue;
      for (const v of serie.timeSeries?.datedValues ?? []) {
        const d = v.date;
        if (!d?.year || !d.month || !d.day) continue;
        const jour = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
        lignes.push({ jour, metrique: serie.dailyMetric, valeur: Number(v.value ?? 0) || 0 });
      }
    }
  }
  return lignes;
}

function parametresPlage(du: string, au: string): URLSearchParams {
  const p = new URLSearchParams();
  for (const m of METRIQUES_FICHE) p.append("dailyMetrics", m);
  const [a1, m1, j1] = du.split("-").map(Number);
  const [a2, m2, j2] = au.split("-").map(Number);
  p.set("dailyRange.startDate.year", String(a1));
  p.set("dailyRange.startDate.month", String(m1));
  p.set("dailyRange.startDate.day", String(j1));
  p.set("dailyRange.endDate.year", String(a2));
  p.set("dailyRange.endDate.month", String(m2));
  p.set("dailyRange.endDate.day", String(j2));
  return p;
}

const A_FAIRE_FICHE = (env?: NodeJS.ProcessEnv) =>
  `Accès à l'API Business Profile à demander à Google (formulaire « Application for Basic API Access ») puis, une fois accordé, ajouter ${emailCompteService(env) ?? "le compte de service"} comme gérant de la fiche.`;

async function ecrire(jour: string, metrique: string, valeur: number, synchroniseLe: Date): Promise<void> {
  await prisma.ficheGoogleJour.upsert({ where: { jour_metrique: { jour, metrique } }, create: { jour, metrique, valeur, synchroniseLe }, update: { valeur, synchroniseLe } });
}

/**
 * Synchronise la fiche Google (jours inclus). Sans période : 540 jours tant que la couverture notée dans
 * `SourceAnalytique.detail` n'y remonte pas (relecture B, point 11 : un premier passage interrompu est repris), sinon
 * les 10 derniers jours ; toujours jusqu'à il y a 3 jours. Sans variables : NON_BRANCHEE, aucun appel.
 */
export async function synchroniserFicheGoogle(periode: { depuis?: string; jusqua?: string } = {}, options: { env?: NodeJS.ProcessEnv; maintenant?: Date; signal?: AbortSignal } = {}): Promise<BilanSynchro> {
  const config = configurationFiche(options.env);
  const aujourdhui = jourParis(options.maintenant ?? new Date());
  const jusqua = periode.jusqua ?? jourDecale(aujourdhui, -JOURS_NON_CALCULES_FICHE);
  const couverture = config.branchee ? ((await lireSuivi("FICHE_GOOGLE"))?.detail.couverture ?? null) : null;
  const depuis = periode.depuis ?? debutDeReprise(couverture, jourDecale(jusqua, -JOURS_PREMIER_PASSAGE_FICHE), jusqua, JOURS_PASSAGE_NUIT_FICHE);
  const premierPassage = !periode.depuis && depuis < jourDecale(jusqua, -JOURS_PASSAGE_NUIT_FICHE);
  if (!config.branchee || !config.emplacement) return { source: "FICHE_GOOGLE", etat: "NON_BRANCHEE", du: depuis, au: jusqua, lignes: 0, appels: 0, message: config.erreur ?? `Variables absentes : ${config.manquantes.join(", ")}.` };
  const emplacement = config.emplacement;

  return suivreSynchro("FICHE_GOOGLE", { du: depuis, au: jusqua }, async () => {
    const synchroniseLe = new Date();
    const commun = { portees: [PORTEES_ANALYTIQUE.FICHE], service: "Fiche Google", aFaire: A_FAIRE_FICHE(options.env), env: options.env };
    const rep = await appelCompteService(`${API_PERFORMANCE}/${emplacement}:fetchMultiDailyMetricsTimeSeries?${parametresPlage(depuis, jusqua)}`, { method: "GET", ...commun });
    let appels = 1;
    let lignes = 0;
    for (const l of lignesFiche((await rep.json()) as ReponsePerformance)) {
      await ecrire(l.jour, l.metrique, l.valeur, synchroniseLe);
      lignes += 1;
    }
    await noterProgression("FICHE_GOOGLE", { du: depuis, au: jusqua });
    verifierInterruption(options.signal);
    let avis: { nombre: number; note: number | null } | null = null;
    if (config.compteFiche) {
      const repAvis = await appelCompteService(`${API_AVIS}/${config.compteFiche}/${emplacement}/reviews?pageSize=1`, { method: "GET", ...commun });
      appels += 1;
      const corps = (await repAvis.json()) as { totalReviewCount?: number; averageRating?: number };
      avis = { nombre: Number(corps.totalReviewCount ?? 0) || 0, note: typeof corps.averageRating === "number" ? corps.averageRating : null };
      await ecrire(aujourdhui, METRIQUE_AVIS_NOMBRE, avis.nombre, synchroniseLe);
      lignes += 1;
      if (avis.note !== null) {
        await ecrire(aujourdhui, METRIQUE_AVIS_NOTE, avis.note, synchroniseLe);
        lignes += 1;
      }
    }
    return { lignes, appels, detail: { emplacement, avis, premierPassage } };
  });
}
