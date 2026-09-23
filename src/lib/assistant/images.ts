import type { ImageOutil } from "./definition";

/**
 * Les images que l'assistant montre à Claude (mission 10) : photos d'un dossier,
 * simulations avant/après. Toujours compressées avant de partir — une photo
 * d'iPhone fait 4 Mo, Claude n'a besoin que de la voir : 1 024 px de côté au
 * plus, JPEG à 72 %. Une image illisible (HEIC brut) ne casse pas l'outil :
 * elle est dite absente, les autres passent.
 */

export const COTE_MAX = 1024;
export const QUALITE_JPEG = 72;
/** Au-delà, l'outil s'arrête : l'application Claude n'a pas à recevoir des dizaines d'images d'un coup. */
export const IMAGES_MAX_PAR_RESULTAT = 12;

export type ImageCompressee = { base64: string; mimeType: "image/jpeg"; octets: number; largeur: number; hauteur: number };

export async function compresserPourClaude(octets: Buffer): Promise<ImageCompressee | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(octets)
      .rotate()
      .resize({ width: COTE_MAX, height: COTE_MAX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITE_JPEG, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { base64: data.toString("base64"), mimeType: "image/jpeg", octets: data.length, largeur: info.width, hauteur: info.height };
  } catch (erreur) {
    console.warn("[assistant] image non compressée :", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

/** Compresse et nomme une image pour le résultat ; null si elle ne se lit pas. */
export async function imagePourResultat(octets: Buffer | null, libelle: string): Promise<ImageOutil | null> {
  if (!octets) return null;
  const c = await compresserPourClaude(octets);
  return c ? { libelle, mimeType: c.mimeType, base64: c.base64, octets: c.octets } : null;
}

export const ko = (octets: number) => `${Math.round(octets / 1024)} Ko`;
