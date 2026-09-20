import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { noterRapidement, schemaNoteRapide } from "@/lib/commercial/appels";

export const dynamic = "force-dynamic";

/** POST { leadId | dossierId, contenu } : note rapide, sur le dossier s'il existe, sinon sur le contact. */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json(await noterRapidement(analyser(schemaNoteRapide, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/commercial/notes");
  }
}
