import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { controlerCoherence } from "@/lib/coherence/controle";

export const dynamic = "force-dynamic";

/** GET : le contrôle de cohérence, rejoué à la demande (lecture seule). */
export async function GET() {
  try {
    return NextResponse.json(await controlerCoherence());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/coherence");
  }
}
