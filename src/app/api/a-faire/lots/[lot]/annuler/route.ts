import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { annulerLot } from "@/lib/a-faire/reponses";
import { cleDeLot } from "../../../parametres";

export const dynamic = "force-dynamic";

const schemaAnnulation = z.object({ le: z.string().trim().max(40, "Instant invalide.").nullish() });

/**
 * POST /api/a-faire/lots/<lot>/annuler { le? } : défait « Tout classer » (chaque tâche revient, son effet est annulé ou
 * défait). Mission 17 (partie A, relecture) : `le` est l'instant rendu par …/classer ; seules les tâches classées à cet
 * instant reviennent (jamais un classement d'un autre jour). Sans `le` (corps vide) : le dernier classement du lot.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ lot: string }> }) {
  try {
    const lot = cleDeLot((await params).lot);
    const brut = await requete.text();
    let corps: unknown = {};
    if (brut.trim()) {
      try {
        corps = JSON.parse(brut);
      } catch {
        throw new ErreurMetier("Requête invalide : données JSON attendues.");
      }
    }
    const { le } = analyser(schemaAnnulation, corps);
    return NextResponse.json(await annulerLot(lot, new Date(), le ?? undefined));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/lots/[lot]/annuler");
  }
}
