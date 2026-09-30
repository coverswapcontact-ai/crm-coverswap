/**
 * Le type d'un fichier reçu, lu dans ses premiers octets (« octets magiques »),
 * jamais dans son extension ni dans le type déclaré par l'envoyeur : un .jpg qui
 * est en réalité une page HTML ou un exécutable est refusé.
 *
 * Permis : JPEG, PNG, WebP, HEIC / HEIF (photos d'iPhone), PDF.
 */

export type FormatPermis = { typeMime: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "application/pdf"; extension: string; image: boolean };

const MARQUES_HEIC = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const MARQUES_HEIF = new Set(["mif1", "msf1"]);

export function detecterFormat(octets: Uint8Array): FormatPermis | null {
  const b = octets;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { typeMime: "image/jpeg", extension: "jpg", image: true };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { typeMime: "image/png", extension: "png", image: true };
  const ascii = (debut: number, fin: number) => (b.length >= fin ? String.fromCharCode(...b.subarray(debut, fin)) : "");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { typeMime: "image/webp", extension: "webp", image: true };
  if (ascii(4, 8) === "ftyp") {
    const marque = ascii(8, 12).toLowerCase();
    if (MARQUES_HEIC.has(marque)) return { typeMime: "image/heic", extension: "heic", image: true };
    if (MARQUES_HEIF.has(marque)) {
      // mif1 / msf1 : conteneur générique ; on cherche une marque compatible HEIC dans la boîte ftyp (sinon HEIF).
      const taille = b.length >= 4 ? ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 : 0;
      const compatibles = ascii(16, Math.min(taille, 64, b.length)).toLowerCase();
      return compatibles.includes("heic") || compatibles.includes("heix") ? { typeMime: "image/heic", extension: "heic", image: true } : { typeMime: "image/heif", extension: "heif", image: true };
    }
    return null;
  }
  // PDF : « %PDF- » en tête (quelques octets parasites tolérés, comme les lecteurs).
  const tete = ascii(0, Math.min(b.length, 1024));
  const position = tete.indexOf("%PDF-");
  if (position >= 0 && position < 1024) return { typeMime: "application/pdf", extension: "pdf", image: false };
  return null;
}

export const estHeicOuHeif = (typeMime: string) => typeMime === "image/heic" || typeMime === "image/heif";

export const MESSAGE_FORMAT_REFUSE = "Format refusé : seuls les photos (JPEG, PNG, WebP, HEIC) et les PDF sont acceptés (le contenu du fichier est vérifié, pas son nom).";
