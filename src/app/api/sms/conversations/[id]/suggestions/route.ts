import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { suggestionsPourConversation } from "@/lib/sms/suggestions";

export const dynamic = "force-dynamic";

/** GET : les messages types remplis pour cette conversation. Rien ne part d'ici. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ suggestions: await suggestionsPourConversation(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/sms/conversations/[id]/suggestions");
  }
}
