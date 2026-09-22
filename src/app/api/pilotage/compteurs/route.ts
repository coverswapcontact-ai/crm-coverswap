import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { rappelConnexionGoogle } from "@/lib/google/connexion";
import { compterLeadsAAppeler } from "@/lib/prospects/leads";
import { conversations, filtrerVue } from "@/lib/mail/vues";

export const dynamic = "force-dynamic";

/**
 * Compteurs de la navigation (contacts entrants à traiter, propositions à
 * valider, mails à trier, tâches de fond en échec) et rappel de la connexion Google quand elle expire bientôt.
 */
export async function GET() {
  try {
    const [leadsAAppeler, tachesEnEchec, rappelGoogle, lignesMail] = await Promise.all([
      compterLeadsAAppeler(),
      prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } }),
      rappelConnexionGoogle(),
      conversations(),
    ]);
    // Onglet Mail : les conversations « À traiter » (mission 7 ; le compteur SMS a quitté le menu avec l'onglet).
    const mailATraiter = filtrerVue(lignesMail, "A_TRAITER").length;
    return NextResponse.json({ leadsAAppeler, tachesEnEchec, rappelGoogle, mailATraiter });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
