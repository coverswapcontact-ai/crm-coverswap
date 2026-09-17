import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerProspect, modifierProspect, schemaModificationProspect } from "@/lib/prospects/demarchage";

export const dynamic = "force-dynamic";

export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ prospect: await chargerProspect(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/prospects/demarchage/[id]");
  }
}

/** PATCH { statut?, note?, telephone?, email?, siteWeb? } */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const avertissements = await modifierProspect(id, analyser(schemaModificationProspect, await lireCorpsJson(requete)));
    return NextResponse.json({ prospect: await chargerProspect(id), avertissements });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/prospects/demarchage/[id]");
  }
}
