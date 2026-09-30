import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { tachesDuLot } from "@/lib/a-faire/lecture";
import { cleDeLot } from "../../parametres";

export const dynamic = "force-dynamic";

/** GET /api/a-faire/lots/<lot> : les tâches d'un lot, dans l'ordre de la liste (« Revoir un par un »). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ lot: string }> }) {
  try {
    const lot = cleDeLot((await params).lot);
    return NextResponse.json({ lot, taches: await tachesDuLot(lot, new Date()) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/a-faire/lots/[lot]");
  }
}
