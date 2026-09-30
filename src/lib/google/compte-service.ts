import { createPrivateKey, sign } from "node:crypto";
import { AccesEnAttente } from "@/lib/analytique/suivi";

/**
 * Mission 17 (partie B) — Google par COMPTE DE SERVICE, pour l'Analytique (Search Console, fiche Google). Rien à voir
 * avec la connexion OAuth de Lucas (google/connexion.ts : Drive, Gmail, Agenda) : pas de reconnexion, pas
 * d'expiration à 7 jours, pas d'alerte « Google coupé ».
 *
 * Variable : GOOGLE_SERVICE_ACCOUNT_JSON = le contenu du fichier de clé JSON (tel quel, ou encodé en base64 si
 * Railway abîme le multi-ligne). Le jeton d'accès s'obtient en signant soi-même un JWT RS256 (node:crypto, aucune
 * dépendance) échangé à https://oauth2.googleapis.com/token ; il n'y a pas de jeton de rafraîchissement : on re-signe
 * à l'expiration. Le jeton est gardé en mémoire (par jeu de portées) jusqu'à 60 s avant son expiration.
 *
 * Réponses : 401 → nouveau jeton, un seul nouvel essai ; 403 d'accès (compte de service pas ajouté, API non activée,
 * accès Business Profile non accordé) et 429 « quota 0 » → `AccesEnAttente` (état « en attente d'accès », jamais une
 * erreur bruyante) ; 429 et 5xx ordinaires → Error (la tâche réessaie).
 */

export const URL_JETON_GOOGLE = "https://oauth2.googleapis.com/token";
export const PORTEES_ANALYTIQUE = {
  SEARCH_CONSOLE: "https://www.googleapis.com/auth/webmasters.readonly",
  FICHE: "https://www.googleapis.com/auth/business.manage",
} as const;

export type CompteService = { email: string; clePrivee: string; idCle: string | null };

/** Lit GOOGLE_SERVICE_ACCOUNT_JSON (JSON brut ou base64). `erreur` dit pourquoi la clé est illisible ; les deux null : absente. */
export function configurationCompteService(env: NodeJS.ProcessEnv = process.env): { compte: CompteService | null; erreur: string | null } {
  const brut = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!brut) return { compte: null, erreur: null };
  let texte = brut;
  if (!brut.startsWith("{")) {
    try {
      texte = Buffer.from(brut, "base64").toString("utf8").trim();
    } catch {
      texte = "";
    }
  }
  try {
    const cle = JSON.parse(texte) as { client_email?: unknown; private_key?: unknown; private_key_id?: unknown };
    if (typeof cle.client_email !== "string" || typeof cle.private_key !== "string") return { compte: null, erreur: "GOOGLE_SERVICE_ACCOUNT_JSON sans client_email ni private_key : coller le fichier de clé JSON entier." };
    // Une clé recollée à la main arrive parfois avec des « \n » littéraux.
    const clePrivee = cle.private_key.includes("\\n") ? cle.private_key.replace(/\\n/g, "\n") : cle.private_key;
    return { compte: { email: cle.client_email, clePrivee, idCle: typeof cle.private_key_id === "string" ? cle.private_key_id : null }, erreur: null };
  } catch {
    return { compte: null, erreur: "GOOGLE_SERVICE_ACCOUNT_JSON illisible : coller le contenu du fichier de clé JSON (ou son encodage base64)." };
  }
}

const base64url = (valeur: unknown) => Buffer.from(typeof valeur === "string" ? valeur : JSON.stringify(valeur)).toString("base64url");

/** Le JWT signé (RS256) que Google échange contre un jeton d'accès. Pur : l'instant est fourni. */
export function assertionJwt(compte: CompteService, portees: readonly string[], maintenantMs: number = Date.now()): string {
  const iat = Math.floor(maintenantMs / 1000) - 30; // marge d'horloge
  const entete = base64url({ alg: "RS256", typ: "JWT", ...(compte.idCle ? { kid: compte.idCle } : {}) });
  const corps = base64url({ iss: compte.email, scope: portees.join(" "), aud: URL_JETON_GOOGLE, iat, exp: iat + 3600 });
  const signature = sign("sha256", Buffer.from(`${entete}.${corps}`), createPrivateKey(compte.clePrivee)).toString("base64url");
  return `${entete}.${corps}.${signature}`;
}

type JetonEnCache = { jeton: string; expire: number };
const CLE_CACHE = "__coverswapJetonsCompteService";
const globalCache = globalThis as unknown as Record<string, Map<string, JetonEnCache> | undefined>;
const cache = (globalCache[CLE_CACHE] ??= new Map());

/** Pour les essais (et après un changement de clé). */
export function oublierJetonsCompteService(): void {
  cache.clear();
}

/** Un jeton d'accès pour ces portées : en mémoire tant qu'il vaut, sinon un JWT neuf échangé chez Google. */
export async function jetonCompteService(portees: readonly string[], options: { forcer?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { compte, erreur } = configurationCompteService(options.env);
  if (!compte) throw new Error(erreur ?? "GOOGLE_SERVICE_ACCOUNT_JSON absente.");
  const cle = `${compte.email}|${[...portees].sort().join(" ")}`;
  const connu = cache.get(cle);
  if (connu && !options.forcer && connu.expire > Date.now()) return connu.jeton;
  const rep = await fetch(URL_JETON_GOOGLE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertionJwt(compte, portees) }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const corps = (await rep.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!rep.ok || !corps.access_token) {
    const raison = `${corps.error ?? `HTTP ${rep.status}`}${corps.error_description ? ` (${corps.error_description})` : ""}`;
    if (corps.error === "invalid_grant" || corps.error === "invalid_client" || corps.error === "unauthorized_client") {
      throw new Error(`Google refuse la clé du compte de service : ${raison}. Refaire une clé JSON et remplacer GOOGLE_SERVICE_ACCOUNT_JSON.`);
    }
    throw new Error(`Jeton du compte de service indisponible : ${raison}.`);
  }
  cache.set(cle, { jeton: corps.access_token, expire: Date.now() + Math.max(60, (corps.expires_in ?? 3600) - 60) * 1000 });
  return corps.access_token;
}

/** L'adresse du compte de service (à ajouter dans Search Console, ou comme gérant de la fiche), sans secret. */
export function emailCompteService(env: NodeJS.ProcessEnv = process.env): string | null {
  return configurationCompteService(env).compte?.email ?? null;
}

/** Le corps d'erreur Google, lu sans lever. */
async function lireErreur(rep: Response): Promise<{ texte: string; message: string; statut: string; raisons: string[] }> {
  const texte = await rep.text().catch(() => "");
  try {
    const corps = JSON.parse(texte) as { error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } };
    const e = corps.error ?? {};
    const raisons = [...(e.errors ?? []).map((x) => x.reason ?? ""), ...(e.details ?? []).map((x) => x.reason ?? "")].filter(Boolean);
    return { texte, message: e.message ?? texte.slice(0, 300), statut: e.status ?? "", raisons };
  } catch {
    return { texte, message: texte.slice(0, 300), statut: "", raisons: [] };
  }
}

/**
 * Un appel à une API Google avec le compte de service. `service` nomme l'API dans les messages (« Search Console »,
 * « Fiche Google ») ; `aFaire` est la phrase donnée quand l'accès manque (qui ajouter, où).
 */
export async function appelCompteService(url: string, init: RequestInit & { portees: readonly string[]; service: string; aFaire: string; env?: NodeJS.ProcessEnv }): Promise<Response> {
  const { portees, service, aFaire, env, ...requete } = init;
  for (let essai = 0; ; essai++) {
    const jeton = await jetonCompteService(portees, { forcer: essai > 0, env });
    const entetes = new Headers(requete.headers);
    entetes.set("Authorization", `Bearer ${jeton}`);
    const rep = await fetch(url, { ...requete, headers: entetes, signal: requete.signal ?? AbortSignal.timeout(30_000) });
    if (rep.ok) return rep;
    if (rep.status === 401 && essai === 0) continue;
    const erreur = await lireErreur(rep);
    const quotaNul = rep.status === 429 && /limit[^0-9]{0,40}\b0\b|quota_limit_value[^0-9]{0,6}0\b/i.test(erreur.texte);
    const apiNonActivee = /accessNotConfigured|SERVICE_DISABLED/.test(erreur.texte);
    if (rep.status === 401 || rep.status === 403 || quotaNul) {
      if (/rateLimitExceeded|userRateLimitExceeded/.test(erreur.texte) && !quotaNul) throw new Error(`${service} : limite de débit (${erreur.message}).`);
      const pourquoi = apiNonActivee ? "API non activée dans le projet Google Cloud du compte de service" : quotaNul ? "accès à l'API pas encore accordé par Google (quota 0)" : "accès non accordé au compte de service";
      throw new AccesEnAttente(`${service} en attente d'accès : ${pourquoi}. ${aFaire} (Google : ${erreur.message.slice(0, 200)})`);
    }
    throw new Error(`${service} : HTTP ${rep.status}${erreur.statut ? ` ${erreur.statut}` : ""} — ${erreur.message.slice(0, 300)}`);
  }
}
