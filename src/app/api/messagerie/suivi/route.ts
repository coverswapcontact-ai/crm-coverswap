import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { analyserSuivi } from "@/lib/messagerie/analyse";
import { suiviPour } from "@/lib/messagerie/suivis";
import { ficheDuSuivi } from "@/lib/messagerie/fiche";
import { ouEnEstDuSuivi } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/**
 * GET ?dossierId= | ?leadId= : le suivi d'un dossier ou d'un lead (créé s'il manque) avec « Où on en est » et les dix
 * dernières lignes du journal — l'en-tête de la fiche dossier, du lead et de la conversation. Mission 25 (lot 6) : et
 * `fiche`, les résumés d'une ligne des sections de la fiche (conversation, simulations, espace, zone, pièces).
 */
export async function GET(requete: NextRequest) {
  try {
    const dossierId = requete.nextUrl.searchParams.get("dossierId");
    const leadId = requete.nextUrl.searchParams.get("leadId");
    if (!dossierId && !leadId) throw new ErreurMetier("Indique le dossier ou le lead.", 400);
    const suivi = await suiviPour({ dossierId, leadId }, { geste: true });
    if (!suivi) return NextResponse.json({ suiviId: null, ouEnEst: null, journal: [], fiche: null });
    if (!suivi.analyseLe) await analyserSuivi(suivi.id);
    const [vue, fiche] = await Promise.all([ouEnEstDuSuivi(suivi.id), ficheDuSuivi(suivi.id)]);
    return NextResponse.json({ suiviId: suivi.id, ...vue, fiche });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/suivi");
  }
}
