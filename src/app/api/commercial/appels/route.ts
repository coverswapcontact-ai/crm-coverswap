import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { noterAppel, schemaAppel } from "@/lib/commercial/appels";

export const dynamic = "force-dynamic";

/** POST { leadId | dossierId, issue, note?, rappelLe? } : fin d'appel — la note, l'issue, et la suite fixée par le CRM. */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json({ suite: await noterAppel(analyser(schemaAppel, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/commercial/appels");
  }
}
