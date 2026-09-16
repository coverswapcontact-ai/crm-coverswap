import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/dossiers/api";
import { rechercherLeads } from "@/lib/dossiers/leads";

/** Recherche de leads et prospects pour « Ouvrir un dossier depuis un lead ». */
export async function GET(request: NextRequest) {
  try {
    const recherche = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ resultats: await rechercherLeads(recherche) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/leads");
  }
}
