import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { lireDateDictee } from "@/lib/assistant/agenda";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { annulerSnooze, snoozer } from "@/lib/mail/v2";

export const dynamic = "force-dynamic";

const schema = z.object({ quand: z.string().trim().max(60).optional(), annuler: z.boolean().optional() });

/** POST { quand } | { annuler: true } : remettre un mail à plus tard (« demain 9h », « lundi », « dans une semaine », « 2026-10-01 14:00 »). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const e = analyser(schema, await lireCorpsJson(requete));
    if (e.annuler) {
      await annulerSnooze(id);
      return NextResponse.json({ ok: true, jusqua: null });
    }
    const maintenant = new Date();
    const jusqua = e.quand ? lireDateDictee(e.quand, maintenant, 9) : null;
    if (!jusqua) throw new ErreurMetier("Quand ? (« demain 9h », « lundi », « dans une semaine »).", 400);
    if (jusqua <= maintenant) throw new ErreurMetier("Ce moment est déjà passé.", 400);
    await snoozer(id, jusqua);
    return NextResponse.json({ ok: true, jusqua: jusqua.toISOString() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/snooze");
  }
}
