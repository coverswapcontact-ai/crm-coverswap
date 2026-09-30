import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { ErreurDefinitive } from "@/lib/taches/registre";
import { jourDecale, suivreSynchro, type BilanSynchro } from "@/lib/analytique/suivi";
import { configurationPublicite, variablesPubliciteManquantes } from "./config";
import { ErreurGraph, appelerGraph, appelerTout, estProblemeDeDroits } from "./graph";

/**
 * Mission 17 (partie B) — la VRAIE dépense publicitaire Meta, lue dans l'API Marketing (docs/ANALYTIQUE.md § 3) :
 * `GET /act_<id>/insights`, niveau publicité, une ligne par jour (`time_increment=1`), toutes les pages suivies
 * (`appelerTout`), écrite par upsert dans `DepensePubJour` (clé plateforme + jour + publicité : rejouer la même période
 * réécrit les mêmes lignes, rien ne se double). Les chiffres Meta sont révisés pendant des jours : les 3 derniers jours
 * sont relus toutes les 3 h, toute la campagne (ou 90 jours) chaque nuit (analytique/synchro.ts).
 *
 * Variables : META_AD_ACCOUNT_ID (avec ou sans « act_ ») et META_ADS_TOKEN (jeton d'utilisateur système avec `ads_read`,
 * repli META_ACCESS_TOKEN). Sans elles : état NON_BRANCHEE, aucun appel (l'écran garde le prorata du budget, dit
 * « estimation »). Les jours sont ceux du FUSEAU DU COMPTE publicitaire : relecture B, le compte est lu d'abord
 * (`act_<id>?fields=timezone_name,currency`) et la synchronisation est EN ÉCHEC s'il n'est pas en Europe/Paris et en EUR.
 *
 * Leads de la plateforme : `onsite_conversion.lead_grouped` (tous les leads des formulaires instantanés) sinon `lead` —
 * jamais les deux, ils se recouvrent.
 */

export const PLATEFORME_META = "META";
export const CHAMPS_INSIGHTS = [
  "date_start",
  "date_stop",
  "account_currency",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "actions",
].join(",");

/** Publicités supprimées ou archivées en cours de campagne comprises (sinon leur dépense passée manque). */
const FILTRE_TOUS_ETATS = JSON.stringify([
  { field: "ad.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"] },
]);

export type ActionMeta = { action_type?: string; value?: string | number };
export type LigneInsights = {
  date_start?: string;
  date_stop?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionMeta[];
};

/** Les leads comptés par Meta : `onsite_conversion.lead_grouped` s'il est là, sinon `lead` ; jamais la somme. */
export function leadsDesActions(actions: readonly ActionMeta[] | null | undefined): number {
  const valeur = (type: string) => {
    const a = (actions ?? []).find((x) => x.action_type === type);
    return a ? Number(a.value) || 0 : null;
  };
  return valeur("onsite_conversion.lead_grouped") ?? valeur("lead") ?? 0;
}

const entier = (v: string | undefined) => Math.round(Number(v ?? 0) || 0);

/** Une ligne d'insights → les données d'un `DepensePubJour` (pur). null si la ligne n'a ni jour ni publicité. */
export function depenseDepuisInsights(ligne: LigneInsights, compteId: string, synchroniseLe: Date) {
  if (!ligne.date_start || !ligne.ad_id) return null;
  return {
    plateforme: PLATEFORME_META,
    jour: ligne.date_start,
    compteId,
    campagneId: ligne.campaign_id ?? "",
    campagneNom: ligne.campaign_name ?? null,
    ensembleId: ligne.adset_id ?? null,
    ensembleNom: ligne.adset_name ?? null,
    publiciteId: ligne.ad_id,
    publiciteNom: ligne.ad_name ?? null,
    depense: Math.round((Number(ligne.spend ?? 0) || 0) * 100) / 100,
    impressions: entier(ligne.impressions),
    clics: entier(ligne.clicks),
    clicsLien: ligne.inline_link_clicks === undefined ? null : entier(ligne.inline_link_clicks),
    leadsPlateforme: leadsDesActions(ligne.actions),
    actions: ligne.actions?.length ? JSON.stringify(ligne.actions).slice(0, 4000) : null,
    devise: ligne.account_currency || "EUR",
    synchroniseLe,
  };
}

/** Lit les insights (toutes les pages). Si le filtre d'état est refusé (code 100), relit sans lui. */
async function lireInsights(compteId: string, jeton: string, depuis: string, jusqua: string): Promise<{ lignes: LigneInsights[]; appels: number }> {
  const parametres = {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: depuis, until: jusqua }),
    fields: CHAMPS_INSIGHTS,
    limit: "500",
    access_token: jeton,
  };
  try {
    return { lignes: await appelerTout<LigneInsights>(`act_${compteId}/insights`, { ...parametres, filtering: FILTRE_TOUS_ETATS }), appels: 1 };
  } catch (erreur) {
    if (erreur instanceof ErreurGraph && erreur.code === 100 && !estProblemeDeDroits(erreur)) {
      console.warn(`[meta] filtre d'état des insights refusé (${erreur.message}) : lecture sans filtre.`);
      return { lignes: await appelerTout<LigneInsights>(`act_${compteId}/insights`, parametres), appels: 2 };
    }
    throw erreur;
  }
}

export type PeriodeSynchro = { depuis?: string; jusqua?: string };

export const FUSEAU_ATTENDU = "Europe/Paris";
export const DEVISE_ATTENDUE = "EUR";

/**
 * Relecture B (point 12) : le compte publicitaire doit compter en jours de Paris et en euros — sinon les jours de
 * `DepensePubJour` ne seraient pas ceux du CRM, ou les montants pas des euros. Rend le problème en une phrase, ou null.
 */
export function problemeDeCompte(compte: { timezone_name?: string; currency?: string }): string | null {
  const problemes: string[] = [];
  if (compte.timezone_name !== FUSEAU_ATTENDU) problemes.push(`fuseau ${compte.timezone_name ?? "inconnu"} au lieu de ${FUSEAU_ATTENDU}`);
  if (compte.currency !== DEVISE_ATTENDUE) problemes.push(`devise ${compte.currency ?? "inconnue"} au lieu de ${DEVISE_ATTENDUE}`);
  return problemes.length ? `Compte publicitaire Meta en ${problemes.join(" et ")} : la dépense n'est pas lue (jours ou montants faux). Régler le compte dans Meta, ou le signaler.` : null;
}

/**
 * Synchronise la dépense Meta d'une période (jours inclus ; défaut : les 3 derniers jours jusqu'à aujourd'hui, heure de
 * Paris). Met à jour `SourceAnalytique` META (réussite ou échec). Sans variables : bilan NON_BRANCHEE, rien d'appelé,
 * rien d'écrit. Jeton refusé ou droit manquant : ErreurDefinitive (réessayer ne sert à rien ; tâche système).
 */
export async function synchroniserDepenseMeta(periode: PeriodeSynchro = {}, options: { env?: NodeJS.ProcessEnv; maintenant?: Date; signal?: AbortSignal } = {}): Promise<BilanSynchro> {
  const env = options.env ?? process.env;
  const config = configurationPublicite(env);
  const aujourdhui = jourParis(options.maintenant ?? new Date());
  const jusqua = periode.jusqua ?? aujourdhui;
  const depuis = periode.depuis ?? jourDecale(jusqua, -2);
  if (!config) return { source: "META", etat: "NON_BRANCHEE", du: depuis, au: jusqua, lignes: 0, appels: 0, message: `Variables absentes : ${variablesPubliciteManquantes(env).join(", ")}.` };
  if (depuis > jusqua) throw new ErreurDefinitive(`Période invalide : du ${depuis} au ${jusqua}.`);

  return suivreSynchro("META", { du: depuis, au: jusqua }, async () => {
    let lu: { lignes: LigneInsights[]; appels: number };
    try {
      const compte = await appelerGraph<{ timezone_name?: string; currency?: string }>(`act_${config.compteId}`, { fields: "timezone_name,currency", access_token: config.jeton });
      const probleme = problemeDeCompte(compte);
      if (probleme) throw new ErreurDefinitive(probleme);
      if (options.signal?.aborted) throw new Error("Synchronisation Meta interrompue (délai de la tâche dépassé).");
      lu = await lireInsights(config.compteId, config.jeton, depuis, jusqua);
      lu.appels += 1;
    } catch (erreur) {
      if (erreur instanceof ErreurGraph && estProblemeDeDroits(erreur)) {
        throw new ErreurDefinitive(`Meta refuse la lecture de la dépense (code ${erreur.code ?? erreur.statut}) : ${erreur.message}. Vérifier que META_ADS_TOKEN a le droit ads_read sur le compte publicitaire.`);
      }
      throw erreur;
    }
    const maintenant = new Date();
    let lignes = 0;
    for (const brute of lu.lignes) {
      const donnees = depenseDepuisInsights(brute, config.compteId, maintenant);
      if (!donnees) continue;
      await prisma.depensePubJour.upsert({
        where: { plateforme_jour_publiciteId: { plateforme: PLATEFORME_META, jour: donnees.jour, publiciteId: donnees.publiciteId } },
        create: donnees,
        update: donnees,
      });
      lignes += 1;
    }
    return { lignes, appels: lu.appels, detail: { compte: `act_${config.compteId}` } };
  });
}
