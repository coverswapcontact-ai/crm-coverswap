import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { toutMettreEnPause } from "@/lib/messagerie/gestes";
import { etatMessagerie } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/** GET : mode d'envoi, pause générale, IA (active ou non, dépense du mois), compteurs « à envoyer » et « à valider ». */
export async function GET() {
  try {
    return NextResponse.json(await etatMessagerie());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/etat");
  }
}

/** POST { pause } : « Tout mettre en pause » (toutes les préparations et tous les envois d'un coup), ou relancer. */
export async function POST(requete: NextRequest) {
  try {
    const { pause } = analyser(z.object({ pause: z.boolean() }), await lireCorpsJson(requete));
    await toutMettreEnPause(pause);
    return NextResponse.json(await etatMessagerie());
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/etat");
  }
}
