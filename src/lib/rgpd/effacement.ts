import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Effacement physique des fichiers d'un client anonymisé : photos des
 * dossiers (avant, après), pièces jointes de ses mails, images de simulation —
 * à leur place et dans les archives du volume. Les PDF des documents émis et
 * les justificatifs de dépenses ne sont jamais touchés. Rejouable : un fichier
 * déjà effacé est ignoré.
 */

export type ChargeEffacement = { chemins: string[]; dossierIds: string[] };
export type BilanEffacement = { effaces: number };

function dansLeVolume(base: string, relatif: string): string | null {
  const complet = path.resolve(base, relatif);
  return complet.startsWith(base + path.sep) ? complet : null;
}

async function effacerFichier(complet: string | null): Promise<boolean> {
  if (!complet) return false;
  try {
    await fs.rm(complet, { force: false });
    return true;
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw erreur;
  }
}

async function effacerDossier(complet: string | null): Promise<number> {
  if (!complet) return 0;
  let nombre = 0;
  let entrees: import("node:fs").Dirent[];
  try {
    entrees = await fs.readdir(complet, { withFileTypes: true });
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw erreur;
  }
  for (const entree of entrees) {
    const chemin = path.join(complet, entree.name);
    if (entree.isDirectory()) nombre += await effacerDossier(chemin);
    else if (await effacerFichier(chemin)) nombre++;
  }
  return nombre;
}

export async function effacerFichiersAnonymises(charge: ChargeEffacement): Promise<BilanEffacement> {
  const base = path.resolve(resolveUploadsDir());
  // Racines où un fichier peut se trouver : sa place, et chaque lot d'archives (archives/<horodatage>-<raison>/).
  const racines = [base];
  try {
    const archives = path.join(base, "archives");
    for (const entree of await fs.readdir(archives, { withFileTypes: true })) {
      if (entree.isDirectory()) racines.push(path.join(archives, entree.name));
    }
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== "ENOENT") throw erreur;
  }

  let effaces = 0;
  for (const racine of racines) {
    for (const chemin of charge.chemins) {
      if (await effacerFichier(dansLeVolume(racine, chemin))) effaces++;
    }
    for (const dossierId of charge.dossierIds) {
      if (!/^[a-z0-9]+$/i.test(dossierId)) continue;
      for (const sousDossier of ["photos", "photos-apres"]) {
        effaces += await effacerDossier(dansLeVolume(racine, path.join("dossiers", dossierId, sousDossier)));
      }
    }
  }
  return { effaces };
}
