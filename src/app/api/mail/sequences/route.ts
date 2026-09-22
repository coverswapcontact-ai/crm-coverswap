import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerSequences } from "@/lib/mail/sequences";

export const dynamic = "force-dynamic";

/** GET : les séquences (inactives à la livraison), leurs étapes, leurs inscrits, ce qui attend une validation. */
export async function GET() {
  try {
    return NextResponse.json({ sequences: await listerSequences() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/sequences");
  }
}
