import { NextResponse, type NextRequest } from "next/server";
import { lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { deposerSimulation } from "@/lib/espace/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST multipart { image, titre?, description? } : dépose une simulation dans l'espace du client (l'ouvre au besoin). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const formulaire = await lireFormulaire(requete);
    const image = formulaire.get("image");
    if (!(image instanceof File)) throw new ErreurMetier("Aucune image reçue.", 400);
    const simulation = await deposerSimulation(id, image, { titre: texteFormulaire(formulaire, "titre"), description: texteFormulaire(formulaire, "description") });
    return NextResponse.json({ simulation }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/espace/simulations");
  }
}
