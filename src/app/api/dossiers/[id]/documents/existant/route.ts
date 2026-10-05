import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/dossiers/api";
import { enregistrerDocumentExistant, schemaDocumentExistant } from "@/lib/dossiers/documents-existants";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

/**
 * POST : devis ou facture émis avant le CRM, rattaché avec son numéro du registre (rien n'est généré).
 * Mission 18 (B4) : la modale envoie le PDF dans la même requête (formulaire : « donnees » en JSON, « pdf » le fichier) ;
 * il est vérifié avant toute écriture, puis document, PDF et étape s'écrivent d'un bloc. Le JSON seul reste accepté
 * (sans PDF) ; la route du PDF d'un document (…/[documentId]/pdf) reste pour l'importer ou le remplacer ensuite.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let donnees: unknown;
    let pdf: Buffer | undefined;
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const formulaire = await lireFormulaire(request);
      try {
        donnees = JSON.parse(texteFormulaire(formulaire, "donnees"));
      } catch {
        throw new ErreurMetier("Requête invalide : données du document attendues.", 400);
      }
      const fichier = formulaire.get("pdf");
      if (fichier instanceof File) pdf = Buffer.from(await fichier.arrayBuffer());
    } else {
      donnees = await lireCorpsJson(request);
    }
    const resultat = await enregistrerDocumentExistant(id, analyser(schemaDocumentExistant, donnees), { pdf });
    return NextResponse.json({ ...resultat, dossier: await chargerDetail(id) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/existant");
  }
}
