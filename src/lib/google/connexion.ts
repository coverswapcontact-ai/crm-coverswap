import { randomBytes } from "node:crypto";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AttenteExterne, ErreurDefinitive, PREFIXE_ATTENTE } from "@/lib/taches/registre";
import { chiffrer, dechiffrer, lireCle } from "./chiffrement";
import { applicationGooglePubliee, echeanceJetonGoogle, type EcheanceGoogle, type RappelGoogle } from "./echeance";

/**
 * Connexion au compte Google de l'entreprise, partagée par le miroir Drive et
 * l'agent mail. OAuth 2 « application web » : la personne connectée au CRM
 * autorise l'accès une fois ; le jeton de renouvellement est gardé chiffré ;
 * les jetons d'accès, courts, restent en mémoire.
 *
 * Portées demandées, au plus juste :
 * - drive.file : le CRM ne voit et ne modifie que les fichiers qu'il a créés ;
 * - gmail.modify : lire et ranger les mails (libellés, archivage), sans
 *   suppression définitive ; le code n'appelle jamais la corbeille ;
 * - gmail.send : envoyer un mail validé.
 *
 * Sans GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_TOKEN_KEY, rien ne se
 * connecte et tout ce qui dépend de Google reste désactivé.
 */

export const PORTEES_GOOGLE = {
  DRIVE: "https://www.googleapis.com/auth/drive.file",
  GMAIL_MODIFIER: "https://www.googleapis.com/auth/gmail.modify",
  GMAIL_ENVOYER: "https://www.googleapis.com/auth/gmail.send",
  /** Mission 8 : l'assistant inscrit les rappels et actions planifiées dans Google Calendar (accordé à la prochaine reconnexion). */
  AGENDA: "https://www.googleapis.com/auth/calendar.events",
} as const;
const PORTEES_DEMANDEES = ["openid", "email", ...Object.values(PORTEES_GOOGLE)];

const URL_AUTORISATION = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_JETON = "https://oauth2.googleapis.com/token";
const URL_REVOCATION = "https://oauth2.googleapis.com/revoke";
const URL_UTILISATEUR = "https://openidconnect.googleapis.com/v1/userinfo";

export const COOKIE_ETAT = "coverswap_google_etat";

type Transport = (url: string, init?: RequestInit) => Promise<Response>;
const CLE_TRANSPORT = "__coverswapTransportGoogleEssai";
const globalEssai = globalThis as unknown as Record<string, Transport | undefined>;

/** Essais seulement : remplace les appels réseau vers Google. */
export function definirTransportGoogleEssai(transport: Transport | null): void {
  globalEssai[CLE_TRANSPORT] = transport ?? undefined;
}

function transport(): Transport {
  return globalEssai[CLE_TRANSPORT] ?? ((url, init) => fetch(url, init));
}

export type ConfigurationGoogle = { clientId: string; clientSecret: string; cle: Buffer; redirection: string };

export function configurationGoogle(): { configuration: ConfigurationGoogle | null; manquantes: string[] } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const cle = lireCle(process.env.GOOGLE_TOKEN_KEY);
  const base = process.env.GOOGLE_REDIRECT_BASE_URL ?? process.env.NEXTAUTH_URL;
  const manquantes = [
    ...(clientId ? [] : ["GOOGLE_CLIENT_ID"]),
    ...(clientSecret ? [] : ["GOOGLE_CLIENT_SECRET"]),
    ...(cle ? [] : ["GOOGLE_TOKEN_KEY (32 octets en base64)"]),
    ...(base ? [] : ["NEXTAUTH_URL"]),
  ];
  if (manquantes.length > 0) return { configuration: null, manquantes };
  return { configuration: { clientId: clientId!, clientSecret: clientSecret!, cle: cle!, redirection: `${base!.replace(/\/$/, "")}/api/google/retour` }, manquantes: [] };
}

function configurationExigee(): ConfigurationGoogle {
  const { configuration, manquantes } = configurationGoogle();
  if (!configuration) throw new ErreurMetier(`Connexion Google non configurée : variables manquantes ${manquantes.join(", ")}.`, 503);
  return configuration;
}

/** Adresse de consentement Google et état anti-falsification (à garder en cookie). */
export function debuterConnexion(): { url: string; etat: string } {
  const configuration = configurationExigee();
  const etat = randomBytes(24).toString("hex");
  const parametres = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.redirection,
    response_type: "code",
    scope: PORTEES_DEMANDEES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: etat,
  });
  return { url: `${URL_AUTORISATION}?${parametres}`, etat };
}

async function lireJson(reponse: Response): Promise<Record<string, unknown>> {
  return ((await reponse.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/** Retour de Google : échange du code, compte vérifié, jeton chiffré enregistré. */
export async function terminerConnexion(entree: { code: string | null; etat: string | null; etatAttendu: string | null; erreur: string | null }): Promise<{ compte: string }> {
  if (entree.erreur) throw new ErreurMetier(entree.erreur === "access_denied" ? "Accès refusé dans Google : rien n'a été connecté." : `Google a refusé : ${entree.erreur}.`, 400);
  if (!entree.code || !entree.etat || !entree.etatAttendu || entree.etat !== entree.etatAttendu) {
    throw new ErreurMetier("Retour de Google invalide ou expiré : relance la connexion depuis le CRM.", 400);
  }
  const configuration = configurationExigee();
  const reponse = await transport()(URL_JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: entree.code,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      redirect_uri: configuration.redirection,
      grant_type: "authorization_code",
    }),
  });
  const jetons = await lireJson(reponse);
  if (!reponse.ok) throw new ErreurMetier(`Échange avec Google refusé (${String(jetons.error ?? reponse.status)}).`, 502);
  if (typeof jetons.refresh_token !== "string") {
    throw new ErreurMetier("Google n'a pas fourni d'accès durable : retire l'accès de CoverSwap dans le compte Google, puis reconnecte.", 502);
  }
  const utilisateur = await lireJson(
    await transport()(URL_UTILISATEUR, { headers: { Authorization: `Bearer ${String(jetons.access_token)}` } })
  );
  if (typeof utilisateur.email !== "string") throw new ErreurMetier("Compte Google illisible : reconnecte.", 502);

  await prisma.$transaction(async (tx) => {
    await tx.connexionGoogle.updateMany({ where: { deconnecteLe: null }, data: { deconnecteLe: new Date() } });
    await tx.connexionGoogle.create({
      data: {
        compte: utilisateur.email as string,
        portees: typeof jetons.scope === "string" ? jetons.scope : PORTEES_DEMANDEES.join(" "),
        jetonChiffre: chiffrer(jetons.refresh_token as string, configuration.cle),
      },
    });
  });
  cacheJeton.delete("courant");
  await reveillerTachesEnAttente();
  return { compte: utilisateur.email };
}

export type EtatConnexionGoogle = {
  configuree: boolean;
  manquantes: string[];
  connexion: { compte: string; depuis: string; portees: string[]; derniereErreur: string | null; echeance: EcheanceGoogle } | null;
};

export async function etatConnexionGoogle(): Promise<EtatConnexionGoogle> {
  const { configuration, manquantes } = configurationGoogle();
  const connexion = await prisma.connexionGoogle.findFirst({ where: { deconnecteLe: null }, orderBy: { createdAt: "desc" } });
  return {
    configuree: configuration !== null,
    manquantes,
    connexion: connexion
      ? {
          compte: connexion.compte,
          depuis: connexion.createdAt.toISOString(),
          portees: connexion.portees.split(" "),
          derniereErreur: connexion.derniereErreur,
          echeance: echeanceJetonGoogle({ depuis: connexion.createdAt, derniereErreur: connexion.derniereErreur }, { modeTest: !applicationGooglePubliee() }),
        }
      : null,
  };
}

/**
 * Rappel affiché sur tous les écrans : connexion qui expire dans moins de
 * 48 h (mode Test) ou déjà coupée. null quand tout va bien, ou sans connexion.
 */
export async function rappelConnexionGoogle(maintenant: Date = new Date()): Promise<RappelGoogle | null> {
  if (!configurationGoogle().configuration) return null;
  const connexion = await prisma.connexionGoogle.findFirst({ where: { deconnecteLe: null }, orderBy: { createdAt: "desc" } });
  if (!connexion) return null;
  const echeance = echeanceJetonGoogle({ depuis: connexion.createdAt, derniereErreur: connexion.derniereErreur }, { maintenant, modeTest: !applicationGooglePubliee() });
  return echeance.niveau === "LOINTAINE" ? null : { ...echeance, compte: connexion.compte };
}

/** Déconnexion : l'accès est révoqué chez Google, la ligne reste (datée). */
export async function deconnecterGoogle(): Promise<void> {
  const connexion = await prisma.connexionGoogle.findFirst({ where: { deconnecteLe: null } });
  if (!connexion) return;
  const { configuration } = configurationGoogle();
  if (configuration) {
    try {
      const jeton = dechiffrer(connexion.jetonChiffre, configuration.cle);
      await transport()(URL_REVOCATION, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: jeton }) });
    } catch (erreur) {
      console.error("[google] révocation impossible :", erreur);
    }
  }
  await prisma.connexionGoogle.update({ where: { id: connexion.id }, data: { deconnecteLe: new Date() } });
  cacheJeton.delete("courant");
}

const cacheJeton = new Map<string, { jeton: string; expire: number; connexionId: string }>();

/** Connexion active qui porte cette portée, ou null (fonction désactivée). */
export async function connexionActive(portee: string): Promise<{ id: string; compte: string } | null> {
  if (!configurationGoogle().configuration) return null;
  const connexion = await prisma.connexionGoogle.findFirst({ where: { deconnecteLe: null }, orderBy: { createdAt: "desc" } });
  return connexion && connexion.portees.split(" ").includes(portee) ? { id: connexion.id, compte: connexion.compte } : null;
}

/**
 * Google coupé (jamais connecté, déconnecté, jeton expiré, accès à étendre) :
 * les actions attendent la reconnexion au lieu d'échouer, et Lucas est
 * prévenu (une alerte par demi-journée au plus).
 */
export class GoogleIndisponible extends AttenteExterne {
  constructor(message: string) {
    super(`Google : ${message}`);
    this.name = "GoogleIndisponible";
  }
}

async function prevenirGoogleCoupe(raison: string): Promise<void> {
  try {
    const recente = await prisma.alerteEnvoi.findFirst({ where: { origine: "google-coupe", createdAt: { gte: new Date(Date.now() - 12 * 3_600_000) } }, select: { id: true } });
    if (recente) return;
    const { alerter } = await import("@/lib/alertes/canaux");
    await alerter(
      {
        titre: "Google coupé : les actions mail et Drive attendent",
        texte: `${raison}\nRien n'est perdu : les rangements, envois et copies attendent la reconnexion (Paramètres → Connexions → Google), puis repartent seuls.`,
        lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/parametres`,
        libelleLien: "Reconnecter Google",
        urgence: 4,
        etiquette: "google-coupe",
      },
      { origine: "google-coupe", canaux: ["telegram", "ntfy", "pushweb", "mail"] }
    );
  } catch (erreur) {
    console.error("[google] alerte de coupure non envoyée :", erreur);
  }
}

async function indisponible(raison: string): Promise<never> {
  await prevenirGoogleCoupe(raison);
  throw new GoogleIndisponible(raison);
}

/** Après une reconnexion : les tâches qui attendaient Google repartent tout de suite. */
async function reveillerTachesEnAttente(): Promise<void> {
  await prisma.tache
    .updateMany({ where: { statut: "EN_ATTENTE", derniereErreur: { startsWith: `${PREFIXE_ATTENTE}Google` } }, data: { prochainEssaiLe: new Date() } })
    .catch((erreur) => console.error("[google] réveil des tâches en attente :", erreur));
}

async function jetonAcces(portee: string, forcer = false): Promise<string> {
  const configuration = configurationGoogle().configuration;
  if (!configuration) return indisponible("connexion non configurée sur le serveur.");
  const connexion = await prisma.connexionGoogle.findFirst({ where: { deconnecteLe: null }, orderBy: { createdAt: "desc" } });
  if (!connexion) return indisponible("aucun compte connecté.");
  if (!connexion.portees.split(" ").includes(portee)) return indisponible(`accès à étendre (${portee}) : reconnecter le compte dans Paramètres.`);

  const enCache = cacheJeton.get("courant");
  if (!forcer && enCache && enCache.connexionId === connexion.id && enCache.expire > Date.now()) return enCache.jeton;

  const reponse = await transport()(URL_JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      refresh_token: dechiffrer(connexion.jetonChiffre, configuration.cle),
      grant_type: "refresh_token",
    }),
  });
  const corps = await lireJson(reponse);
  if (!reponse.ok || typeof corps.access_token !== "string") {
    if (corps.error === "invalid_grant") {
      await prisma.connexionGoogle.update({ where: { id: connexion.id }, data: { derniereErreur: "Accès révoqué ou expiré côté Google : reconnecter." } });
      return indisponible("accès révoqué ou expiré (7 jours en mode Test) : reconnecter le compte dans Paramètres.");
    }
    throw new Error(`Renouvellement du jeton Google impossible (${String(corps.error ?? reponse.status)})`);
  }
  const expire = Date.now() + (Number(corps.expires_in ?? 3600) - 60) * 1000;
  cacheJeton.set("courant", { jeton: corps.access_token, expire, connexionId: connexion.id });
  if (connexion.derniereErreur) await prisma.connexionGoogle.update({ where: { id: connexion.id }, data: { derniereErreur: null } });
  return corps.access_token;
}

/**
 * Appel d'une API Google avec le jeton de la connexion. Un 401 renouvelle le
 * jeton et réessaie une fois ; 429 et 5xx lèvent une erreur ordinaire (la
 * tâche réessaiera plus tard) ; 403 d'accès est définitif.
 */
export async function appelGoogle(url: string, init: RequestInit & { portee: string }): Promise<Response> {
  const { portee, ...options } = init;
  let reponse: Response | null = null;
  for (const forcer of [false, true]) {
    const jeton = await jetonAcces(portee, forcer);
    reponse = await transport()(url, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${jeton}` } });
    if (reponse.status !== 401) break;
  }
  if (!reponse) throw new Error("Appel Google impossible");
  if (reponse.status === 429 || reponse.status >= 500) throw new Error(`Google indisponible (${reponse.status}) : nouvel essai plus tard`);
  if (reponse.status === 403) {
    const corps = await reponse.clone().json().catch(() => null);
    const raison = (corps as { error?: { errors?: { reason?: string }[] } } | null)?.error?.errors?.[0]?.reason;
    if (raison === "rateLimitExceeded" || raison === "userRateLimitExceeded") throw new Error("Quota Google atteint : nouvel essai plus tard");
    throw new ErreurDefinitive(`Accès refusé par Google (${raison ?? "403"}).`);
  }
  return reponse;
}
