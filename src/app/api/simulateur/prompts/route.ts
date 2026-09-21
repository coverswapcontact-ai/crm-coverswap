import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listerPrompts } from "@/lib/simulateur/bibliotheque";

export const dynamic = "force-dynamic";

/** GET : la bibliothèque de prompts ChatGPT, un par type de surface, avec l'historique de leurs versions. */
export async function GET() {
  try {
    return NextResponse.json({ prompts: await listerPrompts() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/prompts");
  }
}
