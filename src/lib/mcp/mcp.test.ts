import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 8 : de bout en bout avec un VRAI client MCP (SDK) branché sur la
 * route /api/mcp (appelée en direct, sans serveur HTTP), après un vrai
 * parcours OAuth. Les cinq exemples du mandat sont rejoués et l'état de la
 * base vérifié. Sans jeton : 401 avec l'adresse des métadonnées.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";

type Client = import("@modelcontextprotocol/sdk/client/index.js").Client;
let prisma: typeof import("@/lib/prisma").default;
let oauth: typeof import("@/lib/oauth/serveur");
let route: typeof import("@/app/api/mcp/route");
let NextRequest: typeof import("next/server").NextRequest;
let client: Client;
let jetonAcces: string;

const RETOUR = "https://claude.ai/api/mcp/auth_callback";
const MCP = "http://localhost:3001/api/mcp";

/** Le client MCP parle à la route Next directement : même code que derrière HTTP, sans serveur. */
const fetchLocal: typeof fetch = async (entree, init) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const requete = new NextRequest(new Request(url, init));
  if (requete.method === "POST") return route.POST(requete);
  if (requete.method === "DELETE") return route.DELETE(requete);
  return route.GET(requete);
};

function texte(resultat: { content: unknown }): string {
  const contenu = resultat.content as { type: string; text?: string }[];
  return contenu.map((c) => c.text ?? "").join("\n");
}

async function appeler(nom: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: nom, arguments: args });
  return texte(r as { content: unknown });
}

const jetonDe = (t: string) => /Jeton de confirmation : ([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? null;

let rang = 0;
async function lead(donnees: Record<string, unknown> = {}) {
  rang++;
  return prisma.lead.create({ data: { prenom: "Test", nom: `Lead${rang}`, telephone: `06 40 00 00 ${String(rang).padStart(2, "0")}`, email: `l${rang}@exemple.fr`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  oauth = await import("@/lib/oauth/serveur");
  route = await import("@/app/api/mcp/route");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();

  // Parcours OAuth complet : enregistrement, consentement, PKCE, échange.
  const enregistrement = await oauth.enregistrerClient({ client_name: "Claude", redirect_uris: [RETOUR] });
  const verifier = randomBytes(32).toString("base64url");
  const demande = await oauth.demandeAutorisation({ client_id: enregistrement.client_id, redirect_uri: RETOUR, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "s", resource: MCP });
  const code = new URL(await oauth.accorder(demande, "lucas@exemple.fr")).searchParams.get("code")!;
  const jetons = await oauth.echangerJeton(new URLSearchParams({ grant_type: "authorization_code", client_id: enregistrement.client_id, code, code_verifier: verifier, redirect_uri: RETOUR, resource: MCP }), new Headers());
  jetonAcces = jetons.access_token;

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  client = new Client({ name: "Claude", version: "1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { fetch: fetchLocal, requestInit: { headers: { Authorization: `Bearer ${jetonAcces}` } } }));
});

after(async () => {
  await client.close().catch(() => undefined);
  await prisma.$disconnect();
});

describe("serveur MCP", () => {
  test("sans jeton : 401 et l'adresse des métadonnées de la ressource (RFC 9728) ; avec un faux jeton, pareil", async () => {
    const corps = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    for (const entetes of [{}, { Authorization: "Bearer un-faux-jeton-assez-long-pour-passer" }] as Record<string, string>[]) {
      const r = await fetchLocal(MCP, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...entetes }, body: corps });
      assert.equal(r.status, 401);
      assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/localhost:3001\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    }
  });

  test("le catalogue entier est exposé, en français, avec ses niveaux ; les ressources et le prompt aussi", async () => {
    const { CATALOGUE } = await import("@/lib/assistant/catalogue");
    const outils = await client.listTools();
    const noms = outils.tools.map((t) => t.name);
    for (const o of CATALOGUE) assert.ok(noms.includes(o.nom), o.nom);
    const chercher = outils.tools.find((t) => t.name === "chercher")!;
    assert.match(chercher.description ?? "", /^\[Lecture\]/);
    assert.equal(chercher.annotations?.readOnlyHint, true);
    const envoyer = outils.tools.find((t) => t.name === "envoyer_mail")!;
    assert.match(envoyer.description ?? "", /^\[Sensible \(confirmation\)\]/);
    assert.equal(envoyer.annotations?.readOnlyHint, false);
    assert.ok(JSON.stringify(envoyer.inputSchema).includes("confirmation"), "paramètres communs sur les outils d'écriture");
    const ressources = await client.listResources();
    assert.deepEqual(ressources.resources.map((r) => r.uri).sort(), ["coverswap://consignes", "coverswap://positionnement"]);
    const consignes = await client.readResource({ uri: "coverswap://consignes" });
    assert.match((consignes.contents[0] as { text: string }).text, /Consignes pour Claude/);
    const prompt = await client.getPrompt({ name: "point_du_matin" });
    assert.match(JSON.stringify(prompt.messages), /Bonjour Lucas/);
    // Le nom du client MCP est noté sur le jeton, pour l'écran Paramètres.
    const v = await oauth.verifierJetonAcces(jetonAcces);
    assert.equal(v?.clientNom, "Claude");
  });

  test("« Où en est le dossier Forestier ? » et « Qu'est-ce qui attend une action de ma part aujourd'hui ? »", async () => {
    const forestier = await lead({ prenom: "Paul", nom: "Forestier" });
    const ouverture = await appeler("ouvrir_dossier", { leadId: forestier.id, commande: "Ouvre un dossier pour Forestier" });
    assert.match(ouverture, /Dossier ouvert pour Paul Forestier/);
    const fiche = await appeler("lire_fiche", { nom: "Forestier" });
    assert.match(fiche, /Forestier/);
    assert.match(fiche, /Données exactes \(JSON\)/);
    const attend = await appeler("ce_qui_m_attend", {});
    assert.ok(attend.length > 20 && !/a échoué/.test(attend), attend.slice(0, 200));
    const point = await appeler("point_du_jour", {});
    assert.match(point, /^Point du/);
  });

  test("« Archive tous les leads de la file sauf Stella Estelle » : liste, aperçu, confirmation, état vérifié", async () => {
    const stella = await lead({ prenom: "Stella", nom: "Estelle" });
    const autres = await Promise.all([lead(), lead(), lead(), lead()]);
    const file = await appeler("leads_a_appeler", {});
    assert.match(file, /Stella Estelle/);
    const ids = autres.map((l) => l.id);
    const apercu = await appeler("archiver", { leads: ids, motif: "nettoyage de la file", commande: "Archive tous les leads de la file sauf Stella Estelle" });
    const jeton = jetonDe(apercu);
    assert.ok(jeton, apercu);
    assert.match(apercu, /Rien n'a été fait/);
    assert.equal(await prisma.lead.count({ where: { id: { in: ids }, archiveLe: { not: null } } }), 0);
    const fait = await appeler("archiver", { leads: ids, motif: "nettoyage de la file", confirmation: jeton, commande: "Archive tous les leads de la file sauf Stella Estelle" });
    assert.match(fait, /4 lead\(s\) archivé\(s\)/);
    assert.equal(await prisma.lead.count({ where: { id: { in: ids }, archiveLe: { not: null } } }), 4);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: stella.id } })).archiveLe, null);
    const journal = await prisma.appelOutil.findMany({ where: { outil: "archiver" }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(journal.map((a) => a.statut), ["APERCU", "FAIT"]);
    assert.equal(journal[1].commande, "Archive tous les leads de la file sauf Stella Estelle");
  });

  test("« Planifie un rappel de Madame Piketty jeudi 14h »", async () => {
    const piketty = await lead({ prenom: "Anne", nom: "Piketty" });
    const r = await appeler("planifier", { nom: "Piketty", action: "Rappeler", quand: "jeudi 14h", commande: "Planifie un rappel de Madame Piketty jeudi 14h" });
    assert.match(r, /^Planifié : Rappeler pour Anne Piketty/);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: piketty.id } });
    assert.equal(l.rappelLe?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }), "14:00");
    assert.ok(l.ecriture?.includes("ASSISTANT:claude"));
  });

  test("« Génère la facture de Monsieur Rousse, mets-la dans son dossier et son espace, et envoie-lui un mail avec »", async () => {
    const rousse = await lead({ prenom: "Bernard", nom: "Rousse", email: "b.rousse@exemple.fr" });
    const ouverture = await appeler("ouvrir_dossier", { leadId: rousse.id });
    const marque = "Données exactes (JSON) :\n";
    const dossierId = JSON.parse(ouverture.slice(ouverture.indexOf(marque) + marque.length)).dossierId as string;
    await prisma.dossier.update({ where: { id: dossierId }, data: { clientAdresse: "5 rue des Essais" } });
    const lignes = [{ designation: "Revêtement adhésif — façades", quantite: 6, unite: "ml", prix_unitaire: 120 }];
    // Non signé : refus, même confirmé.
    const refusApercu = await appeler("generer_document", { nom: "Rousse", type: "FACTURE", objet: "Cuisine", lignes });
    const refus = await appeler("generer_document", { nom: "Rousse", type: "FACTURE", objet: "Cuisine", lignes, confirmation: jetonDe(refusApercu) });
    assert.match(refus, /^Refusé : Une facture ne se génère que sur un dossier signé/);
    // Devis, signature (comme Lucas dans le CRM), puis facture par Claude.
    const devisApercu = await appeler("generer_document", { dossierId, type: "DEVIS", objet: "Cuisine", lignes });
    await appeler("generer_document", { dossierId, type: "DEVIS", objet: "Cuisine", lignes, confirmation: jetonDe(devisApercu) });
    const transitions = await import("@/lib/dossiers/transitions");
    const { avecActeur } = await import("@/lib/journal/contexte");
    await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, () => transitions.changerEtape(dossierId, transitions.schemaChangementEtape.parse({ vers: "SIGNE", confirmations: { BON_POUR_ACCORD: true }, sansAcompte: { motif: "PAIEMENT_A_LA_FACTURE" } })));
    const factureApercu = await appeler("generer_document", { nom: "Rousse", type: "FACTURE", objet: "Cuisine", lignes, commande: "Génère la facture de Monsieur Rousse" });
    assert.match(factureApercu, /Je vais émettre une facture « Cuisine » pour Bernard Rousse .* total 720 €/);
    const facture = await appeler("generer_document", { nom: "Rousse", type: "FACTURE", objet: "Cuisine", lignes, confirmation: jetonDe(factureApercu), commande: "Génère la facture de Monsieur Rousse" });
    assert.match(facture, /^Facture F\d{4}-\d{3} émise pour Bernard Rousse.* : 720 €/);
    const document = await prisma.document.findFirstOrThrow({ where: { dossierId, type: "FACTURE", numero: { not: null } } });
    assert.ok(document.ecriture?.includes("ASSISTANT:claude"));
    // L'envoi par mail : aperçu avec l'adresse du client et l'objet ; rien n'est parti.
    const envoi = await appeler("envoyer_document", { dossierId, documentId: document.id, commande: "Envoie-lui un mail avec la facture" });
    assert.match(envoi, /Je vais envoyer « Facture n° .* » à b\.rousse@exemple\.fr/);
    assert.ok(jetonDe(envoi));
    assert.equal(await prisma.appelOutil.count({ where: { outil: "envoyer_document", statut: "FAIT" } }), 0);
  });

  test("« supprimer » via MCP met à la corbeille (rien n'est effacé), et le journal des sessions le montre", async () => {
    const l = await lead();
    const r = await appeler("supprimer", { leads: [l.id], motif: "test", commande: "Supprime ce lead de test" });
    assert.match(r, /^1 lead\(s\) à la corbeille/);
    assert.ok((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).archiveLe);
    const { sessionsRecentes } = await import("@/lib/assistant/execution");
    const sessions = await sessionsRecentes(5);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].clientNom, "Claude");
    assert.ok(sessions[0].ecritures >= 5);
    assert.ok(sessions[0].derniers.some((a) => a.outil === "supprimer" && a.commande === "Supprime ce lead de test"));
  });
});
