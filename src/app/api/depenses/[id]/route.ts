import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { schemaModificationDepense } from "@/lib/depenses/constantes";
import { modifierDepense } from "@/lib/depenses/service";

/** PATCH : rattachement, catégorie, montant… (tout est journalisé). */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await modifierDepense(id, analyser(schemaModificationDepense, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/depenses/[id]");
  }
}
