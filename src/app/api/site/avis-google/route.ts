import { NextResponse, type NextRequest } from "next/server";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { avisGoogle } from "@/lib/site/avis-google";

/**
 * GET /api/site/avis-google — la note Google, le nombre d'avis et quelques
 * extraits, pour l'accueil du site (mission 16, partie 3). Sans
 * `GOOGLE_PLACES_API_KEY` ou sans `GOOGLE_PLACE_ID` : `{ disponible: false }`
 * (le site n'affiche alors rien). Lecture seule, rien de privé ; la clé reste
 * sur le serveur ; un appel à Google par 24 h au plus (copie sur le volume,
 * `lib/site/avis-google.ts`). Réponse en cache une heure, CORS ouvert comme
 * les publications ; limite par IP comme les événements. Route publique
 * (routes-publiques.ts).
 */
export const dynamic = "force-dynamic";

const ENTETES = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
  if (ipDepasseLaLimite(`avis-google:${ip}`, Date.now(), 120)) {
    return NextResponse.json({ disponible: false }, { status: 429, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await avisGoogle(), { headers: ENTETES });
  } catch (err) {
    console.error("[site/avis-google] lecture impossible :", err instanceof Error ? err.message : err);
    return NextResponse.json({ disponible: false }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
}
