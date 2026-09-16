import { NextRequest, NextResponse } from "next/server";
import { lireFormulaire, reponseErreur } from "@/lib/dossiers/api";
import { lirePdfDocument } from "@/lib/dossiers/documents";
import { importerPdfDocument } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

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

/** POST : PDF d'un document repris (champ « pdf », un fichier) ; un PDF remplacé reste aux archives. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const fichier = (await lireFormulaire(request)).get("pdf");
    if (!(fichier instanceof File)) throw new ErreurMetier("Choisis le PDF du document.", 400);
    await importerPdfDocument(id, documentId, fichier);
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/[documentId]/pdf");
  }
}
