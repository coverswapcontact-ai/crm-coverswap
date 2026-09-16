import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireInstantane } from "@/lib/synthese/instantanes";
import { redigerSynthese } from "@/lib/synthese/redaction";
import { referencesDe } from "@/lib/synthese/references";

export const dynamic = "force-dynamic";

/** GET : l'instantané figé d'un mois (noms résolus aujourd'hui, ou pseudonymes) et ses écarts avec le recalcul. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ mois: string }> }) {
  try {
    const { mois } = await params;
    if (!/^\d{4}-\d{2}$/.test(mois)) throw new ErreurMetier("Mois invalide : AAAA-MM attendu.", 400);
    const lu = await lireInstantane(mois);
    if (!lu) throw new ErreurMetier("Ce mois n'est pas (encore) figé.", 404);
    const references = await referencesDe(lu.synthese, requete.nextUrl.searchParams.get("anonyme") === "1");
    return NextResponse.json({ ...lu, references, redaction: redigerSynthese(lu.synthese, references) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/synthese/instantanes/[mois]");
  }
}
