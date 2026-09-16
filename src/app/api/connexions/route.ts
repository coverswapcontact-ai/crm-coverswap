import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { etatMiroir } from "@/lib/drive/synchronisation";
import { etatConnexionGoogle } from "@/lib/google/connexion";

export const dynamic = "force-dynamic";

/** GET : état de la connexion Google et du miroir Drive. */
export async function GET() {
  try {
    const [google, drive] = await Promise.all([etatConnexionGoogle(), etatMiroir()]);
    return NextResponse.json({ google, drive });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/connexions");
  }
}
