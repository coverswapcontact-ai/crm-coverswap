import { NextResponse } from "next/server";
import { sessionsRecentes } from "@/lib/assistant/execution";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

/** GET : les dernières sessions de l'assistant (jour, jeton, appels, écritures, derniers outils appelés) pour Tâches de fond. */
export async function GET() {
  try {
    return NextResponse.json({ sessions: await sessionsRecentes(10) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/assistant/sessions");
  }
}
