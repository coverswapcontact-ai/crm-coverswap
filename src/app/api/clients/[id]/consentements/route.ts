import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerFiche, enregistrerConsentement, schemaConsentement } from "@/lib/clients/fiches";

/** POST { statut, moyen, recueilliLe, preuve? } : nouvelle déclaration (les précédentes restent). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await enregistrerConsentement(id, analyser(schemaConsentement, await lireCorpsJson(requete)));
    return NextResponse.json({ client: await chargerFiche(id) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/consentements");
  }
}
