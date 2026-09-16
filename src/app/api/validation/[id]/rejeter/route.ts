import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { rejeterProposition } from "@/lib/validation/service";

const schema = z.object({
  motif: z.string("Choisis le motif du rejet.").min(1, "Choisis le motif du rejet.").max(60),
  commentaire: z.string().max(1000, "Commentaire trop long.").nullable().optional(),
});

/** POST { motif, commentaire? } : rejette la proposition. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rejet = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json({ proposition: await rejeterProposition(id, rejet) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/validation/[id]/rejeter");
  }
}
