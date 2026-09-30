import type { EntonnoirSite, EtapeEntonnoir } from "./evenements";
import { familleDe } from "@/lib/analytique/sources";
import { FAMILLES, LIBELLES_FAMILLE, type Famille } from "@/lib/analytique/types";

/**
 * Mission 16 (partie 6) — la FAMILLE d'une source de visite du site, calculée à la LECTURE : les lignes `EvenementSite`
 * gardent leur source brute, rien n'est réécrit.
 *
 * Mission 17 (partie B) : plus de règle propre au site — la famille vient de la définition unique de l'Analytique
 * (`analytique/sources.ts › familleDe`, docs/ANALYTIQUE.md § 2) : Pub Meta, Google Ads, SEO, Fiche Google, ChatGPT et IA,
 * réseaux sociaux, direct, autres. Changements visibles : « chatgpt.com » (et perplexity.ai, gemini.google.com, meta.ai…)
 * est rangé en IA au lieu d'« autre » ; un lien Facebook ou Instagram SANS marqueur payant (« l.facebook.com ») est un
 * réseau social, plus une publicité Meta ; « google/cpc » est Google Ads, plus de la recherche. Les noms de l'ancienne
 * API (FAMILLES_SOURCE_SITE, familleSource, familleDesParcours…) restent, pour les outils de l'assistant (« synthese »,
 * « voir_publicite ») et l'écran Leads. Module pur, sans base : l'écran Leads (composant client) l'importe.
 *
 * La source est celle que le site envoie (`sourceCourte`, `lib/utm.ts` du site) : `utm_source[/utm_medium]`
 * (« meta/paid », « google/cpc ») ou le domaine du site référent sans `www.` (« l.facebook.com », « google.fr »).
 */
export const FAMILLES_SOURCE_SITE = FAMILLES;
export type FamilleSourceSite = Famille;

export const LIBELLES_FAMILLE_SOURCE_SITE: Record<FamilleSourceSite, string> = LIBELLES_FAMILLE;

export type SourceClassee = { famille: FamilleSourceSite; nom: string };

export function familleSource(source: string | null | undefined): SourceClassee {
  const nom = (source ?? "").trim();
  // Vide : accès direct (ou source inconnue). « direct » est aussi la clé que la synthèse donne à une source vide.
  if (!nom || nom.toLowerCase() === "direct") return { famille: "direct", nom: "" };
  return { famille: familleDe({ source: nom }), nom };
}

/**
 * La famille de chaque parcours : celle de la PREMIÈRE source non vide de ses événements, dans l'ordre reçu (la base
 * les lit par date croissante), sinon « direct ». Un parcours n'est rangé que dans une famille : les entonnoirs par
 * famille s'additionnent en l'entonnoir global. (Un parcours peut survivre à l'onglet : le simulateur le garde sur
 * l'appareil ; une visite revenue plus tard par une publicité reste comptée à sa première provenance connue.) Mission 17 :
 * la famille calculée à la réception (colonne `famille`, qui tient compte du référent et du gclid) est préférée.
 */
export function familleDesParcours(evenements: readonly { parcoursId: string; source?: string | null; famille?: string | null }[]): Map<string, SourceClassee> {
  const familles = new Map<string, SourceClassee>();
  for (const e of evenements) {
    const connue = familles.get(e.parcoursId);
    if (connue && connue.famille !== "direct") continue;
    const recue = e.famille && (FAMILLES as readonly string[]).includes(e.famille) ? (e.famille as Famille) : null;
    const classee = recue ? { famille: recue, nom: recue === "direct" ? "" : (e.source ?? "").trim() } : familleSource(e.source);
    if (!connue || classee.famille !== "direct") familles.set(e.parcoursId, classee);
  }
  return familles;
}

/** Le sélecteur de l'entonnoir (Leads → « Sur le site cette semaine ») : toutes les visites, ou une famille. Les « autres » ne se lisent que dans « Toutes ». */
export const CHOIX_ENTONNOIR = [
  { id: "toutes", libelle: "Toutes" },
  { id: "meta", libelle: LIBELLES_FAMILLE_SOURCE_SITE.meta },
  { id: "seo", libelle: LIBELLES_FAMILLE_SOURCE_SITE.seo },
  { id: "ia", libelle: LIBELLES_FAMILLE_SOURCE_SITE.ia },
  { id: "direct", libelle: LIBELLES_FAMILLE_SOURCE_SITE.direct },
] as const;
export type ChoixEntonnoir = (typeof CHOIX_ENTONNOIR)[number]["id"];

/** Les étapes à afficher pour un choix du sélecteur (l'entonnoir global si les familles manquent, ou si un ancien instantané n'a pas cette famille). */
export function etapesDuChoix(entonnoir: EntonnoirSite, choix: ChoixEntonnoir): EtapeEntonnoir[] {
  if (choix === "toutes" || !entonnoir.parFamille) return entonnoir.etapes;
  return entonnoir.parFamille[choix] ?? entonnoir.etapes;
}

/** Une ligne d'entonnoir en texte : « Visite 12 → Pièce choisie 5 → … → (Estimation vue 2) → Contact ou rappel 1 ». */
export function texteEtapes(etapes: readonly EtapeEntonnoir[]): string {
  return etapes.map((e) => (e.facultative ? `(${e.libelle} ${e.parcours})` : `${e.libelle} ${e.parcours}`)).join(" → ");
}

/** Familles des instantanés mensuels d'avant la mission 17 (synthèse figée) : encore lisibles. */
const LIBELLES_ANCIENNES_FAMILLES: Record<string, string> = { recherche: "Recherche" };

/**
 * Le texte des outils de l'assistant (« synthese », « voir_publicite ») : une ligne par famille qui a eu des visites,
 * les autres sources nommées. Vide si rien n'a été vu sur la période. Un ancien instantané (familles meta, recherche,
 * direct, autre) garde ses lignes.
 */
export function texteEntonnoirParFamille(entonnoir: EntonnoirSite, familles: readonly FamilleSourceSite[] = FAMILLES_SOURCE_SITE): string[] {
  if (!entonnoir.parFamille) return [];
  const parFamille = entonnoir.parFamille as Partial<Record<string, EtapeEntonnoir[]>>;
  const anciennes = familles === FAMILLES_SOURCE_SITE ? Object.keys(parFamille).filter((f) => f in LIBELLES_ANCIENNES_FAMILLES) : [];
  const lignes: string[] = [];
  for (const famille of [...familles, ...anciennes]) {
    const etapes = parFamille[famille];
    if (!etapes || (etapes[0]?.parcours ?? 0) === 0) continue;
    const autres = famille === "autre" && entonnoir.autresSources?.length ? ` (${entonnoir.autresSources.map((s) => `${s.nom} ${s.parcours}`).join(", ")})` : "";
    const libelle = (LIBELLES_FAMILLE_SOURCE_SITE as Record<string, string>)[famille] ?? LIBELLES_ANCIENNES_FAMILLES[famille] ?? famille;
    lignes.push(`- ${libelle}${autres} : ${texteEtapes(etapes)}`);
  }
  return lignes;
}
