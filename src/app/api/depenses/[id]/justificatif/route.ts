import { NextResponse, type NextRequest } from "next/server";
import { lireFormulaire, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { justificatifDe, remplacerJustificatif } from "@/lib/depenses/service";
import { lireFichierConserve } from "@/lib/fichiers/stockage";

type Contexte = { params: Promise<{ id: string }> };

// Pas d'extension dans l'URL : la route passe toujours par le proxy (session obligatoire).
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const { contenu, typeMime, nom } = await lireFichierConserve(await justificatifDe(id));
    return new NextResponse(new Uint8Array(contenu), {
      headers: {
        "Content-Type": typeMime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(nom)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/depenses/[id]/justificatif");
  }
}

/** POST (multipart `justificatif`) : remplace le justificatif ; l'ancien reste aux archives. */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const fichier = (await lireFormulaire(requete)).get("justificatif");
    if (!(fichier instanceof File)) throw new ErreurMetier("Aucun fichier reçu.", 400);
    return NextResponse.json(await remplacerJustificatif(id, fichier));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/depenses/[id]/justificatif");
  }
}
