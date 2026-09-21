import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { photoDePreparation } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";

/** GET : la photo « avant », cadrée au format de ChatGPT, à pleine résolution (?telecharger=1 : en pièce jointe). */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { contenu, type } = await photoDePreparation(id);
    const nom = `photo-avant-${id.slice(-6)}.jpg`;
    return new NextResponse(new Uint8Array(contenu), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", ...(requete.nextUrl.searchParams.get("telecharger") ? { "Content-Disposition": `attachment; filename="${nom}"` } : { "Content-Disposition": `inline; filename="${nom}"` }) },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/preparations/[id]/photo");
  }
}
