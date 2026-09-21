import { NextResponse, type NextRequest } from "next/server";
import { lireFormulaire, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { enregistrerPortrait, lirePortrait } from "@/lib/espace/service";

export const dynamic = "force-dynamic";

/** GET : la photo de Lucas montrée aux clients dans leur espace. POST multipart { photo } : la remplacer (l'ancienne est archivée). */
export async function GET() {
  try {
    const { contenu, type } = await lirePortrait();
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/parametres/portrait");
  }
}

export async function POST(requete: NextRequest) {
  try {
    const photo = (await lireFormulaire(requete)).get("photo");
    if (!(photo instanceof File)) throw new ErreurMetier("Aucune photo reçue.", 400);
    await enregistrerPortrait(photo);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/parametres/portrait");
  }
}
