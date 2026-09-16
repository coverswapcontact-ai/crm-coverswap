import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { resolveUploadsDir } from "@/lib/uploads";
import { FORMATS_PHOTO, PHOTO_OCTETS_MAX, type LigneDocument, type TypeDocument } from "./constants";
import { ErreurMetier } from "./erreurs";

// Fichiers d'un dossier, sur le volume d'upload (/data/uploads en production) :
//   dossiers/<dossierId>/photos/<photoId>.<ext>
//   dossiers/<dossierId>/documents/<TYPE>-<numero>.pdf
// En base, seuls les chemins relatifs sont stockés (Dossier.photos, Document.pdfPath).

const RACINE = "dossiers";

const TYPES_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(FORMATS_PHOTO).map(([mime, extension]) => [extension, mime])
);

function cheminAbsolu(relatif: string): string {
  const base = path.resolve(resolveUploadsDir());
  const complet = path.resolve(base, relatif);
  if (!complet.startsWith(base + path.sep)) {
    throw new ErreurMetier("Chemin de fichier invalide.", 400);
  }
  return complet;
}

function estAbsent(erreur: unknown): boolean {
  return (erreur as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Dossier.photos → liste des chemins relatifs. */
export function lirePhotos(json: string): string[] {
  try {
    const valeur: unknown = JSON.parse(json);
    return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Document.lignes → lignes du document. */
export function lireLignes(json: string): LigneDocument[] {
  try {
    const valeur: unknown = JSON.parse(json);
    return Array.isArray(valeur) ? (valeur as LigneDocument[]) : [];
  } catch {
    return [];
  }
}

/** Identifiant public d'une photo : son nom de fichier sans extension. */
export function idPhoto(chemin: string): string {
  return path.posix.basename(chemin).replace(/\.[^.]+$/, "");
}

export function typeMimePhoto(chemin: string): string {
  const extension = path.posix.extname(chemin).slice(1).toLowerCase();
  return TYPES_MIME[extension] ?? "application/octet-stream";
}

export function verifierPhoto(fichier: File): void {
  if (!FORMATS_PHOTO[fichier.type]) {
    throw new ErreurMetier("Format de photo non pris en charge : JPEG, PNG, WebP ou HEIC.", 415);
  }
  if (fichier.size === 0) throw new ErreurMetier("La photo est vide.", 400);
  if (fichier.size > PHOTO_OCTETS_MAX) {
    throw new ErreurMetier("Photo trop lourde : 9 Mo maximum.", 413);
  }
}

/** Photo « après chantier » (portfolio) : rangée dans photos-apres/, le reste est « avant ». */
export function estPhotoApres(chemin: string): boolean {
  return path.posix.basename(path.posix.dirname(chemin)) === "photos-apres";
}

/** Écrit une photo (déjà vérifiée) et renvoie son chemin relatif. */
export async function enregistrerPhoto(dossierId: string, fichier: File, apres = false): Promise<string> {
  verifierPhoto(fichier);
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const relatif = path.posix.join(RACINE, dossierId, apres ? "photos-apres" : "photos", `${id}.${FORMATS_PHOTO[fichier.type]}`);
  const absolu = cheminAbsolu(relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, Buffer.from(await fichier.arrayBuffer()));
  return relatif;
}

/** PDF d'un document numéroté. Écrase un fichier orphelin du même nom : un
 *  numéro n'est repris que si la transaction qui l'avait tiré a été annulée. */
export async function enregistrerPdf(
  dossierId: string,
  type: TypeDocument,
  numero: string,
  contenu: Buffer
): Promise<string> {
  const relatif = path.posix.join(RACINE, dossierId, "documents", `${type}-${numero}.pdf`);
  const absolu = cheminAbsolu(relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  await fs.writeFile(absolu, contenu);
  return relatif;
}

export async function lireFichier(relatif: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(cheminAbsolu(relatif));
  } catch (erreur) {
    if (estAbsent(erreur)) return null;
    throw erreur;
  }
}

// Rien ne se supprime, fichiers compris : un fichier retiré part dans
//   archives/<horodatage>-<raison>/<chemin d'origine>
// et y reste. Absent : rien à faire.
async function deplacerVersArchives(relatif: string, raison: string): Promise<void> {
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = cheminAbsolu(path.posix.join("archives", `${horodatage}-${raison}`, relatif));
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(cheminAbsolu(relatif), destination);
  } catch (erreur) {
    if (!estAbsent(erreur)) throw erreur;
  }
}

/** Retire un fichier de son emplacement vivant, en le gardant aux archives. */
export async function archiverFichier(relatif: string, raison: string): Promise<void> {
  await deplacerVersArchives(relatif, raison);
}

/** Retire tous les fichiers d'un dossier (création interrompue), en les gardant aux archives. */
export async function archiverFichiersDossier(dossierId: string, raison: string): Promise<void> {
  await deplacerVersArchives(path.posix.join(RACINE, dossierId), raison);
}
