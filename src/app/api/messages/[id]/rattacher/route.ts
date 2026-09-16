import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { rattacherMessage, schemaRattachement } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

/** POST { clientId, dossierId? } : ranger le mail chez ce client (et dans ce dossier). */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await rattacherMessage(id, analyser(schemaRattachement, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/rattacher");
  }
}
