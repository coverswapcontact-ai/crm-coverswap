import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { imageRenduBanc } from "@/lib/simulateur/banc/banc";

export const dynamic = "force-dynamic";

/** GET : l'image d'un rendu du banc (derrière la session ; ?telecharger=1 : en pièce jointe). */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { contenu, type } = await imageRenduBanc(id);
    const nom = `banc-${id.slice(-6)}.${type === "image/png" ? "png" : "jpg"}`;
    return new NextResponse(new Uint8Array(contenu), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400, immutable", "Content-Disposition": `${requete.nextUrl.searchParams.get("telecharger") ? "attachment" : "inline"}; filename="${nom}"` },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/banc/[id]/image");
  }
}
