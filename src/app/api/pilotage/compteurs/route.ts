import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { compterPropositionsEnAttente } from "@/lib/validation/service";

export const dynamic = "force-dynamic";

/** Compteurs de la navigation : propositions à valider, tâches de fond en échec. */
export async function GET() {
  try {
    const [aValider, tachesEnEchec] = await Promise.all([
      compterPropositionsEnAttente(),
      prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } }),
    ]);
    return NextResponse.json({ aValider, tachesEnEchec });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
