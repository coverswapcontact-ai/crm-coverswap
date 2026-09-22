import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { CODES_COMPLETUDE } from "@/lib/dossiers/completude";
import { masquerPointACompleter } from "@/lib/dossiers/dossiers";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.enum(CODES_COMPLETUDE, "Point inconnu."), masque: z.boolean() });

/** PATCH { code, masque } : la croix d'un point « à compléter » (masqué pour ce dossier), ou le réafficher. */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { code, masque } = analyser(schema, await lireCorpsJson(requete));
    await masquerPointACompleter(id, code, masque);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]/completude");
  }
}
