import { NextResponse } from "next/server";
import { prestationsPubliques } from "@/lib/prestations/prestations";

/**
 * GET PUBLIC : les prestations de CoverSwap (familles, sous-parties, questions de taille, guide photo), lues par le
 * site (formulaire de devis, simulateur). Source unique : src/lib/prestations/prestations.ts. Aucun tarif, aucun
 * mot-clé interne, aucune donnée de client.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return NextResponse.json(prestationsPubliques(), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
