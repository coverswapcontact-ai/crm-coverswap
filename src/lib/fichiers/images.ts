import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

/**
 * Mission 13 (26/09/2026), lot 6 — les photos ne sont plus servies telles
 * quelles (3 à 6 Mo par photo d'iPhone). Au dépôt, trois versions sous la
 * racine des téléversements :
 *   originaux/<chemin>                  l'original, hors ligne (jamais servi, jamais effacé) ;
 *   <chemin>                            la version servie, 1 600 px de côté au plus (≈ 300 Ko) ;
 *   <chemin sans extension>.vignette.<extension>   la vignette, 320 px, pour les listes.
 * Le chemin en base ne change pas : tout lecteur d'avant lit la version servie.
 * HEIC : pas de décodeur dans les binaires précompilés de sharp — la photo est
 * servie telle quelle (Safari la décode), sans vignette.
 */

export const COTE_MAX_SERVIE = 1600;
export const COTE_VIGNETTE = 320;
export const DOSSIER_ORIGINAUX = "originaux";
const QUALITE = 82;

const FORMATS_REDIMENSIONNABLES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function estRedimensionnable(typeMime: string): boolean {
  return FORMATS_REDIMENSIONNABLES.has(typeMime);
}

export function cheminOriginal(relatif: string): string {
  return path.posix.join(DOSSIER_ORIGINAUX, relatif);
}

export function cheminVignette(relatif: string): string {
  const extension = path.posix.extname(relatif);
  return `${relatif.slice(0, relatif.length - extension.length)}.vignette${extension}`;
}

export function estVignette(relatif: string): boolean {
  return /\.vignette\.[a-z0-9]+$/i.test(relatif);
}

const existe = (absolu: string) => fs.access(absolu).then(() => true, () => false);

export type VersionsImage = { servie: Buffer; vignette: Buffer; largeur: number; hauteur: number };

/** Les deux versions servies d'une image, orientation EXIF appliquée ; null si le format ne se décode pas ici. */
export async function versionsDe(contenu: Buffer, typeMime: string): Promise<VersionsImage | null> {
  if (!estRedimensionnable(typeMime)) return null;
  try {
    const base = sharp(contenu, { failOn: "none" }).rotate();
    const encoder = (image: sharp.Sharp) =>
      typeMime === "image/png" ? image.png({ compressionLevel: 9 }) : typeMime === "image/webp" ? image.webp({ quality: QUALITE }) : image.jpeg({ quality: QUALITE, mozjpeg: true });
    const servie = await encoder(base.clone().resize({ width: COTE_MAX_SERVIE, height: COTE_MAX_SERVIE, fit: "inside", withoutEnlargement: true })).toBuffer({ resolveWithObject: true });
    const vignette = await encoder(base.clone().resize({ width: COTE_VIGNETTE, height: COTE_VIGNETTE, fit: "inside", withoutEnlargement: true })).toBuffer();
    return { servie: servie.data, vignette, largeur: servie.info.width, hauteur: servie.info.height };
  } catch {
    return null;
  }
}

/** Une photo neuve : l'original hors ligne, la version servie, la vignette. Format non décodable : servie telle quelle. */
export async function ecrirePhotoAvecVersions(racine: string, relatif: string, contenu: Buffer, typeMime: string): Promise<{ redimensionnee: boolean }> {
  const absolu = path.resolve(racine, relatif);
  await fs.mkdir(path.dirname(absolu), { recursive: true });
  const versions = await versionsDe(contenu, typeMime);
  if (!versions) {
    await fs.writeFile(absolu, contenu);
    return { redimensionnee: false };
  }
  const original = path.resolve(racine, cheminOriginal(relatif));
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.writeFile(original, contenu);
  await fs.writeFile(path.resolve(racine, cheminVignette(relatif)), versions.vignette);
  await fs.writeFile(absolu, versions.servie);
  return { redimensionnee: true };
}

export type IssueRedimensionnement = "faite" | "deja" | "absente" | "non-redimensionnable";

/** Déjà traitée : l'original est hors ligne, ou l'image a été marquée illisible. */
export async function estDejaTraitee(racine: string, relatif: string): Promise<boolean> {
  const original = path.resolve(racine, cheminOriginal(relatif));
  return (await existe(original)) || (await existe(`${original}.illisible`));
}

/**
 * Une photo déjà sur le disque (d'avant le lot 6) : l'original part hors ligne
 * (un renommage, même volume) et les versions servies prennent sa place.
 * Idempotent : l'original présent, c'est déjà fait. Une image illisible est
 * marquée (originaux/<chemin>.illisible) pour ne pas être reprise à chaque lot.
 */
export async function redimensionnerSurPlace(racine: string, relatif: string, typeMime: string): Promise<IssueRedimensionnement> {
  if (await estDejaTraitee(racine, relatif)) return "deja";
  if (!estRedimensionnable(typeMime)) return "non-redimensionnable";
  const absolu = path.resolve(racine, relatif);
  const original = path.resolve(racine, cheminOriginal(relatif));
  const contenu = await fs.readFile(absolu).catch(() => null);
  if (!contenu) return "absente";
  const versions = await versionsDe(contenu, typeMime);
  await fs.mkdir(path.dirname(original), { recursive: true });
  if (!versions) {
    await fs.writeFile(`${original}.illisible`, "");
    return "non-redimensionnable";
  }
  // Ordre sûr : la vignette, la version servie à côté, puis les deux renommages — une coupure laisse toujours un fichier lisible.
  await fs.writeFile(path.resolve(racine, cheminVignette(relatif)), versions.vignette);
  await fs.writeFile(`${absolu}.servie`, versions.servie);
  await fs.rename(absolu, original);
  await fs.rename(`${absolu}.servie`, absolu);
  return "faite";
}
