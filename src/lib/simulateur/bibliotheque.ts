import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { resoudreContexte } from "@/lib/journal/acteur";
import type { BaseDonnees } from "@/lib/prisma";
import { PROMPTS_PAR_DEFAUT } from "./prompts-defaut";
import { verifierModele } from "./rendu";
import { TYPES_SURFACE, typeSurface } from "./types-surface";

/**
 * Bibliothèque de prompts ChatGPT (Simulateur → Prompts).
 *
 * Un prompt par type de surface ; son texte vit dans des versions numérotées
 * que la base refuse de modifier. Enregistrer = une version de plus ; revenir
 * en arrière = une version de plus qui reprend un ancien texte : l'histoire ne
 * se réécrit pas, et chaque simulation garde le numéro de la version qui l'a
 * produite — c'est ce qui dira, avec le temps, quels prompts rendent le mieux.
 */

export type StatistiquesVersion = { simulations: number; publiees: number; masquees: number; choisies: number };
export type VersionVue = { numero: number; note: string | null; auteur: string | null; le: string; courante: boolean; longueur: number; stats: StatistiquesVersion };
export type PromptVue = { typeSurface: string; libelle: string; zones: string[]; versionCourante: number; texte: string; misAJourLe: string; versions: VersionVue[] };

/** Pose la version 1 des prompts qui manquent ; ne réécrit jamais un prompt existant. */
export async function poserPromptsParDefaut(client: BaseDonnees = prisma): Promise<number> {
  let poses = 0;
  for (const type of TYPES_SURFACE) {
    const existant = await client.promptSimulation.findUnique({ where: { typeSurface: type.id }, select: { id: true } });
    if (existant) continue;
    const defaut = PROMPTS_PAR_DEFAUT[type.id];
    if (!defaut) continue;
    await client.promptSimulation.create({ data: { typeSurface: type.id, versionCourante: 1, versions: { create: { numero: 1, texte: defaut.texte, note: defaut.note, auteur: "CoverSwap (version d'origine)" } } } });
    poses++;
  }
  return poses;
}

async function statistiques(promptId: string): Promise<Map<number, StatistiquesVersion>> {
  const lignes = await prisma.simulationEspace.findMany({ where: { promptId, archiveLe: undefined }, select: { promptVersion: true, statut: true, choisieLe: true } });
  const parVersion = new Map<number, StatistiquesVersion>();
  for (const ligne of lignes) {
    if (ligne.promptVersion === null) continue;
    const stats = parVersion.get(ligne.promptVersion) ?? { simulations: 0, publiees: 0, masquees: 0, choisies: 0 };
    stats.simulations++;
    if (ligne.statut === "PUBLIEE") stats.publiees++;
    if (ligne.statut === "MASQUEE") stats.masquees++;
    if (ligne.choisieLe) stats.choisies++;
    parVersion.set(ligne.promptVersion, stats);
  }
  return parVersion;
}

async function promptDuType(id: string) {
  if (!typeSurface(id)) throw new ErreurMetier("Type de surface inconnu.", 404);
  let prompt = await prisma.promptSimulation.findUnique({ where: { typeSurface: id }, include: { versions: { orderBy: { numero: "desc" } } } });
  if (!prompt) {
    await poserPromptsParDefaut();
    prompt = await prisma.promptSimulation.findUnique({ where: { typeSurface: id }, include: { versions: { orderBy: { numero: "desc" } } } });
  }
  if (!prompt) throw new ErreurMetier("Prompt introuvable.", 404);
  return prompt;
}

export async function lirePrompt(id: string): Promise<PromptVue> {
  const prompt = await promptDuType(id);
  const type = typeSurface(id)!;
  const stats = await statistiques(prompt.id);
  const courante = prompt.versions.find((v) => v.numero === prompt.versionCourante) ?? prompt.versions[0];
  return {
    typeSurface: id,
    libelle: type.libelle,
    zones: type.zones,
    versionCourante: courante.numero,
    texte: courante.texte,
    misAJourLe: courante.createdAt.toISOString(),
    versions: prompt.versions.map((v) => ({
      numero: v.numero,
      note: v.note,
      auteur: v.auteur,
      le: v.createdAt.toISOString(),
      courante: v.numero === courante.numero,
      longueur: v.texte.length,
      stats: stats.get(v.numero) ?? { simulations: 0, publiees: 0, masquees: 0, choisies: 0 },
    })),
  };
}

export async function listerPrompts(): Promise<PromptVue[]> {
  await poserPromptsParDefaut();
  const vues: PromptVue[] = [];
  for (const type of TYPES_SURFACE) vues.push(await lirePrompt(type.id));
  return vues;
}

/** Le texte d'une version précise (lecture d'une version ancienne dans l'historique). */
export async function texteDeVersion(id: string, numero: number): Promise<string> {
  const prompt = await promptDuType(id);
  const version = prompt.versions.find((v) => v.numero === numero);
  if (!version) throw new ErreurMetier("Version introuvable.", 404);
  return version.texte;
}

/** Ce qui sert à préparer une simulation : l'identifiant, le numéro et le texte de la version courante. */
export async function promptCourant(id: string): Promise<{ promptId: string; version: number; texte: string }> {
  const prompt = await promptDuType(id);
  const courante = prompt.versions.find((v) => v.numero === prompt.versionCourante) ?? prompt.versions[0];
  return { promptId: prompt.id, version: courante.numero, texte: courante.texte };
}

async function auteurCourant(): Promise<string> {
  const { acteur } = await resoudreContexte();
  return acteur.replace(/^HUMAIN:/, "");
}

export async function enregistrerVersion(id: string, entree: { texte: string; note?: string | null }): Promise<PromptVue> {
  const type = typeSurface(id);
  if (!type) throw new ErreurMetier("Type de surface inconnu.", 404);
  const texte = entree.texte.replace(/\r\n/g, "\n").trim();
  const { erreurs } = verifierModele(texte, type);
  if (erreurs.length > 0) throw new ErreurMetier(erreurs[0], 400, { erreurs });
  const prompt = await promptDuType(id);
  const courante = prompt.versions.find((v) => v.numero === prompt.versionCourante);
  if (courante && courante.texte === texte) throw new ErreurMetier("Aucune modification : le texte est celui de la version en service.", 400);
  const numero = (prompt.versions[0]?.numero ?? 0) + 1;
  const auteur = await auteurCourant();
  await prisma.$transaction([
    prisma.promptSimulationVersion.create({ data: { promptId: prompt.id, numero, texte, note: entree.note?.trim().slice(0, 300) || null, auteur } }),
    prisma.promptSimulation.update({ where: { id: prompt.id }, data: { versionCourante: numero } }),
  ]);
  return lirePrompt(id);
}

/** Revenir à une version : son texte redevient celui en service, sous un nouveau numéro. */
export async function restaurerVersion(id: string, numero: number): Promise<PromptVue> {
  const prompt = await promptDuType(id);
  const ancienne = prompt.versions.find((v) => v.numero === numero);
  if (!ancienne) throw new ErreurMetier("Version introuvable.", 404);
  if (ancienne.numero === prompt.versionCourante) throw new ErreurMetier("Cette version est déjà en service.", 400);
  const suivant = (prompt.versions[0]?.numero ?? 0) + 1;
  const auteur = await auteurCourant();
  await prisma.$transaction([
    prisma.promptSimulationVersion.create({ data: { promptId: prompt.id, numero: suivant, texte: ancienne.texte, note: `Retour à la version ${ancienne.numero}`, auteur } }),
    prisma.promptSimulation.update({ where: { id: prompt.id }, data: { versionCourante: suivant } }),
  ]);
  return lirePrompt(id);
}
