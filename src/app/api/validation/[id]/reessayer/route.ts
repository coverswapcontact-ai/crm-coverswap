import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { reessayerExecution } from "@/lib/validation/service";

/** POST : relance l'exécution d'une proposition validée restée en échec. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ proposition: await reessayerExecution(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/validation/[id]/reessayer");
  }
}
