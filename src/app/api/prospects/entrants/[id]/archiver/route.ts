import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { archiverEntrant, chargerEntrant, schemaMotif } from "@/lib/prospects/entrants";

/** POST { motif } : archive le contact (il reste consultable, rien ne se supprime). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { motif } = analyser(schemaMotif, await lireCorpsJson(requete));
    await archiverEntrant(id, motif);
    return NextResponse.json({ entrant: await chargerEntrant(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/entrants/[id]/archiver");
  }
}
