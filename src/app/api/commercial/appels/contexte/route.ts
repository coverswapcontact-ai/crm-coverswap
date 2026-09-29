import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { contexteAppel } from "@/lib/commercial/appels";
import { ErreurMetier } from "@/lib/commun/erreurs";

export const dynamic = "force-dynamic";

/**
 * GET ?leadId=… | ?dossierId=… : ce que la feuille de fin d'appel sait du contact (mission 14, partie 4) —
 * `{ contexte: { nom, telephone, tentatives, source, rappelLe, dossierId } }`. N'écrit rien.
 */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const leadId = parametres.get("leadId")?.slice(0, 40) || null;
    const dossierId = parametres.get("dossierId")?.slice(0, 40) || null;
    if (!leadId && !dossierId) throw new ErreurMetier("Indique le contact ou le dossier concerné.", 400);
    return NextResponse.json({ contexte: await contexteAppel({ leadId, dossierId }) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/commercial/appels/contexte");
  }
}
