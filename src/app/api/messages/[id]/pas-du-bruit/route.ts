import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { annulerBruit } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

/** POST : « ce n'est pas du bruit » : à trier de nouveau, remis dans la boîte de réception. */
export async function POST(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    await annulerBruit(id);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/pas-du-bruit");
  }
}
