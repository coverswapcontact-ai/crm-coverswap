import { NextResponse, type NextRequest } from "next/server";
import { adresseIp, autoriserAppel } from "@/lib/oauth/limite";
import { ENTETES_JETON, preflight, reponseErreurOAuth } from "@/lib/oauth/reponses";
import { ErreurOAuth, echangerJeton } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

async function lireFormulaire(requete: NextRequest): Promise<URLSearchParams> {
  const type = requete.headers.get("content-type") ?? "";
  const texte = await requete.text();
  if (type.includes("application/json")) {
    const corps = JSON.parse(texte || "{}") as Record<string, unknown>;
    return new URLSearchParams(Object.entries(corps).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  return new URLSearchParams(texte);
}

/** Point d'échange des jetons (application/x-www-form-urlencoded, JSON toléré) ; 60 appels par quart d'heure et par adresse. */
export async function POST(requete: NextRequest) {
  try {
    if (!autoriserAppel(`token:${adresseIp(requete)}`, 60, 15 * 60_000)) throw new ErreurOAuth("invalid_request", "Trop d'appels depuis cette adresse : réessayer dans quinze minutes.", 429);
    const form = await lireFormulaire(requete).catch(() => {
      throw new ErreurOAuth("invalid_request", "Corps illisible : application/x-www-form-urlencoded attendu.");
    });
    const jetons = await echangerJeton(form, requete.headers);
    return NextResponse.json(jetons, { headers: ENTETES_JETON });
  } catch (erreur) {
    return reponseErreurOAuth(erreur, "POST /api/oauth/token");
  }
}

export async function OPTIONS() {
  return preflight();
}
