import { NextResponse } from "next/server";
import { ENTETES_DECOUVERTE, preflight } from "@/lib/oauth/reponses";
import { metadonneesRessource } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

/** RFC 9728 : métadonnées de la ressource protégée (servies aussi sous /.well-known/oauth-protected-resource[/api/mcp]). */
export async function GET() {
  return NextResponse.json(metadonneesRessource(), { headers: ENTETES_DECOUVERTE });
}

export async function OPTIONS() {
  return preflight();
}
