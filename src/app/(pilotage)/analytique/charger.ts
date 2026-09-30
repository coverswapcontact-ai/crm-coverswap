import { etatsDesSources } from "@/lib/analytique/appuis";
import { ecranAnalytique } from "@/lib/analytique/cache";
import { resoudrePeriode } from "@/lib/analytique/periode";
import type { EcranAnalytique, EtatSource } from "@/lib/analytique/types";
import type { RequeteAnalytique } from "@/components/pilotage/analytique/requete";

/**
 * Mission 17 (partie B) — l'écran d'une requête de l'Analytique (page /analytique et GET /api/analytique) : période
 * résolue en jours de Paris, écran servi par `ecranAnalytique` (cache mémoire, instantané du jour, sinon calcul), et
 * l'état des sources de données.
 */
export type EcranCharge = { ecran: EcranAnalytique; etats: EtatSource[] };

/**
 * Les chiffres peuvent venir du cache (5 min en mémoire, instantané du jour) ; l'état des sources, lui, est relu à
 * chaque ouverture (lecture en base, sans réseau) : après « Relancer », l'écran dit tout de suite où en est la source.
 */
export async function chargerEcran(requete: RequeteAnalytique, maintenant: Date = new Date()): Promise<EcranCharge> {
  const periode = resoudrePeriode(requete.periode === "libre" ? { du: requete.du, au: requete.au } : { p: requete.periode }, maintenant);
  const [ecran, frais] = await Promise.all([
    ecranAnalytique(requete.onglet, periode, { source: requete.source }, maintenant),
    etatsDesSources(maintenant).catch((erreur) => {
      console.error("[analytique] état des sources illisible :", erreur);
      return null;
    }),
  ]);
  return frais ? { ecran: { ...ecran, sources: frais }, etats: frais } : { ecran, etats: ecran.sources };
}
