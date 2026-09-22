import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { envoyerDepuisLOnglet } from "@/lib/mail/detail";

export const dynamic = "force-dynamic";

const id = z.string().max(40).nullable().optional();
const schema = z.object({
  a: z.email("Adresse du destinataire invalide.").trim().max(160),
  objet: z.string().trim().min(1, "Objet manquant.").max(200, "Objet trop long."),
  texte: z.string().trim().min(1, "Message vide.").max(20_000, "Message trop long."),
  enReponseA: id,
  brouillonId: id,
  dossierId: id,
  clientId: id,
  leadId: id,
});

/** POST : Lucas envoie (son clic). Réponse dans le fil Gmail, ou nouveau mail ; trace dans le dossier. */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json(await envoyerDepuisLOnglet(analyser(schema, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/envoyer");
  }
}
