import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { chargerFiche, restaurerClient } from "@/lib/clients/fiches";

export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await restaurerClient(id);
    return NextResponse.json({ client: await chargerFiche(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/restaurer");
  }
}
