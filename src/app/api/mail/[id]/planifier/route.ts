import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { planifierAction } from "@/lib/agenda/planification";
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
    const message = await prisma.message.findUnique({ where: { id }, select: { dossierId: true, leadId: true, clientId: true, deNom: true, de: true, client: { select: { nom: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } }, lead: { select: { prenom: true, nom: true } } } });
    if (!message) throw new ErreurMetier("Mail introuvable.", 404);
    const dossierId = message.dossierId ?? message.client?.dossiers[0]?.id ?? null;
    if (!dossierId && !message.leadId) throw new ErreurMetier("Ce mail n'est rattaché ni à un dossier ni à un lead : rattachez-le d'abord.", 409);
    const nom = message.client?.nom ?? (message.lead ? `${message.lead.prenom} ${message.lead.nom}`.trim() : (message.deNom ?? message.de));
    const debut = lireDateDictee(`${e.date} ${e.heure ?? "09:00"}`, new Date(), 9);
    if (!debut) throw new ErreurMetier("Date invalide.", 400);
    const r = await planifierAction({ dossierId, leadId: dossierId ? null : message.leadId, nom, action: e.action, debut, origine: `date lue dans un mail (${e.date})` });
    return NextResponse.json(r);
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/planifier");
  }
}
