import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { noterDossierOuvert } from "@/lib/v2/reprendre-serveur";

export const dynamic = "force-dynamic";

const schema = z.object({ dossierId: z.string().trim().min(1).max(64) });

/**
 * Mission 22 (A2) — `POST /api/reprendre` `{ dossierId }` : la coque v2 note le dossier qui vient de s'ouvrir
 * (paramètre DERNIER_DOSSIER_OUVERT, bandeau « Reprendre » d'Aujourd'hui). Rend `{ note }` : false quand la mémoire le
 * disait déjà il y a moins d'un quart d'heure. Route non publique.
 */
export async function POST(requete: NextRequest) {
  try {
    const { dossierId } = analyser(schema, await lireCorpsJson(requete));
    const note = await noterDossierOuvert(dossierId, new Date());
    return NextResponse.json({ note });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/reprendre");
  }
}
