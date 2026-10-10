import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { fileDuJour } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/** GET : la file du jour du mode « Un par un » (réponses, messages dus, appels, propositions), dans cet ordre. */
export async function GET() {
  try {
    return NextResponse.json(await fileDuJour());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/file");
  }
}
