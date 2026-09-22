import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";
import { adresseCrm } from "@/lib/assistant/definition";

/**
 * Le CRM est son propre serveur d'autorisation OAuth 2.1 (mission 8), pour
 * que l'application Claude se connecte au serveur MCP sans qu'aucun secret
 * ne soit tapé ni partagé :
 * - découverte (RFC 9728 pour la ressource, RFC 8414 pour le serveur) ;
 * - enregistrement dynamique des clients (RFC 7591) et documents d'identité
 *   (client_id = adresse https d'un document JSON) ;
 * - code d'autorisation avec PKCE S256 obligatoire, consentement donné par
 *   Lucas CONNECTÉ AU CRM (la page /oauth/autoriser est derrière la session) ;
 * - jetons opaques, stockés hachés (jamais en clair), accès de 12 heures,
 *   renouvellement de 90 jours avec rotation et détection de réutilisation ;
 * - révocation depuis Paramètres, par client ou par jeton.
 * Rien ici ne touche aux données du CRM : ce fichier ne fait qu'ouvrir ou
 * fermer la porte.
 */

export class ErreurOAuth extends Error {
  constructor(
    readonly code: string,
    description: string,
    readonly status = 400
  ) {
    super(description);
    this.name = "ErreurOAuth";
  }
}

export const PORTEE = "crm";
export const DUREE_CODE_MS = 10 * 60_000;
export const DUREE_ACCES_MS = 12 * 3_600_000;
export const DUREE_RENOUVELLEMENT_MS = 90 * 86_400_000;
const CIMD_FRAICHEUR_MS = 24 * 3_600_000;
const METHODES_AUTH = ["none", "client_secret_post", "client_secret_basic"] as const;

export const adresseMcp = () => `${adresseCrm()}/api/mcp`;
export const adresseMetadonneesRessource = () => `${adresseCrm()}/.well-known/oauth-protected-resource/api/mcp`;

const empreinte = (valeur: string) => createHash("sha256").update(valeur).digest("hex");
const secretAleatoire = (octets = 32) => randomBytes(octets).toString("base64url");
const egal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ── Découverte ─────────────────────────────────────────────────────── */

export function metadonneesRessource() {
  return {
    resource: adresseMcp(),
    authorization_servers: [adresseCrm()],
    scopes_supported: [PORTEE],
    bearer_methods_supported: ["header"],
    resource_name: "CRM CoverSwap — assistant",
    resource_documentation: `${adresseCrm()}/parametres#assistant`,
  };
}

export function metadonneesServeur() {
  const base = adresseCrm();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/autoriser`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: [PORTEE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...METHODES_AUTH],
    client_id_metadata_document_supported: true,
    service_documentation: `${base}/parametres#assistant`,
    ui_locales_supported: ["fr-FR"],
  };
}

/* ── Clients ────────────────────────────────────────────────────────── */

export type ClientOAuthLu = { id: string; nom: string; redirectUris: string[]; secretHash: string | null; origine: string };

/** Adresse de retour permise : https (sans fragment), ou http vers la machine locale (clients de bureau, essais). */
export function adresseRetourValide(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

function lireRedirectUris(valeur: unknown): string[] {
  if (!Array.isArray(valeur) || valeur.length === 0 || valeur.length > 10) throw new ErreurOAuth("invalid_redirect_uri", "redirect_uris : une à dix adresses https (ou http vers localhost) attendues.");
  const uris = valeur.map((v) => (typeof v === "string" ? v.trim() : ""));
  for (const uri of uris) if (!adresseRetourValide(uri)) throw new ErreurOAuth("invalid_redirect_uri", `Adresse de retour refusée : ${uri || "(vide)"}.`);
  return [...new Set(uris)];
}

/** Enregistrement dynamique (RFC 7591) : n'ouvre aucun accès, le consentement de Lucas reste requis. */
export async function enregistrerClient(corps: unknown) {
  const c = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  const redirectUris = lireRedirectUris(c.redirect_uris);
  const nom = (typeof c.client_name === "string" && c.client_name.trim().slice(0, 100)) || "Application";
  const methode = typeof c.token_endpoint_auth_method === "string" ? c.token_endpoint_auth_method : "none";
  if (!(METHODES_AUTH as readonly string[]).includes(methode)) throw new ErreurOAuth("invalid_client_metadata", `token_endpoint_auth_method inconnue : ${methode}.`);
  const grants = Array.isArray(c.grant_types) ? c.grant_types.filter((g): g is string => typeof g === "string") : ["authorization_code", "refresh_token"];
  if (grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) throw new ErreurOAuth("invalid_client_metadata", "grant_types : seuls authorization_code et refresh_token sont proposés.");
  const responses = Array.isArray(c.response_types) ? c.response_types.filter((r): r is string => typeof r === "string") : ["code"];
  if (responses.some((r) => r !== "code")) throw new ErreurOAuth("invalid_client_metadata", "response_types : seul « code » est proposé.");
  const id = `cs_${secretAleatoire(12)}`;
  const secret = methode === "none" ? null : secretAleatoire(32);
  await prisma.clientOAuth.create({ data: { id, nom, redirectUris: JSON.stringify(redirectUris), secretHash: secret ? empreinte(secret) : null, origine: "DCR" } });
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: nom,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: methode,
    grant_types: grants.length ? grants : ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: PORTEE,
  };
}

/** Document d'identité (client_id = adresse https) : lu, vérifié, gardé 24 h. */
async function clientParDocument(clientId: string): Promise<ClientOAuthLu> {
  const connu = await prisma.clientOAuth.findUnique({ where: { id: clientId } });
  if (connu?.revoqueLe) throw new ErreurOAuth("invalid_client", "Ce client a été révoqué depuis Paramètres.", 401);
  if (connu && Date.now() - connu.updatedAt.getTime() < CIMD_FRAICHEUR_MS) return { id: connu.id, nom: connu.nom, redirectUris: JSON.parse(connu.redirectUris) as string[], secretHash: null, origine: connu.origine };
  let document: Record<string, unknown> | null = null;
  try {
    const reponse = await fetch(clientId, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000), redirect: "error" });
    if (reponse.ok) {
      const texte = await reponse.text();
      if (texte.length <= 20_000) document = JSON.parse(texte) as Record<string, unknown>;
    }
  } catch {
    document = null;
  }
  if (!document) {
    if (connu) return { id: connu.id, nom: connu.nom, redirectUris: JSON.parse(connu.redirectUris) as string[], secretHash: null, origine: connu.origine };
    throw new ErreurOAuth("invalid_client", "Document d'identité du client illisible.", 401);
  }
  if (document.client_id !== clientId) throw new ErreurOAuth("invalid_client", "Le document d'identité ne porte pas son adresse comme client_id.", 401);
  const redirectUris = lireRedirectUris(document.redirect_uris);
  const nom = (typeof document.client_name === "string" && document.client_name.trim().slice(0, 100)) || new URL(clientId).hostname;
  await prisma.clientOAuth.upsert({ where: { id: clientId }, create: { id: clientId, nom, redirectUris: JSON.stringify(redirectUris), origine: "CIMD" }, update: { nom, redirectUris: JSON.stringify(redirectUris) } });
  return { id: clientId, nom, redirectUris, secretHash: null, origine: "CIMD" };
}

export async function chargerClient(clientId: string): Promise<ClientOAuthLu> {
  if (!clientId || clientId.length > 2_000) throw new ErreurOAuth("invalid_client", "client_id manquant.", 401);
  if (/^https:\/\//.test(clientId)) return clientParDocument(clientId);
  const ligne = await prisma.clientOAuth.findUnique({ where: { id: clientId } });
  if (!ligne) throw new ErreurOAuth("invalid_client", "Client inconnu : à enregistrer d'abord.", 401);
  if (ligne.revoqueLe) throw new ErreurOAuth("invalid_client", "Ce client a été révoqué depuis Paramètres.", 401);
  return { id: ligne.id, nom: ligne.nom, redirectUris: JSON.parse(ligne.redirectUris) as string[], secretHash: ligne.secretHash, origine: ligne.origine };
}

/* ── Autorisation ───────────────────────────────────────────────────── */

export type DemandeAutorisation = { client: ClientOAuthLu; redirectUri: string; state: string | null; scope: string; codeChallenge: string; resource: string | null };

const lire = (p: Record<string, string | string[] | undefined>, cle: string): string | null => {
  const v = p[cle];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length > 0 ? s : null;
};

/** Vérifie une demande d'autorisation ; l'erreur dit pourquoi, la page la montre (jamais de redirection vers une adresse non vérifiée). */
export async function demandeAutorisation(params: Record<string, string | string[] | undefined>): Promise<DemandeAutorisation> {
  const clientId = lire(params, "client_id");
  if (!clientId) throw new ErreurOAuth("invalid_request", "client_id manquant.");
  const client = await chargerClient(clientId);
  const redirectUri = lire(params, "redirect_uri");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) throw new ErreurOAuth("invalid_request", "redirect_uri absente ou différente de celles enregistrées pour ce client.");
  if (lire(params, "response_type") !== "code") throw new ErreurOAuth("unsupported_response_type", "response_type doit valoir « code ».");
  const codeChallenge = lire(params, "code_challenge");
  if (!codeChallenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) throw new ErreurOAuth("invalid_request", "code_challenge PKCE manquant ou mal formé.");
  if (lire(params, "code_challenge_method") !== "S256") throw new ErreurOAuth("invalid_request", "code_challenge_method doit valoir S256.");
  const scope = lire(params, "scope") ?? PORTEE;
  if (scope.split(/\s+/).some((s) => s !== PORTEE)) throw new ErreurOAuth("invalid_scope", `Seule la portée « ${PORTEE} » existe.`);
  const resource = lire(params, "resource");
  if (resource && resource.replace(/\/$/, "") !== adresseMcp()) throw new ErreurOAuth("invalid_target", `resource doit valoir ${adresseMcp()}.`);
  const state = lire(params, "state");
  if (state && state.length > 1_000) throw new ErreurOAuth("invalid_request", "state trop long.");
  return { client, redirectUri, state, scope: PORTEE, codeChallenge, resource: resource ? adresseMcp() : null };
}

function adresseDeRetour(redirectUri: string, champs: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(champs)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

/** Lucas a dit oui : un code d'autorisation à usage unique, dix minutes. */
export async function accorder(demande: DemandeAutorisation, utilisateur: string, maintenant = new Date()): Promise<string> {
  const code = secretAleatoire(32);
  await prisma.codeOAuth.create({ data: { codeHash: empreinte(code), clientId: demande.client.id, redirectUri: demande.redirectUri, codeChallenge: demande.codeChallenge, scope: demande.scope, resource: demande.resource, utilisateur, expireLe: new Date(maintenant.getTime() + DUREE_CODE_MS) } });
  return adresseDeRetour(demande.redirectUri, { code, state: demande.state, iss: adresseCrm() });
}

export function refuser(demande: DemandeAutorisation): string {
  return adresseDeRetour(demande.redirectUri, { error: "access_denied", error_description: "Lucas a refusé l'accès.", state: demande.state });
}

/* ── Jetons ─────────────────────────────────────────────────────────── */

function authentifierClient(client: ClientOAuthLu, form: URLSearchParams, entetes: Headers): void {
  if (!client.secretHash) return;
  let secret = form.get("client_secret");
  const basic = entetes.get("authorization");
  if (basic?.startsWith("Basic ")) {
    try {
      const [id, s] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
      if (decodeURIComponent(id) === client.id) secret = decodeURIComponent(s ?? "");
    } catch {
      secret = null;
    }
  }
  if (!secret || !egal(empreinte(secret), client.secretHash)) throw new ErreurOAuth("invalid_client", "Secret du client absent ou faux.", 401);
}

async function emettreJetons(entree: { client: ClientOAuthLu; utilisateur: string; scope: string; resource: string | null; familleId: string; clientNom?: string | null }, maintenant: Date) {
  const acces = secretAleatoire(32);
  const renouvellement = secretAleatoire(32);
  const expireAcces = new Date(maintenant.getTime() + DUREE_ACCES_MS);
  await prisma.$transaction([
    prisma.jetonOAuth.create({ data: { jetonHash: empreinte(acces), type: "ACCES", clientId: entree.client.id, utilisateur: entree.utilisateur, scope: entree.scope, resource: entree.resource, familleId: entree.familleId, expireLe: expireAcces, clientNom: entree.clientNom ?? null } }),
    prisma.jetonOAuth.create({ data: { jetonHash: empreinte(renouvellement), type: "RENOUVELLEMENT", clientId: entree.client.id, utilisateur: entree.utilisateur, scope: entree.scope, resource: entree.resource, familleId: entree.familleId, expireLe: new Date(maintenant.getTime() + DUREE_RENOUVELLEMENT_MS), clientNom: entree.clientNom ?? null } }),
  ]);
  return { access_token: acces, token_type: "Bearer", expires_in: Math.floor(DUREE_ACCES_MS / 1000), refresh_token: renouvellement, scope: entree.scope };
}

async function revoquerFamille(familleId: string, motif: string, maintenant: Date): Promise<void> {
  await prisma.jetonOAuth.updateMany({ where: { familleId, revoqueLe: null }, data: { revoqueLe: maintenant, revoqueMotif: motif } });
}

function verifierPkce(codeVerifier: string | null, codeChallenge: string): void {
  if (!codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new ErreurOAuth("invalid_grant", "code_verifier PKCE manquant ou mal formé.");
  const attendu = createHash("sha256").update(codeVerifier).digest("base64url");
  if (!egal(attendu, codeChallenge)) throw new ErreurOAuth("invalid_grant", "code_verifier ne correspond pas au code_challenge.");
}

/** Point d'échange (form-urlencoded) : code d'autorisation → jetons ; jeton de renouvellement → nouveaux jetons (rotation). */
export async function echangerJeton(form: URLSearchParams, entetes: Headers, maintenant = new Date()) {
  const grant = form.get("grant_type");
  let clientId = form.get("client_id");
  const basic = entetes.get("authorization");
  if (!clientId && basic?.startsWith("Basic ")) {
    try {
      clientId = decodeURIComponent(Buffer.from(basic.slice(6), "base64").toString("utf8").split(":")[0]);
    } catch {
      clientId = null;
    }
  }
  if (!clientId) throw new ErreurOAuth("invalid_client", "client_id manquant.", 401);
  const client = await chargerClient(clientId);
  authentifierClient(client, form, entetes);

  if (grant === "authorization_code") {
    const code = form.get("code");
    if (!code) throw new ErreurOAuth("invalid_grant", "code manquant.");
    const ligne = await prisma.codeOAuth.findUnique({ where: { codeHash: empreinte(code) } });
    if (!ligne || ligne.clientId !== client.id) throw new ErreurOAuth("invalid_grant", "Code d'autorisation inconnu.");
    if (ligne.utiliseLe) {
      // Un code présenté deux fois : tout ce qu'il a produit tombe (RFC 6749 §4.1.2).
      await revoquerFamille(ligne.id, "Code d'autorisation réutilisé", maintenant);
      throw new ErreurOAuth("invalid_grant", "Code d'autorisation déjà utilisé : ses jetons sont révoqués.");
    }
    if (ligne.expireLe < maintenant) throw new ErreurOAuth("invalid_grant", "Code d'autorisation expiré (dix minutes).");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== ligne.redirectUri) throw new ErreurOAuth("invalid_grant", "redirect_uri différente de celle de la demande d'autorisation.");
    verifierPkce(form.get("code_verifier"), ligne.codeChallenge);
    const resource = form.get("resource");
    if (resource && resource.replace(/\/$/, "") !== adresseMcp()) throw new ErreurOAuth("invalid_target", `resource doit valoir ${adresseMcp()}.`);
    await prisma.codeOAuth.update({ where: { id: ligne.id }, data: { utiliseLe: maintenant } });
    return emettreJetons({ client, utilisateur: ligne.utilisateur, scope: ligne.scope, resource: ligne.resource, familleId: ligne.id }, maintenant);
  }

  if (grant === "refresh_token") {
    const jeton = form.get("refresh_token");
    if (!jeton) throw new ErreurOAuth("invalid_grant", "refresh_token manquant.");
    const ligne = await prisma.jetonOAuth.findUnique({ where: { jetonHash: empreinte(jeton) } });
    if (!ligne || ligne.type !== "RENOUVELLEMENT" || ligne.clientId !== client.id) throw new ErreurOAuth("invalid_grant", "Jeton de renouvellement inconnu.");
    if (ligne.revoqueLe) {
      // Réutilisation d'un jeton déjà tourné : quelqu'un d'autre l'a peut-être ; toute la famille tombe.
      await revoquerFamille(ligne.familleId, "Jeton de renouvellement réutilisé", maintenant);
      throw new ErreurOAuth("invalid_grant", "Jeton de renouvellement déjà utilisé : la connexion est révoquée, se reconnecter.");
    }
    if (ligne.expireLe < maintenant) throw new ErreurOAuth("invalid_grant", "Jeton de renouvellement expiré : se reconnecter.");
    await revoquerFamille(ligne.familleId, "Renouvelé (rotation)", maintenant);
    return emettreJetons({ client, utilisateur: ligne.utilisateur, scope: ligne.scope, resource: ligne.resource, familleId: ligne.familleId, clientNom: ligne.clientNom }, maintenant);
  }

  throw new ErreurOAuth("unsupported_grant_type", "grant_type : authorization_code ou refresh_token.");
}

export type JetonVerifie = { id: string; clientId: string; clientNom: string | null; utilisateur: string; scope: string; expireLe: Date };

/** Le jeton porteur d'une requête MCP : valide, ou null (401). */
export async function verifierJetonAcces(jeton: string | null, maintenant = new Date()): Promise<JetonVerifie | null> {
  if (!jeton || jeton.length < 20 || jeton.length > 200) return null;
  const ligne = await prisma.jetonOAuth.findUnique({ where: { jetonHash: empreinte(jeton) } });
  if (!ligne || ligne.type !== "ACCES" || ligne.revoqueLe || ligne.expireLe < maintenant) return null;
  const client = await prisma.clientOAuth.findUnique({ where: { id: ligne.clientId }, select: { revoqueLe: true } });
  if (!client || client.revoqueLe) return null;
  if (!ligne.dernierUsageLe || maintenant.getTime() - ligne.dernierUsageLe.getTime() > 60_000) {
    await prisma.jetonOAuth.update({ where: { id: ligne.id }, data: { dernierUsageLe: maintenant } }).catch(() => undefined);
  }
  return { id: ligne.id, clientId: ligne.clientId, clientNom: ligne.clientNom, utilisateur: ligne.utilisateur, scope: ligne.scope, expireLe: ligne.expireLe };
}

export function jetonPorteur(requete: Request): string | null {
  const entete = requete.headers.get("authorization");
  if (!entete || !/^Bearer\s+/i.test(entete)) return null;
  return entete.replace(/^Bearer\s+/i, "").trim() || null;
}

/** Le nom que le client MCP a donné à l'initialisation (« Claude »), gardé sur le jeton pour l'écran. */
export async function noterClientMcp(jetonId: string, nom: string): Promise<void> {
  const propre = nom.trim().slice(0, 80);
  if (!propre) return;
  // Toute la famille (accès + renouvellement) : le nom survit à la rotation des jetons.
  const ligne = await prisma.jetonOAuth.findUnique({ where: { id: jetonId }, select: { familleId: true, clientNom: true } });
  if (!ligne || ligne.clientNom === propre) return;
  await prisma.jetonOAuth.updateMany({ where: { familleId: ligne.familleId }, data: { clientNom: propre } }).catch(() => undefined);
}

/* ── Révocation et écran Paramètres ─────────────────────────────────── */

export async function revoquerClient(clientId: string, motif: string, maintenant = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.clientOAuth.updateMany({ where: { id: clientId, revoqueLe: null }, data: { revoqueLe: maintenant, revoqueMotif: motif } }),
    prisma.jetonOAuth.updateMany({ where: { clientId, revoqueLe: null }, data: { revoqueLe: maintenant, revoqueMotif: motif } }),
  ]);
}

/** Révoque un jeton et sa famille (l'accès et son renouvellement tombent ensemble). */
export async function revoquerJeton(jetonId: string, motif: string, maintenant = new Date()): Promise<void> {
  const ligne = await prisma.jetonOAuth.findUnique({ where: { id: jetonId }, select: { familleId: true } });
  if (ligne) await revoquerFamille(ligne.familleId, motif, maintenant);
}

export async function revoquerTout(motif: string, maintenant = new Date()): Promise<number> {
  const r = await prisma.jetonOAuth.updateMany({ where: { revoqueLe: null }, data: { revoqueLe: maintenant, revoqueMotif: motif } });
  return r.count;
}

export type AccesVue = {
  clients: { id: string; nom: string; origine: string; creeLe: string; revoqueLe: string | null; connexions: { id: string; clientNom: string | null; utilisateur: string; creeLe: string; expireLe: string; dernierUsageLe: string | null; revoqueLe: string | null; active: boolean }[] }[];
  connexionsActives: number;
};

/** Ce que l'écran Paramètres montre : les applications connectées et leurs jetons (jamais leur valeur). */
export async function listerAcces(maintenant = new Date()): Promise<AccesVue> {
  const [clients, jetons] = await Promise.all([
    prisma.clientOAuth.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.jetonOAuth.findMany({ where: { type: "ACCES" }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  const vue = clients.map((c) => ({
    id: c.id,
    nom: c.nom,
    origine: c.origine,
    creeLe: c.createdAt.toISOString(),
    revoqueLe: c.revoqueLe?.toISOString() ?? null,
    connexions: jetons
      .filter((j) => j.clientId === c.id)
      .slice(0, 10)
      .map((j) => ({ id: j.id, clientNom: j.clientNom, utilisateur: j.utilisateur, creeLe: j.createdAt.toISOString(), expireLe: j.expireLe.toISOString(), dernierUsageLe: j.dernierUsageLe?.toISOString() ?? null, revoqueLe: j.revoqueLe?.toISOString() ?? null, active: !j.revoqueLe && j.expireLe > maintenant && !c.revoqueLe })),
  }));
  return { clients: vue, connexionsActives: vue.reduce((t, c) => t + c.connexions.filter((j) => j.active).length, 0) };
}
