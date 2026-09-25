import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { modifierPresentationDevis, schemaPresentationDevis } from "@/lib/dossiers/documents";
import { modifierDocumentExistant, schemaModificationDocumentExistant } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/**
 * PATCH : correction d'un document repris (date, montant, objet, statut, acompte) ; un document généré par le CRM reste figé.
 * Mission 11 : { visibleEspace, libelleVariante } seuls = la présentation d'un devis, généré ou repris.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const corps = await lireCorpsJson(request);
    const cles = corps && typeof corps === "object" ? Object.keys(corps) : [];
    if (cles.length > 0 && cles.every((cle) => cle === "visibleEspace" || cle === "libelleVariante")) {
      await modifierPresentationDevis(id, documentId, analyser(schemaPresentationDevis, corps));
      return NextResponse.json({ avertissements: [], dossier: await chargerDetail(id) });
    }
    const avertissements = await modifierDocumentExistant(id, documentId, analyser(schemaModificationDocumentExistant, corps));
    return NextResponse.json({ avertissements, dossier: await chargerDetail(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/documents/[documentId]");
  }
}
