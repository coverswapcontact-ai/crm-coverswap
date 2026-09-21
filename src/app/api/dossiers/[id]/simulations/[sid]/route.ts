import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { changerStatutSimulation, modifierSimulation } from "@/lib/simulations/dossier";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["masquer", "afficher", "brouillon", "retirer", "modifier"], "Action inconnue."),
  titre: z.string().max(80).nullable().optional(),
  description: z.string().max(400).nullable().optional(),
  motif: z.string().max(200).nullable().optional(),
});

/**
 * PATCH { action } : masquer une simulation au client (il ne la voit plus),
 * l'afficher à nouveau, la repasser en brouillon, la retirer du dossier
 * (archivée : rien ne se supprime) ou modifier son titre et son mot au client.
 */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    const entree = analyser(schema, await lireCorpsJson(requete));
    const simulation = entree.action === "modifier" ? await modifierSimulation(id, sid, entree) : await changerStatutSimulation(id, sid, entree.action, entree.motif);
    return NextResponse.json({ simulation });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/simulations/[sid]");
  }
}
