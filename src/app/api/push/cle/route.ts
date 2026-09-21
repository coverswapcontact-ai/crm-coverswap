import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { clesVapid, compterAbonnes } from "@/lib/alertes/pushweb";

export const dynamic = "force-dynamic";

/** GET : la clé publique du serveur, dont le navigateur a besoin pour s'abonner aux notifications. */
export async function GET() {
  try {
    return NextResponse.json({ clePublique: (await clesVapid()).publique, appareils: await compterAbonnes() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/push/cle");
  }
}
