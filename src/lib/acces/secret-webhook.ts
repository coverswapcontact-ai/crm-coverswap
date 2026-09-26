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

/**
 * Mission 13 (lot 2) : le secret voyage dans l'en-tête `X-Webhook-Secret`
 * (comme le site le fait déjà). Le paramètre `?secret=` reste accepté jusqu'au
 * 26/10/2026, avec un avertissement dans les journaux du serveur : les journaux
 * d'accès (Railway, proxys) gardent les adresses, pas les en-têtes.
 */
export const EN_TETE_SECRET = "x-webhook-secret";
export const FIN_TOLERANCE_SECRET_ADRESSE = new Date("2026-10-26T00:00:00.000Z");

type RequeteAvecSecret = { headers: { get(nom: string): string | null }; url: string };

/** Le secret reçu et d'où il vient : l'en-tête d'abord, sinon l'adresse. */
export function secretDeLaRequete(requete: RequeteAvecSecret): { valeur: string | null; source: "en-tete" | "adresse" | null } {
  const enTete = requete.headers.get(EN_TETE_SECRET);
  if (enTete?.trim()) return { valeur: enTete, source: "en-tete" };
  const adresse = new URL(requete.url).searchParams.get("secret");
  if (adresse?.trim()) return { valeur: adresse, source: "adresse" };
  return { valeur: null, source: null };
}

/** Le secret de la requête est-il valide ? Dans l'adresse : accepté jusqu'à la date de fin de tolérance, en le disant. */
export function secretRequeteValide(requete: RequeteAvecSecret, route: string, secrets: string[] = secretsWebhook(), maintenant: Date = new Date()): boolean {
  const recu = secretDeLaRequete(requete);
  if (!secretWebhookValide(recu.valeur, secrets)) return false;
  if (recu.source === "adresse") {
    if (maintenant >= FIN_TOLERANCE_SECRET_ADRESSE) {
      console.warn(`[webhook] ${route} : secret reçu dans l'adresse (?secret=), refusé depuis le 26/10/2026 — passer à l'en-tête X-Webhook-Secret.`);
      return false;
    }
    console.warn(`[webhook] ${route} : secret reçu dans l'adresse (?secret=), toléré jusqu'au 26/10/2026 — passer à l'en-tête X-Webhook-Secret.`);
  }
  return true;
}
