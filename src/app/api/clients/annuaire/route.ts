import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { rechercherEntreprises } from "@/lib/clients/annuaire";

export const dynamic = "force-dynamic";

/** GET /api/clients/annuaire?q=… : établissements de l'annuaire public des entreprises (nom, SIREN ou SIRET). */
export async function GET(requete: NextRequest) {
  try {
    const resultats = await rechercherEntreprises(requete.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ resultats });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/clients/annuaire");
  }
}
