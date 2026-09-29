import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { leadSuivant } from "@/lib/prospects/leads";

export const dynamic = "force-dynamic";

/**
 * GET ?apres=<leadId> : le lead à appeler ensuite, hors celui-ci (mission 14, partie 4) — d'abord les rappels en
 * retard (le plus ancien d'abord), puis « À appeler » (le plus récent d'abord). `{ suivant: { id, nom, ville,
 * telephone, raison: "RETARD" | "JAMAIS_APPELE", dossierId } | null }`. N'écrit rien.
 */
export async function GET(requete: NextRequest) {
  try {
    return NextResponse.json({ suivant: await leadSuivant(requete.nextUrl.searchParams.get("apres")?.slice(0, 60) || null) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/leads/suivant");
  }
}
