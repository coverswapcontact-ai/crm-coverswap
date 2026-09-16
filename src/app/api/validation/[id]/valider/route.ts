import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { validerProposition } from "@/lib/validation/service";

const schema = z.object({ corrections: z.record(z.string(), z.unknown()).optional() });

/** POST { corrections? } : valide la proposition, telle quelle ou corrigée, et l'exécute. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { corrections } = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json({ proposition: await validerProposition(id, corrections) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/validation/[id]/valider");
  }
}
