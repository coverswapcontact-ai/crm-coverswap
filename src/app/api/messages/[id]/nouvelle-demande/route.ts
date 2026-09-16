import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { creerNouvelleDemande, schemaNouvelleDemande } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

/** POST : nouvelle demande depuis le mail (fiche client, et dossier si demandé). */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await creerNouvelleDemande(id, analyser(schemaNouvelleDemande, await lireCorpsJson(requete))), { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/nouvelle-demande");
  }
}
