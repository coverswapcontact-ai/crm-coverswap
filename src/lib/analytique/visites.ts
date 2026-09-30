import prisma from "@/lib/prisma";
import { dateDepuisJour, debutDuJourParis, jourParis } from "@/lib/dossiers/dates";
import { FAMILLES, type Famille } from "./types";
import { familleDe, nomDeProvenance } from "./sources";

/**
 * Mission 17 (partie B) — les VISITES du site, lues dans `EvenementSite` (docs/ANALYTIQUE.md § 3) :
 *  - visite = les événements d'un même visiteur du jour (empreinte calculée à la réception, analytique/mesure.ts) sans
 *    pause de 30 minutes ou plus ; les événements d'avant la mesure (sans empreinte) se regroupent par parcours, même
 *    règle (leurs robots ne sont pas écartés : `sansEmpreinte` les compte) ;
 *  - page d'entrée = la page de la première PAGE_VUE de la visite ;
 *  - famille de la visite = celle de sa première page vue (colonne `famille`, sinon recalculée depuis source et
 *    référent) ; appareil et pays = ceux de la première page ;
 *  - une visite « simule » si elle lance une génération, « termine » si elle voit un résultat, « demande » si elle
 *    envoie un contact (devis, formulaire, rappel).
 *
 * Lecture par agrégats : UN passage linéaire sur les événements triés par visiteur puis date (index
 * `[visiteur, createdAt]`), lus par tranches de 5 000 ; chaque compte est un Map incrémenté (jamais de recopie de
 * tableau, jamais de double boucle). Les pages vues sont comptées au jour de leur visite.
 */

export const PAUSE_VISITE_MS = 30 * 60_000;
const TRANCHE = 5_000;

const LANCEES = new Set(["GENERATION_LANCEE", "SIMULATION_LANCEE"]);
const TERMINEES = new Set(["RESULTAT_VU", "SIMULATION_RESULTAT"]);
const DEMANDES = new Set(["DEVIS_DEMANDE", "CONTACT_ENVOYE", "RAPPEL_DEMANDE"]);

export type CompteVisites = { visites: number; simulations: number; terminees: number; leads: number };

export type VisitesSite = {
  du: string;
  au: string;
  visites: number;
  /** Visiteurs du jour distincts, additionnés jour par jour (une personne revenue deux jours compte deux fois). */
  visiteurs: number;
  pagesVues: number;
  /** Chaque jour de la période (zéros compris), avec les visites par famille. */
  parJour: { jour: string; visites: number; pagesVues: number; parFamille: Partial<Record<Famille, number>> }[];
  pagesEntree: ({ page: string } & CompteVisites)[];
  /** Pages vues par adresse (toutes les PAGE_VUE, pas seulement les entrées). */
  pages: { page: string; vues: number }[];
  /** Par famille (ordre de FAMILLES) puis par provenance nommée (« chatgpt.com », « meta/paid »). */
  familles: ({ famille: Famille } & CompteVisites)[];
  sources: ({ famille: Famille; nom: string } & CompteVisites)[];
  appareils: { appareil: string; visites: number }[];
  /** Code ISO à deux lettres ; « ?? » quand le fuseau n'a rien dit. */
  pays: { pays: string; visites: number }[];
  /** Visite → simulation lancée → terminée → demande. */
  entonnoir: CompteVisites;
  /** Visites reconstituées depuis des événements sans empreinte (avant la mesure du 30/09/2026). */
  sansEmpreinte: number;
};

type Ligne = { id: string; createdAt: Date; parcoursId: string; visiteur: string | null; type: string; page: string | null; source: string | null; referent: string | null; famille: string | null; appareil: string | null; pays: string | null };

type Visite = {
  cle: string;
  debut: number;
  dernier: number;
  jour: string;
  entree: string | null;
  famille: Famille;
  nom: string;
  appareil: string | null;
  pays: string | null;
  aPageVue: boolean;
  simule: boolean;
  termine: boolean;
  demande: boolean;
  sansEmpreinte: boolean;
};

/** Les bornes d'une période en jours de Paris (bornes incluses) : [début du premier jour, début du lendemain du dernier[. */
export function bornesParis(du: string, au: string): { debut: Date; fin: Date } {
  const lendemain = new Date(dateDepuisJour(au).getTime() + 86_400_000);
  return { debut: debutDuJourParis(dateDepuisJour(du)), fin: debutDuJourParis(lendemain) };
}

/** Tous les jours AAAA-MM-JJ de `du` à `au` inclus. */
export function joursEntre(du: string, au: string): string[] {
  const jours: string[] = [];
  for (let t = Date.parse(`${du}T12:00:00Z`), fin = Date.parse(`${au}T12:00:00Z`); t <= fin; t += 86_400_000) jours.push(new Date(t).toISOString().slice(0, 10));
  return jours;
}

const estFamille = (f: string | null): f is Famille => Boolean(f) && (FAMILLES as readonly string[]).includes(f!);
const familleDeLigne = (e: Ligne): Famille => (estFamille(e.famille) ? e.famille : familleDe({ source: e.source, referent: e.referent }));

const vide = (): CompteVisites => ({ visites: 0, simulations: 0, terminees: 0, leads: 0 });
function compter(compte: CompteVisites, v: Visite): void {
  compte.visites += 1;
  if (v.simule) compte.simulations += 1;
  if (v.termine) compte.terminees += 1;
  if (v.demande) compte.leads += 1;
}

/**
 * Les visites du site sur une période (jours de Paris, bornes incluses). `options.famille` : seulement les visites de
 * cette famille (les pages vues restent celles de ces visites).
 */
export async function visitesSurPeriode(du: string, au: string, options: { famille?: Famille | null } = {}): Promise<VisitesSite> {
  const { debut, fin } = bornesParis(du, au);
  const filtre = options.famille ?? null;
  const jours = joursEntre(du, au);
  const parJour = new Map(jours.map((jour) => [jour, { jour, visites: 0, pagesVues: 0, parFamille: {} as Partial<Record<Famille, number>> }]));
  const parEntree = new Map<string, { page: string } & CompteVisites>();
  const parFamille = new Map<Famille, { famille: Famille } & CompteVisites>();
  const parSource = new Map<string, { famille: Famille; nom: string } & CompteVisites>();
  const parAppareil = new Map<string, number>();
  const parPays = new Map<string, number>();
  const parPage = new Map<string, number>();
  const visiteursParJour = new Set<string>();
  const entonnoir = vide();
  let visites = 0;
  let pagesVues = 0;
  let sansEmpreinte = 0;

  const clore = (v: Visite | null, vues: Map<string, number>) => {
    if (!v || (filtre && v.famille !== filtre)) return;
    visites += 1;
    if (v.sansEmpreinte) sansEmpreinte += 1;
    else visiteursParJour.add(`${v.jour}|${v.cle}`);
    const j = parJour.get(v.jour);
    if (j) {
      j.visites += 1;
      j.parFamille[v.famille] = (j.parFamille[v.famille] ?? 0) + 1;
    }
    compter(entonnoir, v);
    if (v.entree) {
      const e = parEntree.get(v.entree) ?? { page: v.entree, ...vide() };
      compter(e, v);
      parEntree.set(v.entree, e);
    }
    const f = parFamille.get(v.famille) ?? { famille: v.famille, ...vide() };
    compter(f, v);
    parFamille.set(v.famille, f);
    const cleSource = `${v.famille}|${v.nom}`;
    const s = parSource.get(cleSource) ?? { famille: v.famille, nom: v.nom, ...vide() };
    compter(s, v);
    parSource.set(cleSource, s);
    const appareil = v.appareil ?? "INCONNU";
    parAppareil.set(appareil, (parAppareil.get(appareil) ?? 0) + 1);
    const pays = v.pays ?? "??";
    parPays.set(pays, (parPays.get(pays) ?? 0) + 1);
    // Pages vues de la visite, comptées au jour de la visite.
    for (const [page, n] of vues) {
      parPage.set(page, (parPage.get(page) ?? 0) + n);
      pagesVues += n;
      if (j) j.pagesVues += n;
    }
  };

  // Un passage linéaire : événements triés par visiteur (puis, sans empreinte, par parcours) et par date, lus par tranches.
  let courante: Visite | null = null;
  let vuesCourantes = new Map<string, number>();
  const parcourir = async (avecEmpreinte: boolean) => {
    let curseur: string | undefined;
    for (;;) {
      const lignes: Ligne[] = await prisma.evenementSite.findMany({
        where: { createdAt: { gte: debut, lt: fin }, visiteur: avecEmpreinte ? { not: null } : null },
        select: { id: true, createdAt: true, parcoursId: true, visiteur: true, type: true, page: true, source: true, referent: true, famille: true, appareil: true, pays: true },
        orderBy: [avecEmpreinte ? { visiteur: "asc" } : { parcoursId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: TRANCHE,
        ...(curseur ? { cursor: { id: curseur }, skip: 1 } : {}),
      });
      for (const e of lignes) lire(e);
      if (lignes.length < TRANCHE) return;
      curseur = lignes[lignes.length - 1].id;
    }
  };
  const lire = (e: Ligne) => {
    const cle = e.visiteur ?? `p:${e.parcoursId}`;
    const t = e.createdAt.getTime();
    if (!courante || courante.cle !== cle || t - courante.dernier >= PAUSE_VISITE_MS) {
      clore(courante, vuesCourantes);
      courante = {
        cle,
        debut: t,
        dernier: t,
        jour: jourParis(e.createdAt),
        entree: null,
        famille: familleDeLigne(e),
        nom: nomDeProvenance({ source: e.source, referent: e.referent }),
        appareil: e.appareil,
        pays: e.pays,
        aPageVue: false,
        simule: false,
        termine: false,
        demande: false,
        sansEmpreinte: !e.visiteur,
      };
      vuesCourantes = new Map();
    }
    courante.dernier = t;
    if (e.type === "PAGE_VUE") {
      if (!courante.aPageVue) {
        // La première page vue fait l'entrée, la provenance, l'appareil et le pays de la visite.
        courante.aPageVue = true;
        courante.entree = e.page || null;
        courante.famille = familleDeLigne(e);
        courante.nom = nomDeProvenance({ source: e.source, referent: e.referent });
        courante.appareil = e.appareil ?? courante.appareil;
        courante.pays = e.pays ?? courante.pays;
      }
      const page = e.page || "?";
      vuesCourantes.set(page, (vuesCourantes.get(page) ?? 0) + 1);
    }
    if (LANCEES.has(e.type)) courante.simule = true;
    if (TERMINEES.has(e.type)) courante.termine = true;
    if (DEMANDES.has(e.type)) courante.demande = true;
  };
  await parcourir(true);
  await parcourir(false);
  clore(courante, vuesCourantes);

  const parValeur = <T extends { visites: number }>(a: T, b: T) => b.visites - a.visites;
  return {
    du,
    au,
    visites,
    visiteurs: visiteursParJour.size,
    pagesVues,
    parJour: [...parJour.values()],
    pagesEntree: [...parEntree.values()].sort((a, b) => b.visites - a.visites || a.page.localeCompare(b.page, "fr")),
    pages: [...parPage.entries()].map(([page, vues]) => ({ page, vues })).sort((a, b) => b.vues - a.vues || a.page.localeCompare(b.page, "fr")),
    familles: FAMILLES.map((f) => parFamille.get(f)).filter((f): f is { famille: Famille } & CompteVisites => Boolean(f)),
    sources: [...parSource.values()].sort(parValeur),
    appareils: [...parAppareil.entries()].map(([appareil, n]) => ({ appareil, visites: n })).sort(parValeur),
    pays: [...parPays.entries()].map(([pays, n]) => ({ pays, visites: n })).sort(parValeur),
    entonnoir,
    sansEmpreinte,
  };
}
