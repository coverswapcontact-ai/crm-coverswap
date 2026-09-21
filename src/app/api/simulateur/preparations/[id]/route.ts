import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePreparation } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";

/** GET : une préparation (l'écran suit ainsi une génération par l'API jusqu'à son brouillon). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ preparation: await lirePreparation(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/preparations/[id]");
  }
}
