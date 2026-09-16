import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { anneeDemandee } from "@/lib/finances/annee";
import { chargerLivre, livreEnCsv } from "@/lib/finances/livre";
import { ParametresManquants } from "@/lib/parametres/service";

export const dynamic = "force-dynamic";

/** GET : livre des recettes de l'année, en CSV pour le comptable. */
export async function GET(requete: NextRequest) {
  try {
    const annee = anneeDemandee(requete.nextUrl.searchParams);
    const { lignes, manquants } = await chargerLivre(`${annee}-01-01`, `${annee}-12-31`);
    if (manquants.length > 0) throw new ParametresManquants(manquants);
    return new NextResponse(livreEnCsv(lignes), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="livre-des-recettes-${annee}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/finances/livre");
  }
}
