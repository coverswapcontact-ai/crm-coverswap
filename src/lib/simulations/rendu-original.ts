import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Mission 23 (L3) — le rendu d'origine, gardé quand la correction des teintes l'a remplacé : même dossier que le rendu,
 * même nom suivi de `-original` (`apres.jpg` → `apres-original.jpg`). Chemins relatifs au dossier des fichiers, comme
 * partout en base.
 */

/** `site/p/s/apres.jpg` → `site/p/s/apres-original.jpg`. */
export function cheminOriginal(chemin: string): string {
  const extension = path.posix.extname(chemin);
  return `${chemin.slice(0, chemin.length - extension.length)}-original${extension}`;
}

/** Écrit le rendu d'origine à côté du rendu (s'il y en a un) et rend son chemin relatif ; null sinon ou en cas d'échec. */
export async function ecrireRenduOriginal(chemin: string | null | undefined, octets: Buffer | null | undefined): Promise<string | null> {
  if (!chemin || !octets) return null;
  const relatif = cheminOriginal(chemin);
  try {
    const absolu = path.join(path.resolve(resolveUploadsDir()), relatif);
    await fs.mkdir(path.dirname(absolu), { recursive: true });
    await fs.writeFile(absolu, octets);
    return relatif;
  } catch (erreur) {
    console.error("[correction-teintes] rendu d'origine non écrit (non bloquant) :", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}
