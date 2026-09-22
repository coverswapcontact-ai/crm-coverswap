import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { redigerBrouillon } from "@/lib/mail/redaction";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const id = z.string().max(40).nullable().optional();
const schema = z.object({ messageId: id, clientId: id, leadId: id, dossierId: id, consigne: z.string().max(500).nullable().optional() });

/** POST : « Rédiger avec l'IA » (à la demande de Lucas seulement). Rien n'est envoyé. */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json(await redigerBrouillon(analyser(schema, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/brouillon");
  }
}
