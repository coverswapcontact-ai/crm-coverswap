import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerClientsEspaces } from "@/lib/espace/suivi";

export const dynamic = "force-dynamic";

/**
 * GET : les espaces clients, PAR CLIENT (son lien, ses visites, ses projets et où il en est dans chacun) ; `espaces` :
 * les mêmes projets à plat (écrans d'avant).
 */
export async function GET() {
  try {
    const clients = await listerClientsEspaces();
    return NextResponse.json({ clients, espaces: clients.flatMap((c) => c.projets) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/espaces");
  }
}
