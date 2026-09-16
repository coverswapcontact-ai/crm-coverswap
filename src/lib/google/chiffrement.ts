import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement des jetons Google (AES-256-GCM). La clé vient de GOOGLE_TOKEN_KEY
 * (32 octets en base64), jamais de la base : une copie de la base seule ne
 * donne pas accès au compte.
 */

const VERSION = "v1";

export function lireCle(brute: string | undefined): Buffer | null {
  if (!brute) return null;
  const cle = Buffer.from(brute, "base64");
  return cle.length === 32 ? cle : null;
}

export function chiffrer(texte: string, cle: Buffer): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle, iv);
  const contenu = Buffer.concat([chiffreur.update(texte, "utf8"), chiffreur.final()]);
  return [VERSION, iv.toString("base64"), chiffreur.getAuthTag().toString("base64"), contenu.toString("base64")].join(":");
}

export function dechiffrer(chiffre: string, cle: Buffer): string {
  const [version, iv, etiquette, contenu] = chiffre.split(":");
  if (version !== VERSION || !iv || !etiquette || !contenu) throw new Error("Jeton chiffré illisible");
  const dechiffreur = createDecipheriv("aes-256-gcm", cle, Buffer.from(iv, "base64"));
  dechiffreur.setAuthTag(Buffer.from(etiquette, "base64"));
  return Buffer.concat([dechiffreur.update(Buffer.from(contenu, "base64")), dechiffreur.final()]).toString("utf8");
}
