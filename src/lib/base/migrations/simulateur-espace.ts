import { promises as fs } from "node:fs";
import path from "node:path";
import { idPhoto, lirePhotos } from "@/lib/dossiers/stockage";
import { poserPromptsParDefaut } from "@/lib/simulateur/bibliotheque";
import { poserModelesParDefaut } from "@/lib/sms/modeles";
import { resolveUploadsDir } from "@/lib/uploads";
import type { MigrationDonnees } from "./index";

/**
 * Mission du 21/09/2026 (espace client, simulateur du CRM) :
 *  1. la bibliothèque de prompts ChatGPT reçoit sa version 1 (un prompt par
 *     type de surface) — jamais réécrite ensuite ; le nouveau message type
 *     « devis relu plusieurs fois » est posé (les autres ne sont pas touchés) ;
 *  2. les simulations du site déjà rangées dans un dossier apprennent quelles
 *     photos du dossier sont leurs copies (retrouvées octet pour octet) : le
 *     rendu n'est pas une photo du client et ne doit pas servir de photo
 *     « avant » au simulateur, ni compter comme photo déposée.
 * Les simulations déjà déposées dans un espace gardent leur visibilité
 * (statut PUBLIEE par défaut de colonne). Rejouable : ce qui est fait est sauté.
 */
async function lire(relatif: string | null): Promise<Buffer | null> {
  if (!relatif) return null;
  return fs.readFile(path.join(resolveUploadsDir(), relatif)).catch(() => null);
}

export const migrationSimulateurEspace: MigrationDonnees = {
  nom: "simulateur-espace-21-09",
  description: "Bibliothèque de prompts ChatGPT (version 1) ; copies des rendus du site repérées dans les photos des dossiers",
  executer: async (client) => {
    const prompts = await poserPromptsParDefaut(client);
    const modelesSms = await poserModelesParDefaut(client);
    let reperees = 0;
    let sansCopie = 0;
    const simulations = await client.simulation.findMany({ where: { dossierId: { not: null }, photosDossier: null }, select: { id: true, dossierId: true, imageAfterPath: true, imageBeforePath: true, imageOriginalPath: true } });
    const photosParDossier = new Map<string, { id: string; chemin: string; taille: number }[]>();
    for (const simulation of simulations) {
      const dossierId = simulation.dossierId!;
      if (!photosParDossier.has(dossierId)) {
        const dossier = await client.dossier.findFirst({ where: { id: dossierId, archiveLe: undefined }, select: { photos: true } });
        const liste: { id: string; chemin: string; taille: number }[] = [];
        for (const chemin of lirePhotos(dossier?.photos ?? "[]")) {
          const taille = (await fs.stat(path.join(resolveUploadsDir(), chemin)).catch(() => null))?.size ?? 0;
          if (taille > 0) liste.push({ id: idPhoto(chemin), chemin, taille });
        }
        photosParDossier.set(dossierId, liste);
      }
      const photos = photosParDossier.get(dossierId)!;
      const trouver = async (source: Buffer | null) => {
        if (!source) return null;
        for (const photo of photos.filter((p) => p.taille === source.length)) {
          const octets = await lire(photo.chemin);
          if (octets && octets.equals(source)) return photo.id;
        }
        return null;
      };
      const copies = { avant: await trouver(await lire(simulation.imageOriginalPath ?? simulation.imageBeforePath)), rendu: await trouver(await lire(simulation.imageAfterPath)) };
      if (!copies.avant && !copies.rendu) sansCopie++;
      else reperees++;
      await client.simulation.update({ where: { id: simulation.id }, data: { photosDossier: JSON.stringify(copies) } });
    }
    return { promptsPoses: prompts, modelesSmsPoses: modelesSms, simulationsExaminees: simulations.length, copiesReperees: reperees, sansCopie };
  },
};
