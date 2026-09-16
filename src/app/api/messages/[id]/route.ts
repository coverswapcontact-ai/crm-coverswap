import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { detailMessage } from "@/lib/messages/consultation";

type Contexte = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** GET : le message, son texte, ses pièces, les analyses de l'agent et sa conversation. */
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await detailMessage(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messages/[id]");
  }
}
