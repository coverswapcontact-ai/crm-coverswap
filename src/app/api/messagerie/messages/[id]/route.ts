import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import prisma from "@/lib/prisma";
import { annulerMessage, confirmerEnvoi, envoyerDansLEspace, nePasEnvoyer, noterOuverture, reporterMessage, validerProposition } from "@/lib/messagerie/gestes";
import { RAISONS_NON_ENVOI } from "@/lib/messagerie/types";
import { avecImages, vueDuMessage } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ouvert") }),
  z.object({ action: z.literal("envoye"), texte: z.string().trim().max(1600).optional(), le: z.iso.datetime().optional() }),
  z.object({ action: z.literal("plus-tard"), quand: z.union([z.enum(["1H", "3H", "DEMAIN", "MAINTENANT"]), z.iso.datetime("Date invalide.")]) }),
  z.object({ action: z.literal("non-envoye"), raison: z.enum(RAISONS_NON_ENVOI), commentaire: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal("valider") }),
  z.object({ action: z.literal("annuler") }),
  z.object({ action: z.literal("envoyer-espace"), texte: z.string().trim().max(2000).optional() }),
]);

/**
 * POST { action } sur un message préparé : « ouvert » (Ouvrir Messages touché), « envoye » (✅, texte = ce qui est
 * vraiment parti), « plus-tard » (1 h, 3 h, demain 9 h 30, maintenant, ou une date), « non-envoye » (raison),
 * « valider » (proposition du démarrage en douceur), « annuler » (message programmé). Rien n'est envoyé d'ici.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schema, await lireCorpsJson(requete));
    switch (entree.action) {
      case "ouvert":
        await noterOuverture(id);
        break;
      case "envoye":
        await confirmerEnvoi(id, { texte: entree.texte ?? null, le: entree.le ? new Date(entree.le) : null, origine: "ECRAN" });
        break;
      case "plus-tard":
        await reporterMessage(id, ["1H", "3H", "DEMAIN", "MAINTENANT"].includes(entree.quand) ? (entree.quand as "1H" | "3H" | "DEMAIN" | "MAINTENANT") : new Date(entree.quand));
        break;
      case "non-envoye":
        await nePasEnvoyer(id, entree.raison, entree.commentaire ?? null);
        break;
      case "valider":
        await validerProposition(id);
        break;
      case "annuler":
        await annulerMessage(id);
        break;
      case "envoyer-espace":
        await envoyerDansLEspace(id, entree.texte ?? null);
        break;
    }
    const message = await prisma.messagePrepare.findUnique({ where: { id } });
    return NextResponse.json({ message: message ? (await avecImages([vueDuMessage(message)]))[0] : null });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/messages/[id]");
  }
}

/** GET : un message préparé (ouvert depuis une notification). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const message = await prisma.messagePrepare.findUnique({ where: { id } });
    const suivi = message ? await prisma.suivi.findUnique({ where: { id: message.suiviId }, select: { id: true, nom: true, telephone: true } }) : null;
    return NextResponse.json({ message: message ? (await avecImages([vueDuMessage(message)]))[0] : null, suivi });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/messages/[id]");
  }
}
