import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { publierSimulations } from "@/lib/simulations/dossier";

export const dynamic = "force-dynamic";

const schema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1, "Choisissez au moins une simulation.").max(20),
  prevenir: z.boolean().default(true),
  texte: z.string().max(918).nullable().optional(),
});

/**
 * POST { ids, prevenir, texte? } : publie les simulations dans l'espace du
 * client. Si « prevenir », le SMS « vos simulations sont prêtes » part — c'est
 * ce clic qui l'envoie, avec le texte que Lucas a sous les yeux.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await publierSimulations(id, entree.ids, { prevenir: entree.prevenir, texte: entree.texte }));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/simulations/publier");
  }
}
