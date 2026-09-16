import { NextRequest, NextResponse } from "next/server";
import { lireFormulaire, reponseErreur } from "@/lib/dossiers/api";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

/** Ajout d'une photo (champ multipart `photo`, une seule par requête ; `apres=1` : photo après chantier). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const formulaire = await lireFormulaire(request);
    const photo = formulaire.get("photo");
    if (!(photo instanceof File)) throw new ErreurMetier("Aucune photo reçue.");
    return NextResponse.json(await ajouterPhoto(id, photo, formulaire.get("apres") === "1"), { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/photos");
  }
}
