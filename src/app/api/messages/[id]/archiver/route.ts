import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { archiverMessage } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

/** POST : bruit ; le mail est retiré de la boîte de réception (jamais supprimé). */
export async function POST(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await archiverMessage(id));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/archiver");
  }
}
