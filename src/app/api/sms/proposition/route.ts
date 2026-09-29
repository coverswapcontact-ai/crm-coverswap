import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ACTIONS_SMS } from "@/lib/sms/catalogue";
import { proposerSms } from "@/lib/sms/proposition";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    action: z.enum(ACTIONS_SMS, "Action SMS inconnue."),
    leadId: z.string().max(40).nullish(),
    dossierId: z.string().max(40).nullish(),
    rappelLe: z.iso.datetime("Date de rappel invalide.").nullish(),
    relance: z.object({ documentId: z.string().min(1).max(40), rang: z.number().int().min(1).max(2) }).nullish(),
  })
  .refine((v) => v.leadId || v.dossierId || v.relance, "Indique le contact ou le dossier concerné.");

/**
 * POST { action, leadId | dossierId, rappelLe?, relance? } : le SMS prérempli pour l'écran SMS (mission 14, partie 5).
 * N'écrit rien, sauf l'ouverture de l'espace pour un SMS avec le lien (comme « lien_espace ») ; c'est la copie qui trace.
 */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json({ proposition: await proposerSms(analyser(schema, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/proposition");
  }
}
