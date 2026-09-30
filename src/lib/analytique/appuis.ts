import { familleDe, familleDuLead, type EntreeFamille } from "./sources";
import { visitesSurPeriode, type VisitesSite } from "./visites";
import { etatDesSources } from "./etat";
import { doublonWwwDesPages } from "@/lib/google/search-console";
import type { EtatSource, Famille } from "./types";

/**
 * Mission 17 (partie B) — les appuis des calculs sur le lot « connecteurs et mesure du site » : familles de source
 * (sources.ts), visites (visites.ts), état des sources (etat.ts), doublon www (Search Console). Un seul fichier les
 * importe, pour que les écrans ne dépendent que de ces formes-ci.
 */

export type ProvenanceParcours = EntreeFamille & { famille?: string | null };
export type VisitesAnalyse = VisitesSite;

/** La famille d'une source brute du site (utm_source[/medium] ou référent). */
export function familleDeSource(source: string | null | undefined, referent?: string | null): Famille {
  return familleDe({ source: source ?? null, referent: referent ?? null });
}

/** La famille d'un lead : `Lead.source`, puis `canal`, puis la première visite de son parcours. */
export function familleDeLead(lead: { source: string; canal: string | null; campagne?: string | null }, parcours: ProvenanceParcours | null = null): Famille {
  return familleDuLead({ source: lead.source, canal: lead.canal, campagne: lead.campagne ?? null, parcours });
}

/** Les visites du site sur des jours de Paris (bornes incluses), éventuellement d'une seule famille. null : mesure indisponible. */
export async function visitesDuSite(periode: { du: string; au: string }, famille: Famille | null = null): Promise<VisitesAnalyse | null> {
  try {
    return await visitesSurPeriode(periode.du, periode.au, { famille });
  } catch (erreur) {
    console.error("[analytique] visites du site illisibles :", erreur);
    return null;
  }
}

export async function etatsDesSources(maintenant: Date): Promise<EtatSource[]> {
  return etatDesSources(maintenant);
}

/** « www et sans www indexés tous les deux », d'après les pages vues dans Google (adresse, affichages, clics). */
export function doublonDesPages(pages: readonly { page: string; impressions?: number; clics?: number }[]): { detecte: boolean; exemples: string[] } {
  const { detecte, exemples } = doublonWwwDesPages(pages);
  return { detecte, exemples };
}
