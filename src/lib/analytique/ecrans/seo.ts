import prisma from "@/lib/prisma";
import { doublonDesPages } from "../appuis";
import { decalerMois, joursDe, periodePrecedente } from "../periode";
import { COULEURS_FAMILLE, type EcranSeo, type EtatSource, type Indicateur, type LigneSeo, type Periode } from "../types";
import { chiffresDisponibles, etatDe, evolutionDe, indicateur, ratio } from "./commun";

/**
 * Mission 17 (partie B) — l'onglet SEO et Google : Search Console (SeoJour : total, requêtes, pages, par jour) et fiche
 * Google (FicheGoogleJour). Position moyenne pondérée par les impressions. Opportunités :
 * - vu, jamais cliqué : au moins 30 impressions sur la période et aucun clic (ou un CTR sous 1 %) ;
 * - proches de la première page : position moyenne entre 8 et 20 ;
 * - en hausse : au moins 20 impressions, au moins le double de la période précédente.
 * Source non branchée (ou en attente d'accès) : valeurs null, listes vides — jamais un zéro trompeur.
 */

export const SEUILS_SEO = { impressionsSansClic: 30, ctrFaible: 0.01, positionMin: 8, positionMax: 20, impressionsHausse: 20, multipleHausse: 2 } as const;

type Agregat = { cle: string; clics: number; impressions: number; positionPonderee: number; impressionsPosition: number };
type Ligne = { jour: string; dimension: string; cle: string; clics: number; impressions: number; position: number | null };

function agreger(lignes: readonly Ligne[], dimension: string): Map<string, Agregat> {
  const carte = new Map<string, Agregat>();
  for (const l of lignes) {
    if (l.dimension !== dimension) continue;
    const a = carte.get(l.cle) ?? { cle: l.cle, clics: 0, impressions: 0, positionPonderee: 0, impressionsPosition: 0 };
    a.clics += l.clics;
    a.impressions += l.impressions;
    if (l.position !== null) {
      a.positionPonderee += l.position * l.impressions;
      a.impressionsPosition += l.impressions;
    }
    carte.set(l.cle, a);
  }
  return carte;
}

const position = (a: Agregat | undefined) => (a && a.impressionsPosition > 0 ? Math.round((a.positionPonderee / a.impressionsPosition) * 10) / 10 : null);

function ligneSeo(a: Agregat, avant: Agregat | undefined): LigneSeo {
  return { cle: a.cle, clics: a.clics, impressions: a.impressions, ctr: ratio(a.clics, a.impressions, 4), position: position(a), evolutionClics: evolutionDe(a.clics, avant?.clics ?? 0, "hausse").variation };
}

/** Opportunités (pur) : vu jamais cliqué, proches de la première page, en hausse. */
export function opportunitesSeo(requetes: readonly LigneSeo[], avant: ReadonlyMap<string, { impressions: number }>) {
  const s = SEUILS_SEO;
  return {
    sansClic: requetes.filter((r) => r.impressions >= s.impressionsSansClic && (r.clics === 0 || (r.ctr ?? 0) < s.ctrFaible)).sort((a, b) => b.impressions - a.impressions).slice(0, 10),
    presquePremierePage: requetes.filter((r) => r.position !== null && r.position >= s.positionMin && r.position <= s.positionMax).sort((a, b) => b.impressions - a.impressions).slice(0, 10),
    enHausse: requetes
      .filter((r) => r.impressions >= s.impressionsHausse && r.impressions >= s.multipleHausse * (avant.get(r.cle)?.impressions ?? 0))
      .sort((a, b) => b.impressions - (avant.get(b.cle)?.impressions ?? 0) - (a.impressions - (avant.get(a.cle)?.impressions ?? 0)))
      .slice(0, 10),
  };
}

async function lire(periode: Pick<Periode, "du" | "au">): Promise<Ligne[]> {
  return prisma.seoJour.findMany({ where: { jour: { gte: periode.du, lte: periode.au } }, select: { jour: true, dimension: true, cle: true, clics: true, impressions: true, position: true } });
}

export type ChiffresSeo = { clics: number; impressions: number; position: number | null; parJour: Map<string, Agregat>; requetes: LigneSeo[]; pages: LigneSeo[]; avantRequetes: Map<string, Agregat>; opportunites: ReturnType<typeof opportunitesSeo> };

/** Les chiffres Search Console d'une période (et de la précédente, pour les évolutions). */
export async function chiffresSeo(periode: Periode): Promise<{ actuel: ChiffresSeo; avant: { clics: number; impressions: number; position: number | null } }> {
  const [lignes, lignesAvant] = await Promise.all([lire(periode), lire(periodePrecedente(periode))]);
  const total = (ls: Ligne[]) => {
    const t = agreger(ls.map((l) => ({ ...l, cle: "" })), "TOTAL").get("");
    return { clics: t?.clics ?? 0, impressions: t?.impressions ?? 0, position: position(t) };
  };
  const requetesAvant = agreger(lignesAvant, "REQUETE");
  const pagesAvant = agreger(lignesAvant, "PAGE");
  const requetes = [...agreger(lignes, "REQUETE").values()].map((a) => ligneSeo(a, requetesAvant.get(a.cle))).sort((a, b) => b.clics - a.clics || b.impressions - a.impressions);
  const pagesAgregees = agreger(lignes, "PAGE");
  const pages = [...pagesAgregees.values()].map((a) => ligneSeo(a, pagesAvant.get(a.cle))).sort((a, b) => b.clics - a.clics || b.impressions - a.impressions);
  const parJour = new Map<string, Agregat>();
  for (const l of lignes) {
    if (l.dimension !== "TOTAL") continue;
    const a = parJour.get(l.jour) ?? { cle: l.jour, clics: 0, impressions: 0, positionPonderee: 0, impressionsPosition: 0 };
    a.clics += l.clics;
    a.impressions += l.impressions;
    parJour.set(l.jour, a);
  }
  return { actuel: { ...total(lignes), parJour, requetes, pages, avantRequetes: requetesAvant, opportunites: opportunitesSeo(requetes, requetesAvant) }, avant: total(lignesAvant) };
}

/* ── Fiche Google ────────────────────────────────────────────────────────── */

export const METRIQUES_VUES = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"];
export const METRIQUES_INTERACTIONS = ["CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "BUSINESS_CONVERSATIONS", "BUSINESS_BOOKINGS"];

export type ChiffresFiche = { vues: number; interactions: number; appels: number; clicsSite: number; itineraires: number; parJour: Map<string, { vues: number; interactions: number }>; avis: { nombre: number | null; note: number | null } };

async function lireFiche(periode: Pick<Periode, "du" | "au">): Promise<ChiffresFiche> {
  const lignes = await prisma.ficheGoogleJour.findMany({ where: { jour: { gte: periode.du, lte: periode.au } }, select: { jour: true, metrique: true, valeur: true } });
  const avis = await prisma.ficheGoogleJour.findMany({ where: { jour: { lte: periode.au }, metrique: { in: ["AVIS_NOMBRE", "AVIS_NOTE"] } }, orderBy: { jour: "desc" }, take: 2, select: { metrique: true, valeur: true } });
  const parJour = new Map<string, { vues: number; interactions: number }>();
  let vues = 0, interactions = 0, appels = 0, clicsSite = 0, itineraires = 0;
  for (const l of lignes) {
    const j = parJour.get(l.jour) ?? { vues: 0, interactions: 0 };
    if (METRIQUES_VUES.includes(l.metrique)) {
      vues += l.valeur;
      j.vues += l.valeur;
    }
    if (METRIQUES_INTERACTIONS.includes(l.metrique)) {
      interactions += l.valeur;
      j.interactions += l.valeur;
    }
    if (l.metrique === "CALL_CLICKS") appels += l.valeur;
    if (l.metrique === "WEBSITE_CLICKS") clicsSite += l.valeur;
    if (l.metrique === "BUSINESS_DIRECTION_REQUESTS") itineraires += l.valeur;
    parJour.set(l.jour, j);
  }
  return { vues, interactions, appels, clicsSite, itineraires, parJour, avis: { nombre: avis.find((a) => a.metrique === "AVIS_NOMBRE")?.valeur ?? null, note: avis.find((a) => a.metrique === "AVIS_NOTE")?.valeur ?? null } };
}

export async function chiffresFiche(periode: Periode) {
  const [actuel, avant] = await Promise.all([lireFiche(periode), lireFiche(periodePrecedente(periode))]);
  return { actuel, avant };
}

/** Vues de la fiche par mois (les 6 derniers mois jusqu'à `au`). */
export async function vuesFicheParMois(au: string, nombre = 6): Promise<{ mois: string; vues: number }[]> {
  const premier = decalerMois(au.slice(0, 7), -(nombre - 1));
  const lignes = await prisma.ficheGoogleJour.findMany({ where: { jour: { gte: `${premier}-01`, lte: au }, metrique: { in: METRIQUES_VUES } }, select: { jour: true, valeur: true } });
  return Array.from({ length: nombre }, (_, i) => decalerMois(premier, i)).map((mois) => ({ mois, vues: lignes.filter((l) => l.jour.startsWith(mois)).reduce((t, l) => t + l.valeur, 0) }));
}

export async function construireEcranSeo(periode: Periode, options: { etats: EtatSource[] }): Promise<Omit<EcranSeo, "genereLe" | "alertes">> {
  const etatSc = etatDe(options.etats, "SEARCH_CONSOLE");
  const etatFiche = etatDe(options.etats, "FICHE_GOOGLE");
  const scOk = chiffresDisponibles(etatSc);
  const ficheOk = chiffresDisponibles(etatFiche);
  const jours = joursDe(periode);
  const [seo, fiche] = await Promise.all([scOk ? chiffresSeo(periode) : null, ficheOk ? chiffresFiche(periode) : null]);
  const v = <T>(ok: boolean, valeur: T) => (ok ? valeur : null);
  const indicateurs: Indicateur[] = [
    indicateur({ cle: "clics", libelle: "Clics", valeur: v(scOk, seo?.actuel.clics ?? 0), precedente: v(scOk, seo?.avant.clics ?? 0), format: "nombre", favorable: "hausse", serie: jours.map((j) => seo?.actuel.parJour.get(j)?.clics ?? 0), source: "SEARCH_CONSOLE" }),
    indicateur({ cle: "impressions", libelle: "Affichages", valeur: v(scOk, seo?.actuel.impressions ?? 0), precedente: v(scOk, seo?.avant.impressions ?? 0), format: "nombre", favorable: "hausse", serie: jours.map((j) => seo?.actuel.parJour.get(j)?.impressions ?? 0), source: "SEARCH_CONSOLE" }),
    indicateur({ cle: "ctr", libelle: "CTR", valeur: seo ? ratio(seo.actuel.clics, seo.actuel.impressions, 4) : null, precedente: seo ? ratio(seo.avant.clics, seo.avant.impressions, 4) : null, format: "pourcent", favorable: "hausse", source: "SEARCH_CONSOLE" }),
    indicateur({ cle: "position", libelle: "Position moyenne", valeur: seo?.actuel.position ?? null, precedente: seo?.avant.position ?? null, format: "position", favorable: "baisse", source: "SEARCH_CONSOLE" }),
  ];
  const courbe = {
    titre: "Clics et affichages par jour",
    series: [
      { cle: "clics", libelle: "Clics", couleur: COULEURS_FAMILLE.seo },
      { cle: "impressions", libelle: "Affichages", couleur: COULEURS_FAMILLE.direct },
    ],
    points: seo ? jours.map((jour) => ({ jour, valeurs: { clics: seo.actuel.parJour.get(jour)?.clics ?? 0, impressions: seo.actuel.parJour.get(jour)?.impressions ?? 0 } })) : [],
  };
  const f = fiche?.actuel;
  const fa = fiche?.avant;
  return {
    onglet: "seo",
    periode,
    sources: options.etats,
    indicateurs,
    courbe,
    requetes: seo?.actuel.requetes.slice(0, 50) ?? [],
    pages: seo?.actuel.pages.slice(0, 50) ?? [],
    opportunites: seo?.actuel.opportunites ?? { sansClic: [], presquePremierePage: [], enHausse: [] },
    doublonWww: seo ? doublonDesPages(seo.actuel.pages.map((p) => ({ page: p.cle, impressions: p.impressions, clics: p.clics }))) : null,
    fiche: {
      indicateurs: [
        indicateur({ cle: "vues", libelle: "Vues de la fiche", valeur: v(ficheOk, f?.vues ?? 0), precedente: v(ficheOk, fa?.vues ?? 0), format: "nombre", favorable: "hausse", serie: jours.map((j) => f?.parJour.get(j)?.vues ?? 0), source: "FICHE_GOOGLE" }),
        indicateur({ cle: "interactions", libelle: "Interactions", valeur: v(ficheOk, f?.interactions ?? 0), precedente: v(ficheOk, fa?.interactions ?? 0), format: "nombre", favorable: "hausse", serie: jours.map((j) => f?.parJour.get(j)?.interactions ?? 0), source: "FICHE_GOOGLE" }),
        indicateur({ cle: "appels", libelle: "Appels", valeur: v(ficheOk, f?.appels ?? 0), precedente: v(ficheOk, fa?.appels ?? 0), format: "nombre", favorable: "hausse", source: "FICHE_GOOGLE" }),
        indicateur({ cle: "clicsSite", libelle: "Clics vers le site", valeur: v(ficheOk, f?.clicsSite ?? 0), precedente: v(ficheOk, fa?.clicsSite ?? 0), format: "nombre", favorable: "hausse", source: "FICHE_GOOGLE" }),
        indicateur({ cle: "itineraires", libelle: "Itinéraires", valeur: v(ficheOk, f?.itineraires ?? 0), precedente: v(ficheOk, fa?.itineraires ?? 0), format: "nombre", favorable: "hausse", source: "FICHE_GOOGLE" }),
      ],
      courbe: {
        titre: "Vues et interactions de la fiche",
        series: [
          { cle: "vues", libelle: "Vues", couleur: COULEURS_FAMILLE["fiche-google"] },
          { cle: "interactions", libelle: "Interactions", couleur: COULEURS_FAMILLE.meta },
        ],
        points: f ? jours.map((jour) => ({ jour, valeurs: { vues: f.parJour.get(jour)?.vues ?? 0, interactions: f.parJour.get(jour)?.interactions ?? 0 } })) : [],
      },
      avis: f ? f.avis : { nombre: null, note: null },
    },
  };
}
