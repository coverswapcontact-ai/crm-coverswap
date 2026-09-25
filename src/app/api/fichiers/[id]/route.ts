import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lireFichierConserve } from "@/lib/fichiers/stockage";

/** GET : un fichier conservé (document déposé sur un dossier, pièce de mail conservée). Session exigée par le proxy. `?telecharger=1` pour l'enregistrer. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const fichier = await lireFichierConserve(id);
    const telecharger = new URL(request.url).searchParams.get("telecharger") === "1";
    const nom = fichier.nom.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "fichier";
    return new NextResponse(new Uint8Array(fichier.contenu), {
      headers: {
        "Content-Type": fichier.typeMime,
        "Content-Length": String(fichier.contenu.length),
        "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${nom}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/fichiers/[id]");
  }
}
