import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePhotoRetiree } from "@/lib/espace/vue-crm";

export const dynamic = "force-dynamic";

/** Une photo que le client a retirée de son espace : gardée, visible de Lucas seul (session du CRM). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const { id, photoId } = await params;
    const { contenu, type } = await lirePhotoRetiree(id, photoId);
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/espace/photos-retirees/[photoId]");
  }
}
