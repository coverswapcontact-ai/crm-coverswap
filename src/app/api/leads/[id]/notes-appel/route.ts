import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { creerNoteAppel, notesDuLead, schemaNoteAppel } from "@/lib/commercial/notes-appel";

export const dynamic = "force-dynamic";

/** GET : les notes d'appel du contact, de la plus récente à la plus ancienne. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ notes: await notesDuLead(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/leads/[id]/notes-appel");
  }
}

/** POST { texte?, etiquettes?, appelLe? } : une nouvelle note (un nouvel appel), datée. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ note: await creerNoteAppel(id, analyser(schemaNoteAppel, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/leads/[id]/notes-appel");
  }
}
