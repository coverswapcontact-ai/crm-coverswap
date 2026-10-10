import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { rappelConnexionGoogle } from "@/lib/google/connexion";
import { compterLeadsEnRetard } from "@/lib/prospects/leads";
import { compterAujourdhui } from "@/lib/a-faire/lecture";
import { compterMailATraiter } from "@/lib/a-faire/ecran";
import { compterPropositionsEnAttente } from "@/lib/validation/service";

export const dynamic = "force-dynamic";

/**
 * Compteurs de la navigation : les tâches d'« Aujourd'hui » (mission 17, partie A), les leads dont le rappel est en
 * retard (mission 14), les mails à traiter, les tâches de fond en échec, et le rappel de la connexion Google quand elle
 * expire bientôt.
 *
 * Mission 18 (A5) : la navigation n'affiche plus `tachesEnEchec` (un seul compteur : l'échec remonte comme tâche système
 * dans Tâches) ; la clé reste dans la réponse pour les clients d'avant (réponse servie par le cache hors ligne).
 *
 * Mission 17 (partie A) : l'onglet Mail compte les tâches à faire venues du mail ou des messages de l'espace client
 * (une seule source de vérité avec l'écran Tâches), et non plus les conversations « À traiter » recalculées ici.
 *
 * Mission 22 (A5) : `propositionsEnAttente` (ajout seulement) pour le menu « Plus » de la v2, qui le dit en phrase
 * (« À valider — 3 en attente »), jamais en badge ; la v1 ne lit pas cette clé.
 */
export async function GET() {
  try {
    const maintenant = new Date();
    const [tachesAujourdhui, leadsEnRetard, tachesEnEchec, rappelGoogle, mailATraiter, propositionsEnAttente, messagesAEnvoyer] = await Promise.all([
      compterAujourdhui(maintenant),
      compterLeadsEnRetard(),
      prisma.tache.count({ where: { statut: "ECHEC_DEFINITIF" } }),
      rappelConnexionGoogle(),
      compterMailATraiter(maintenant),
      compterPropositionsEnAttente(),
      // Mission 25 : le badge de la Messagerie, les messages prêts à envoyer (ajout seulement).
      prisma.messagePrepare.count({ where: { statut: "A_ENVOYER" } }),
    ]);
    return NextResponse.json({ tachesAujourdhui, leadsEnRetard, tachesEnEchec, rappelGoogle, mailATraiter, propositionsEnAttente, messagesAEnvoyer });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/pilotage/compteurs");
  }
}
