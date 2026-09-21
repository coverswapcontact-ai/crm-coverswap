import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerEspaces } from "@/lib/espace/suivi";

export const dynamic = "force-dynamic";

/** GET : tous les espaces clients — étape, ce que le client a fait, dernière visite, qui a la main, signaux. */
export async function GET() {
  try {
    return NextResponse.json({ espaces: await listerEspaces() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/espaces");
  }
}
