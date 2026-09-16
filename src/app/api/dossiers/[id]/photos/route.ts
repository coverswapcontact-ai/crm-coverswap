import { NextRequest, NextResponse } from "next/server";
import { lireFormulaire, reponseErreur } from "@/lib/dossiers/api";
import { ajouterPhoto } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

/** Ajout d'une photo (champ multipart `photo`, une seule par requête). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const photo = (await lireFormulaire(request)).get("photo");
    if (!(photo instanceof File)) throw new ErreurMetier("Aucune photo reçue.");
    return NextResponse.json(await ajouterPhoto(id, photo), { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/photos");
  }
}
