import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { modifierPublication, photosDuDossierPourPublication, publierPublication, retirerPublication } from "@/lib/site/publications";

export const dynamic = "force-dynamic";

/** PATCH : { action: "publier" | "retirer" } ou le contenu complet à modifier. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const corps = (await request.json()) as { action?: string } & Record<string, unknown>;
    const publication = corps.action === "publier" ? await publierPublication(id) : corps.action === "retirer" ? await retirerPublication(id) : await modifierPublication(id, corps);
    return NextResponse.json({ publication });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/publications/[id]");
  }
}

/** GET : les photos disponibles pour le dossier passé en paramètre (?dossier=…). */
export async function GET(request: NextRequest) {
  try {
    const dossierId = request.nextUrl.searchParams.get("dossier");
    if (!dossierId) return NextResponse.json({ photos: [] });
    return NextResponse.json({ photos: await photosDuDossierPourPublication(dossierId) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/publications/[id]");
  }
}
