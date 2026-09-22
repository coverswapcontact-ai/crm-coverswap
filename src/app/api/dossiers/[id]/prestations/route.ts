import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { enregistrerPrestations, lirePrestationsDossier } from "@/lib/prestations/dossier";

export const dynamic = "force-dynamic";

/** GET : les familles et sous-parties du dossier (fichier des prestations). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ prestations: await lirePrestationsDossier(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/prestations");
  }
}

const schema = z.object({ prestations: z.record(z.string().max(20), z.array(z.string().max(40)).max(12)) });

/** PATCH { prestations } : Lucas coche ou décoche des familles et sous-parties ; écrit dans l'historique (« par Lucas »). */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { prestations } = analyser(schema, await lireCorpsJson(requete));
    const { selection } = await enregistrerPrestations(id, prestations, "LUCAS");
    return NextResponse.json({ prestations: selection });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/prestations");
  }
}
