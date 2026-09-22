import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { desinscrire } from "@/lib/mail/sequences";

export const dynamic = "force-dynamic";

const ORIGINES = ["https://coverswap.fr", "https://www.coverswap.fr"];
function entetes(requete: NextRequest): Record<string, string> {
  const origine = requete.headers.get("origin");
  const permise = origine && (ORIGINES.includes(origine) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origine))) ? origine : ORIGINES[0];
  return { "Access-Control-Allow-Origin": permise, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin", "Cache-Control": "no-store" };
}

export async function OPTIONS(requete: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetes(requete) });
}

const schema = z.object({ e: z.string().min(3).max(400), j: z.string().min(10).max(64) });

/** POST { e, j } (page de désinscription du site) : désinscription définitive des séquences, jeton HMAC vérifié. */
export async function POST(requete: NextRequest) {
  try {
    const { e, j } = analyser(schema, await lireCorpsJson(requete));
    await desinscrire(e, j);
    return NextResponse.json({ ok: true }, { headers: entetes(requete) });
  } catch (erreur) {
    const reponse = reponseErreur(erreur, "POST /api/site/desinscription");
    for (const [nom, valeur] of Object.entries(entetes(requete))) reponse.headers.set(nom, valeur);
    return reponse;
  }
}
