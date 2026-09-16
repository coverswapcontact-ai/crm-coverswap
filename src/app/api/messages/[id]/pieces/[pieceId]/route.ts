import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePieceMessage } from "@/lib/messages/consultation";

type Contexte = { params: Promise<{ id: string; pieceId: string }> };

// Pas d'extension dans l'URL : la route passe toujours par le proxy (session obligatoire).
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id, pieceId } = await params;
    const { contenu, typeMime, nom } = await lirePieceMessage(id, pieceId);
    return new NextResponse(new Uint8Array(contenu), {
      headers: {
        "Content-Type": typeMime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nom)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messages/[id]/pieces/[pieceId]");
  }
}
