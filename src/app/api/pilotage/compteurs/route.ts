import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

/** Compteurs de la navigation : tâches de fond en échec. */
export async function GET() {
  try {
    const tachesEnEchec = await prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } });
    return NextResponse.json({ tachesEnEchec });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
