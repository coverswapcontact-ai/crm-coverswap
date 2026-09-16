import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { STATUTS_MESSAGE, type StatutMessage } from "@/lib/messages/constantes";
import { listerMessages } from "@/lib/messages/consultation";

export const dynamic = "force-dynamic";

/** GET /api/messages?statut=A_TRIER|RATTACHE|BRUIT|IGNORE|TOUS&recherche=…&clientId=…&dossierId=…&limite=… */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const statut = parametres.get("statut") ?? "A_TRIER";
    const messages = await listerMessages({
      statut: statut === "TOUS" ? "TOUS" : (STATUTS_MESSAGE as readonly string[]).includes(statut) ? (statut as StatutMessage) : "A_TRIER",
      recherche: parametres.get("recherche") ?? undefined,
      clientId: parametres.get("clientId") ?? undefined,
      dossierId: parametres.get("dossierId") ?? undefined,
      limite: Number(parametres.get("limite")) || undefined,
    });
    return NextResponse.json({ messages });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messages");
  }
}
