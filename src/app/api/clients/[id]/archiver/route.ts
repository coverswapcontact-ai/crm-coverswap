import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { archiverClient, chargerFiche } from "@/lib/clients/fiches";

const schema = z.object({
  motif: z.string("Motif d'archivage obligatoire.").trim().min(3, "Motif d'archivage obligatoire.").max(500),
});

/** POST { motif } : archive la fiche (refusé tant qu'un dossier est en cours). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { motif } = analyser(schema, await lireCorpsJson(requete));
    await archiverClient(id, motif);
    return NextResponse.json({ client: await chargerFiche(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/archiver");
  }
}
