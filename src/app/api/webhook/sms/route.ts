import { NextRequest, NextResponse } from "next/server";
import { secretRequeteValide, secretsWebhook } from "@/lib/acces/secret-webhook";
import { enregistrerSmsEntrant } from "@/lib/sms/reception";

/**
 * WEBHOOK — SMS entrant poussé par un fournisseur.
 *
 * OVH se relève (pas de webhook) ; cette route sert aux fournisseurs qui
 * POUSSENT les réponses. Elle accepte une forme neutre, et les variantes
 * courantes des champs :
 *   { "de": "+33612345678", "texte": "Bonjour", "id": "abc", "date": "2026-09-21T10:00:00Z" }
 *   (alias : from/sender/msisdn · text/message/content/body · messageId/message_id · date/timestamp/receivedAt)
 *
 *   URL : https://crm.coverswap.fr/api/webhook/sms?fournisseur=<nom>  avec l'en-tête X-Webhook-Secret: <WEBHOOK_SECRET>  (« ?secret= » toléré jusqu'au 26/10/2026)
 *
 * Idempotent par l'identifiant du message ; sans identifiant, une empreinte du
 * contenu et de la minute en tient lieu. Protection : le secret partagé des
 * webhooks, comparé à temps constant.
 */
export const dynamic = "force-dynamic";

const premier = (objet: Record<string, unknown>, cles: string[]): string | null => {
  for (const cle of cles) {
    const valeur = objet[cle];
    if (typeof valeur === "string" && valeur.trim()) return valeur.trim();
    if (typeof valeur === "number") return String(valeur);
  }
  return null;
};

export async function POST(requete: NextRequest) {
  const parametres = new URL(requete.url).searchParams;
  // Mission 13 : secret dans l'en-tête X-Webhook-Secret ; « ?secret= » toléré jusqu'au 26/10/2026 (secret-webhook.ts).
  if (!secretRequeteValide(requete, "POST /api/webhook/sms", secretsWebhook())) return NextResponse.json({ error: "Non autorise" }, { status: 403 });

  let corps: Record<string, unknown>;
  try {
    const type = requete.headers.get("content-type") ?? "";
    corps = type.includes("form") ? Object.fromEntries((await requete.formData()).entries()) : ((await requete.json()) as Record<string, unknown>);
  } catch {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const numero = premier(corps, ["de", "from", "sender", "msisdn", "numero", "phone"]);
  const texte = premier(corps, ["texte", "text", "message", "content", "body"]) ?? "";
  if (!numero) return NextResponse.json({ error: "Expéditeur manquant (champ « de », « from » ou « sender »)." }, { status: 400 });
  const date = premier(corps, ["date", "timestamp", "receivedAt", "received_at", "creationDatetime"]);
  const recuLe = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : new Date();
  const fournisseur = (parametres.get("fournisseur") ?? "webhook").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "webhook";
  const identifiant = premier(corps, ["id", "messageId", "message_id", "reference"]) ?? `sans-id:${numero}:${Math.floor(recuLe.getTime() / 60_000)}:${texte.length}:${texte.slice(0, 24)}`;

  try {
    const resultat = await enregistrerSmsEntrant({ identifiant, numero, texte, recuLe }, fournisseur);
    return NextResponse.json({ recu: true, nouveau: resultat?.nouveau ?? false, stop: resultat?.stop ?? false });
  } catch (erreur) {
    console.error("[webhook-sms] échec :", erreur);
    // 503 : le fournisseur rejouera, et l'identifiant du message écarte le doublon.
    return NextResponse.json({ error: "Traitement impossible, à rejouer." }, { status: 503 });
  }
}
