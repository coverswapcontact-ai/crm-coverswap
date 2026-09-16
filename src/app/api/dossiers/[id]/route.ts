import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { chargerDetail, modifierDossier, schemaModification } from "@/lib/dossiers/dossiers";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]");
  }
}

/** Coordonnées client, objet, source, montant estimé, prochaine action, date de chantier. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaModification, await lireCorpsJson(request));
    await modifierDossier(id, entree);
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]");
  }
}
