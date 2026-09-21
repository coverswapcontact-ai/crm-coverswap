import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { modifierNoteAppel, schemaNoteAppel } from "@/lib/commercial/notes-appel";

export const dynamic = "force-dynamic";

/** PUT { texte?, etiquettes? } : enregistrement au fil de la frappe (et à la sortie de l'écran). */
export async function PUT(requete: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const { id, noteId } = await params;
    return NextResponse.json({ note: await modifierNoteAppel(id, noteId, analyser(schemaNoteAppel, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "PUT /api/leads/[id]/notes-appel/[noteId]");
  }
}
