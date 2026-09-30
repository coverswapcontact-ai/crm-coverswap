import { ipDepasseLaLimite } from "@/lib/acces/limite-site";

/**
 * Mission 15 (partie 4) — la photo du visiteur préparée par le CRM quand son
 * navigateur ne sait pas la décoder (HEIC d'un iPhone lu depuis Chrome sur
 * ordinateur, par exemple) : décodage HEIC par `heic-decode` (libheif en wasm,
 * sans dépendance système) qui rend les pixels RGBA, passés TELS QUELS à sharp
 * (aucun encodage JPEG intermédiaire en JavaScript pur, aucun second
 * décodage) ; orientation EXIF appliquée ; réduction à 1600 px sur le grand
 * côté ; JPEG. Le navigateur reçoit la même chose que ce qu'il produit
 * lui-même avec `preparerPhoto` (site) : une data URL JPEG.
 *
 * Le processus Railway sert aussi l'espace client, le MCP et le bureau : les
 * conversions se font UNE À LA FOIS (file en mémoire) et sont plafonnées pour
 * tout le site sur 10 min, en plus de la limite par adresse.
 *
 * Le décodeur HEIC est remplaçable pour les essais (aucun décodage wasm dans
 * les tests).
 */
export const COTE_MAX_PHOTO = 1600;
export const POIDS_MAX_PHOTO = 25 * 1024 * 1024;
const QUALITE_JPEG = 86;

/** Conversions par 10 min (fenêtre glissante de `ipDepasseLaLimite`) : par adresse, et pour tout le site. */
export const LIMITE_CONVERSIONS = { parIp: 20, global: 60 };

export type RaisonPhotoRefusee = "trop-lourde" | "format" | "illisible";
export type PhotoPreparee = { ok: true; dataUrl: string; largeur: number; hauteur: number; convertie: boolean } | { ok: false; raison: RaisonPhotoRefusee; message: string };

export const MESSAGES_PHOTO: Record<RaisonPhotoRefusee, string> = {
  "trop-lourde": "Cette photo dépasse 25 Mo. Choisissez une photo plus légère, ou faites une capture d'écran.",
  format: "Ce format de photo n'a pas pu être converti. Envoyez une capture d'écran de la photo, ou une photo en JPEG.",
  illisible: "Impossible de lire cette photo. Essayez une autre photo, en JPEG ou PNG.",
};

/** Les pixels RGBA d'une photo décodée (ce que `heic-decode` rend). */
export type ImageDecodee = { largeur: number; hauteur: number; data: Uint8Array | Uint8ClampedArray };
type DecodeurHeic = (octets: Buffer) => Promise<ImageDecodee>;
let decodeurEssai: DecodeurHeic | null = null;

/** Pour les essais : remplace le décodeur HEIC (null : revenir à heic-decode). */
export function definirDecodeurHeicEssai(decodeur: DecodeurHeic | null): void {
  decodeurEssai = decodeur;
}

const MARQUES_HEIC = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"]);

/** Un fichier HEIC / HEIF : d'après ses octets (boîte `ftyp`), sinon d'après son nom ou son type déclaré. */
export function estHeic(octets: Buffer, nom = "", type = ""): boolean {
  if (octets.length >= 12 && octets.toString("latin1", 4, 8) === "ftyp" && MARQUES_HEIC.has(octets.toString("latin1", 8, 12).toLowerCase())) return true;
  return /image\/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(nom);
}

async function decoderHeic(octets: Buffer): Promise<ImageDecodee> {
  if (decodeurEssai) return decodeurEssai(octets);
  const { default: decode } = await import("heic-decode");
  const image = await decode({ buffer: octets });
  return { largeur: image.width, hauteur: image.height, data: image.data };
}

/**
 * La conversion refusée ? `"ip"` : trop pour cette adresse ; `"global"` : trop pour tout le site ; null : autorisée
 * (et comptée). Le préfixe isole les compteurs (essais).
 */
export function conversionRefusee(ip: string, maintenant: number = Date.now(), limites = LIMITE_CONVERSIONS, prefixe = "simulate-photo"): "ip" | "global" | null {
  if (ipDepasseLaLimite(`${prefixe}:${ip}`, maintenant, limites.parIp)) return "ip";
  if (ipDepasseLaLimite(`${prefixe}:global`, maintenant, limites.global)) return "global";
  return null;
}

/* Une conversion à la fois : la suivante attend la fin de la précédente (réussie ou non). */
let file: Promise<unknown> = Promise.resolve();
function enSerie<T>(travail: () => Promise<T>): Promise<T> {
  const resultat = file.then(travail, travail);
  file = resultat.catch(() => undefined);
  return resultat;
}

/**
 * Prépare la photo reçue du site : refus au-delà de 25 Mo ; HEIC décodé ;
 * orientation appliquée ; réduite à 1600 px ; JPEG en data URL. Sérialisée.
 */
export function preparerPhotoSite(octets: Buffer, nom = "", type = ""): Promise<PhotoPreparee> {
  if (octets.length > POIDS_MAX_PHOTO) return Promise.resolve({ ok: false, raison: "trop-lourde", message: MESSAGES_PHOTO["trop-lourde"] });
  if (octets.length < 64) return Promise.resolve({ ok: false, raison: "illisible", message: MESSAGES_PHOTO.illisible });
  return enSerie(() => preparer(octets, nom, type));
}

async function preparer(octets: Buffer, nom: string, type: string): Promise<PhotoPreparee> {
  const { default: sharp } = await import("sharp");
  let source: import("sharp").Sharp;
  let convertie = false;
  if (estHeic(octets, nom, type)) {
    let decodee: ImageDecodee;
    try {
      decodee = await decoderHeic(octets);
    } catch (erreur) {
      console.warn("[simulate/photo] conversion HEIC impossible :", erreur instanceof Error ? erreur.message : erreur);
      return { ok: false, raison: "format", message: MESSAGES_PHOTO.format };
    }
    // Les pixels bruts vont droit dans sharp : ni JPEG intermédiaire, ni second décodage. libheif a déjà appliqué l'orientation.
    const pixels = Buffer.from(decodee.data.buffer, decodee.data.byteOffset, decodee.data.byteLength);
    source = sharp(pixels, { raw: { width: decodee.largeur, height: decodee.hauteur, channels: 4 } });
    convertie = true;
  } else {
    source = sharp(octets).rotate();
  }
  try {
    const { data, info } = await source
      .resize({ width: COTE_MAX_PHOTO, height: COTE_MAX_PHOTO, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITE_JPEG })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, dataUrl: `data:image/jpeg;base64,${data.toString("base64")}`, largeur: info.width, hauteur: info.height, convertie };
  } catch (erreur) {
    console.warn("[simulate/photo] photo illisible :", erreur instanceof Error ? erreur.message : erreur);
    return { ok: false, raison: "illisible", message: MESSAGES_PHOTO.illisible };
  }
}
