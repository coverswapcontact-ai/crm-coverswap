import { NextResponse } from "next/server";
import { publicationsPubliees } from "@/lib/site/publications";

/**
 * GET /api/site/publications — réalisations et avis publiés, pour le site.
 * Public par construction : ne renvoie que ce qui a été publié avec accord,
 * sans nom complet ni identifiant de client. Mis en cache cinq minutes.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const publications = await publicationsPubliees();
    return NextResponse.json(
      { publications, calculeLe: new Date().toISOString() },
      { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300, s-maxage=300" } }
    );
  } catch (err) {
    console.error("[site/publications] lecture impossible :", err);
    return NextResponse.json({ publications: [] }, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
}
