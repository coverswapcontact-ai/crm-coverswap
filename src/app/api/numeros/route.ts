import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { numerosLibres } from "@/lib/dossiers/registre";

export const dynamic = "force-dynamic";

/**
 * GET : les numéros émis hors du CRM pas encore rattachés à un document
 * (rattachement d'un devis ou d'une facture existants). Mission 13 (lot 7) :
 * l'écran Registre des numéros est retiré, Paramètres → Facturation porte la
 * numérotation ; cette lecture reste pour DocumentExistant et RepriseDossier.
 */
export async function GET() {
  try {
    return NextResponse.json({ libres: await numerosLibres() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/numeros");
  }
}
