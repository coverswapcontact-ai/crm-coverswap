import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { planMinutes } from "@/lib/a-faire/lecture";

export const dynamic = "force-dynamic";

/** GET /api/a-faire/minutes?m=15 : « J'ai 15 minutes » — ce qui tient, regroupé (« 3 appels · 10 min »). N'écrit rien. */
export async function GET(requete: NextRequest) {
  try {
    const minutes = Number(requete.nextUrl.searchParams.get("m"));
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) throw new ErreurMetier("Minutes : un nombre entier entre 1 et 480.", 400);
    return NextResponse.json(await planMinutes(minutes, new Date()));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/a-faire/minutes");
  }
}
