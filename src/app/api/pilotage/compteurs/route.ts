import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { rappelConnexionGoogle } from "@/lib/google/connexion";
import { compterLeadsEnRetard } from "@/lib/prospects/leads";
import { compterAujourdhui } from "@/lib/a-faire/lecture";
import { compterMailATraiter } from "@/lib/a-faire/ecran";

export const dynamic = "force-dynamic";

/**
 * Compteurs de la navigation : les tâches d'« Aujourd'hui » (mission 17, partie A), les leads dont le rappel est en
 * retard (mission 14), les mails à traiter, les tâches de fond en échec, et le rappel de la connexion Google quand elle
 * expire bientôt.
 *
 * Mission 17 (partie A) : l'onglet Mail compte les tâches à faire venues du mail ou des messages de l'espace client
 * (une seule source de vérité avec l'écran Tâches), et non plus les conversations « À traiter » recalculées ici.
 */
export async function GET() {
  try {
    const maintenant = new Date();
    const [tachesAujourdhui, leadsEnRetard, tachesEnEchec, rappelGoogle, mailATraiter] = await Promise.all([
      compterAujourdhui(maintenant),
      compterLeadsEnRetard(),
      prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } }),
      rappelConnexionGoogle(),
      compterMailATraiter(maintenant),
    ]);
    return NextResponse.json({ tachesAujourdhui, leadsEnRetard, tachesEnEchec, rappelGoogle, mailATraiter });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
