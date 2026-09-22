import { NextResponse } from "next/server";
import { ENTETES_DECOUVERTE, preflight } from "@/lib/oauth/reponses";
import { metadonneesServeur } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

/** RFC 8414 : métadonnées du serveur d'autorisation (servies aussi sous /.well-known/oauth-authorization-server). */
export async function GET() {
  return NextResponse.json(metadonneesServeur(), { headers: ENTETES_DECOUVERTE });
}

export async function OPTIONS() {
  return preflight();
}
