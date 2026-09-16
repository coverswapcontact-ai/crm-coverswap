import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { schemaArchivageDepense } from "@/lib/depenses/constantes";
import { archiverDepense } from "@/lib/depenses/service";

/** POST : dépense saisie par erreur, retirée avec son motif (jamais supprimée). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { motif } = analyser(schemaArchivageDepense, await lireCorpsJson(requete));
    await archiverDepense(id, motif);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/depenses/[id]/archive");
  }
}
