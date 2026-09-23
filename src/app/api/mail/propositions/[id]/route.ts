import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { appliquerProposition } from "@/lib/mail/appliquer";
import { rejeterProposition } from "@/lib/validation/service";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ action: z.literal("valider"), corrections: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal("ignorer"), motif: z.string().max(60).optional(), commentaire: z.string().max(300).optional() }),
]);

/** POST { action: "valider", corrections? } | { action: "ignorer", motif? } : une carte au pouce (mission 9), appliquée tout de suite. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const e = analyser(schema, await lireCorpsJson(requete));
    const proposition = e.action === "valider" ? await appliquerProposition(id, e.corrections) : await rejeterProposition(id, { motif: e.motif ?? "INUTILE", commentaire: e.commentaire ?? null });
    return NextResponse.json({ proposition });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/propositions/[id]");
  }
}
