import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ajouterEchange, chargerEntrant, schemaEchange } from "@/lib/prospects/entrants";

/** POST { type: APPEL|SMS|EMAIL|NOTE, contenu } */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await ajouterEchange(id, analyser(schemaEchange, await lireCorpsJson(requete)));
    return NextResponse.json({ entrant: await chargerEntrant(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/entrants/[id]/echanges");
  }
}
