import { alertesAnalytique } from "../alertes";
import { etatsDesSources } from "../appuis";
import { resumeEnregistre } from "../resume";
import type { Alerte, EcranArgent, EcranEnsemble, EcranPublicite, EcranSeo, EcranSite, EtatSource, Famille, OngletAnalytique, Periode, SourceDonnees } from "../types";
import { construireEcranArgent } from "./argent";
import { construireEcranEnsemble } from "./ensemble";
import { construireEcranPublicite } from "./publicite";
import { construireEcranSeo } from "./seo";
import { construireEcranSite } from "./site";

/**
 * Mission 17 (partie B) — les cinq écrans de l'Analytique, calculés en direct (sans cache : voir `ecranAnalytique` de
 * cache.ts pour l'écran servi). Chacun lit l'état des sources et les alertes qui le concernent, puis rend exactement
 * le type de types.ts. Signature commune : (période, options, maintenant).
 */

export type OptionsEcran = { source?: Famille | null; etats?: EtatSource[] };

const SOURCES_DES_ALERTES: Record<OngletAnalytique, SourceDonnees[] | null> = { ensemble: null, publicite: ["META", "GOOGLE_ADS"], seo: ["SEARCH_CONSOLE", "FICHE_GOOGLE"], site: ["SITE"], argent: ["CRM"] };

async function commun(onglet: OngletAnalytique, options: OptionsEcran, maintenant: Date): Promise<{ etats: EtatSource[]; alertes: Alerte[] }> {
  const etats = options.etats ?? (await etatsDesSources(maintenant));
  const toutes = await alertesAnalytique(maintenant, etats).catch((erreur) => {
    console.error("[analytique] alertes illisibles :", erreur);
    return [] as Alerte[];
  });
  const filtre = SOURCES_DES_ALERTES[onglet];
  return { etats, alertes: filtre ? toutes.filter((a) => filtre.includes(a.source)) : toutes };
}

export async function ecranEnsemble(periode: Periode, options: OptionsEcran = {}, maintenant: Date = new Date()): Promise<EcranEnsemble> {
  const { etats, alertes } = await commun("ensemble", options, maintenant);
  const resume = await resumeEnregistre(maintenant).catch((erreur) => {
    console.error("[analytique] résumé du jour illisible :", erreur);
    return null;
  });
  const ecran = await construireEcranEnsemble(periode, { etats, source: options.source ?? null, resume }, maintenant);
  return { ...ecran, genereLe: maintenant.toISOString(), alertes };
}

export async function ecranPublicite(periode: Periode, options: OptionsEcran = {}, maintenant: Date = new Date()): Promise<EcranPublicite> {
  const { etats, alertes } = await commun("publicite", options, maintenant);
  return { ...(await construireEcranPublicite(periode, { etats }, maintenant)), genereLe: maintenant.toISOString(), alertes };
}

export async function ecranSeo(periode: Periode, options: OptionsEcran = {}, maintenant: Date = new Date()): Promise<EcranSeo> {
  const { etats, alertes } = await commun("seo", options, maintenant);
  return { ...(await construireEcranSeo(periode, { etats })), genereLe: maintenant.toISOString(), alertes };
}

export async function ecranSite(periode: Periode, options: OptionsEcran = {}, maintenant: Date = new Date()): Promise<EcranSite> {
  const { alertes } = await commun("site", options, maintenant);
  return { ...(await construireEcranSite(periode)), genereLe: maintenant.toISOString(), alertes } as EcranSite;
}

export async function ecranArgent(periode: Periode, options: OptionsEcran = {}, maintenant: Date = new Date()): Promise<EcranArgent> {
  const { etats, alertes } = await commun("argent", options, maintenant);
  return { ...(await construireEcranArgent(periode, { etats }, maintenant)), genereLe: maintenant.toISOString(), alertes };
}

export const ECRANS = { ensemble: ecranEnsemble, publicite: ecranPublicite, seo: ecranSeo, site: ecranSite, argent: ecranArgent } as const;
