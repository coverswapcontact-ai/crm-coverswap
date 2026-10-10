import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { analyserSuivi } from "@/lib/messagerie/analyse";
import { suiviPour } from "@/lib/messagerie/suivis";
import { ouEnEstDuSuivi } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/**
 * GET ?dossierId= | ?leadId= : le suivi d'un dossier ou d'un lead (créé s'il manque) avec « Où on en est » et les dix
 * dernières lignes du journal — l'en-tête de la fiche dossier, du lead et de la conversation.
 */
export async function GET(requete: NextRequest) {
  try {
    const dossierId = requete.nextUrl.searchParams.get("dossierId");
    const leadId = requete.nextUrl.searchParams.get("leadId");
    if (!dossierId && !leadId) throw new ErreurMetier("Indique le dossier ou le lead.", 400);
    const suivi = await suiviPour({ dossierId, leadId }, { geste: true });
    if (!suivi) return NextResponse.json({ suiviId: null, ouEnEst: null, journal: [] });
    if (!suivi.analyseLe) await analyserSuivi(suivi.id);
    return NextResponse.json({ suiviId: suivi.id, ...(await ouEnEstDuSuivi(suivi.id)) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/suivi");
  }
}
