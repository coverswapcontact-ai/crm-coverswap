import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/dossiers/api";
import { lirePhoto, supprimerPhoto } from "@/lib/dossiers/dossiers";

type Contexte = { params: Promise<{ id: string; photoId: string }> };

// L'URL ne porte pas d'extension de fichier : elle passe toujours par le
// middleware (session obligatoire), quel que soit son matcher.
export async function GET(_request: NextRequest, { params }: Contexte) {
  try {
    const { id, photoId } = await params;
    const { contenu, type } = await lirePhoto(id, photoId);
    return new NextResponse(new Uint8Array(contenu), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/photos/[photoId]");
  }
}

export async function DELETE(_request: NextRequest, { params }: Contexte) {
  try {
    const { id, photoId } = await params;
    await supprimerPhoto(id, photoId);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "DELETE /api/dossiers/[id]/photos/[photoId]");
  }
}
