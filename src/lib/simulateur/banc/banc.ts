import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RenduBanc } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { estPhotoApres, idPhoto, lireFichier, lirePhotos } from "@/lib/dossiers/stockage";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { extensionDe, typeImage } from "@/lib/simulations/generation";
import { effacerImage } from "@/lib/simulations/images";
import { ecrireRenduOriginal } from "@/lib/simulations/rendu-original";
import { genererAvecMoteur, type SortiePipeline } from "@/lib/simulations/pipeline";
import { COUT_ESTIME_VISION_DOLLARS, coutEstime, type Qualite } from "@/lib/simulations/prix";
import type { EtapeTravail } from "@/lib/simulations/travaux-lecture";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement } from "@/lib/taches/registre";
import { resolveUploadsDir } from "@/lib/uploads";
import { dimensionsImage } from "../moteur/analyse-photo";
import type { DefautRendu } from "../moteur/types";
import { reglagesSimulateur, type ReglagesSimulateur } from "../reglages";
import { ZONES_SIMULATEUR, estIdPiece, estIdZone, type IdZone } from "../zones";
import { CAS_BANC, VARIANTES_BANC, estVarianteBanc, filmsDuCas, varianteBanc, type CasBanc, type VarianteBanc } from "./cas";

/**
 * Le banc de comparaison (mission 15, partie 3) : six photos de dossiers de
 * prod × trois variantes (V1 échantillons, V2 planche, V2 échantillons), par
 * le pipeline commun (`simulations/pipeline.ts`). Rien ne part sans le clic de
 * Lucas ; le coût est estimé AVANT (`estimerCampagne`) ; chaque rendu est une
 * tâche `SIMULATION_BANC` (voie longue), son résultat une ligne `RenduBanc`
 * (image sous `banc/<cas>/<variante>-<n>.jpg`, score, défauts, coût réel,
 * durée, prompt). Jamais de `SimulationEspace` : les rendus du banc ne sont
 * pas publiés dans les espaces clients. Ils comptent dans `GenerationImage`
 * (origine CRM, comme une génération du CRM).
 *
 * Tenue en ordre : la ligne et sa tâche naissent dans une même transaction ;
 * une ligne en attente ou en cours dont la tâche n'est plus vivante (annulée
 * depuis l'écran des tâches, échec hors du rendu) est basculée en ECHEC à la
 * relecture ou au lancement suivant, pour ne jamais bloquer son cas × variante.
 * Les images sont effacées après 30 jours (`purgerRendusBanc`, ligne gardée).
 */

export const TACHE_SIMULATION_BANC = "SIMULATION_BANC";
/** Comme SIMULATION_API : analyse + rendu + contrôle + seconde tentative tiennent dans 8 min. */
export const DELAI_TACHE_BANC_MS = 480_000;
export const DOSSIER_BANC = "banc";
/** Les images du banc vivent 30 jours sur le volume (comme les rendus du site) ; la ligne reste. */
export const RETENTION_BANC_MS = 30 * 24 * 60 * 60 * 1000;
export const MESSAGE_INTERROMPU_BANC = "Rendu interrompu par une mise à jour du service : relance ce rendu.";
export const MESSAGE_TACHE_PERDUE_BANC = "Tâche annulée ou perdue avant le rendu : relance ce rendu.";
export const RAISON_PHOTO_INTROUVABLE = "photo introuvable";
export const RAISON_DEJA_EN_COURS = "déjà en cours";

export type StatutRenduBanc = "EN_ATTENTE" | "EN_COURS" | "PRET" | "ECHEC";

export type RenduBancVue = {
  id: string;
  campagneId: string;
  cas: string;
  variante: VarianteBanc;
  statut: StatutRenduBanc;
  etape: string | null;
  moteur: string | null;
  qualite: string | null;
  coutEstime: number | null;
  /** Adresse de l'image (derrière la session), quand le rendu est prêt. */
  image: string | null;
  /** Dimensions de l'image (place réservée en plein écran), quand elles sont connues. */
  largeur: number | null;
  hauteur: number | null;
  score: number | null;
  defauts: DefautRendu[];
  tentatives: number | null;
  coutDollars: number | null;
  dureeMs: number | null;
  promptTexte: string | null;
  directionArtistique: string | null;
  erreur: string | null;
  le: string;
  termineLe: string | null;
};

export type CasBancVue = CasBanc & {
  /** La photo du dossier (adresse derrière la session, dimensions si lisibles), ou null : « photo introuvable », le cas n'est pas lancé. */
  photo: { url: string; vignette: string; largeur: number | null; hauteur: number | null } | null;
  films: number;
  zonesLibelles: string[];
};

export type EstimationBanc = {
  /** Cas lançables (photo trouvée) et rendus de la campagne complète. */
  cas: number;
  rendus: number;
  analyses: number;
  controles: number;
  /** Le rendu le moins et le plus cher de la campagne (« 18 × 0,21 à 0,35 $ »). */
  renduMin: number;
  renduMax: number;
  /** Une tentative par rendu, analyses et contrôles compris. */
  totalMin: number;
  /** Chaque rendu V2 demande une seconde tentative (et un second contrôle). */
  totalMax: number;
  parCas: Record<string, Record<VarianteBanc, number>>;
};

export type EtatBanc = {
  reglages: ReglagesSimulateur;
  variantes: typeof VARIANTES_BANC;
  cas: CasBancVue[];
  estimation: EstimationBanc;
  /** Les 200 derniers rendus (l'écran montre le dernier de chaque cas × variante) ; le total, lui, compte tout. */
  rendus: RenduBancVue[];
  total: {
    rendus: number;
    prets: number;
    enCours: number;
    echecs: number;
    /** Rendus et contrôles de tous les rendus + les analyses des photos du banc. */
    coutDollars: number;
    /** La part des analyses de photo (une par photo, payée à la première variante V2 qui la demande). */
    analysesDollars: number;
  };
};

type OptionsCas = { cas?: readonly CasBanc[] };

const arrondir = (n: number) => Math.round(n * 100) / 100;

/** La qualité d'une variante : medium pour le V1, la qualité de l'espace et du CRM (Paramètres) pour le V2. */
export function qualiteDeVariante(variante: VarianteBanc, reglages: ReglagesSimulateur): Qualite {
  const definition = varianteBanc(variante);
  return definition.qualite === "espace" ? reglages.qualiteEspace : definition.qualite;
}

/** Coût estimé d'un rendu (génération seule, une tentative) d'un cas dans une variante. */
export function coutRendu(cas: Pick<CasBanc, "zones">, variante: VarianteBanc, reglages: ReglagesSimulateur): number {
  return coutEstime(filmsDuCas(cas), qualiteDeVariante(variante, reglages));
}

/**
 * Le coût de la campagne, AVANT tout lancement (fonction pure) : une génération
 * par cas et par variante, une analyse par photo (V2, réutilisée entre les deux
 * variantes V2), un contrôle par rendu V2 ; au pire, une seconde tentative (et
 * un second contrôle) pour chaque rendu V2.
 */
export function estimerCampagne(cas: readonly Pick<CasBanc, "id" | "zones">[], reglages: ReglagesSimulateur): EstimationBanc {
  const parCas: Record<string, Record<VarianteBanc, number>> = {};
  const couts: number[] = [];
  let totalMin = 0;
  let totalMax = 0;
  let controles = 0;
  for (const c of cas) {
    parCas[c.id] = {} as Record<VarianteBanc, number>;
    for (const v of VARIANTES_BANC) {
      const cout = coutRendu(c, v.id, reglages);
      parCas[c.id][v.id] = cout;
      couts.push(cout);
      totalMin += cout;
      totalMax += v.moteur === "V2" ? 2 * cout : cout;
      if (v.moteur === "V2") controles += 1;
    }
  }
  const analyses = cas.length;
  return {
    cas: cas.length,
    rendus: cas.length * VARIANTES_BANC.length,
    analyses,
    controles,
    renduMin: couts.length ? Math.min(...couts) : 0,
    renduMax: couts.length ? Math.max(...couts) : 0,
    totalMin: arrondir(totalMin + (analyses + controles) * COUT_ESTIME_VISION_DOLLARS),
    totalMax: arrondir(totalMax + (analyses + 2 * controles) * COUT_ESTIME_VISION_DOLLARS),
    parCas,
  };
}

function lireDefautsJson(json: string | null | undefined): DefautRendu[] {
  if (!json) return [];
  try {
    const lu: unknown = JSON.parse(json);
    return Array.isArray(lu) ? (lu as DefautRendu[]).filter((d) => d && typeof d === "object" && typeof d.detail === "string") : [];
  } catch {
    return [];
  }
}

function lireZonesJson(json: string): { zone: IdZone; ref: string }[] {
  try {
    const lu: unknown = JSON.parse(json);
    return Array.isArray(lu) ? (lu as { zone: string; ref: string }[]).filter((z) => z && estIdZone(z.zone) && typeof z.ref === "string").map((z) => ({ zone: z.zone as IdZone, ref: z.ref })) : [];
  } catch {
    return [];
  }
}

function versVue(r: RenduBanc): RenduBancVue {
  return {
    id: r.id,
    campagneId: r.campagneId,
    cas: r.cas,
    variante: r.variante as VarianteBanc,
    statut: r.statut as StatutRenduBanc,
    etape: r.etape,
    moteur: r.moteur,
    qualite: r.qualite,
    coutEstime: r.coutEstime,
    image: r.chemin ? `/api/simulateur/banc/${r.id}/image` : null,
    largeur: r.largeur,
    hauteur: r.hauteur,
    score: r.score,
    defauts: lireDefautsJson(r.defauts),
    tentatives: r.tentatives,
    coutDollars: r.coutDollars,
    dureeMs: r.dureeMs,
    promptTexte: r.promptTexte,
    directionArtistique: r.directionArtistique,
    erreur: r.erreur,
    le: r.createdAt.toISOString(),
    termineLe: r.termineLe?.toISOString() ?? null,
  };
}

/** Le chemin (relatif au volume) de la photo d'un cas, ou null si le dossier ou la photo est introuvable. */
export async function photoDuCas(cas: Pick<CasBanc, "dossierId" | "photoId">): Promise<string | null> {
  const dossier = await prisma.dossier.findUnique({ where: { id: cas.dossierId }, select: { photos: true, archiveLe: true } });
  if (!dossier || dossier.archiveLe) return null;
  return lirePhotos(dossier.photos).find((c) => idPhoto(c) === cas.photoId && !estPhotoApres(c)) ?? null;
}

/** Les dimensions des photos des cas, lues une fois par chemin (la page se relit toutes les 5 s ; une photo ne change pas). */
const dimensionsConnues = new Map<string, Promise<{ largeur: number; hauteur: number } | null>>();
function dimensionsPhoto(chemin: string): Promise<{ largeur: number; hauteur: number } | null> {
  let promesse = dimensionsConnues.get(chemin);
  if (!promesse) {
    promesse = dimensionsImage(path.join(path.resolve(resolveUploadsDir()), chemin));
    dimensionsConnues.set(chemin, promesse);
  }
  return promesse;
}

async function casVues(cas: readonly CasBanc[]): Promise<CasBancVue[]> {
  return Promise.all(
    cas.map(async (c) => {
      const chemin = await photoDuCas(c);
      const dims = chemin ? await dimensionsPhoto(chemin) : null;
      return {
        ...c,
        photo: chemin ? { url: `/api/dossiers/${c.dossierId}/photos/${c.photoId}`, vignette: `/api/dossiers/${c.dossierId}/photos/${c.photoId}?taille=vignette`, largeur: dims?.largeur ?? null, hauteur: dims?.hauteur ?? null } : null,
        films: filmsDuCas(c),
        zonesLibelles: c.zones.map((z) => `${ZONES_SIMULATEUR[z.zone].libelle} ${z.ref}`),
      };
    })
  );
}

/**
 * Remet en ordre les lignes en attente ou en cours dont la tâche `banc:<id>`
 * n'est plus vivante (annulée depuis l'écran des tâches, échec hors du rendu,
 * tâche jamais créée) : ECHEC « tâche annulée ou perdue », pour que le cas ×
 * variante ne reste pas bloqué « déjà en cours ». Rend le nombre de lignes
 * basculées. Une tâche vivante (même en retard) est laissée à l'exécuteur.
 */
export async function remettreEnOrdreBanc(): Promise<number> {
  const vivants = await prisma.renduBanc.findMany({ where: { statut: { in: ["EN_ATTENTE", "EN_COURS"] } }, select: { id: true, demarreLe: true } });
  if (vivants.length === 0) return 0;
  const taches = await prisma.tache.findMany({ where: { cle: { in: vivants.map((r) => `banc:${r.id}`) } }, select: { cle: true, statut: true } });
  const actives = new Set(taches.filter((t) => t.statut === "EN_ATTENTE" || t.statut === "EN_COURS").map((t) => t.cle));
  let bascules = 0;
  for (const r of vivants) {
    if (actives.has(`banc:${r.id}`)) continue;
    const { count } = await prisma.renduBanc.updateMany({
      where: { id: r.id, statut: { in: ["EN_ATTENTE", "EN_COURS"] } },
      data: { statut: "ECHEC", erreur: MESSAGE_TACHE_PERDUE_BANC, termineLe: new Date(), dureeMs: r.demarreLe ? Date.now() - r.demarreLe.getTime() : null },
    });
    bascules += count;
  }
  if (bascules > 0) console.warn(`[banc] ${bascules} rendu(s) sans tâche vivante basculé(s) en échec`);
  return bascules;
}

/**
 * Le total de la campagne, compté en base sur TOUS les rendus (pas seulement
 * les 200 relus), analyses comprises. Les lignes archivées par la purge (image
 * effacée) comptent toujours : le score et le coût sont gardés.
 */
async function totalBanc(): Promise<EtatBanc["total"]> {
  const [parStatut, premier, dossiers] = await Promise.all([
    prisma.renduBanc.groupBy({ by: ["statut"], where: { ...AVEC_ARCHIVES }, _count: { _all: true }, _sum: { coutDollars: true } }),
    prisma.renduBanc.aggregate({ where: { ...AVEC_ARCHIVES }, _min: { createdAt: true } }),
    prisma.renduBanc.findMany({ where: { ...AVEC_ARCHIVES }, distinct: ["dossierId"], select: { dossierId: true } }),
  ]);
  const compte = (statuts: StatutRenduBanc[]) => parStatut.filter((g) => statuts.includes(g.statut as StatutRenduBanc)).reduce((s, g) => s + g._count._all, 0);
  const rendusDollars = parStatut.reduce((s, g) => s + (g._sum.coutDollars ?? 0), 0);
  // Les analyses des photos du banc : les appels vision « analyse » au CRM sur ses dossiers depuis le premier rendu
  // (une analyse déjà connue avant la campagne n'a rien coûté au banc et n'est pas comptée).
  const analyses =
    premier._min.createdAt && dossiers.length
      ? await prisma.generationImage.aggregate({ _sum: { coutDollars: true }, where: { origine: "CRM", phase: "analyse", statut: "REUSSI", dossierId: { in: dossiers.map((d) => d.dossierId) }, createdAt: { gte: premier._min.createdAt } } })
      : null;
  const analysesDollars = analyses?._sum.coutDollars ?? 0;
  return {
    rendus: compte(["EN_ATTENTE", "EN_COURS", "PRET", "ECHEC"]),
    prets: compte(["PRET"]),
    enCours: compte(["EN_ATTENTE", "EN_COURS"]),
    echecs: compte(["ECHEC"]),
    coutDollars: arrondir(rendusDollars + analysesDollars),
    analysesDollars: arrondir(analysesDollars),
  };
}

/** Tout ce que la page du banc affiche (relue toutes les 5 s). */
export async function etatBanc(options: OptionsCas = {}): Promise<EtatBanc> {
  const definitions = options.cas ?? CAS_BANC;
  await remettreEnOrdreBanc();
  // Les rendus purgés (image effacée, ligne archivée) restent listés : score, coût, durée et prompt sont gardés.
  const [reglages, cas, lignes, total] = await Promise.all([reglagesSimulateur(), casVues(definitions), prisma.renduBanc.findMany({ where: { ...AVEC_ARCHIVES }, orderBy: { createdAt: "desc" }, take: 200 }), totalBanc()]);
  return {
    reglages,
    variantes: VARIANTES_BANC,
    cas,
    estimation: estimerCampagne(
      cas.filter((c) => c.photo),
      reglages
    ),
    rendus: lignes.map(versVue),
    total,
  };
}

export type LancementBanc = {
  campagneId: string;
  lances: RenduBancVue[];
  ignores: { cas: string; variante: VarianteBanc | null; raison: string }[];
};

/**
 * Lance la campagne (tous les cas × toutes les variantes), un seul cas, une
 * seule variante, ou un cas dans une variante : une ligne `RenduBanc` en attente
 * et une tâche par rendu. Un cas sans photo est ignoré (« photo introuvable ») ;
 * un rendu déjà en attente ou en cours pour le même cas et la même variante
 * n'est pas doublé.
 */
export async function lancerBanc(selection: { cas?: string | null; variante?: string | null } = {}, options: OptionsCas = {}): Promise<LancementBanc> {
  const definitions = options.cas ?? CAS_BANC;
  const casChoisis = selection.cas ? definitions.filter((c) => c.id === selection.cas) : definitions;
  if (selection.cas && casChoisis.length === 0) throw new ErreurMetier("Cas inconnu.", 400);
  if (selection.variante && !estVarianteBanc(selection.variante)) throw new ErreurMetier("Variante inconnue.", 400);
  const variantes = selection.variante ? VARIANTES_BANC.filter((v) => v.id === selection.variante) : VARIANTES_BANC;
  const reglages = await reglagesSimulateur();
  const campagneId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const lances: RenduBancVue[] = [];
  const ignores: LancementBanc["ignores"] = [];
  const lancables: CasBanc[] = [];
  for (const c of casChoisis) {
    if (await photoDuCas(c)) lancables.push(c);
    else ignores.push({ cas: c.id, variante: null, raison: RAISON_PHOTO_INTROUVABLE });
  }
  // Une ligne en attente ou en cours sans tâche vivante ne bloque pas son cas × variante.
  await remettreEnOrdreBanc();
  // Variante par variante (et non cas par cas) : les deux places de la voie longue ne traitent pas en même temps les
  // deux variantes V2 d'une même photo — son analyse est faite une fois, puis réutilisée (empreinte).
  for (const v of variantes) {
    for (const c of lancables) {
      const enCours = await prisma.renduBanc.count({ where: { cas: c.id, variante: v.id, statut: { in: ["EN_ATTENTE", "EN_COURS"] } } });
      if (enCours > 0) {
        ignores.push({ cas: c.id, variante: v.id, raison: RAISON_DEJA_EN_COURS });
        continue;
      }
      const qualite = qualiteDeVariante(v.id, reglages);
      // La ligne et sa tâche dans une même transaction : l'une n'existe jamais sans l'autre.
      const rendu = await prisma.$transaction(async (tx) => {
        const cree = await tx.renduBanc.create({
          data: { campagneId, cas: c.id, variante: v.id, dossierId: c.dossierId, photoId: c.photoId, piece: c.piece, zones: JSON.stringify(c.zones), moteur: v.moteur, qualite, coutEstime: coutEstime(filmsDuCas(c), qualite) },
        });
        await mettreEnFile({ type: TACHE_SIMULATION_BANC, cle: `banc:${cree.id}`, charge: { renduId: cree.id }, priorite: 6, tentativesMax: 1 }, tx);
        return cree;
      });
      lances.push(versVue(rendu));
    }
  }
  return { campagneId, lances, ignores };
}

/** Un nom de fichier libre sous banc/<cas>/ : <variante>-<n>.<ext>, n = rang du rendu de ce cas dans cette variante. */
async function cheminLibre(cas: string, variante: string, extension: string): Promise<string> {
  const base = path.resolve(resolveUploadsDir());
  let n = (await prisma.renduBanc.count({ where: { ...AVEC_ARCHIVES, cas, variante, chemin: { not: null } } })) + 1;
  for (;;) {
    const relatif = path.posix.join(DOSSIER_BANC, cas, `${variante}-${n}.${extension}`);
    try {
      await fs.access(path.join(base, relatif));
      n += 1;
    } catch {
      return relatif;
    }
  }
}

/** La tâche SIMULATION_BANC : un rendu, par le pipeline commun, jamais rappelé si la tâche est reprise. */
export async function executerRenduBanc(renduId: string, signal?: AbortSignal): Promise<{ statut: StatutRenduBanc }> {
  const r = await prisma.renduBanc.findUnique({ where: { id: renduId } });
  if (!r) return { statut: "ECHEC" };
  if (r.statut === "PRET" || r.statut === "ECHEC") return { statut: r.statut };
  let demarre: number | null = r.demarreLe?.getTime() ?? null;
  /** Pose l'échec ; le coût et les tentatives sont donnés quand OpenAI a déjà été payé (persistance ratée). */
  const echouer = async (message: string, paye?: { coutDollars: number; tentatives: number }) => {
    await prisma.renduBanc.update({ where: { id: r.id }, data: { statut: "ECHEC", erreur: message.slice(0, 500), termineLe: new Date(), dureeMs: demarre ? Date.now() - demarre : null, ...(paye ?? {}) } });
    return { statut: "ECHEC" as const };
  };
  const variante = estVarianteBanc(r.variante) ? varianteBanc(r.variante) : null;
  if (!variante) return echouer("Variante inconnue.");
  const zones = lireZonesJson(r.zones);
  if (zones.length === 0) return echouer("Aucune zone connue dans ce rendu.");
  if (!estIdPiece(r.piece)) return echouer("Pièce inconnue.");
  const piece = r.piece;
  const chemin = await photoDuCas(r);
  const photo = chemin ? await lireFichier(chemin) : null;
  if (!photo) return echouer("Photo introuvable sur le serveur.");

  // Comme SIMULATION_API : le départ est posé d'un seul geste, seulement si le rendu attend encore. Un rendu déjà
  // démarré (tâche réclamée une seconde fois après un redéploiement) échoue sans rappeler OpenAI.
  demarre = Date.now();
  const { count } = await prisma.renduBanc.updateMany({ where: { id: r.id, statut: "EN_ATTENTE" }, data: { statut: "EN_COURS", demarreLe: new Date(demarre), etape: variante.moteur === "V2" ? "analyse" : "rendu" } });
  if (count !== 1) return echouer(MESSAGE_INTERROMPU_BANC);
  const surEtape = async (etape: EtapeTravail) => {
    await prisma.renduBanc.updateMany({ where: { id: r.id, statut: "EN_COURS" }, data: { etape } }).catch(() => undefined);
  };
  const reglages = await reglagesSimulateur();
  const qualite = qualiteDeVariante(variante.id, reglages);
  let resultat: SortiePipeline;
  try {
    resultat = await genererAvecMoteur({
      photo,
      piece,
      zones,
      origine: "CRM",
      reglages: { ...reglages, moteur: variante.moteur, planche: variante.planche },
      qualite,
      dossierId: r.dossierId,
      echeance: demarre + DELAI_TACHE_BANC_MS,
      surEtape,
      signal,
      // Mission 23 (L4a) : le banc mesure toujours la fidélité des teintes (c'est son rôle), réglage de correction ou non.
      mesurerFidelite: true,
    });
  } catch (erreur) {
    return echouer(erreur instanceof Error ? erreur.message : "Génération impossible.");
  }
  if (!resultat.ok) return echouer(`${resultat.message} (${resultat.raison})`);

  // Le rendu est PAYÉ : si l'image ne peut pas être écrite (volume plein, base indisponible), la ligne passe en ECHEC
  // avec le coût réel, jamais laissée EN_COURS (ce qui bloquerait le cas × variante).
  const paye = { coutDollars: resultat.coutTotalDollars, tentatives: resultat.tentatives };
  try {
    const relatif = await cheminLibre(r.cas, r.variante, extensionDe(resultat.type ?? typeImage(resultat.image)));
    const absolu = path.join(path.resolve(resolveUploadsDir()), relatif);
    await fs.mkdir(path.dirname(absolu), { recursive: true });
    await fs.writeFile(absolu, resultat.image);
    const renduOriginal = await ecrireRenduOriginal(relatif, resultat.imageOriginale);
    const dims = await dimensionsImage(resultat.image);
    await prisma.renduBanc.update({
      where: { id: r.id },
      data: {
        statut: "PRET",
        etape: "rendu",
        chemin: relatif,
        largeur: dims?.largeur ?? null,
        hauteur: dims?.hauteur ?? null,
        moteur: resultat.moteur,
        qualite,
        score: resultat.scoreControle,
        defauts: resultat.defautsControle ? JSON.stringify(resultat.defautsControle) : null,
        ...paye,
        dureeMs: Date.now() - demarre,
        promptTexte: resultat.prompt,
        directionArtistique: resultat.directionArtistique,
        fidelite: resultat.fidelite ? JSON.stringify(resultat.fidelite) : null,
        renduOriginal,
        termineLe: new Date(),
      },
    });
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : "Enregistrement du rendu impossible.";
    console.error(`[banc] ${r.cas} · ${r.variante} : rendu payé (${resultat.coutTotalDollars} $) mais non enregistré :`, message);
    return echouer(`Rendu payé mais non enregistré (${message}).`, paye);
  }
  console.log(`[banc] ${r.cas} · ${r.variante} : prêt en ${Math.round((Date.now() - demarre) / 1000)} s, ${resultat.coutTotalDollars} $${resultat.scoreControle !== null ? `, contrôle ${resultat.scoreControle}/10` : ""}`);
  return { statut: "PRET" };
}

/**
 * Purge à 30 jours (comme les rendus du site et les analyses) : l'image est
 * effacée du volume, la ligne reste (score, coût, durée, prompt) avec
 * `chemin: null` et le motif d'archivage. Appelée par la purge opportuniste du
 * simulateur (`site/simulations.ts › purgerSiNecessaire`). Rend le nombre de
 * lignes archivées.
 */
export async function purgerRendusBanc(maintenant: Date = new Date()): Promise<number> {
  const limite = new Date(maintenant.getTime() - RETENTION_BANC_MS);
  const perimes = await prisma.renduBanc.findMany({ where: { archiveLe: null, chemin: { not: null }, statut: { in: ["PRET", "ECHEC"] }, createdAt: { lt: limite } }, take: 200, select: { id: true, chemin: true, renduOriginal: true } });
  for (const r of perimes) {
    await effacerImage(r.chemin);
    if (r.renduOriginal) await effacerImage(r.renduOriginal);
    await prisma.renduBanc.update({ where: { id: r.id }, data: { chemin: null, renduOriginal: null, archiveLe: maintenant, archiveMotif: "Rendu du banc de plus de 30 jours : image effacée" } });
  }
  return perimes.length;
}

/** L'image d'un rendu prêt (servie derrière la session). */
export async function imageRenduBanc(id: string): Promise<{ contenu: Buffer; type: string }> {
  const r = await prisma.renduBanc.findUnique({ where: { id }, select: { chemin: true } });
  if (!r?.chemin) throw new ErreurMetier("Rendu introuvable.", 404);
  const base = path.resolve(resolveUploadsDir());
  const absolu = path.resolve(base, r.chemin);
  if (!absolu.startsWith(base + path.sep)) throw new ErreurMetier("Chemin de fichier invalide.", 400);
  try {
    const contenu = await fs.readFile(absolu);
    return { contenu, type: typeImage(contenu) };
  } catch {
    throw new ErreurMetier("Image introuvable.", 404);
  }
}

export function enregistrerTachesBanc(): void {
  enregistrerTraitement(TACHE_SIMULATION_BANC, {
    libelle: "Simulateur : rendu du banc de comparaison",
    acteur: "SYSTEME:simulateur-banc",
    tentativesMax: 1,
    delaiMaxMs: DELAI_TACHE_BANC_MS,
    voie: "longue",
    executer: async (charge, { signal }) => executerRenduBanc((charge as { renduId: string }).renduId, signal),
  });
}
