import prisma from "@/lib/prisma";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement } from "@/lib/taches/registre";
import { resolveUploadsDir } from "@/lib/uploads";
import { estDejaTraitee, estRedimensionnable, redimensionnerSurPlace } from "./images";

/**
 * Mission 13 (26/09/2026), lot 6 — les photos d'avant reçoivent leur version
 * 1 600 px et leur vignette, par lots de 25, en tâche de fond journalisée
 * (Tâches de fond) : chaque lot remet le suivant en file tant qu'il reste des
 * photos. Idempotent : une photo dont l'original est déjà hors ligne n'est pas
 * reprise. Rien n'est effacé : l'original part dans originaux/.
 */
export const TYPE_TACHE_REDIMENSIONNEMENT = "REDIMENSIONNER_PHOTOS";
export const ACTEUR_PHOTOS = "SYSTEME:photos";
export const TAILLE_LOT = 25;

const TYPES_PAR_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Le type d'une photo d'après son extension (les fichiers du site s'appellent before.jpg, <uuid>.jpeg…). */
export function typeDeLaPhoto(chemin: string): string {
  const extension = chemin.split(".").pop()?.toLowerCase() ?? "";
  return TYPES_PAR_EXTENSION[extension] ?? "application/octet-stream";
}

export type PhotoCandidate = { chemin: string; origine: "DOSSIER" | "LEAD" | "SIMULATION" };
export type BilanLot = { lot: number; candidates: number; dejaFaites: number; faites: number; absentes: number; nonRedimensionnables: number; restantes: number };

/** Toutes les photos de clients connues en base (archives comprises), dans un format que sharp décode. */
export async function photosARedimensionner(): Promise<PhotoCandidate[]> {
  const [dossiers, photosLead, simulations] = await Promise.all([
    prisma.dossier.findMany({ where: { ...AVEC_ARCHIVES }, select: { photos: true } }),
    prisma.photoLead.findMany({ where: { ...AVEC_ARCHIVES }, select: { chemin: true } }),
    prisma.simulation.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ imageBeforePath: { not: null } }, { imageOriginalPath: { not: null } }] }, select: { imageBeforePath: true, imageOriginalPath: true } }),
  ]);
  const vues = new Set<string>();
  const candidates: PhotoCandidate[] = [];
  const ajouter = (chemin: string | null, origine: PhotoCandidate["origine"]) => {
    if (!chemin || vues.has(chemin) || !estRedimensionnable(typeDeLaPhoto(chemin))) return;
    vues.add(chemin);
    candidates.push({ chemin, origine });
  };
  for (const dossier of dossiers) for (const chemin of lirePhotos(dossier.photos)) ajouter(chemin, "DOSSIER");
  for (const photo of photosLead) ajouter(photo.chemin, "LEAD");
  for (const simulation of simulations) {
    ajouter(simulation.imageOriginalPath, "SIMULATION");
    ajouter(simulation.imageBeforePath, "SIMULATION");
  }
  return candidates;
}

/** Un lot : au plus `taille` photos redimensionnées ; le bilan dit ce qu'il reste. */
export async function redimensionnerUnLot(lot: number, taille = TAILLE_LOT, racine = resolveUploadsDir()): Promise<BilanLot> {
  const candidates = await photosARedimensionner();
  const bilan: BilanLot = { lot, candidates: candidates.length, dejaFaites: 0, faites: 0, absentes: 0, nonRedimensionnables: 0, restantes: 0 };
  for (const candidate of candidates) {
    if (bilan.faites >= taille) {
      bilan.restantes++;
      continue;
    }
    if (await estDejaTraitee(racine, candidate.chemin)) {
      bilan.dejaFaites++;
      continue;
    }
    const issue = await redimensionnerSurPlace(racine, candidate.chemin, typeDeLaPhoto(candidate.chemin));
    if (issue === "faite") bilan.faites++;
    else if (issue === "absente") bilan.absentes++;
    else if (issue === "non-redimensionnable") bilan.nonRedimensionnables++;
    else bilan.dejaFaites++;
  }
  return bilan;
}

export const cleLot = (lot: number) => `redimensionnement-photos:${lot}`;

/** Met le premier lot en file (idempotent par sa clé). */
export async function lancerRedimensionnement(client: Parameters<typeof mettreEnFile>[1] = prisma): Promise<string> {
  return mettreEnFile({ type: TYPE_TACHE_REDIMENSIONNEMENT, cle: cleLot(1), charge: { lot: 1 } }, client);
}

export function enregistrerTachesRedimensionnement(): void {
  enregistrerTraitement(TYPE_TACHE_REDIMENSIONNEMENT, {
    libelle: "Photos : version 1 600 px et vignette, original mis hors ligne",
    acteur: ACTEUR_PHOTOS,
    tentativesMax: 5,
    delaiMaxMs: 10 * 60_000,
    executer: async (charge) => {
      const lot = Number((charge as { lot?: number } | null)?.lot) || 1;
      const bilan = await redimensionnerUnLot(lot);
      if (bilan.restantes > 0) await mettreEnFile({ type: TYPE_TACHE_REDIMENSIONNEMENT, cle: cleLot(lot + 1), charge: { lot: lot + 1 } });
      return bilan;
    },
  });
}
