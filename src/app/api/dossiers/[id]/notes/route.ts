import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { ajouterNote, schemaNote } from "@/lib/dossiers/dossiers";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const note = await ajouterNote(id, analyser(schemaNote, await lireCorpsJson(request)));
    return NextResponse.json(note, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/notes");
  }
}
