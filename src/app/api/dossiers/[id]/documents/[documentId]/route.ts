import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { phraseAnnonce } from "@/lib/dossiers/devis-envoye";
import { modifierPresentationDevis, schemaPresentationDevis } from "@/lib/dossiers/documents";
import { modifierDocumentExistant, schemaModificationDocumentExistant } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/**
 * PATCH : correction d'un document repris (date, montant, objet, statut, acompte) ; un document généré par le CRM reste figé.
 * Mission 11 : { visibleEspace, libelleVariante } seuls = la présentation d'un devis, généré ou repris.
 * Mission 18 (B5) : `annonce` dit si le mail « Devis disponible » est parti à la mise en ligne ; (B6) masqué, le retour
 * d'étape éventuel est dit dans `avertissements`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const corps = await lireCorpsJson(request);
    const cles = corps && typeof corps === "object" ? Object.keys(corps) : [];
    if (cles.length > 0 && cles.every((cle) => cle === "visibleEspace" || cle === "libelleVariante")) {
      const presentation = await modifierPresentationDevis(id, documentId, analyser(schemaPresentationDevis, corps));
      // Mission 18 (B5) : mis en ligne, le devis est annoncé (« Devis disponible ») ou l'écran dit pourquoi pas.
      const avertissements = [...(presentation.annonce ? [phraseAnnonce(presentation.annonce)] : []), ...(presentation.retrait ? [presentation.retrait] : [])];
      return NextResponse.json({ avertissements, annonce: presentation.annonce, dossier: await chargerDetail(id) });
    }
    const avertissements = await modifierDocumentExistant(id, documentId, analyser(schemaModificationDocumentExistant, corps));
    return NextResponse.json({ avertissements, dossier: await chargerDetail(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/documents/[documentId]");
  }
}
