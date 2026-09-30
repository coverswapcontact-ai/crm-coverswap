import { ZONES_SIMULATEUR, type IdPiece, type IdZone } from "../zones";
import { couleurDe, profilDe, type Profil } from "./materiaux";
import type { ZoneMoteur } from "./types";

/**
 * Direction artistique (mission 15, partie 2) : deux à trois phrases qui
 * disent au modèle ce que la composition doit raconter — ce qu'un directeur
 * artistique dirait avant la prise de vue. Règles pures, une par situation,
 * testées une par une ; une phrase de clôture générique quand aucune ne
 * s'applique. Le texte est enregistré sur la simulation et visible au CRM.
 */

export const PHRASE_GENERIQUE = "Keep the scene calm and credible, photographed at eye level: the new material simply belongs to the room.";
const PHRASES_MAX = 3;

const ZONES_FACADES: readonly IdZone[] = ["facades-cuisine", "meubles-hauts", "meubles-bas", "meuble-vasque", "portes-dressing", "rangements-pro", "comptoir-habillage"];
const ZONES_PLAN: readonly IdZone[] = ["plan-de-travail", "plan-vasque", "comptoir-plateau"];
const PROFILS_BOIS: readonly Profil[] = ["bois"];
const PROFILS_MINERAUX: readonly Profil[] = ["marbre", "pierre", "terrazzo", "beton"];
const PROFILS_UNIS: readonly Profil[] = ["uni-mat", "uni-brillant", "uni-raye", "bois-peint"];
const PROFILS_ACCENT: readonly Profil[] = ["paillettes", "metal-brosse", "metal-poli", "metal-patine"];

type ZoneLue = { zone: IdZone; ref: string; nom: string; profil: Profil; clarte: number | null };

const lire = (z: ZoneMoteur): ZoneLue => ({ zone: z.zone, ref: z.reference.ref, nom: z.reference.nom, profil: profilDe(z.reference), clarte: couleurDe(z.reference)?.clarte ?? null });
const nomsZones = (zones: ZoneLue[]) => zones.map((z) => ZONES_SIMULATEUR[z.zone].nomCourt).join(", ");
const film = (z: ZoneLue) => `${z.ref} "${z.nom}"`;

/** Un seul film pour toutes les zones : un bloc monolithique. */
export function regleMonolithique(zones: ZoneLue[]): string | null {
  const refs = new Set(zones.map((z) => z.ref));
  if (refs.size !== 1) return null;
  const z = zones[0];
  return zones.length > 1
    ? `One material, one gesture: ${nomsZones(zones)} all wear ${film(z)} and read as a single monolithic volume, calm and continuous, with no competing accent.`
    : `A single material: ${nomsZones(zones)} wear ${film(z)} as one clean, monolithic surface, with no competing accent.`;
}

/** Bois sur les façades et pierre ou béton sur le plan : le plan est l'ancre visuelle. */
export function regleBoisEtMineral(zones: ZoneLue[]): string | null {
  const bois = zones.find((z) => ZONES_FACADES.includes(z.zone) && PROFILS_BOIS.includes(z.profil));
  const mineral = zones.find((z) => ZONES_PLAN.includes(z.zone) && PROFILS_MINERAUX.includes(z.profil));
  if (!bois || !mineral) return null;
  return `Warm timber cabinetry (${film(bois)}) under a mineral top (${film(mineral)}): the worktop is the visual anchor, the wood stays quiet and even around it.`;
}

/** Deux bois différents : sens du fil, contraste des tons, le plus sombre ancre la composition. */
export function regleDeuxBois(zones: ZoneLue[]): string | null {
  const bois = zones.filter((z) => PROFILS_BOIS.includes(z.profil));
  const refs = [...new Map(bois.map((z) => [z.ref, z])).values()];
  if (refs.length < 2) return null;
  const tries = [...refs].sort((a, b) => (a.clarte ?? 50) - (b.clarte ?? 50));
  const sombre = tries[0];
  return `Two woods (${refs.map(film).join(" and ")}): their grain runs the same way, their tones contrast clearly, and the darker wood (${film(sombre)}) grounds the composition.`;
}

/** Uni sur les hauts, bois sur les bas : haut aérien, bas chaleureux. */
export function regleUniHautsBoisBas(zones: ZoneLue[]): string | null {
  const hauts = zones.find((z) => z.zone === "meubles-hauts" && PROFILS_UNIS.includes(z.profil));
  const bas = zones.find((z) => z.zone === "meubles-bas" && PROFILS_BOIS.includes(z.profil));
  if (!hauts || !bas) return null;
  const clair = hauts.clarte === null || hauts.clarte >= 60;
  return `${clair ? "Light" : "Plain"} upper units (${film(hauts)}) keep the room airy; the wood bases (${film(bas)}) bring warmth and weight to the lower half.`;
}

/** Paillettes ou métal : un accent qui prend la lumière, rien d'autre ne rivalise. */
export function regleAccent(zones: ZoneLue[]): string | null {
  const accents = zones.filter((z) => PROFILS_ACCENT.includes(z.profil));
  if (accents.length === 0) return null;
  const autres = zones.filter((z) => !PROFILS_ACCENT.includes(z.profil));
  return `${nomsZones(accents)} in ${accents.map(film).join(" and ")} ${accents.length > 1 ? "are the accents that catch" : "is the accent that catches"} the light${autres.length ? `; ${nomsZones(autres)} stay quiet so nothing competes with it` : "; the rest of the room stays as quiet as it is"}.`;
}

/** Salle de bain : esprit spa, mat et silencieux ; gouttes et calcaire restent. */
export function regleSalleDeBain(piece: IdPiece): string | null {
  if (piece !== "salle-de-bain") return null;
  return "Spa-like mood: matt and quiet, clean lines, soft even light; water droplets, limescale marks and the wear of daily use stay exactly where they are.";
}

/** Professionnel : le comptoir est la première impression de la marque. */
export function regleProfessionnel(piece: IdPiece): string | null {
  if (piece !== "professionnel") return null;
  return "The counter is the brand's first impression: a clean, durable, hospitality-grade finish, signage and equipment untouched and legible.";
}

/** Îlot ou plan avec retours : chants et retours, décor continu et raccordé au pli. */
export function regleRetours(zones: ZoneLue[]): string | null {
  const plan = zones.find((z) => ZONES_PLAN.includes(z.zone));
  if (!plan) return null;
  return `On the ${ZONES_SIMULATEUR[plan.zone].nomCourt} the decor runs continuous over the front edge and the returns, matched at the fold as if one slab had been cut and mitred.`;
}

/** La direction artistique complète : deux à trois phrases, la clôture générique si aucune règle ne s'applique. */
export function directionArtistique(piece: IdPiece, zonesMoteur: ZoneMoteur[]): string {
  const zones = zonesMoteur.map(lire);
  const phrases = [regleMonolithique(zones), regleBoisEtMineral(zones), regleDeuxBois(zones), regleUniHautsBoisBas(zones), regleAccent(zones), regleSalleDeBain(piece), regleProfessionnel(piece), regleRetours(zones)].filter((p): p is string => Boolean(p));
  if (phrases.length === 0) return PHRASE_GENERIQUE;
  return phrases.slice(0, PHRASES_MAX).join(" ");
}
