import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { imageSimulationSite } from "@/lib/simulations/site";

export const dynamic = "force-dynamic";

/** GET …/image ou …/avant : le rendu d'une simulation faite sur le site, ou la photo du visiteur (derrière la session). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string; quoi: string }> }) {
  try {
    const { id, quoi } = await params;
    if (quoi !== "image" && quoi !== "avant") throw new ErreurMetier("Page introuvable.", 404);
    const { contenu, type } = await imageSimulationSite(id, quoi);
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulations-site/[id]/[quoi]");
  }
}
