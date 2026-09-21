import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { resoudreContexte } from "@/lib/journal/acteur";
import { enregistrerAbonnement, retirerAbonnement } from "@/lib/alertes/pushweb";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["abonner", "desabonner"]).default("abonner"),
  application: z.enum(["crm", "messages"]).default("crm"),
  abonnement: z.object({
    endpoint: z.url("Abonnement invalide.").max(1000),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(8).max(300) }).optional(),
  }),
});

/** POST : cet appareil veut (ou ne veut plus) recevoir les notifications du CRM. */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.action === "desabonner") {
      await retirerAbonnement(entree.abonnement.endpoint);
      return NextResponse.json({ abonne: false });
    }
    if (!entree.abonnement.keys) return NextResponse.json({ error: "Abonnement incomplet : clés de chiffrement manquantes." }, { status: 400 });
    const { acteur } = await resoudreContexte();
    await enregistrerAbonnement({
      endpoint: entree.abonnement.endpoint,
      p256dh: entree.abonnement.keys.p256dh,
      auth: entree.abonnement.keys.auth,
      application: entree.application,
      utilisateur: acteur.startsWith("HUMAIN:") ? acteur.slice(7) : null,
      appareil: requete.headers.get("user-agent"),
    });
    return NextResponse.json({ abonne: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/push/abonnement");
  }
}
