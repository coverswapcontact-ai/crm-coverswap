import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { reprendreDossier, schemaReprise } from "@/lib/dossiers/reprise";

/**
 * POST : reprise d'un dossier commencé avant le CRM, en une fois (client,
 * étape actuelle, dates clés, documents déjà émis, paiements reçus). Les PDF
 * et les photos suivent un à un sur les routes du dossier créé.
 */
export async function POST(request: NextRequest) {
  try {
    const resultat = await reprendreDossier(analyser(schemaReprise, await lireCorpsJson(request)));
    return NextResponse.json(resultat, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/reprise");
  }
}
