import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ouvrirEspaceDuContact } from "@/lib/espace/liens";

export const dynamic = "force-dynamic";

/** POST : ouvre l'espace client du contact (et son dossier s'il n'en a pas) ; rend le lien à envoyer. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { lien, dossierId, nouveau } = await ouvrirEspaceDuContact(id);
    return NextResponse.json({ lien, dossierId, nouveau });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/entrants/[id]/espace");
  }
}
