import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { validerEnLot } from "@/lib/validation/service";

const schema = z.object({ ids: z.array(z.string().max(40)).min(1, "Aucune proposition choisie.").max(100) });

/** POST { ids } : valide en lot celles qui le permettent (jamais une proposition sensible). */
export async function POST(requete: NextRequest) {
  try {
    const { ids } = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await validerEnLot(ids));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/validation/lot");
  }
}
