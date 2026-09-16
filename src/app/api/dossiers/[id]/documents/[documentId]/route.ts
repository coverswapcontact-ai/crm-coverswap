import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { modifierDocumentExistant, schemaModificationDocumentExistant } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/** PATCH : correction d'un document repris (date, montant, objet, statut, acompte). Un document généré par le CRM reste figé. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const avertissements = await modifierDocumentExistant(id, documentId, analyser(schemaModificationDocumentExistant, await lireCorpsJson(request)));
    return NextResponse.json({ avertissements, dossier: await chargerDetail(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/documents/[documentId]");
  }
}
