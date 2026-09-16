import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { etatMiroir } from "@/lib/drive/synchronisation";
import { etatConnexionGoogle } from "@/lib/google/connexion";
import { etatAgentMail } from "@/lib/messages/consultation";

export const dynamic = "force-dynamic";

/** GET : état de la connexion Google, du miroir Drive et de l'agent mail. */
export async function GET() {
  try {
    const [google, drive, agent] = await Promise.all([etatConnexionGoogle(), etatMiroir(), etatAgentMail()]);
    return NextResponse.json({ google, drive, agent });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/connexions");
  }
}
