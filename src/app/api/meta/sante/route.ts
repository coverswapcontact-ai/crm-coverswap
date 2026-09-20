import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { santeMeta } from "@/lib/meta/sante";

export const dynamic = "force-dynamic";

/** État de l'intégration Meta. `?meta=0` pour ne pas interroger Meta (lecture locale seule). */
export async function GET(requete: NextRequest) {
  try {
    const interrogerMeta = requete.nextUrl.searchParams.get("meta") !== "0";
    return NextResponse.json({ sante: await santeMeta({ interrogerMeta }) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/meta/sante");
  }
}
