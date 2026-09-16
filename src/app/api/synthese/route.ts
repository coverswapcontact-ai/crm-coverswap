import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePeriode, lireSynthese } from "@/lib/synthese/requete";

export const dynamic = "force-dynamic";

/** GET : synthèse d'une période (structurée, rédigée), alertes du jour ; noms ou pseudonymes. */
export async function GET(requete: NextRequest) {
  try {
    const { du, au, anonyme } = lirePeriode(requete.nextUrl.searchParams);
    return NextResponse.json(await lireSynthese(du, au, anonyme));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/synthese");
  }
}
