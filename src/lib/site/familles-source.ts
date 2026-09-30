import type { EntonnoirSite, EtapeEntonnoir } from "./evenements";

/**
 * Mission 16 (partie 6) — la FAMILLE d'une source de visite du site : Meta, recherche, direct, ou autre (le nom de la
 * source est gardé). Calculée à la LECTURE : les lignes `EvenementSite` gardent leur source brute, rien n'est réécrit.
 *
 * La source est celle que le site envoie (`sourceCourte`, `lib/utm.ts` du site) : `utm_source[/utm_medium]`
 * (« meta/paid », « google/cpc ») ou le domaine du site référent sans `www.` (« l.facebook.com », « google.fr »). Seul
 * le premier segment compte (avant « / »), découpé en mots (« l.instagram.com » → l, instagram, com) : un mot connu
 * décide. Module pur, sans base : l'écran Leads (composant client) l'importe.
 */
export const FAMILLES_SOURCE_SITE = ["meta", "recherche", "direct", "autre"] as const;
export type FamilleSourceSite = (typeof FAMILLES_SOURCE_SITE)[number];

export const LIBELLES_FAMILLE_SOURCE_SITE: Record<FamilleSourceSite, string> = { meta: "Meta", recherche: "Recherche", direct: "Direct", autre: "Autres" };

/** Facebook, Instagram, Messenger (et le raccourci « meta » des publicités). */
const MOTS_META = new Set(["meta", "fb", "facebook", "ig", "instagram", "msg"]);
/** Les moteurs de recherche. */
const MOTS_RECHERCHE = new Set(["google", "bing", "duckduckgo", "qwant", "ecosia", "yahoo"]);

export type SourceClassee = { famille: FamilleSourceSite; nom: string };

export function familleSource(source: string | null | undefined): SourceClassee {
  const nom = (source ?? "").trim();
  // Vide : accès direct (ou source inconnue). « direct » est aussi la clé que la synthèse donne à une source vide.
  if (!nom || nom.toLowerCase() === "direct") return { famille: "direct", nom: "" };
  const mots = nom.toLowerCase().split("/")[0].split(/[^a-z0-9]+/).filter(Boolean);
  if (mots.some((mot) => MOTS_META.has(mot))) return { famille: "meta", nom };
  if (mots.some((mot) => MOTS_RECHERCHE.has(mot))) return { famille: "recherche", nom };
  return { famille: "autre", nom };
}

/**
 * La famille de chaque parcours : celle de la PREMIÈRE source non vide de ses événements, dans l'ordre reçu (la base
 * les lit par date croissante), sinon « direct ». Un parcours n'est rangé que dans une famille : les entonnoirs par
 * famille s'additionnent en l'entonnoir global. (Un parcours peut survivre à l'onglet : le simulateur le garde sur
 * l'appareil ; une visite revenue plus tard par une publicité reste comptée à sa première provenance connue.)
 */
export function familleDesParcours(evenements: readonly { parcoursId: string; source?: string | null }[]): Map<string, SourceClassee> {
  const familles = new Map<string, SourceClassee>();
  for (const e of evenements) {
    const connue = familles.get(e.parcoursId);
    if (connue && connue.famille !== "direct") continue;
    const classee = familleSource(e.source);
    if (!connue || classee.famille !== "direct") familles.set(e.parcoursId, classee);
  }
  return familles;
}

/** Le sélecteur de l'entonnoir (Leads → « Sur le site cette semaine ») : toutes les visites, ou une famille. Les « autres » ne se lisent que dans « Toutes ». */
export const CHOIX_ENTONNOIR = [
  { id: "toutes", libelle: "Toutes" },
  { id: "meta", libelle: LIBELLES_FAMILLE_SOURCE_SITE.meta },
  { id: "recherche", libelle: LIBELLES_FAMILLE_SOURCE_SITE.recherche },
  { id: "direct", libelle: LIBELLES_FAMILLE_SOURCE_SITE.direct },
] as const;
export type ChoixEntonnoir = (typeof CHOIX_ENTONNOIR)[number]["id"];

/** Les étapes à afficher pour un choix du sélecteur (l'entonnoir global si les familles manquent). */
export function etapesDuChoix(entonnoir: EntonnoirSite, choix: ChoixEntonnoir): EtapeEntonnoir[] {
  if (choix === "toutes" || !entonnoir.parFamille) return entonnoir.etapes;
  return entonnoir.parFamille[choix];
}

/** Une ligne d'entonnoir en texte : « Visite 12 → Pièce choisie 5 → … → (Estimation vue 2) → Contact ou rappel 1 ». */
export function texteEtapes(etapes: readonly EtapeEntonnoir[]): string {
  return etapes.map((e) => (e.facultative ? `(${e.libelle} ${e.parcours})` : `${e.libelle} ${e.parcours}`)).join(" → ");
}

/**
 * Le texte des outils de l'assistant (« synthese », « voir_publicite ») : une ligne par famille qui a eu des visites,
 * les autres sources nommées. Vide si rien n'a été vu sur la période.
 */
export function texteEntonnoirParFamille(entonnoir: EntonnoirSite, familles: readonly FamilleSourceSite[] = FAMILLES_SOURCE_SITE): string[] {
  if (!entonnoir.parFamille) return [];
  const lignes: string[] = [];
  for (const famille of familles) {
    const etapes = entonnoir.parFamille[famille];
    if (!etapes || (etapes[0]?.parcours ?? 0) === 0) continue;
    const autres = famille === "autre" && entonnoir.autresSources?.length ? ` (${entonnoir.autresSources.map((s) => `${s.nom} ${s.parcours}`).join(", ")})` : "";
    lignes.push(`- ${LIBELLES_FAMILLE_SOURCE_SITE[famille]}${autres} : ${texteEtapes(etapes)}`);
  }
  return lignes;
}
