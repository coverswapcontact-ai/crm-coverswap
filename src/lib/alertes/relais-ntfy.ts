import { createHmac } from "node:crypto";
import { decrireErreur } from "./reseau";

/**
 * Passerelle vers ntfy.sh par le site coverswap.fr.
 *
 * Constat du 21/09/2026 (sonde /api/health?reseau=1) : ntfy.sh laisse sans
 * réponse les connexions TCP venant de Railway — l'adresse de sortie, partagée
 * entre clients de l'hébergeur, y est filtrée — alors que Telegram, Brevo et
 * coverswap.fr répondent en quelques millisecondes. Le site (Vercel) sort par
 * une autre adresse : le CRM lui confie l'envoi, signé d'un secret que les
 * deux partagent déjà (celui du simulateur, à défaut celui des webhooks).
 * Aucune variable nouvelle à poser. `NTFY_RELAIS=0` coupe la passerelle,
 * `NTFY_RELAIS_URL` la déplace.
 */
const RELAIS_PAR_DEFAUT = "https://coverswap.fr/api/relais/ntfy";

export function relaisNtfyDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NTFY_RELAIS === "0") return false;
  // Le relais ne sert que ntfy.sh : un serveur ntfy personnel se joint en direct.
  const serveur = (env.NTFY_SERVEUR || "https://ntfy.sh").replace(/\/$/, "");
  return serveur === "https://ntfy.sh" && secretsDeSignature(env).length > 0;
}

function secretsDeSignature(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([env.SIMULATE_TOKEN_SECRET, env.WEBHOOK_SECRET, env.WEBHOOK_SECRET_PRECEDENT].map((s) => s?.trim() ?? "").filter(Boolean))];
}

export type DemandeRelais = { sujet: string; titre: string; priorite: string; tags: string; actions: string; texte: string; jeton?: string };

/** Envoie par la passerelle. Lève avec une raison lisible si elle échoue. */
export async function envoyerParRelais(demande: DemandeRelais, delaiMs = 12_000): Promise<{ status: number }> {
  const corps = JSON.stringify(demande);
  const horodatage = String(Date.now());
  // Une signature par secret connu : le site accepte celle qui correspond au sien
  // (utile pendant une rotation du secret des webhooks).
  const signatures = secretsDeSignature().map((secret) => createHmac("sha256", secret).update(`${horodatage}.${corps}`, "utf8").digest("hex"));
  let reponse: Response;
  try {
    reponse = await fetch(process.env.NTFY_RELAIS_URL || RELAIS_PAR_DEFAUT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relais-Horodatage": horodatage, "X-Relais-Signature": signatures.join(",") },
      body: corps,
      signal: AbortSignal.timeout(delaiMs),
    });
  } catch (erreur) {
    throw new Error(`passerelle injoignable : ${decrireErreur(erreur)}`);
  }
  if (!reponse.ok) throw new Error(`passerelle : HTTP ${reponse.status} ${(await reponse.text()).slice(0, 200)}`);
  return { status: reponse.status };
}
