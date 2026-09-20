import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { LONGUEUR_MAX_SMS, envoyerSms } from "@/lib/sms/envoi";
import { publierEvenementSms } from "@/lib/sms/flux";

export const dynamic = "force-dynamic";

const schemaEnvoi = z.object({
  texte: z.string("Le message est vide.").trim().min(1, "Le message est vide.").max(LONGUEUR_MAX_SMS, "Message trop long pour un SMS."),
  /** Identifiant fabriqué par l'écran : un double-tap ou une file hors ligne rejouée ne produisent qu'un SMS. */
  cleEnvoi: z.string().min(8).max(80).optional(),
  /** Message type d'où vient le texte, et la version que le CRM proposait avant correction. */
  modele: z.string().max(60).nullable().optional(),
  textePropose: z.string().max(LONGUEUR_MAX_SMS).nullable().optional(),
});

/** POST : le SMS est écrit tout de suite (l'écran l'affiche), l'envoi part par la file de tâches. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaEnvoi, await lireCorpsJson(requete));
    const sms = await envoyerSms({
      conversationId: id,
      texte: entree.texte,
      cleEnvoi: entree.cleEnvoi ?? null,
      modele: entree.modele ?? null,
      textePropose: entree.textePropose ?? null,
      origine: entree.modele === "LIEN_ESPACE" || entree.modele === "INJOIGNABLE_LIEN" ? "LIEN_ESPACE" : entree.modele ? "MODELE" : "MANUEL",
    });
    publierEvenementSms({ genre: "MESSAGE", conversationId: id, smsId: sms.id });
    return NextResponse.json({
      message: { genre: "SMS", id: sms.id, le: sms.createdAt.toISOString(), sens: "SORTANT", texte: sms.texte, statut: sms.statut, erreur: sms.erreur, origine: sms.origine, cleEnvoi: sms.cleEnvoi, segments: sms.segments },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/conversations/[id]/messages");
  }
}
