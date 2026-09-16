import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { creerPreset, listerPresets, schemaPreset } from "@/lib/dossiers/presets";

export async function GET() {
  try {
    return NextResponse.json({ presets: await listerPresets() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/presets");
  }
}

export async function POST(request: NextRequest) {
  try {
    const preset = await creerPreset(analyser(schemaPreset, await lireCorpsJson(request)));
    return NextResponse.json(preset, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/presets");
  }
}
