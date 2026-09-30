import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { etatBanc, lancerBanc } from "@/lib/simulateur/banc/banc";

export const dynamic = "force-dynamic";

/**
 * Le banc de comparaison (mission 15, partie 3), derrière la session.
 * GET : l'état complet (cas, coût estimé, rendus, total) — relu toutes les 5 s par la page.
 * POST { cas?, variante? } : lance la campagne, un cas, une variante, ou un cas dans une variante.
 *   Rien ne part sans ce clic ; un cas sans photo est ignoré.
 */
const schemaLancement = z.object({
  cas: z.string().min(1).max(40).nullable().optional(),
  variante: z.string().min(1).max(40).nullable().optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await etatBanc(), { headers: { "Cache-Control": "no-store" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/banc");
  }
}

export async function POST(requete: NextRequest) {
  try {
    const selection = analyser(schemaLancement, await lireCorpsJson(requete));
    return NextResponse.json(await lancerBanc(selection), { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/simulateur/banc");
  }
}
