import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { annulerDevis } from "@/lib/dossiers/documents";
import { chargerDetail } from "@/lib/dossiers/dossiers";

const schemaAnnulation = z.object({ motif: z.string("Motif invalide.").trim().max(300, "Motif trop long.").optional() });

/**
 * POST { motif? } : annule un devis émis qui ne sera pas signé (jamais un devis accepté). Il reste en historique.
 * Mission 18 (B6) : `avertissements` dit le retour d'étape quand plus aucun devis n'attend la réponse du client.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const entree = analyser(schemaAnnulation, await lireCorpsJson(request));
    const document = await annulerDevis(id, documentId, entree.motif ?? "");
    return NextResponse.json({ document, avertissements: document.avertissements, dossier: await chargerDetail(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/[documentId]/annulation");
  }
}
