import { NextRequest, NextResponse } from "next/server";
import { verifierSignatureMeta, MESSAGES_REFUS } from "@/lib/meta/signature";
import { accuserReceptionLeadgen, evenementsDeLaCharge } from "@/lib/meta/leads";

/**
 * Webhook Meta Lead Ads — l'adresse que Meta appelle à chaque formulaire rempli.
 *
 * GET  : vérification initiale de Meta (hub.mode, hub.verify_token, hub.challenge).
 * POST : un ou plusieurs événements `leadgen`. La charge de Meta ne contient que
 *        des identifiants ; les réponses se lisent ensuite dans l'API Graph.
 *
 * Trois exigences tenues ici :
 *  - la signature X-Hub-Signature-256 est vérifiée sur le corps BRUT, à temps
 *    constant, avec META_APP_SECRET ; sans elle, rien n'est lu ni écrit ;
 *  - la réponse part tout de suite : on n'enregistre que l'événement, le
 *    travail se fait en tâche de fond. Meta rejoue pendant 36 heures ce qu'il
 *    ne voit pas acquitté, et un traitement lent ferait des doublons ;
 *  - l'idempotence tient au `leadgen_id` : rejoué, il ne produit rien de neuf.
 *
 * L'endpoint est public (routes-publiques) et sera sondé : tout ce qui n'est
 * pas signé par Meta repart en 401 sans laisser de trace en base.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const parametres = request.nextUrl.searchParams;
  const mode = parametres.get("hub.mode");
  const jeton = parametres.get("hub.verify_token");
  const defi = parametres.get("hub.challenge");
  const attendu = process.env.META_VERIFY_TOKEN;

  if (!attendu) {
    console.error("[meta-webhook] META_VERIFY_TOKEN absente : vérification impossible.");
    return NextResponse.json({ error: "Webhook non configuré." }, { status: 503 });
  }
  if (mode === "subscribe" && jeton === attendu && defi) {
    console.log("[meta-webhook] vérification réussie.");
    return new Response(defi, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  console.warn("[meta-webhook] vérification refusée.");
  return NextResponse.json({ error: "Vérification échouée." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const brut = await request.text();
  const verdict = verifierSignatureMeta(brut, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET);
  if (!verdict.ok) {
    console.warn(`[meta-webhook] appel refusé : ${MESSAGES_REFUS[verdict.raison]}`);
    return NextResponse.json({ error: "Signature invalide." }, { status: verdict.raison === "secret-absent" ? 503 : 401 });
  }

  let charge: unknown;
  try {
    charge = JSON.parse(brut);
  } catch {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const evenements = evenementsDeLaCharge(charge);
  if (evenements.length === 0) {
    // Un autre champ que `leadgen` (ou une charge de test de Meta) : acquitté pour ne pas être rejoué.
    return NextResponse.json({ recu: true, leads: 0 });
  }

  const recus: { leadgenId: string; nouveau: boolean }[] = [];
  for (const evenement of evenements) {
    try {
      const { nouveau } = await accuserReceptionLeadgen(evenement);
      recus.push({ leadgenId: evenement.leadgenId, nouveau });
      console.log(`[meta-webhook] leadgen ${evenement.leadgenId} ${nouveau ? "reçu" : "déjà connu"}.`);
    } catch (erreur) {
      // Écriture impossible : ne pas acquitter, Meta rejouera.
      console.error(`[meta-webhook] enregistrement impossible pour ${evenement.leadgenId} :`, erreur);
      return NextResponse.json({ error: "Enregistrement impossible, à rejouer." }, { status: 503 });
    }
  }

  return NextResponse.json({ recu: true, leads: recus.length, nouveaux: recus.filter((r) => r.nouveau).length });
}
