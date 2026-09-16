import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerInstantanes } from "@/lib/synthese/instantanes";

export const dynamic = "force-dynamic";

/** GET : mois figés, du plus récent au plus ancien. */
export async function GET() {
  try {
    return NextResponse.json(await listerInstantanes());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/synthese/instantanes");
  }
}
