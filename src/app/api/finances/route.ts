import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { anneeDemandee } from "@/lib/finances/annee";
import { chargerTableauFinances } from "@/lib/finances/tableau";

export const dynamic = "force-dynamic";

/** GET : recettes, URSSAF, seuils, encours, chèques à créditer et points à corriger pour une année. */
export async function GET(requete: NextRequest) {
  try {
    return NextResponse.json(await chargerTableauFinances(anneeDemandee(requete.nextUrl.searchParams)));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/finances");
  }
}
