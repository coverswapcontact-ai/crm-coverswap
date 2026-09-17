import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AGENT_SLUGS } from "@/lib/prospection/constants";
import { sourceProspects } from "@/lib/prospection/sourcing";

const schema = z.object({
  agent: z.enum(AGENT_SLUGS, "Agent inconnu."),
  maxNouveaux: z.number().int().min(1).max(200).optional(),
});

/**
 * POST { agent, maxNouveaux? } : sourcing Google Places de l'agent (30 à 90 s).
 * Appels payants au-delà du quota gratuit : l'écran le fait confirmer avant.
 */
export async function POST(requete: NextRequest) {
  try {
    const { agent, maxNouveaux } = analyser(schema, await lireCorpsJson(requete));
    if (!process.env.GOOGLE_PLACES_API_KEY) throw new ErreurMetier("Sourcing indisponible : clé Google Places (GOOGLE_PLACES_API_KEY) absente du serveur.", 503);
    return NextResponse.json(await sourceProspects(agent, { maxNouveaux }));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/demarchage/sourcer");
  }
}
