import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { rappelConnexionGoogle } from "@/lib/google/connexion";
import { compterMessagesATrier } from "@/lib/messages/consultation";
import { compterPropositionsEnAttente } from "@/lib/validation/service";

export const dynamic = "force-dynamic";

/**
 * Compteurs de la navigation (propositions à valider, mails à trier, tâches de
 * fond en échec) et rappel de la connexion Google quand elle expire bientôt.
 */
export async function GET() {
  try {
    const [aValider, messagesATrier, tachesEnEchec, rappelGoogle] = await Promise.all([
      compterPropositionsEnAttente(),
      compterMessagesATrier(),
      prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } }),
      rappelConnexionGoogle(),
    ]);
    return NextResponse.json({ aValider, messagesATrier, tachesEnEchec, rappelGoogle });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
