import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { pluriel } from "@/lib/commun/format";
import { zipEnFlux, type EntreeZip } from "@/lib/exports/zip";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Mission 23 (L1) — le jeu d'essai du simulateur : les N simulations les plus récentes du site (`SimulationSite`) et
 * des espaces (`SimulationEspace`), chacune avec sa photo avant, son rendu et ce qu'on sait de sa génération (zones et
 * références du catalogue, moteur, modèle au mieux, contrôle). Le gérant le télécharge en zip depuis Paramètres ›
 * Simulateur ; c'est la seule source de vraies photos du calibrage des teintes.
 *
 * Aucune donnée de contact : ni lead, ni parcours, ni dossier, ni espace, ni IP, ni nom, ni commentaire, ni chemin
 * disque d'origine. Les identifiants sont opaques (12 caractères d'un sha256 de l'id : stables d'un export à l'autre).
 * Aucune écriture ici, sauf la trace de l'export (`tracerExportJeuEssai`).
 */

export const VERSION_FORMAT_JEU = 1;
export const N_JEU_PAR_DEFAUT = 150;
export const N_JEU_MAX = 300;
/** Marge autour de la durée d'une simulation du site pour y retrouver sa génération (`GenerationImage`). */
const MARGE_HORODATAGE_MS = 2_000;
/** Lignes lues par origine : de quoi remplacer les lignes illisibles sans tout lire. */
const lecturesParOrigine = (n: number) => 3 * n + 50;

export type RaisonIgnoree = "sans-avant" | "avant-illisible" | "sans-rendu" | "rendu-illisible";
export type ZoneJeu = { zone: string; libelle: string; ref: string; nom: string };

export type MetaJeu = {
  id: string;
  origine: "site" | "espace";
  projet?: string | null;
  typeSurface?: string | null;
  /** Espace seulement : SITE, API, CHATGPT, MANUEL, CLIENT. */
  source?: string;
  zones: ZoneJeu[];
  moteur: string | null;
  modele: string | null;
  modeleSource: "preparation" | "horodatage" | "inconnu";
  scoreControle: number | null;
  defautsControle: unknown;
  tentatives: number | null;
  dureeMs: number | null;
  creeLe: string;
  /** Vrai sur la pièce d'exemple du site : l'avant n'est pas une photo de client. */
  exemple: boolean;
  promptTexte: string | null;
  fichiers: { avant: string; rendu: string };
};

export type SimulationJeu = { meta: MetaJeu; avant: string; rendu: string };

export type ManifesteJeu = {
  format: number;
  genereLe: string;
  nDemande: number;
  nExporte: number;
  parOrigine: { site: number; espace: number };
  ignorees: { total: number; parRaison: Record<RaisonIgnoree, number> };
  /** Simulations du site recopiées dans un espace : gardées une fois, sur la ligne du site. */
  doublonsEcartes: number;
  candidatsLus: number;
  contenu: string;
};

export type JeuEssai = { manifeste: ManifesteJeu; simulations: SimulationJeu[] };

/** L'identifiant opaque d'une simulation : 12 caractères hexadécimaux du sha256 de son id. */
export const idOpaque = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);

function lireZonesBrutes(json: string | null | undefined): ZoneJeu[] {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((z): z is Record<string, unknown> => Boolean(z) && typeof z === "object" && typeof (z as { ref?: unknown }).ref === "string")
      .map((z) => ({ zone: String(z.zone ?? ""), libelle: String(z.libelle ?? ""), ref: String(z.ref), nom: String(z.nom ?? "") }));
  } catch {
    return [];
  }
}

function lireJson(json: string | null | undefined): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/** Le chemin absolu d'un fichier du répertoire d'upload ; null s'il en sort. */
function cheminSur(relatif: string): string | null {
  const base = path.resolve(resolveUploadsDir());
  const complet = path.resolve(base, relatif);
  return complet.startsWith(base + path.sep) ? complet : null;
}

async function lisible(relatif: string): Promise<boolean> {
  const complet = cheminSur(relatif);
  if (!complet) return false;
  try {
    const s = await fs.stat(complet);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

const extensionDe = (relatif: string) => {
  const e = path.posix.extname(relatif).slice(1).toLowerCase();
  return e === "png" ? "png" : e === "webp" ? "webp" : "jpg";
};

type Candidat = {
  idBrut: string;
  origine: "site" | "espace";
  creeLe: Date;
  avant: string | null;
  rendu: string | null;
  dureeMs: number | null;
  preparationId: string | null;
  meta: Omit<MetaJeu, "id" | "origine" | "modele" | "modeleSource" | "fichiers" | "creeLe" | "dureeMs">;
};

async function candidatsDuSite(prise: number, maintenant: Date): Promise<Candidat[]> {
  const lignes = await prisma.simulationSite.findMany({
    where: { createdAt: { lte: maintenant } },
    orderBy: { createdAt: "desc" },
    take: prise,
    select: { id: true, createdAt: true, projet: true, references: true, imageBeforePath: true, imageAfterPath: true, simulationId: true, dureeMs: true, moteur: true, promptTexte: true, scoreControle: true, defautsControle: true, tentatives: true, exemple: true },
  });
  // Rattachée à un lead : les fichiers ont été déplacés sur la Simulation du lead (comme `cheminsImagesTravail`).
  const aRelire = lignes.filter((l) => !l.imageAfterPath && l.simulationId).map((l) => l.simulationId!);
  const rattachees = aRelire.length ? await prisma.simulation.findMany({ where: { ...AVEC_ARCHIVES, id: { in: aRelire } }, select: { id: true, imageBeforePath: true, imageAfterPath: true } }) : [];
  const parId = new Map(rattachees.map((s) => [s.id, s]));
  return lignes.map((l) => {
    const r = !l.imageAfterPath && l.simulationId ? parId.get(l.simulationId) : undefined;
    return {
      idBrut: l.id,
      origine: "site",
      creeLe: l.createdAt,
      avant: r ? r.imageBeforePath : l.imageBeforePath,
      rendu: r ? r.imageAfterPath : l.imageAfterPath,
      dureeMs: l.dureeMs,
      preparationId: null,
      meta: { projet: l.projet, zones: lireZonesBrutes(l.references), moteur: l.moteur, scoreControle: l.scoreControle, defautsControle: lireJson(l.defautsControle), tentatives: l.tentatives, exemple: Boolean(l.exemple), promptTexte: l.promptTexte },
    };
  });
}

async function candidatsDesEspaces(prise: number, maintenant: Date): Promise<{ candidats: Candidat[]; doublons: number }> {
  const lignes = await prisma.simulationEspace.findMany({
    where: { createdAt: { lte: maintenant } },
    orderBy: { createdAt: "desc" },
    take: prise,
    select: { id: true, createdAt: true, chemin: true, photoAvant: true, typeSurface: true, zones: true, source: true, preparationId: true, simulationId: true, moteur: true, promptTexte: true, scoreControle: true, defautsControle: true, tentatives: true, exemple: true },
  });
  // Recopiée du site par `synchroniserSimulationsSite` : la ligne du site la porte déjà.
  const simulationIds = [...new Set(lignes.map((l) => l.simulationId).filter((id): id is string => Boolean(id)))];
  const duSite = simulationIds.length ? await prisma.simulationSite.findMany({ where: { simulationId: { in: simulationIds } }, select: { simulationId: true } }) : [];
  const couvertes = new Set(duSite.map((s) => s.simulationId));
  const gardees = lignes.filter((l) => !(l.simulationId && couvertes.has(l.simulationId)));
  return {
    doublons: lignes.length - gardees.length,
    candidats: gardees.map((l) => ({
      idBrut: l.id,
      origine: "espace",
      creeLe: l.createdAt,
      avant: l.photoAvant,
      rendu: l.chemin,
      dureeMs: null,
      preparationId: l.preparationId,
      meta: { typeSurface: l.typeSurface, source: l.source, zones: lireZonesBrutes(l.zones), moteur: l.moteur, scoreControle: l.scoreControle, defautsControle: lireJson(l.defautsControle), tentatives: l.tentatives, exemple: Boolean(l.exemple), promptTexte: l.promptTexte },
    })),
  };
}

/** Le modèle d'image de chaque simulation retenue, au mieux : par la préparation (espace), par l'horodatage (site). */
async function modeles(retenus: Candidat[]): Promise<Map<string, { modele: string | null; source: MetaJeu["modeleSource"] }>> {
  const sortie = new Map<string, { modele: string | null; source: MetaJeu["modeleSource"] }>();
  const preparations = [...new Set(retenus.map((c) => c.preparationId).filter((id): id is string => Boolean(id)))];
  if (preparations.length) {
    const gens = await prisma.generationImage.findMany({ where: { preparationId: { in: preparations }, phase: "rendu" }, orderBy: { createdAt: "asc" }, select: { preparationId: true, modele: true, statut: true } });
    const parPreparation = new Map<string, string>();
    // La dernière génération réussie l'emporte ; à défaut, la dernière tout court.
    for (const g of gens) if (g.preparationId && (g.statut === "REUSSI" || !parPreparation.has(g.preparationId))) parPreparation.set(g.preparationId, g.modele);
    for (const c of retenus) if (c.preparationId && parPreparation.has(c.preparationId)) sortie.set(c.idBrut, { modele: parPreparation.get(c.preparationId)!, source: "preparation" });
  }
  const duSite = retenus.filter((c) => c.origine === "site" && c.dureeMs && c.dureeMs > 0);
  if (duSite.length) {
    const fenetre = (c: Candidat) => ({ du: c.creeLe.getTime() - c.dureeMs! - MARGE_HORODATAGE_MS, au: c.creeLe.getTime() + MARGE_HORODATAGE_MS });
    const du = Math.min(...duSite.map((c) => fenetre(c).du));
    const au = Math.max(...duSite.map((c) => fenetre(c).au));
    const gens = await prisma.generationImage.findMany({ where: { origine: "SITE", phase: "rendu", createdAt: { gte: new Date(du), lte: new Date(au) } }, select: { createdAt: true, modele: true, statut: true } });
    for (const c of duSite) {
      const f = fenetre(c);
      const dedans = gens.filter((g) => g.createdAt.getTime() >= f.du && g.createdAt.getTime() <= f.au);
      const reussies = dedans.filter((g) => g.statut === "REUSSI");
      const parmi = reussies.length ? reussies : dedans;
      const proche = parmi.sort((a, b) => Math.abs(a.createdAt.getTime() - c.creeLe.getTime()) - Math.abs(b.createdAt.getTime() - c.creeLe.getTime()))[0];
      if (proche) sortie.set(c.idBrut, { modele: proche.modele, source: "horodatage" });
    }
  }
  return sortie;
}

/**
 * Les N simulations les plus récentes, toutes origines confondues, dont l'avant et le rendu sont lisibles : une ligne
 * sans avant ou sans rendu lisible est ignorée et comptée (raison), et la suivante prend sa place.
 */
export async function collecterJeuEssai({ n = N_JEU_PAR_DEFAUT, maintenant = new Date() }: { n?: number; maintenant?: Date } = {}): Promise<JeuEssai> {
  const voulu = Math.max(1, Math.min(N_JEU_MAX, Math.floor(n)));
  const prise = lecturesParOrigine(voulu);
  const [site, espaces] = await Promise.all([candidatsDuSite(prise, maintenant), candidatsDesEspaces(prise, maintenant)]);
  const tous = [...site, ...espaces.candidats].sort((a, b) => b.creeLe.getTime() - a.creeLe.getTime() || a.idBrut.localeCompare(b.idBrut));
  const parRaison: Record<RaisonIgnoree, number> = { "sans-avant": 0, "avant-illisible": 0, "sans-rendu": 0, "rendu-illisible": 0 };
  const retenus: Candidat[] = [];
  let lus = 0;
  for (const c of tous) {
    if (retenus.length >= voulu) break;
    lus++;
    const raison: RaisonIgnoree | null = !c.rendu ? "sans-rendu" : !(await lisible(c.rendu)) ? "rendu-illisible" : !c.avant ? "sans-avant" : !(await lisible(c.avant)) ? "avant-illisible" : null;
    if (raison) parRaison[raison]++;
    else retenus.push(c);
  }
  const parModele = await modeles(retenus);
  const simulations: SimulationJeu[] = retenus.map((c) => {
    const id = idOpaque(c.idBrut);
    const m = parModele.get(c.idBrut);
    const fichiers = { avant: `avant.${extensionDe(c.avant!)}`, rendu: `rendu.${extensionDe(c.rendu!)}` };
    return {
      avant: c.avant!,
      rendu: c.rendu!,
      meta: { id, origine: c.origine, ...c.meta, modele: m?.modele ?? null, modeleSource: m?.source ?? "inconnu", dureeMs: c.dureeMs, creeLe: c.creeLe.toISOString(), fichiers },
    };
  });
  const ignorees = Object.values(parRaison).reduce((s, x) => s + x, 0);
  return {
    simulations,
    manifeste: {
      format: VERSION_FORMAT_JEU,
      genereLe: maintenant.toISOString(),
      nDemande: voulu,
      nExporte: simulations.length,
      parOrigine: { site: simulations.filter((s) => s.meta.origine === "site").length, espace: simulations.filter((s) => s.meta.origine === "espace").length },
      ignorees: { total: ignorees, parRaison },
      doublonsEcartes: espaces.doublons,
      candidatsLus: lus,
      contenu: "Par simulation : <id>/avant.(jpg|png|webp), <id>/rendu.(jpg|png|webp), <id>/meta.json. Identifiants opaques (sha256 tronqué de l'id), aucune donnée de contact.",
    },
  };
}

/** Le zip du jeu : manifest.json, puis avant, rendu et meta.json de chaque simulation, lus un à un. */
export function fluxJeuEssai(jeu: JeuEssai): ReadableStream<Uint8Array> {
  const date = new Date(jeu.manifeste.genereLe);
  function* entrees(): Generator<EntreeZip> {
    yield { nom: "manifest.json", contenu: Buffer.from(JSON.stringify(jeu.manifeste, null, 2), "utf8"), date };
    for (const s of jeu.simulations) {
      const lire = (relatif: string) => async () => {
        const complet = cheminSur(relatif);
        if (!complet) throw new Error("Jeu d'essai : chemin d'image invalide.");
        return fs.readFile(complet);
      };
      yield { nom: `${s.meta.id}/${s.meta.fichiers.avant}`, contenu: lire(s.avant), date };
      yield { nom: `${s.meta.id}/${s.meta.fichiers.rendu}`, contenu: lire(s.rendu), date };
      yield { nom: `${s.meta.id}/meta.json`, contenu: Buffer.from(JSON.stringify(s.meta, null, 2), "utf8"), date };
    }
  }
  return zipEnFlux(entrees());
}

/** Le nom du fichier téléchargé : jeu-essai-simulateur-AAAA-MM-JJ.zip (jour de Paris). */
export function nomFichierJeu(maintenant: Date): string {
  const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(maintenant);
  return `jeu-essai-simulateur-${jour}.zip`;
}

/** Sessions « ECRAN » du registre des appels : les gestes faits depuis l'écran, pas par l'assistant. */
export const SESSION_ECRAN = "ECRAN";
export const OUTIL_EXPORT_JEU = "export_jeu_essai";

/**
 * Trace de l'export (qui, quand, combien) : une ligne datée du registre des appels (`AppelOutil`, session « ECRAN »),
 * relue par « agir_systeme » EXPORTER_JEU_ESSAI, et une ligne de log.
 */
export async function tracerExportJeuEssai(jeu: JeuEssai, acteur: string): Promise<void> {
  const m = jeu.manifeste;
  const resume = `export de ${pluriel(m.nExporte, "simulation")} (site ${m.parOrigine.site}, espace ${m.parOrigine.espace}) sur ${m.nDemande} demandées, ${pluriel(m.ignorees.total, "ignorée")}`;
  console.info(`[jeu d'essai] ${resume}, par ${acteur}`);
  await prisma.appelOutil.create({ data: { sessionId: SESSION_ECRAN, outil: OUTIL_EXPORT_JEU, niveau: "LECTURE", parametres: JSON.stringify({ n: m.nDemande }), commande: acteur.slice(0, 200), statut: "FAIT", resume } });
}

/** Les derniers exports tracés, du plus récent au plus ancien. */
export async function derniersExportsJeu(prise = 5): Promise<{ le: Date; par: string | null; resume: string | null }[]> {
  const lignes = await prisma.appelOutil.findMany({ where: { sessionId: SESSION_ECRAN, outil: OUTIL_EXPORT_JEU }, orderBy: { createdAt: "desc" }, take: prise, select: { createdAt: true, commande: true, resume: true } });
  return lignes.map((l) => ({ le: l.createdAt, par: l.commande, resume: l.resume }));
}

/** Ce qui est disponible à l'export, par origine (lignes non archivées ; une simulation du site recopiée dans un espace compte au site). */
export async function simulationsDisponibles(): Promise<{ site: number; espace: number }> {
  const rattachees = await prisma.simulationSite.findMany({ where: { simulationId: { not: null } }, select: { simulationId: true } });
  const couvertes = rattachees.map((s) => s.simulationId!);
  const [site, sansLien, avecLien] = await Promise.all([
    prisma.simulationSite.count(),
    prisma.simulationEspace.count({ where: { simulationId: null } }),
    prisma.simulationEspace.count({ where: { simulationId: { not: null, notIn: couvertes } } }),
  ]);
  return { site, espace: sansLien + avecLien };
}
