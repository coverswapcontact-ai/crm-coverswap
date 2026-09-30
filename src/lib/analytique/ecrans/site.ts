import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { jourParis } from "@/lib/dossiers/dates";
import { familleDeSource, visitesDuSite, type VisitesAnalyse } from "../appuis";
import { bornes, joursDe, periodePrecedente } from "../periode";
import { COULEURS_FAMILLE, FAMILLES, LIBELLES_FAMILLE, type EcranSite, type EtatSource, type Famille, type Periode, type Tunnel } from "../types";
import { indicateur, ratio, serieParJour } from "./commun";
import { tunnelDe } from "./tunnel";

/**
 * Mission 17 (partie B) — l'onglet Site : la mesure maison sans cookie (`visitesSurPeriode` : visites, pages vues,
 * pages d'entrée, provenances, appareils, pays — ses lignes comptent, par visite, les simulations lancées et les
 * demandes) croisée avec le simulateur pour les indicateurs et l'entonnoir :
 * - simulation lancée : un parcours du site qui a demandé au moins une génération (TravailSimulation, échecs compris) ;
 * - simulation terminée : un parcours avec un rendu réussi (SimulationSite, archivées comprises : la purge des 30 jours
 *   ne les retire pas des chiffres) ;
 * - simulation → lead : parcours dont un rendu a été rattaché à un lead (coordonnées laissées, rattachement par le
 *   parcours déjà en place).
 * Taux visites → simulation = parcours lancés / visites (deux mesures du site, rapprochées).
 */

export type SimulationsSite = { lancees: { parcoursId: string; jour: string; famille: Famille }[]; terminees: { parcoursId: string; jour: string; lead: boolean; famille: Famille }[] };

export async function simulationsDuSite(periode: Pick<Periode, "du" | "au">): Promise<SimulationsSite> {
  const { debut, fin } = bornes(periode);
  const [travaux, rendus] = await Promise.all([
    prisma.travailSimulation.findMany({ where: { ...AVEC_ARCHIVES, createdAt: { gte: debut, lt: fin } }, orderBy: { createdAt: "asc" }, select: { parcoursId: true, createdAt: true, source: true } }),
    prisma.simulationSite.findMany({ where: { ...AVEC_ARCHIVES, createdAt: { gte: debut, lt: fin } }, orderBy: { createdAt: "asc" }, select: { parcoursId: true, createdAt: true, leadId: true, source: true } }),
  ]);
  const lancees = new Map<string, SimulationsSite["lancees"][number]>();
  for (const t of travaux) if (!lancees.has(t.parcoursId)) lancees.set(t.parcoursId, { parcoursId: t.parcoursId, jour: jourParis(t.createdAt), famille: familleDeSource(t.source) });
  const terminees = new Map<string, SimulationsSite["terminees"][number]>();
  for (const r of rendus) {
    const deja = terminees.get(r.parcoursId);
    if (!deja) terminees.set(r.parcoursId, { parcoursId: r.parcoursId, jour: jourParis(r.createdAt), lead: Boolean(r.leadId), famille: familleDeSource(r.source) });
    else if (r.leadId) deja.lead = true;
  }
  return { lancees: [...lancees.values()], terminees: [...terminees.values()] };
}

export function entonnoirDuSite(visites: number | null, s: SimulationsSite): Tunnel {
  return tunnelDe(
    [
      { cle: "visites", libelle: "Visites", valeur: visites, source: "SITE" },
      { cle: "lancees", libelle: "Simulations lancées", valeur: s.lancees.length, source: "SITE" },
      { cle: "terminees", libelle: "Simulations terminées", valeur: s.terminees.length, source: "SITE" },
      { cle: "leads", libelle: "Leads", valeur: s.terminees.filter((t) => t.lead).length, source: "CRM" },
    ],
    ["lancees", "terminees", "leads"],
  );
}

const APPAREILS: Record<string, string> = { TELEPHONE: "Téléphone", TABLETTE: "Tablette", ORDINATEUR: "Ordinateur" };

export async function construireEcranSite(periode: Periode, options: { etats: EtatSource[] }): Promise<Omit<EcranSite, "genereLe" | "alertes">> {
  const precedente = periodePrecedente(periode);
  const [visites, visitesAvant, sims, simsAvant] = await Promise.all([visitesDuSite(periode), visitesDuSite(precedente), simulationsDuSite(periode), simulationsDuSite(precedente)]);
  const jours = joursDe(periode);
  const tauxSimulation = (v: VisitesAnalyse | null, s: SimulationsSite) => (v ? ratio(s.lancees.length, v.visites) : null);
  const tauxLead = (s: SimulationsSite) => ratio(s.terminees.filter((t) => t.lead).length, s.terminees.length);
  const indicateurs = [
    indicateur({ cle: "visites", libelle: "Visites", valeur: visites?.visites ?? null, precedente: visitesAvant?.visites ?? null, format: "nombre", favorable: "hausse", serie: jours.map((j) => visites?.parJour.find((p) => p.jour === j)?.visites ?? 0), source: "SITE", detail: visites ? `${visites.visiteurs} visiteurs` : "mesure du site illisible" }),
    indicateur({ cle: "pagesVues", libelle: "Pages vues", valeur: visites?.pagesVues ?? null, precedente: visitesAvant?.pagesVues ?? null, format: "nombre", favorable: "hausse", serie: jours.map((j) => visites?.parJour.find((p) => p.jour === j)?.pagesVues ?? 0), source: "SITE" }),
    indicateur({ cle: "tauxSimulation", libelle: "Visites → simulation", valeur: tauxSimulation(visites, sims), precedente: tauxSimulation(visitesAvant, simsAvant), format: "pourcent", favorable: "hausse", serie: serieParJour(periode, sims.lancees), source: "SITE", detail: `${sims.lancees.length} simulations lancées` }),
    indicateur({ cle: "tauxLead", libelle: "Simulation → lead", valeur: tauxLead(sims), precedente: tauxLead(simsAvant), format: "pourcent", favorable: "hausse", source: "SITE", detail: `${sims.terminees.filter((t) => t.lead).length} sur ${sims.terminees.length} simulations terminées` }),
  ];
  const familles = FAMILLES.filter((f) => visites?.parJour.some((p) => (p.parFamille[f] ?? 0) > 0));
  const courbe = {
    titre: "Visites par jour et par source",
    series: familles.map((f) => ({ cle: f, libelle: LIBELLES_FAMILLE[f], couleur: COULEURS_FAMILLE[f] })),
    points: visites ? visites.parJour.map((p) => ({ jour: p.jour, valeurs: Object.fromEntries(familles.map((f) => [f, p.parFamille[f] ?? 0])) })) : [],
  };
  const trafic = (visites?.sources ?? []).map((s) => ({ famille: s.famille, nom: s.nom || LIBELLES_FAMILLE[s.famille], visites: s.visites, simulations: s.simulations, leads: s.leads }));
  return {
    onglet: "site",
    periode,
    sources: options.etats,
    provenances: trafic,
    indicateurs,
    courbe,
    pagesEntree: (visites?.pagesEntree ?? []).slice(0, 30).map((p) => ({ page: p.page, visites: p.visites, simulations: p.simulations, leads: p.leads })),
    pagesVues: (visites?.pages ?? []).slice(0, 30),
    appareils: (visites?.appareils ?? []).map((a) => ({ appareil: APPAREILS[a.appareil] ?? a.appareil, visites: a.visites })),
    pays: visites?.pays ?? [],
    entonnoir: entonnoirDuSite(visites?.visites ?? null, sims),
  };
}
