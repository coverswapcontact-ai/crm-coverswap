import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod/v4";
import { CATALOGUE } from "@/lib/assistant/catalogue";
import { LIBELLES_NIVEAU, type ResultatOutil } from "@/lib/assistant/definition";
import { lireConsignes, lirePositionnement } from "@/lib/assistant/consignes";
import { executerOutil, schemaCommun, type Session } from "@/lib/assistant/execution";
import type { JetonVerifie } from "@/lib/oauth/serveur";

/**
 * Le serveur MCP du CRM (mission 8) : il ne fait que traduire. Chaque outil du
 * catalogue devient un outil MCP (mêmes nom, description en français, schéma) ;
 * les consignes et le positionnement sont des ressources ; « point du matin »
 * est un prompt. Sans état : un serveur par requête HTTP, la session du
 * journal est portée par le jeton et le jour.
 */

export const VERSION_SERVEUR = "1.0.0";
const DONNEES_MAX = 60_000;

const INSTRUCTIONS = `Tu es l'assistant et le directeur général de CoverSwap, la société de Lucas (rénovation par revêtements adhésifs, Montpellier). Lis d'abord la ressource coverswap://consignes (tarifs, prestations, protocole de campagne, principes de décision, format du point du jour) et, avant toute recherche web, coverswap://positionnement.
Règles : tu réponds en français, tu tutoies Lucas. Tu passes la phrase de Lucas telle quelle dans le paramètre « commande » de chaque outil d'écriture. Une action sensible rend d'abord un aperçu : lis-le à Lucas, et n'appelle l'outil une seconde fois, avec le jeton « confirmation », que s'il dit oui. Si un outil rend plusieurs candidats, demande lequel, ne choisis jamais. Rien ne se supprime : « supprimer » archive. Dans tes conseils, distingue toujours ce qui vient des données du CRM, ce qui vient du web, et ce que tu déduis ; dis quand les données sont trop minces.`;

/** Le texte que Claude lit : le résultat, ses liens, puis les données exactes en JSON (tronquées au besoin). */
export function texteDuResultat(resultat: ResultatOutil): string {
  const parties = [resultat.texte];
  if (resultat.liens?.length) parties.push(`Liens : ${resultat.liens.map((l) => `${l.libelle} — ${l.href}`).join(" · ")}`);
  if (resultat.confirmation) parties.push(`Jeton de confirmation : ${resultat.confirmation.jeton} (valable jusqu'à ${resultat.confirmation.expireLe}).`);
  if (resultat.images?.length) parties.push(`Images jointes (dans l'ordre) : ${resultat.images.map((i, n) => `${n + 1}. ${i.libelle}`).join(" · ")}`);
  if (resultat.donnees !== undefined) {
    let json = JSON.stringify(resultat.donnees);
    if (json.length > DONNEES_MAX) json = `${json.slice(0, DONNEES_MAX)}… [données tronquées : ${json.length} caractères]`;
    parties.push(`Données exactes (JSON) :\n${json}`);
  }
  return parties.join("\n\n");
}

export function construireServeur(session: Session) {
  const mcp = new McpServer({ name: "coverswap-crm", title: "CRM CoverSwap", version: VERSION_SERVEUR }, { instructions: INSTRUCTIONS });

  for (const outil of CATALOGUE) {
    const objet = outil.schema as unknown as z.ZodObject<z.ZodRawShape>;
    const schema = outil.niveau === "LECTURE" ? objet : objet.extend(schemaCommun.shape);
    mcp.registerTool(
      outil.nom,
      {
        title: outil.titre,
        description: `[${LIBELLES_NIVEAU[outil.niveau]}] ${outil.description}`,
        inputSchema: schema,
        annotations: { title: outil.titre, readOnlyHint: outil.niveau === "LECTURE", destructiveHint: false, idempotentHint: outil.niveau === "LECTURE", openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const resultat = await executerOutil(outil, args, session, new Date());
        // Mission 10 : les photos et simulations arrivent en blocs image, après le texte qui les décrit.
        const images = (resultat.images ?? []).map((i) => ({ type: "image" as const, data: i.base64, mimeType: i.mimeType }));
        return { content: [{ type: "text" as const, text: texteDuResultat(resultat) }, ...images] };
      }
    );
  }

  mcp.registerResource("consignes", "coverswap://consignes", { title: "Consignes de Lucas pour l'assistant", description: "Tarifs, prestations, conditions, protocole de campagne, principes de décision, format du point du jour. À lire à chaque session ; modifiable dans Paramètres → Assistant Claude.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: (await lireConsignes()).texte }],
  }));
  mcp.registerResource("positionnement", "coverswap://positionnement", { title: "Positionnement de CoverSwap (contexte marché)", description: "Ce que vend CoverSwap, à qui, contre qui, à quels prix : le cadre des recherches web et des conseils. Modifiable dans Paramètres → Assistant Claude.", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: (await lirePositionnement()).texte }],
  }));

  mcp.registerPrompt("point_du_matin", { title: "Le point du matin", description: "Le point du jour de Lucas en 60 à 90 secondes : ce qui s'est passé depuis le dernier point, ce qui l'attend, la campagne et sa règle du jour." }, () => ({
    messages: [{ role: "user", content: { type: "text", text: "Bonjour. Fais-moi le point du matin : appelle « point_du_jour » (mémorise), puis « ce_qui_m_attend » et « campagne », lis les consignes, et rends un point de 60 à 90 secondes qui commence par « Bonjour Lucas » et finit par le jour de campagne et la règle du jour." } }],
  }));

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  return { mcp, transport };
}

export function infoAuth(jeton: JetonVerifie, brut: string): AuthInfo {
  return { token: brut, clientId: jeton.clientId, scopes: jeton.scope.split(/\s+/), expiresAt: Math.floor(jeton.expireLe.getTime() / 1000), extra: { utilisateur: jeton.utilisateur } };
}
