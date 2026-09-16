import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/dossiers/api";
import { TYPES_DOCUMENT, type TypeDocument } from "@/lib/dossiers/constants";
import { ErreurMetier } from "@/lib/dossiers/erreurs";
import { prochainNumero } from "@/lib/dossiers/numerotation";

/** Numéro que recevrait le prochain devis ou la prochaine facture (indicatif). */
export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type") ?? "";
    if (!(TYPES_DOCUMENT as readonly string[]).includes(type)) {
      throw new ErreurMetier("Type de document invalide.");
    }
    return NextResponse.json({ numero: await prochainNumero(type as TypeDocument) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/numerotation");
  }
}
