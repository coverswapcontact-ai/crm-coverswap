import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { GROUPES_DEMARCHAGE, type GroupeDemarchage } from "@/lib/prospects/constantes";
import { etatAgents, listerProspects } from "@/lib/prospects/demarchage";

export const dynamic = "force-dynamic";

/** GET ?groupe=A_CONTACTER|EN_COURS|A_SCORER|CONVERTIS|ECARTES|NE_PAS_CONTACTER&agent=…&recherche=… ; rend aussi l'état des agents. */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const groupe = parametres.get("groupe") ?? "";
    const [liste, agents] = await Promise.all([
      listerProspects({
        groupe: (GROUPES_DEMARCHAGE as readonly string[]).includes(groupe) ? (groupe as GroupeDemarchage) : undefined,
        agent: parametres.get("agent") || undefined,
        recherche: parametres.get("recherche") || undefined,
      }),
      etatAgents(),
    ]);
    return NextResponse.json({ ...liste, ...agents });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/prospects/demarchage");
  }
}
