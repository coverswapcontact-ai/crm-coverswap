import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { genererDocument, schemaGeneration } from "@/lib/dossiers/documents";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/** Génération d'un devis ou d'une facture : numéro, PDF archivé, événement, étape. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaGeneration, await lireCorpsJson(request));
    const { document } = await genererDocument(id, entree);
    return NextResponse.json(
      {
        document: {
          id: document.id,
          type: document.type,
          numero: document.numero,
          pdfUrl: `/api/dossiers/${id}/documents/${document.id}/pdf`,
        },
        dossier: await chargerDetail(id),
      },
      { status: 201 }
    );
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents");
  }
}
