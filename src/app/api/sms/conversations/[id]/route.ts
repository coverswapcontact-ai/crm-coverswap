import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import prisma from "@/lib/prisma";
import { contexteDeLaConversation } from "@/lib/sms/contexte";
import { archiverConversation, enregistrerBrouillon, filDeLaConversation, marquerConversationLue, marquerConversationNonLue, rattacherConversation, resumerConversation } from "@/lib/sms/conversations";
import { publierEvenementSms } from "@/lib/sms/flux";

export const dynamic = "force-dynamic";

/**
 * GET : le fil (SMS, appels, gestes du client) et le contexte du dossier.
 * ?lu=0 pour ne pas marquer la conversation comme lue (rafraîchissement en arrière-plan).
 */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parametres = new URL(requete.url).searchParams;
    if (parametres.get("lu") !== "0") await marquerConversationLue(id);
    const fil = await filDeLaConversation(id);
    const contexte = await contexteDeLaConversation({ id, leadId: fil.conversation.leadId, clientId: fil.conversation.clientId });
    return NextResponse.json({ ...fil, contexte });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/sms/conversations/[id]");
  }
}

const schemaModification = z
  .object({
    brouillon: z.string().max(1600).nullable(),
    rattacher: z.object({ leadId: z.string().max(40).optional(), clientId: z.string().max(40).optional() }),
    nonLue: z.literal(true),
    archiver: z.string().trim().min(3, "Motif d'archivage : 3 caractères au moins.").max(300),
    restaurer: z.literal(true),
  })
  .partial();

export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaModification, await lireCorpsJson(requete));
    if (entree.brouillon !== undefined) await enregistrerBrouillon(id, entree.brouillon);
    if (entree.rattacher) await rattacherConversation(id, entree.rattacher);
    if (entree.nonLue) await marquerConversationNonLue(id);
    if (entree.archiver) await archiverConversation(id, entree.archiver);
    if (entree.restaurer) await prisma.conversationSms.update({ where: { id }, data: { archiveLe: null, archiveMotif: null } });
    if (entree.rattacher || entree.nonLue || entree.archiver || entree.restaurer) publierEvenementSms({ genre: "CONVERSATION", conversationId: id });
    const conversation = await prisma.conversationSms.findUnique({ where: { id } });
    return NextResponse.json({ conversation: conversation ? resumerConversation(conversation) : null });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/sms/conversations/[id]");
  }
}
