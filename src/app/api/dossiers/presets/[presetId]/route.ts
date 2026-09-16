import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { archiverPreset, modifierPreset, schemaPreset } from "@/lib/dossiers/presets";

type Contexte = { params: Promise<{ presetId: string }> };

export async function PATCH(request: NextRequest, { params }: Contexte) {
  try {
    const { presetId } = await params;
    const entree = analyser(schemaPreset.partial(), await lireCorpsJson(request));
    return NextResponse.json(await modifierPreset(presetId, entree));
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/presets/[presetId]");
  }
}

/** Retire le tarif de la liste (archivé, pas effacé). */
export async function DELETE(_request: NextRequest, { params }: Contexte) {
  try {
    const { presetId } = await params;
    await archiverPreset(presetId);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "DELETE /api/dossiers/presets/[presetId]");
  }
}
