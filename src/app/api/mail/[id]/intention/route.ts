import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { INTENTIONS, classerIntention } from "@/lib/mail/v2";

export const dynamic = "force-dynamic";

const schema = z.object({ intention: z.enum([...INTENTIONS, "NON_CLASSE"]), attendu: z.string().trim().max(300).nullable().optional() });

/** POST { intention, attendu? } : Lucas classe ou corrige (mission 9). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const e = analyser(schema, await lireCorpsJson(requete));
    const r = await classerIntention([{ messageId: id, intention: e.intention === "NON_CLASSE" ? null : e.intention, attendu: e.attendu ?? null }]);
    if (r.inconnus.length) return NextResponse.json({ error: "Mail introuvable." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/intention");
  }
}
