import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { noterAppel, schemaAppel } from "@/lib/commercial/appels";

export const dynamic = "force-dynamic";

/**
 * POST { leadId | dossierId, issue, note?, rappelLe?, motifPerte?, perteCommentaire? } : fin d'appel — la note,
 * l'issue, et la suite fixée par le CRM (rappel, dossier et espace, perte), avec le SMS proposé (`suite.sms`).
 */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json({ suite: await noterAppel(analyser(schemaAppel, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/commercial/appels");
  }
}
