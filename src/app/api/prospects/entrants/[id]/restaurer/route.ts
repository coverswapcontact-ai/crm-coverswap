import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { chargerEntrant, restaurerEntrant } from "@/lib/prospects/entrants";

export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await restaurerEntrant(id);
    return NextResponse.json({ entrant: await chargerEntrant(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/entrants/[id]/restaurer");
  }
}
