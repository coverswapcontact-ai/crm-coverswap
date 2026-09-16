import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePeriode, lireSynthese } from "@/lib/synthese/requete";

export const dynamic = "force-dynamic";

/** GET : la synthèse à emporter : texte rédigé (format=texte) ou données structurées (format=json). */
export async function GET(requete: NextRequest) {
  try {
    const { du, au, anonyme } = lirePeriode(requete.nextUrl.searchParams);
    const lue = await lireSynthese(du, au, anonyme);
    const nom = `synthese-${du}-${au}${anonyme ? "-anonyme" : ""}`;
    if (requete.nextUrl.searchParams.get("format") === "json") {
      return new NextResponse(JSON.stringify({ synthese: lue.synthese, references: lue.references, alertes: lue.alertes }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${nom}.json"`, "Cache-Control": "no-store" },
      });
    }
    return new NextResponse(lue.redaction, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${nom}.txt"`, "Cache-Control": "no-store" },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/synthese/export");
  }
}
