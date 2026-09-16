import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { enregistrerDocumentExistant, schemaDocumentExistant } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/** POST : devis ou facture émis avant le CRM, rattaché avec son numéro du registre (rien n'est généré). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const resultat = await enregistrerDocumentExistant(id, analyser(schemaDocumentExistant, await lireCorpsJson(request)));
    return NextResponse.json({ ...resultat, dossier: await chargerDetail(id) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/existant");
  }
}
