import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { envoyerPushWeb } from "@/lib/alertes/pushweb";

export const dynamic = "force-dynamic";

/** POST : envoie une notification d'essai aux appareils abonnés (push web seulement). */
export async function POST() {
  try {
    const resultat = await envoyerPushWeb(
      { titre: "Notifications actives", texte: "Cet appareil recevra les nouveaux leads, les SMS des clients et leurs gestes dans leur espace.", lien: "/leads", etiquette: "essai" },
      { application: "crm" }
    );
    return NextResponse.json({ resultat });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/push/essai");
  }
}
