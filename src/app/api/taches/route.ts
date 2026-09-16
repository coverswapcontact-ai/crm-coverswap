import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { etatDesTaches } from "@/lib/taches/lecture";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await etatDesTaches());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/taches");
  }
}
