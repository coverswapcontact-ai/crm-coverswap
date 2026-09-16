import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { FORMATS_PHOTO, PHOTO_OCTETS_MAX } from "@/lib/dossiers/constants";
import { archiverFichier, lireFichier } from "@/lib/dossiers/stockage";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Fichiers conservés (justificatifs…), sur le volume d'upload :
 *   <racine>/<AAAA>/<MM>/<identifiant>.<extension>
 * En base (`Fichier`) : chemin relatif, type, taille, empreinte SHA-256. Rien
 * ne se supprime : un fichier retiré part aux archives et sa ligne est archivée.
 * Aucun n'est servi sans session (routes /api, refus par défaut).
 */

export const FORMATS_JUSTIFICATIF: Record<string, string> = { ...FORMATS_PHOTO, "application/pdf": "pdf" };

export function verifierJustificatif(fichier: File): void {
  if (!FORMATS_JUSTIFICATIF[fichier.type]) {
    throw new ErreurMetier("Format non pris en charge : photo (JPEG, PNG, WebP, HEIC) ou PDF.", 415);
  }
  if (fichier.size === 0) throw new ErreurMetier("Le fichier est vide.", 400);
  if (fichier.size > PHOTO_OCTETS_MAX) throw new ErreurMetier("Fichier trop lourd : 9 Mo maximum.", 413);
}

function cheminAbsolu(relatif: string): string {
  const base = path.resolve(resolveUploadsDir());
  const complet = path.resolve(base, relatif);
  if (!complet.startsWith(base + path.sep)) throw new ErreurMetier("Chemin de fichier invalide.", 400);
  return complet;
}

export function empreinteDe(contenu: Buffer): string {
  return createHash("sha256").update(contenu).digest("hex");
}

/** Écrit le fichier sur le volume puis sa ligne ; rend la ligne. */
export async function enregistrerFichier(racine: string, fichier: File, quand: Date = new Date()) {
  verifierJustificatif(fichier);
  const contenu = Buffer.from(await fichier.arrayBuffer());
  const annee = String(quand.getUTCFullYear());
  const mois = String(quand.getUTCMonth() + 1).padStart(2, "0");
  const identifiant = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const relatif = path.posix.join(racine, annee, mois, `${identifiant}.${FORMATS_JUSTIFICATIF[fichier.type]}`);
  const absolu = cheminAbsolu(relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, contenu);
  try {
    return await prisma.fichier.create({
      data: {
        chemin: relatif,
        nomOriginal: fichier.name ? fichier.name.slice(0, 200) : null,
        typeMime: fichier.type,
        taille: contenu.length,
        empreinte: empreinteDe(contenu),
      },
    });
  } catch (erreur) {
    await archiverFichier(relatif, "enregistrement-annule").catch(() => {});
    throw erreur;
  }
}

export async function lireFichierConserve(id: string): Promise<{ contenu: Buffer; typeMime: string; nom: string }> {
  const ligne = await prisma.fichier.findUnique({ where: { id } });
  if (!ligne) throw new ErreurMetier("Fichier introuvable.", 404);
  const contenu = await lireFichier(ligne.chemin);
  if (!contenu) throw new ErreurMetier("Fichier absent du stockage.", 404);
  return { contenu, typeMime: ligne.typeMime, nom: ligne.nomOriginal ?? path.posix.basename(ligne.chemin) };
}

/** Retire un fichier de son emplacement (il reste aux archives) et archive sa ligne. */
export async function archiverFichierConserve(id: string, motif: string): Promise<void> {
  const ligne = await prisma.fichier.findUnique({ where: { id } });
  if (!ligne || ligne.archiveLe) return;
  await archiverFichier(ligne.chemin, "justificatif-remplace");
  await prisma.fichier.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif } });
}
