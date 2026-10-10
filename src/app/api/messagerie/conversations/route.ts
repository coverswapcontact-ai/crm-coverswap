import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { FILTRES_CONVERSATIONS, listerConversations, type FiltreConversations } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/** GET ?filtre=TOUS|NON_LUS|A_ENVOYER|A_TOI|ATTENTE_CLIENT|ARCHIVES&q= : la liste des conversations (une par client). */
export async function GET(requete: NextRequest) {
  try {
    const filtre = requete.nextUrl.searchParams.get("filtre") ?? "TOUS";
    const q = requete.nextUrl.searchParams.get("q");
    return NextResponse.json(await listerConversations({ filtre: (FILTRES_CONVERSATIONS as readonly string[]).includes(filtre) ? (filtre as FiltreConversations) : "TOUS", recherche: q }));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/conversations");
  }
}
