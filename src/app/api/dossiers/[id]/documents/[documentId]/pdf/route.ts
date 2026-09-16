import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/dossiers/api";
import { lirePdfDocument } from "@/lib/dossiers/documents";

/** PDF archivé d'un document. `?telecharger=1` force le téléchargement. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const { id, documentId } = await params;
    const { contenu, nomFichier } = await lirePdfDocument(id, documentId);
    const disposition = request.nextUrl.searchParams.get("telecharger") === "1" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(contenu), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${nomFichier}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/documents/[documentId]/pdf");
  }
}
