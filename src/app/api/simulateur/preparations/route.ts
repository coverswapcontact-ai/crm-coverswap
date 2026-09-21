import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { preparationsRecentes, preparerSimulation, schemaPreparation } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { dossierId, photoId, typeSurface, zones: [{ zone, ref }], mode } :
 *   CHATGPT → le prompt, la planche des teintes et la photo cadrée, prêts à copier et enregistrer ;
 *   API     → la génération part en tâche de fond ; le résultat arrive en brouillon dans le dossier.
 * GET ?dossier=… : les préparations des deux dernières semaines.
 */
export async function POST(requete: NextRequest) {
  try {
    const preparation = await preparerSimulation(analyser(schemaPreparation, await lireCorpsJson(requete)));
    return NextResponse.json({ preparation }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/simulateur/preparations");
  }
}

export async function GET(requete: NextRequest) {
  try {
    const dossier = requete.nextUrl.searchParams.get("dossier");
    if (!dossier) throw new ErreurMetier("Dossier attendu.", 400);
    return NextResponse.json({ preparations: await preparationsRecentes(dossier) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/preparations");
  }
}
