import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { bilanTri } from "@/lib/mail/vues";

export const dynamic = "force-dynamic";

/** GET : bilan du tri, en lecture seule (boîte, vues, ce qui est rangé et pourquoi). */
export async function GET() {
  try {
    return NextResponse.json(await bilanTri());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/bilan");
  }
}
