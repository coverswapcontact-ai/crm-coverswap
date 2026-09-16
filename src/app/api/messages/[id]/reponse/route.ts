import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { brouillonReponse, repondreAuMessage, schemaReponse } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** GET : brouillon de réponse (celui de l'agent s'il en a préparé un). */
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await brouillonReponse(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messages/[id]/reponse");
  }
}

/** POST { objet, texte } : réponse décidée par la personne, envoyée par la file de tâches. */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await repondreAuMessage(id, analyser(schemaReponse, await lireCorpsJson(requete))), { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/reponse");
  }
}
