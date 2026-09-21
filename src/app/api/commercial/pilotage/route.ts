import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { pilotageCommercial } from "@/lib/commercial/pilotage";

export const dynamic = "force-dynamic";

/** GET : toutes les affaires vivantes, avec à qui est la main. */
export async function GET() {
  try {
    return NextResponse.json(await pilotageCommercial());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/commercial/pilotage");
  }
}
