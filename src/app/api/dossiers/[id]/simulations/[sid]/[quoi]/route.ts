import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { imageSimulationDossier } from "@/lib/simulations/dossier";

export const dynamic = "force-dynamic";

/** GET …/image ou …/avant : le rendu d'une simulation du dossier, ou la photo « avant » qui l'a produite (derrière la session). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string; sid: string; quoi: string }> }) {
  try {
    const { id, sid, quoi } = await params;
    if (quoi !== "image" && quoi !== "avant") throw new ErreurMetier("Page introuvable.", 404);
    const { contenu, type } = await imageSimulationDossier(id, sid, quoi);
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/simulations/[sid]/[quoi]");
  }
}
