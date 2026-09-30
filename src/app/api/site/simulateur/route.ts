import { NextResponse } from "next/server";
import { zonesPubliques } from "@/lib/simulateur/zones";

/**
 * GET /api/site/simulateur — les pièces et les zones du simulateur (mission 15,
 * partie 2) : libellés, descriptions, incompatibilités, zones composées, nombre
 * maximal de zones. Source unique `src/lib/simulateur/zones.ts` ; le site la
 * lit (partie 4) au lieu de garder sa propre liste. Jamais la consigne du
 * moteur : elle reste au CRM.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return NextResponse.json(zonesPubliques(), { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600", "Access-Control-Allow-Origin": "*" } });
}
