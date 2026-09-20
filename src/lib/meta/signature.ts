import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature des appels de Meta (webhook Lead Ads).
 *
 * Meta signe le corps BRUT de la requête avec le secret de l'application et
 * envoie « X-Hub-Signature-256: sha256=<hexadécimal> ». L'endpoint est public
 * et sera sondé : sans signature valable, rien n'est lu, rien n'est écrit.
 *
 * Fonction pure, comparaison à temps constant, testée.
 */
export type VerdictSignature = { ok: true } | { ok: false; raison: "secret-absent" | "entete-absente" | "format" | "invalide" };

export function verifierSignatureMeta(corpsBrut: string, entete: string | null, secret: string | undefined): VerdictSignature {
  // Sans secret configuré, on refuse : une vérification qu'on croit active et qui laisse tout passer est pire que rien.
  if (!secret) return { ok: false, raison: "secret-absent" };
  if (!entete) return { ok: false, raison: "entete-absente" };
  if (!entete.startsWith("sha256=")) return { ok: false, raison: "format" };
  const recue = entete.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recue)) return { ok: false, raison: "format" };
  const attendue = createHmac("sha256", secret).update(corpsBrut, "utf8").digest("hex");
  const a = Buffer.from(attendue, "hex");
  const b = Buffer.from(recue, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, raison: "invalide" };
}

/** La signature telle que Meta l'enverrait : sert aux essais et au mode test. */
export function signerCommeMeta(corpsBrut: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(corpsBrut, "utf8").digest("hex")}`;
}

export const MESSAGES_REFUS: Record<Exclude<VerdictSignature, { ok: true }>["raison"], string> = {
  "secret-absent": "META_APP_SECRET n'est pas configurée : le webhook refuse tout.",
  "entete-absente": "En-tête X-Hub-Signature-256 absente.",
  format: "En-tête X-Hub-Signature-256 mal formée.",
  invalide: "Signature invalide.",
};
