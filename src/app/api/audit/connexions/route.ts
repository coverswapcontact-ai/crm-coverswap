import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { auditerConnexions } from "@/lib/audit/connexions";

export const dynamic = "force-dynamic";

/** GET : l'audit de connectivité, sur les vraies données, en lecture seule (session exigée par le proxy). */
export async function GET() {
  try {
    return NextResponse.json(await auditerConnexions());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/audit/connexions");
  }
}
