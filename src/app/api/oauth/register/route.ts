import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { adresseIp, autoriserAppel } from "@/lib/oauth/limite";
import { ENTETES_JETON, preflight, reponseErreurOAuth } from "@/lib/oauth/reponses";
import { ErreurOAuth, enregistrerClient } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

/**
 * RFC 7591 : enregistrement dynamique d'un client. N'ouvre aucun accès (le
 * consentement de Lucas, connecté, reste requis) ; limité à 10 par quart
 * d'heure et par adresse, et à 50 nouveaux clients par jour en tout.
 */
export async function POST(requete: NextRequest) {
  try {
    if (!autoriserAppel(`register:${adresseIp(requete)}`, 10, 15 * 60_000)) throw new ErreurOAuth("invalid_request", "Trop d'enregistrements depuis cette adresse : réessayer dans quinze minutes.", 429);
    const parJour = await prisma.clientOAuth.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (parJour >= 50) throw new ErreurOAuth("invalid_request", "Trop de clients enregistrés aujourd'hui.", 429);
    const corps = await requete.json().catch(() => null);
    if (!corps || typeof corps !== "object") throw new ErreurOAuth("invalid_client_metadata", "Corps JSON attendu.");
    return NextResponse.json(await enregistrerClient(corps), { status: 201, headers: ENTETES_JETON });
  } catch (erreur) {
    return reponseErreurOAuth(erreur, "POST /api/oauth/register");
  }
}

export async function OPTIONS() {
  return preflight();
}
