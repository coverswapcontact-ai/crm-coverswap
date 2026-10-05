import { NextRequest, NextResponse } from "next/server";
import { enregistrerPaiementStripe } from "@/lib/paiement/carte";
import { lireSessionPayee, MESSAGES_REFUS_STRIPE, verifierSignatureStripe } from "@/lib/paiement/stripe";

/**
 * Mission 18 (B10) — webhook Stripe : l'adresse que Stripe appelle quand un client a payé depuis son espace (« Payer par
 * carte », acompte ou solde ; carte, ou paiement en plusieurs fois si Lucas l'a activé dans Stripe).
 *
 * - La signature Stripe-Signature est vérifiée sur le corps BRUT, à temps constant, avec STRIPE_WEBHOOK_SECRET
 *   (5 minutes de tolérance) ; sans elle, rien n'est lu ni écrit (401 ; 503 si le secret n'est pas posé).
 * - Seules les sessions réglées s'enregistrent (`checkout.session.completed` payée, `async_payment_succeeded`) ; tout
 *   autre événement est acquitté sans rien écrire.
 * - Idempotent : la session porte une clé unique sur l'encaissement ; Stripe qui rejoue un événement reçoit 200, rien
 *   n'est écrit deux fois. Une écriture impossible répond 500 : Stripe rejouera.
 *
 * L'endpoint est public (routes-publiques) et sera sondé.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const brut = await request.text();
  const verdict = verifierSignatureStripe(brut, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined, Math.floor(Date.now() / 1000));
  if (!verdict.ok) {
    console.warn(`[stripe-webhook] appel refusé : ${MESSAGES_REFUS_STRIPE[verdict.raison]}`);
    return NextResponse.json({ error: "Signature invalide." }, { status: verdict.raison === "secret-absent" ? 503 : 401 });
  }

  let charge: unknown;
  try {
    charge = JSON.parse(brut);
  } catch {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const lue = lireSessionPayee(charge);
  if ("ignore" in lue) return NextResponse.json({ recu: true, statut: "IGNORE", raison: lue.ignore });

  try {
    const issue = await enregistrerPaiementStripe(lue.session);
    console.log(`[stripe-webhook] session ${lue.session.sessionId} : ${issue.statut}${issue.raison ? ` (${issue.raison})` : ""}.`);
    return NextResponse.json({ recu: true, ...issue });
  } catch (erreur) {
    console.error(`[stripe-webhook] enregistrement impossible pour la session ${lue.session.sessionId} :`, erreur);
    return NextResponse.json({ error: "Enregistrement impossible, à rejouer." }, { status: 500 });
  }
}
