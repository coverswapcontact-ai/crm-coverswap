import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { SOURCES_LEAD } from "@/lib/prospects/constantes";
import { listerLeads, type VueLeads } from "@/lib/prospects/leads";

export const dynamic = "force-dynamic";

const VUES: readonly VueLeads[] = ["A_APPELER", "A_RAPPELER", "SANS_SUITE", "ARCHIVES"];

/**
 * GET ?vue=A_APPELER|A_RAPPELER|SANS_SUITE|ARCHIVES&source=…&q=…&page=… : une liste de Leads, une page à la fois.
 * « ACTIFS » (anciens liens, cache hors ligne) et toute valeur inconnue valent « À appeler ».
 */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const source = parametres.get("source");
    const vue = VUES.find((v) => v === parametres.get("vue")) ?? "A_APPELER";
    return NextResponse.json(
      await listerLeads({
        vue,
        source: source && (SOURCES_LEAD as readonly string[]).includes(source) ? source : undefined,
        recherche: parametres.get("q")?.slice(0, 120) ?? undefined,
        // Mission 13 (lot 6) : une page de 50.
        page: Number(parametres.get("page")) || 1,
      })
    );
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/leads");
  }
}
