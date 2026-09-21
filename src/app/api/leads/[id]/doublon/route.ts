import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ecarterDoublon, fusionnerDoublon } from "@/lib/prospects/doublons";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["fusionner", "ecarter"], "Action inconnue.") });

/** POST { action } : fusionner ce contact avec celui qu'il semble doubler (un clic), ou écarter le signalement. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = analyser(schema, await lireCorpsJson(requete));
    if (action === "ecarter") {
      await ecarterDoublon(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await fusionnerDoublon(id));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/leads/[id]/doublon");
  }
}
