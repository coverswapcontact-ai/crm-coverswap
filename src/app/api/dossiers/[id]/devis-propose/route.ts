import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { devisProposeDuDossier } from "@/lib/espace/devis-propose";

export const dynamic = "force-dynamic";

/** Le devis de départ proposé d'après l'espace du client (son choix, ses mètres) : rien n'est émis ici. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ proposition: await devisProposeDuDossier(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/devis-propose");
  }
}
