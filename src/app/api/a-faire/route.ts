import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { listeTaches } from "@/lib/a-faire/lecture";

export const dynamic = "force-dynamic";

/**
 * GET /api/a-faire : la liste de l'écran Tâches (« Aujourd'hui », « Plus tard », les lots, ce qui a été fait
 * aujourd'hui, ce qui revient demain). Une requête ; n'écrit rien. Gardée hors ligne par le service worker.
 */
export async function GET() {
  try {
    return NextResponse.json(await listeTaches(new Date()));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/a-faire");
  }
}
