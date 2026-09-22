import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { CODES_LIEN_MAIL, envoyerLienParMail, proposerLienParMail } from "@/lib/mail/lien-espace";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proposer"), code: z.enum(CODES_LIEN_MAIL), leadId: z.string().max(40).nullable().optional(), dossierId: z.string().max(40).nullable().optional() }),
  z.object({
    action: z.literal("envoyer"),
    code: z.enum(CODES_LIEN_MAIL),
    dossierId: z.string().min(1).max(40),
    a: z.string().trim().min(3, "Adresse e-mail manquante.").max(200),
    objet: z.string().trim().min(2, "Objet manquant.").max(150),
    phrase: z.string().trim().min(10, "La phrase est trop courte.").max(600),
    jeton: z.string().regex(/^[a-z0-9]{8,32}$/i),
  }),
]);

/**
 * POST { action: "proposer", leadId | dossierId, code } : ouvre l'espace (et le dossier) s'il le faut, rend le mail proposé — n'envoie rien ;
 * POST { action: "envoyer", dossierId, code, a, objet, phrase, jeton } : Lucas a relu, le mail part (une fois par jeton).
 */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.action === "proposer") return NextResponse.json(await proposerLienParMail(entree));
    return NextResponse.json(await envoyerLienParMail(entree));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/lien-espace");
  }
}
