import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { SOURCES_LEAD } from "@/lib/prospects/constantes";
import { listerLeads } from "@/lib/prospects/leads";

export const dynamic = "force-dynamic";

/** GET ?vue=ACTIFS|SANS_SUITE&source=…&q=… : les leads sans dossier, du plus récent au plus ancien. */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const source = parametres.get("source");
    return NextResponse.json(
      await listerLeads({
        vue: parametres.get("vue") === "SANS_SUITE" ? "SANS_SUITE" : parametres.get("vue") === "ARCHIVES" ? "ARCHIVES" : "ACTIFS",
        source: source && (SOURCES_LEAD as readonly string[]).includes(source) ? source : undefined,
        recherche: parametres.get("q")?.slice(0, 120) ?? undefined,
      })
    );
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/leads");
  }
}
