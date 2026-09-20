import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { secretWebhookValide, secretsWebhook } from "@/lib/acces/secret-webhook";
import { recevoirLeadDuPont } from "@/lib/meta/leads";
import { CANAUX_PUSH } from "@/lib/alertes/canaux";

/**
 * WEBHOOK — pont Zapier pour les leads Meta Ads.
 *
 * Zapier livre le lead à plat, réponses comprises : ce chemin n'a besoin
 * d'aucune permission Meta, contrairement au webhook natif (/api/webhook/meta)
 * qui doit aller lire les réponses dans l'API Graph.
 *
 * Depuis le 20/09/2026 les deux chemins aboutissent au MÊME traitement
 * (src/lib/meta/leads) : champs normalisés, campagne, ensemble et publicité
 * conservés, déduplication sur le téléphone et l'e-mail, notification immédiate
 * sur tous les canaux, relance à trente minutes, et visibilité dans l'écran
 * Publicité. Avant, cette route écrivait un contact à part, sans rien de tout ça.
 *
 * Config Zapier (action « Webhooks by Zapier » → POST) :
 *   URL    : https://crm.coverswap.fr/api/webhook/zapier?secret=<WEBHOOK_SECRET>
 *   Data   : full_name (ou first_name + last_name), phone_number, email, city,
 *            post_code, form_name, form_id, page_id, leadgen_id, created_time,
 *            campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name.
 * Toute autre clé envoyée est gardée comme réponse du formulaire.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (!secretWebhookValide(searchParams.get("secret"), secretsWebhook(process.env.META_VERIFY_TOKEN))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  let corps: Record<string, unknown>;
  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  try {
    const resultat = await recevoirLeadDuPont(corps, "Zapier");
    revalidatePath("/prospects");
    revalidatePath("/publicite");
    return NextResponse.json({
      success: true,
      leadId: resultat.leadId,
      // `created` reste dans la réponse : Zapier l'affiche dans son historique.
      created: resultat.nouveau && !resultat.rattache,
      rattacheAUnContactExistant: resultat.rattache,
      // Une ligne par canal, y compris ceux qui ne sont pas configurés : la
      // réponse que Zapier archive doit dire si le téléphone a sonné.
      notifications: resultat.notifications,
      pousseRecue: resultat.notifications.some((n) => n.ok && CANAUX_PUSH.includes(n.canal)),
      ...(resultat.notifications.some((n) => n.ok && CANAUX_PUSH.includes(n.canal))
        ? {}
        : { avertissement: "Aucune notification poussée n'est partie : voir /publicite ou /api/webhook/diagnostic." }),
    });
  } catch (erreur) {
    // Ne pas acquitter : Zapier rejouera, et le leadgen_id garantit l'absence de doublon.
    console.error("[zapier-webhook] échec :", erreur);
    return NextResponse.json({ error: "Traitement impossible, à rejouer.", message: erreur instanceof Error ? erreur.message : "inconnu" }, { status: 503 });
  }
}

/** GET = point de santé, utilisé par Zapier pendant la configuration (« Test Request »). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (!secretWebhookValide(searchParams.get("secret"), secretsWebhook(process.env.META_VERIFY_TOKEN))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, endpoint: "zapier-webhook", message: "Prêt à recevoir des leads depuis Zapier" });
}
