import { NextResponse } from "next/server";
import { ErreurOAuth } from "./serveur";

/** En-têtes des documents de découverte : publics, lisibles depuis n'importe quelle origine, jamais mis en cache longtemps. */
export const ENTETES_DECOUVERTE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version",
} as const;

export const ENTETES_JETON = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Pragma: "no-cache" } as const;

/** Une erreur OAuth au format de la RFC 6749 ({ error, error_description }) ; tout le reste = 500 sans détail. */
export function reponseErreurOAuth(erreur: unknown, contexte: string): NextResponse {
  if (erreur instanceof ErreurOAuth) return NextResponse.json({ error: erreur.code, error_description: erreur.message }, { status: erreur.status, headers: ENTETES_JETON });
  console.error(`[oauth] ${contexte} :`, erreur);
  return NextResponse.json({ error: "server_error", error_description: "Erreur interne." }, { status: 500, headers: ENTETES_JETON });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: ENTETES_DECOUVERTE });
}
