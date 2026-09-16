import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { depensesDuDossier } from "@/lib/depenses/service";

export const dynamic = "force-dynamic";

/** GET : dépenses rattachées à ce chantier et leur total. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await depensesDuDossier(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/depenses");
  }
}
