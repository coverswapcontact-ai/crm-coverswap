import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerPropositions } from "@/lib/validation/service";
import { STATUTS_PROPOSITION, type StatutProposition } from "@/lib/validation/types";

export const dynamic = "force-dynamic";

/** GET /api/validation?statut=EN_ATTENTE,ECHEC&type=…&dossierId=… */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const statuts = (parametres.get("statut") ?? "EN_ATTENTE")
      .split(",")
      .filter((statut): statut is StatutProposition => (STATUTS_PROPOSITION as readonly string[]).includes(statut));
    const propositions = await listerPropositions({
      statuts,
      type: parametres.get("type") ?? undefined,
      dossierId: parametres.get("dossierId") ?? undefined,
      clientId: parametres.get("clientId") ?? undefined,
      limite: Number(parametres.get("limite")) || undefined,
    });
    return NextResponse.json({ propositions });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/validation");
  }
}
