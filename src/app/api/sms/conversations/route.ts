import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import prisma from "@/lib/prisma";
import { FILTRES_CONVERSATIONS, conversationDuNumero, listerConversations, resumerConversation, type FiltreConversations } from "@/lib/sms/conversations";
import { etatFournisseur } from "@/lib/sms/fournisseurs";

export const dynamic = "force-dynamic";

/** GET ?filtre=TOUTES|NON_LUES|A_REPONDRE|A_RATTACHER|ARCHIVEES&q=… : la liste, triée par dernière activité. */
export async function GET(requete: NextRequest) {
  try {
    const parametres = new URL(requete.url).searchParams;
    const filtre = parametres.get("filtre") as FiltreConversations | null;
    const liste = await listerConversations({
      filtre: filtre && (FILTRES_CONVERSATIONS as readonly string[]).includes(filtre) ? filtre : "TOUTES",
      recherche: parametres.get("q") ?? undefined,
    });
    return NextResponse.json({ ...liste, fournisseur: etatFournisseur() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/sms/conversations");
  }
}

const schemaOuverture = z
  .object({
    numero: z.string().trim().max(40).optional(),
    leadId: z.string().max(40).optional(),
    clientId: z.string().max(40).optional(),
    dossierId: z.string().max(40).optional(),
  })
  .refine((v) => v.numero || v.leadId || v.clientId || v.dossierId, "Indique un numéro, un contact, un client ou un dossier.");

/** POST { numero } | { leadId } | { clientId } : ouvre (ou retrouve) la conversation de cette personne. */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaOuverture, await lireCorpsJson(requete));
    let numero = entree.numero ?? null;
    if (entree.dossierId) {
      const dossier = await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { clientTelephone: true, leadId: true, clientId: true } });
      if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
      numero = numero ?? dossier.clientTelephone;
      entree.leadId = entree.leadId ?? dossier.leadId ?? undefined;
      entree.clientId = entree.clientId ?? dossier.clientId ?? undefined;
    }
    if (!numero && entree.leadId) numero = (await prisma.lead.findUnique({ where: { id: entree.leadId }, select: { telephone: true } }))?.telephone ?? null;
    if (!numero && entree.clientId) {
      const telephone = await prisma.clientTelephone.findFirst({ where: { clientId: entree.clientId }, orderBy: [{ principal: "desc" }, { createdAt: "desc" }], select: { numero: true } });
      numero = telephone?.numero ?? null;
    }
    if (!numero) throw new ErreurMetier("Aucun numéro de téléphone connu pour cette personne.", 400);
    const conversation = await conversationDuNumero(numero, { leadId: entree.leadId, clientId: entree.clientId });
    return NextResponse.json({ conversation: resumerConversation(conversation) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/conversations");
  }
}
