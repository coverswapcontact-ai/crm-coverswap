import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { santeMeta } from "@/lib/meta/sante";

export const dynamic = "force-dynamic";

/** État de l'intégration Meta. `?meta=0` : lecture locale seule ; `?jours=21` : fenêtre des résultats. */
export async function GET(requete: NextRequest) {
  try {
    const interrogerMeta = requete.nextUrl.searchParams.get("meta") !== "0";
    const demandes = Number(requete.nextUrl.searchParams.get("jours"));
    const jours = Number.isFinite(demandes) && demandes >= 1 && demandes <= 365 ? Math.round(demandes) : undefined;
    return NextResponse.json({ sante: await santeMeta({ interrogerMeta, jours }) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/meta/sante");
  }
}
