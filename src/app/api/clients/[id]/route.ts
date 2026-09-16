import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerFiche, modifierClient, schemaModificationClient } from "@/lib/clients/fiches";

export const dynamic = "force-dynamic";

export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ client: await chargerFiche(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/clients/[id]");
  }
}

export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const modification = analyser(schemaModificationClient, await lireCorpsJson(requete));
    const avertissements = await modifierClient(id, modification);
    return NextResponse.json({ client: await chargerFiche(id), avertissements });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/clients/[id]");
  }
}
