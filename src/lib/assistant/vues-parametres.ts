import { catalogueVue, type OutilVue } from "./catalogue";
import { CLE_CONSIGNES, CLE_POSITIONNEMENT, CONSIGNES_DEFAUT, POSITIONNEMENT_DEFAUT, lireConsignes, lirePositionnement, listerVersions, type TexteReglable, type VersionVue } from "./consignes";
import { adresseMcp, listerAcces, type AccesVue } from "@/lib/oauth/serveur";

/**
 * Mission 13 (lot 3) — ce que Paramètres → Assistant affiche : lu par la page
 * (rendu serveur) et par les routes GET /api/assistant/acces et /consignes.
 */
export type VueAccesAssistant = { adresseMcp: string; acces: AccesVue; outils: OutilVue[] };
export type VueConsignesAssistant = {
  consignes: TexteReglable;
  positionnement: TexteReglable;
  defauts: { consignes: string; positionnement: string };
  versions: { consignes: VersionVue[]; positionnement: VersionVue[] };
};

export async function vueAcces(): Promise<VueAccesAssistant> {
  return { adresseMcp: adresseMcp(), acces: await listerAcces(), outils: catalogueVue() };
}

export async function vueConsignes(): Promise<VueConsignesAssistant> {
  const [consignes, positionnement, versionsConsignes, versionsPositionnement] = await Promise.all([lireConsignes(), lirePositionnement(), listerVersions(CLE_CONSIGNES), listerVersions(CLE_POSITIONNEMENT)]);
  return { consignes, positionnement, defauts: { consignes: CONSIGNES_DEFAUT, positionnement: POSITIONNEMENT_DEFAUT }, versions: { consignes: versionsConsignes, positionnement: versionsPositionnement } };
}
