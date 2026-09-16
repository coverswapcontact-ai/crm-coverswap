import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { changerEtape, schemaChangementEtape } from "@/lib/dossiers/transitions";

/** Changement d'étape : règles de REGLES_ETAPES vérifiées, événement écrit. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaChangementEtape, await lireCorpsJson(request));
    await changerEtape(id, entree);
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/etape");
  }
}
