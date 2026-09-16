import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { demanderRelecture } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

/** POST : nouvelle lecture par l'IA, en tâche de fond (dans la limite du budget). */
export async function POST(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    await demanderRelecture(id);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/relire");
  }
}
