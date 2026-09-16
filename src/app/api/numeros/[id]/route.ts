import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { completerNumero, lireRegistre, schemaComplement } from "@/lib/dossiers/registre";

/** PATCH : complète une ligne du registre ; le numéro lui-même ne change jamais. */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await completerNumero(id, analyser(schemaComplement, await lireCorpsJson(requete)));
    return NextResponse.json({ series: await lireRegistre() });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/numeros/[id]");
  }
}
