import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { espaceDuClient } from "@/lib/espace/gestion";

export const dynamic = "force-dynamic";

/** GET : l'espace permanent du client (lien, visites, projets et où il en est), ses documents, le SMS prêt pour un nouveau lien. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await espaceDuClient(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/clients/[id]/espace");
  }
}
