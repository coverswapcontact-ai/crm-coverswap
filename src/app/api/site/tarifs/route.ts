import { NextResponse, type NextRequest } from "next/server";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { tarifsPublics, tarifsPublicsSansPrix } from "@/lib/site/tarifs-publics";

/**
 * GET /api/site/tarifs — les prix unitaires des sous-parties et les formats de pièce, pour l'estimation que le site
 * affiche après un rendu (mission 16, partie 4). Lecture seule : aucune désignation interne, aucune marge, `null`
 * quand aucun tarif n'est attribué (`lib/site/tarifs-publics.ts`). Route publique (routes-publiques.ts).
 *
 * Rendue à la demande, pas au build (`force-dynamic` et non `force-static`) : elle lit la base, que le build de
 * Railway n'a pas (le volume n'est monté qu'au démarrage). Le cache d'une heure est tenu par l'en-tête et par le
 * site (`revalidate` 3600). CORS ouvert et limite par IP, comme les avis Google.
 */
export const dynamic = "force-dynamic";

const ENTETES = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
  if (ipDepasseLaLimite(`tarifs:${ip}`, Date.now(), 120)) {
    return NextResponse.json(tarifsPublicsSansPrix(), { status: 429, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await tarifsPublics(), { headers: ENTETES });
  } catch (err) {
    console.error("[site/tarifs] lecture impossible :", err instanceof Error ? err.message : err);
    return NextResponse.json(tarifsPublicsSansPrix(), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
}
