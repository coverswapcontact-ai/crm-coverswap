import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { aHeureParis } from "@/lib/commercial/quand";
import { jourParis } from "@/lib/dossiers/dates";
import { typeActeur } from "@/lib/journal/contexte";
import { lireObjet } from "./json";
import {
  FAMILLE_GROUPE,
  GROUPES_TYPE,
  REPONSES_TACHE,
  SOURCES_TACHE,
  STATUTS_TACHE,
  TYPES_TACHE,
  type GroupeMinutes,
  type ListeTaches,
  type LotVue,
  type NiveauTache,
  type PlanMinutes,
  type Raccourci,
  type ReponseTache,
  type SourceTache,
  type StatutTache,
  type TacheVue,
  type TypeTache,
} from "./types";

/**
 * Mission 17 (partie A) : la lecture des tâches (écran /taches, badge, outils MCP). Rien n'est détecté ici : la liste se
 * sert en une requête (le badge aussi), les passages des détecteurs tiennent la table à jour (detection.ts).
 *
 * Un « Plus tard » dont la date est passée compte déjà comme revenu (en tête d'« Aujourd'hui ») sans attendre le
 * prochain passage du moteur, qui le remettra « à faire » (moteur.ts, étape 6).
 */

/** « Aujourd'hui » : les 10 premières tâches à faire hors lot ; le badge de l'onglet les compte. */
export const TACHES_AUJOURDHUI = 10;

const TYPES = TYPES_TACHE as readonly string[];

/** « Lucas », « Claude » ou « le CRM » : qui a répondu, pour une ligne lisible. */
export function reponduParLisible(acteur: string | null | undefined): string | null {
  if (!acteur) return null;
  const type = typeActeur(acteur);
  if (type === "HUMAIN") return "Lucas";
  if (type === "ASSISTANT") return "Claude";
  return "le CRM";
}

function raccourciDe(texte: string): Raccourci {
  const lu = lireObjet(texte);
  return typeof lu.genre === "string" && typeof lu.libelle === "string" ? (lu as unknown as Raccourci) : { genre: "PAGE", libelle: "Ouvrir", href: null };
}

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const parmi = <T extends string>(liste: readonly string[], valeur: string | null, defaut: T): T => (valeur && liste.includes(valeur) ? (valeur as T) : defaut);

export function versVue(ligne: TacheAFaire): TacheVue {
  return {
    id: ligne.id,
    cle: ligne.cle,
    type: parmi<TypeTache>(TYPES, ligne.type, "MANUELLE"),
    source: parmi<SourceTache>(SOURCES_TACHE, ligne.source, "MANUELLE"),
    sujetType: parmi<TacheVue["sujetType"]>(["LEAD", "DOSSIER", "CLIENT", "SYSTEME"], ligne.sujetType, "SYSTEME"),
    sujetId: ligne.sujetId,
    leadId: ligne.leadId,
    dossierId: ligne.dossierId,
    clientId: ligne.clientId,
    aClient: Boolean(ligne.dossierId || ligne.leadId),
    titre: ligne.titre,
    raison: ligne.raison,
    niveau: (Math.min(5, Math.max(1, Math.round(ligne.niveau))) || 3) as NiveauTache,
    montant: ligne.montant,
    depuis: ligne.depuis.toISOString(),
    echeance: iso(ligne.echeance),
    dureeMin: ligne.dureeMin,
    raccourci: raccourciDe(ligne.raccourci),
    donnees: lireObjet(ligne.donnees),
    lot: ligne.lot,
    lotLibelle: ligne.lotLibelle,
    statut: parmi<StatutTache>(STATUTS_TACHE, ligne.statut, "A_FAIRE"),
    reponse: ligne.reponse && (REPONSES_TACHE as readonly string[]).includes(ligne.reponse) ? (ligne.reponse as ReponseTache) : null,
    reponseRaison: ligne.reponseRaison,
    reponseTexte: ligne.reponseTexte,
    reponduLe: iso(ligne.reponduLe),
    reponduParLisible: reponduParLisible(ligne.reponduPar),
    plusTardJusqua: iso(ligne.plusTardJusqua),
    revenueLe: iso(ligne.revenueLe),
  };
}

/** Un « Plus tard » dont la date est passée : il est déjà là (le moteur le remettra « à faire » au prochain passage). */
function echue(v: Pick<TacheVue, "statut" | "plusTardJusqua">, maintenant: Date): boolean {
  return v.statut === "PLUS_TARD" && v.plusTardJusqua !== null && Date.parse(v.plusTardJusqua) <= maintenant.getTime();
}

/** Revenue aujourd'hui d'un « Plus tard » : en tête de la liste le jour de son retour. */
export function estRevenue(v: Pick<TacheVue, "statut" | "plusTardJusqua" | "revenueLe">, maintenant: Date): boolean {
  return echue(v, maintenant) || (v.revenueLe !== null && jourParis(v.revenueLe) === jourParis(maintenant));
}

/**
 * L'ordre de la liste (docs/TACHES.md § 3) : les tâches revenues aujourd'hui d'un « Plus tard » en tête, puis le
 * niveau (1 argent d'abord), le montant en jeu (le plus gros d'abord, sans montant en dernier), l'ancienneté (le plus
 * ancien d'abord). Pur : ne modifie pas le tableau reçu.
 */
export function trierTaches(vues: readonly TacheVue[], maintenant: Date): TacheVue[] {
  const revenue = new Map(vues.map((v) => [v.id, estRevenue(v, maintenant)]));
  return [...vues].sort((a, b) => {
    const ra = revenue.get(a.id) ? 0 : 1;
    const rb = revenue.get(b.id) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (a.niveau !== b.niveau) return a.niveau - b.niveau;
    if (a.montant !== b.montant) {
      if (a.montant === null) return 1;
      if (b.montant === null) return -1;
      return b.montant - a.montant;
    }
    const ancien = Date.parse(a.depuis) - Date.parse(b.depuis);
    return ancien !== 0 ? ancien : a.id.localeCompare(b.id);
  });
}

/** « 151 anciens leads à classer » : le libellé d'un lot se donne « singulier|pluriel » (sans barre : tel quel). */
export function libelleDuLot(nombre: number, lotLibelle: string | null, cle: string): string {
  const texte = lotLibelle?.trim() || cle;
  const [singulier, pluriel = singulier] = texte.split("|").map((t) => t.trim());
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`;
}

function lotsDe(vues: TacheVue[]): LotVue[] {
  const parLot = new Map<string, TacheVue[]>();
  for (const v of vues) if (v.lot) parLot.set(v.lot, [...(parLot.get(v.lot) ?? []), v]);
  return [...parLot.entries()]
    .map(([cle, liste]) => ({
      cle,
      libelle: libelleDuLot(liste.length, liste[0].lotLibelle, cle),
      nombre: liste.length,
      dureeMin: liste.reduce((s, v) => s + v.dureeMin, 0),
      types: [...new Set(liste.map((v) => v.type))],
    }))
    .sort((a, b) => b.nombre - a.nombre || a.cle.localeCompare(b.cle));
}

/** Ce qui est à faire maintenant, hors lot, dans l'ordre : « Aujourd'hui » en tête, le reste ensuite. */
function aFaireTriees(lignes: TacheAFaire[], maintenant: Date): TacheVue[] {
  const vues = lignes.map(versVue).filter((v) => !v.lot && (v.statut === "A_FAIRE" || echue(v, maintenant)));
  return trierTaches(vues, maintenant);
}

/**
 * La liste de l'écran (une requête) : « Aujourd'hui » (10 au plus), « Plus tard » (le reste des tâches à faire, puis
 * les reportées par date de retour), les lots (une ligne chacun), ce qui a été fait ou écarté depuis minuit (heure de
 * Paris, le plus récent d'abord), et le nombre de tâches qui reviennent demain.
 */
export async function listeTaches(maintenant: Date = new Date()): Promise<ListeTaches> {
  const minuit = aHeureParis(maintenant, 0, 0);
  const lignes = await prisma.tacheAFaire.findMany({
    where: { OR: [{ statut: { in: ["A_FAIRE", "PLUS_TARD"] } }, { statut: { in: ["FAITE", "PAS_A_FAIRE"] }, reponduLe: { gte: minuit } }] },
  });
  const vues = lignes.map(versVue);
  const triees = aFaireTriees(lignes, maintenant);
  const aujourdhui = triees.slice(0, TACHES_AUJOURDHUI);
  const reportees = vues
    .filter((v) => v.statut === "PLUS_TARD" && !echue(v, maintenant))
    .sort((a, b) => (a.plusTardJusqua ?? "9999").localeCompare(b.plusTardJusqua ?? "9999") || a.id.localeCompare(b.id));
  const plusTard = [...triees.slice(TACHES_AUJOURDHUI), ...reportees];
  const lots = lotsDe(vues.filter((v) => v.lot && (v.statut === "A_FAIRE" || echue(v, maintenant))));
  const faitAujourdhui = vues
    .filter((v) => (v.statut === "FAITE" || v.statut === "PAS_A_FAIRE") && v.reponduLe !== null)
    .sort((a, b) => (b.reponduLe ?? "").localeCompare(a.reponduLe ?? "") || a.id.localeCompare(b.id));
  const debutDemain = aHeureParis(maintenant, 1, 0).getTime();
  const finDemain = aHeureParis(maintenant, 2, 0).getTime();
  const demain = reportees.filter((v) => {
    const retour = v.plusTardJusqua ? Date.parse(v.plusTardJusqua) : NaN;
    return retour >= debutDemain && retour < finDemain;
  }).length;
  return {
    genereLe: maintenant.toISOString(),
    aujourdhui,
    plusTard,
    lots,
    faitAujourdhui,
    demain,
    compteurs: {
      aujourdhui: aujourdhui.length,
      plusTard: plusTard.length,
      enLot: lots.reduce((s, l) => s + l.nombre, 0),
      faitAujourdhui: faitAujourdhui.length,
      minutesAujourdhui: aujourdhui.reduce((s, v) => s + v.dureeMin, 0),
    },
  };
}

/** Le badge de l'onglet : les tâches d'« Aujourd'hui » (10 au plus). Une requête de comptage. */
export async function compterAujourdhui(maintenant: Date = new Date()): Promise<number> {
  const nombre = await prisma.tacheAFaire.count({ where: { lot: null, OR: [{ statut: "A_FAIRE" }, { statut: "PLUS_TARD", plusTardJusqua: { lte: maintenant } }] } });
  return Math.min(TACHES_AUJOURDHUI, nombre);
}

/**
 * « J'ai N minutes » : le meilleur ensemble qui tient, en parcourant les tâches du jour puis le reste dans l'ordre de la
 * liste (glouton : ce qui ne tient pas est sauté, la suivante est essayée) ; regroupé par famille (les appels ensemble,
 * les SMS ensemble) ou par type, dans l'ordre de la première tâche de chaque groupe : « 3 appels · 10 min ».
 */
export async function planMinutes(minutes: number, maintenant: Date = new Date()): Promise<PlanMinutes> {
  const lignes = await prisma.tacheAFaire.findMany({ where: { lot: null, statut: { in: ["A_FAIRE", "PLUS_TARD"] } } });
  const budget = Math.max(0, Math.floor(minutes));
  const retenues: TacheVue[] = [];
  let utilisees = 0;
  for (const v of aFaireTriees(lignes, maintenant)) {
    if (utilisees + v.dureeMin > budget) continue;
    retenues.push(v);
    utilisees += v.dureeMin;
  }
  const groupes = new Map<string, GroupeMinutes & { type: TypeTache }>();
  for (const v of retenues) {
    const famille = FAMILLE_GROUPE[v.type] ?? v.type;
    const groupe = groupes.get(famille) ?? { famille, libelle: "", nombre: 0, minutes: 0, ids: [], type: v.type };
    groupe.nombre++;
    groupe.minutes += v.dureeMin;
    groupe.ids.push(v.id);
    groupes.set(famille, groupe);
  }
  return {
    minutes: budget,
    utilisees,
    groupes: [...groupes.values()].map(({ type, ...g }) => {
      const [singulier, pluriel] = GROUPES_TYPE[type];
      return { ...g, libelle: `${g.nombre} ${g.nombre > 1 ? pluriel : singulier} · ${g.minutes} min` };
    }),
    taches: retenues,
  };
}

/**
 * Mission 17 (partie A, relecture) : les tâches d'un lot telles que la liste les compte (`lotsDe`) : à faire, ou
 * « Plus tard » échu. « Tout classer » (reponses.ts › classerLot) et « Revoir un par un » prennent les mêmes.
 */
export function filtreDuLot(lot: string, maintenant: Date) {
  return { lot, OR: [{ statut: "A_FAIRE" }, { statut: "PLUS_TARD", plusTardJusqua: { lte: maintenant } }] };
}

/** Les tâches à faire d'un lot (« Revoir un par un »), dans l'ordre de la liste. */
export async function tachesDuLot(lot: string, maintenant: Date = new Date()): Promise<TacheVue[]> {
  const lignes = await prisma.tacheAFaire.findMany({ where: filtreDuLot(lot, maintenant) });
  return trierTaches(lignes.map(versVue), maintenant);
}

/** Une tâche, telle que l'écran la lit ; null si elle n'existe pas ou a été retirée (archivée). */
export async function lireTache(id: string): Promise<TacheVue | null> {
  const ligne = await prisma.tacheAFaire.findUnique({ where: { id } });
  return ligne && !ligne.archiveLe ? versVue(ligne) : null;
}

/**
 * Mission 22 (A3) — les tâches d'un dossier, telles que l'écran Aujourd'hui les range : celles d'« Aujourd'hui » du
 * dossier d'abord (dans leur ordre), puis celles de « Plus tard » (à faire au-delà des dix, ou reportées). Hors lot.
 * Sert au panneau du dossier (« À faire ici », bouton principal) ; `GET /api/a-faire` reste tel quel.
 */
export async function tachesDuDossier(dossierId: string, maintenant: Date = new Date()): Promise<TacheVue[]> {
  const liste = await listeTaches(maintenant);
  return [...liste.aujourdhui, ...liste.plusTard].filter((t) => t.dossierId === dossierId);
}
