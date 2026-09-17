import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { scorerAgent } from "@/lib/prospects/demarchage";

const schema = z.object({ agent: z.string("Agent manquant.").min(1, "Agent manquant.").max(40) });

/** POST { agent } : score les prospects sourcés de l'agent (calcul local, aucun appel extérieur). */
export async function POST(requete: NextRequest) {
  try {
    const { agent } = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await scorerAgent(agent));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/demarchage/scorer");
  }
}
