import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lirePage } from "@/lib/commun/pagination";
import { pageClientsEspaces } from "@/lib/espace/suivi";

export const dynamic = "force-dynamic";

/**
 * GET : les espaces clients, PAR CLIENT (son lien, ses visites, ses projets et où il en est dans chacun) ; `espaces` :
 * les mêmes projets à plat (écrans d'avant).
 */
export async function GET(requete: NextRequest) {
  try {
    // Mission 13 (lot 6) : ?page=1 — une page de 50 clients.
    const { page, parPage } = lirePage(requete.nextUrl.searchParams);
    const lue = await pageClientsEspaces(new Date(), { page, parPage });
    return NextResponse.json({ ...lue, espaces: lue.clients.flatMap((c) => c.projets) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/espaces");
  }
}
