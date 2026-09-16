import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { genererAvoir, schemaAvoir } from "@/lib/dossiers/documents";
import { chargerDetail } from "@/lib/dossiers/dossiers";

/** POST { motif, precision? } : annule la facture par un avoir de même montant. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const { id, documentId } = await params;
    const entree = analyser(schemaAvoir, await lireCorpsJson(request));
    const { document } = await genererAvoir(id, documentId, entree);
    return NextResponse.json(
      {
        document: { id: document.id, numero: document.numero, pdfUrl: `/api/dossiers/${id}/documents/${document.id}/pdf` },
        dossier: await chargerDetail(id),
      },
      { status: 201 }
    );
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/[documentId]/avoir");
  }
}
