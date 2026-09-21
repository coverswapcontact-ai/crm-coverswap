import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { controlerCoherence, corrigerIncoherence } from "@/lib/coherence/controle";

export const dynamic = "force-dynamic";

const schema = z.object({ cle: z.string().min(3).max(120) });

/** POST { cle } : corrige l'incohérence que Lucas vient de lire (rejouée d'abord : si elle a disparu, rien n'est fait), puis rend le contrôle à jour. */
export async function POST(requete: NextRequest) {
  try {
    const { cle } = analyser(schema, await lireCorpsJson(requete));
    const resultat = await corrigerIncoherence(cle);
    return NextResponse.json({ ...resultat, rapport: await controlerCoherence() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/coherence/corriger");
  }
}
