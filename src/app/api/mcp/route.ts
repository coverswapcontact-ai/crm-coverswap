import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { NextResponse, type NextRequest } from "next/server";
import { ouvrirSession } from "@/lib/assistant/execution";
import { construireServeur, infoAuth } from "@/lib/mcp/serveur";
import { adresseMetadonneesRessource, jetonPorteur, noterClientMcp, verifierJetonAcces } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Le point d'entrée MCP (Streamable HTTP, sans état). Chaque requête porte un
 * jeton OAuth du CRM ; sans jeton valide, 401 avec l'adresse des métadonnées
 * (RFC 9728) pour que l'application Claude lance la connexion.
 */
function refus(): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Jeton d'accès absent, expiré ou révoqué." }, id: null },
    { status: 401, headers: { "WWW-Authenticate": `Bearer realm="CoverSwap", error="invalid_token", resource_metadata="${adresseMetadonneesRessource()}"`, "Cache-Control": "no-store" } }
  );
}

async function traiter(requete: NextRequest): Promise<Response> {
  const brut = jetonPorteur(requete);
  const jeton = await verifierJetonAcces(brut);
  if (!jeton || !brut) return refus();
  // Sans état, chaque requête est un serveur neuf : le nom du client (« Claude ») se lit sur la requête d'initialisation elle-même.
  let corps: unknown;
  if (requete.method === "POST") {
    corps = await requete.json().catch(() => undefined);
    if (isInitializeRequest(corps) && corps.params.clientInfo?.name) {
      jeton.clientNom = corps.params.clientInfo.name.trim().slice(0, 80) || jeton.clientNom;
      await noterClientMcp(jeton.id, corps.params.clientInfo.name);
    }
  }
  const session = await ouvrirSession({ jetonId: jeton.id, clientNom: jeton.clientNom, utilisateur: jeton.utilisateur });
  const { mcp, transport } = construireServeur(session);
  try {
    await mcp.connect(transport);
    return await transport.handleRequest(requete, { authInfo: infoAuth(jeton, brut), ...(corps !== undefined ? { parsedBody: corps } : {}) });
  } finally {
    // Réponses JSON complètes : le serveur de la requête se ferme aussitôt (pas de flux à garder ouvert).
    void transport.close().catch(() => undefined);
    void mcp.close().catch(() => undefined);
  }
}

export async function POST(requete: NextRequest) {
  return traiter(requete);
}

export async function DELETE(requete: NextRequest) {
  return traiter(requete);
}

/** Pas de flux serveur → client hors requête : un serveur sans état n'en a pas besoin. */
export async function GET(requete: NextRequest) {
  const jeton = await verifierJetonAcces(jetonPorteur(requete));
  if (!jeton) return refus();
  return NextResponse.json({ jsonrpc: "2.0", error: { code: -32000, message: "Méthode non permise : ce serveur répond aux requêtes POST." }, id: null }, { status: 405, headers: { Allow: "POST, DELETE" } });
}
