import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { chargerDetail, modifierDateEvenement, schemaDateEvenement } from "@/lib/dossiers/dossiers";

/** PATCH : date réelle d'un passage d'étape (dossier signé en juillet, saisi en septembre). Rend le dossier à jour. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; evenementId: string }> }) {
  try {
    const { id, evenementId } = await params;
    await modifierDateEvenement(id, evenementId, analyser(schemaDateEvenement, await lireCorpsJson(request)));
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/evenements/[evenementId]");
  }
}
