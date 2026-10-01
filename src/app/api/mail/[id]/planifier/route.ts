import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { planifierDepuisMail } from "@/lib/agenda/depuis-mail";
import { lireDateDictee } from "@/lib/assistant/agenda";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";

export const dynamic = "force-dynamic";

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), heure: z.string().regex(/^\d{2}:\d{2}$/).optional(), action: z.string().trim().min(1).max(200) });

/** POST { date, heure?, action } : le bouton Planifier d'une date extraite (mission 9) — même code que l'outil « planifier ». */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const e = analyser(schema, await lireCorpsJson(requete));
    const debut = lireDateDictee(`${e.date} ${e.heure ?? "09:00"}`, new Date(), 9);
    if (!debut) throw new ErreurMetier("Date invalide.", 400);
    const r = await planifierDepuisMail(id, { debut, action: e.action, origine: `date lue dans un mail (${e.date})` });
    return NextResponse.json(r);
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/planifier");
  }
}
