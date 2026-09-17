import { createHash, timingSafeEqual } from "node:crypto";

// Secret partagé des webhooks (site, n8n, Zapier, scripts) : WEBHOOK_SECRET.
// Pour en changer sans perdre de lead, WEBHOOK_SECRET_PRECEDENT garde l'ancien
// accepté le temps de mettre à jour chaque expéditeur, puis se retire.

/** Secrets acceptés, dans l'ordre : l'actuel, le précédent (rotation en cours), un repli éventuel. */
export function secretsWebhook(repli?: string | null): string[] {
  const actuel = process.env.WEBHOOK_SECRET?.trim() || repli?.trim() || "";
  const precedent = process.env.WEBHOOK_SECRET_PRECEDENT?.trim() || "";
  return [...new Set([actuel, precedent].filter(Boolean))];
}

const empreinte = (valeur: string) => createHash("sha256").update(valeur, "utf8").digest();

/** Le secret reçu est-il l'un des secrets acceptés ? Comparaison à temps constant. */
export function secretWebhookValide(recu: string | null | undefined, secrets: string[] = secretsWebhook()): boolean {
  if (!recu || secrets.length === 0) return false;
  const empreinteRecue = empreinte(recu.trim());
  let valide = false;
  for (const secret of secrets) valide = timingSafeEqual(empreinteRecue, empreinte(secret)) || valide;
  return valide;
}
