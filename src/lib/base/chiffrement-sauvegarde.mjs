import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Mission 13 (lot 2) — chiffrement des sauvegardes envoyées hors de l'hébergeur
 * (Google Drive). AES-256-GCM ; la clé est dérivée (HKDF-SHA256) de
 * SAUVEGARDE_CLE, à défaut de GOOGLE_TOKEN_KEY (32 octets en base64, déjà posée
 * sur Railway) : aucune nouvelle variable n'est indispensable, et la clé qui
 * chiffre les jetons Google n'est jamais utilisée telle quelle.
 *
 * Format du fichier : « CSWB1 » (5 octets) + IV (12) + étiquette GCM (16) + contenu chiffré.
 * Le contenu clair est l'archive .db.gz (gzip) de la copie vérifiée de la base.
 * Déchiffrer : scripts/dechiffrer-sauvegarde.mjs. Module .mjs : lisible par le
 * CRM (TypeScript) et par le script de restauration (Node seul).
 */

export const MAGIE = Buffer.from("CSWB1", "latin1");
const SEL = "coverswap-sauvegarde";
const INFO = "sauvegarde-drive-v1";

/** La clé de chiffrement des sauvegardes (32 octets), ou null si aucune variable utilisable n'est posée. */
export function cleSauvegarde(brute = process.env.SAUVEGARDE_CLE || process.env.GOOGLE_TOKEN_KEY) {
  if (!brute) return null;
  const secret = Buffer.from(brute.trim(), "base64");
  if (secret.length !== 32) return null;
  return Buffer.from(hkdfSync("sha256", secret, SEL, INFO, 32));
}

export function chiffrerTampon(contenu, cle) {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle, iv);
  const corps = Buffer.concat([chiffreur.update(contenu), chiffreur.final()]);
  return Buffer.concat([MAGIE, iv, chiffreur.getAuthTag(), corps]);
}

export function dechiffrerTampon(chiffre, cle) {
  if (chiffre.length < MAGIE.length + 12 + 16 || !chiffre.subarray(0, MAGIE.length).equals(MAGIE)) {
    throw new Error("Ce fichier n'est pas une sauvegarde chiffrée du CRM (en-tête CSWB1 absent).");
  }
  const iv = chiffre.subarray(MAGIE.length, MAGIE.length + 12);
  const etiquette = chiffre.subarray(MAGIE.length + 12, MAGIE.length + 28);
  const corps = chiffre.subarray(MAGIE.length + 28);
  const dechiffreur = createDecipheriv("aes-256-gcm", cle, iv);
  dechiffreur.setAuthTag(etiquette);
  return Buffer.concat([dechiffreur.update(corps), dechiffreur.final()]);
}
