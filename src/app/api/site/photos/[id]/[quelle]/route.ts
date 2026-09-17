import { NextRequest, NextResponse } from "next/server";
import { lirePhotoPublique } from "@/lib/site/publications";

/**
 * GET /api/site/photos/<publication>/<avant|apres> — la photo d'une publication
 * publiée. Rien d'autre du dossier des téléversements n'est joignable sans session.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; quelle: string }> }) {
  const { id, quelle } = await ctx.params;
  if (!/^[a-z0-9]{10,40}$/i.test(id) || (quelle !== "avant" && quelle !== "apres")) return new NextResponse(null, { status: 404 });
  const photo = await lirePhotoPublique(id, quelle);
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.contenu), {
    headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=86400, s-maxage=86400", "Access-Control-Allow-Origin": "*" },
  });
}
