import { NextRequest, NextResponse } from "next/server";
import { largeurPhotoSite, lirePhotoPublique, lirePhotoPubliqueReduite } from "@/lib/site/publications";

/**
 * GET /api/site/photos/<publication>/<avant|apres>[?l=480|960|1600] — la photo
 * d'une publication publiée ; avec `l` (mission 16, partie 3), un WebP réduit à
 * cette largeur pour le `srcset` du site. Rien d'autre du dossier des
 * téléversements n'est joignable sans session.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; quelle: string }> }) {
  const { id, quelle } = await ctx.params;
  if (!/^[a-z0-9]{10,40}$/i.test(id) || (quelle !== "avant" && quelle !== "apres")) return new NextResponse(null, { status: 404 });
  const largeur = largeurPhotoSite(req.nextUrl.searchParams.get("l"));
  const photo = largeur ? await lirePhotoPubliqueReduite(id, quelle, largeur) : await lirePhotoPublique(id, quelle);
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.contenu), {
    headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=86400, s-maxage=86400", "Access-Control-Allow-Origin": "*" },
  });
}
