import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { annulerReponse } from "@/lib/a-faire/reponses";
import { idDeTache } from "../../parametres";

export const dynamic = "force-dynamic";

/** POST /api/a-faire/<id>/annuler : « Annuler » — l'état d'avant la dernière réponse ; dit ce qui n'a pas pu être défait. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idDeTache((await params).id);
    return NextResponse.json(await annulerReponse(id, new Date()));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/[id]/annuler");
  }
}
