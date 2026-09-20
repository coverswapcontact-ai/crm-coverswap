/**
 * Réseau sortant des alertes : dire POURQUOI un envoi échoue, et passer quand même.
 *
 * Le 20/09/2026 au soir, ntfy répondait « TypeError: fetch failed » depuis
 * Railway, sans autre précision : `fetch` range la vraie raison (DNS, IPv6
 * injoignable, connexion refusée, délai) dans `erreur.cause`, que personne ne
 * lisait. Ce module la déroule, offre un second chemin d'envoi (module https
 * de Node, IPv4 forcé) quand `fetch` échoue, et une sonde qui mesure ce que le
 * serveur arrive réellement à joindre. Aucune valeur secrète ne transite ici.
 */
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/** Déroule la chaîne des causes d'une erreur réseau : « fetch failed ← ENETUNREACH 2a01:… ». */
export function decrireErreur(erreur: unknown, profondeur = 0): string {
  if (profondeur > 4 || erreur === null || erreur === undefined) return "";
  if (typeof erreur !== "object") return String(erreur);
  const e = erreur as { name?: string; message?: string; code?: string; cause?: unknown; errors?: unknown[]; address?: string; port?: number };
  const ici = [e.code, e.name && e.name !== "Error" ? e.name : null, e.message, e.address ? `${e.address}${e.port ? `:${e.port}` : ""}` : null]
    .filter(Boolean)
    .join(" ");
  const sous = Array.isArray(e.errors) ? e.errors.map((x) => decrireErreur(x, profondeur + 1)).filter(Boolean).join(" | ") : "";
  const cause = e.cause ? decrireErreur(e.cause, profondeur + 1) : "";
  return [ici, sous ? `[${sous}]` : "", cause ? `← ${cause}` : ""].filter(Boolean).join(" ").slice(0, 400);
}

export type ReponseSimple = { status: number; texte: string; chemin: "fetch" | "ipv4" };

/** Requête HTTPS par le module natif, famille d'adresses imposée : contourne l'IPv6 et la sélection automatique de `fetch`. */
export function requeteHttps(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; delaiMs?: number; famille?: 4 | 6 } = {}
): Promise<{ status: number; texte: string }> {
  return new Promise((resoudre, rejeter) => {
    const cible = new URL(url);
    const corps = options.body === undefined ? undefined : Buffer.from(options.body, "utf8");
    const requete = https.request(
      {
        host: cible.hostname,
        port: cible.port || 443,
        path: `${cible.pathname}${cible.search}`,
        method: options.method ?? "GET",
        family: options.famille ?? 4,
        headers: { ...(options.headers ?? {}), ...(corps ? { "Content-Length": String(corps.length) } : {}) },
        timeout: options.delaiMs ?? 10_000,
      },
      (reponse) => {
        const morceaux: Buffer[] = [];
        reponse.on("data", (m: Buffer) => morceaux.push(m));
        reponse.on("end", () => resoudre({ status: reponse.statusCode ?? 0, texte: Buffer.concat(morceaux).toString("utf8") }));
        reponse.on("error", rejeter);
      }
    );
    requete.on("timeout", () => requete.destroy(new Error(`délai de ${options.delaiMs ?? 10_000} ms dépassé`)));
    requete.on("error", rejeter);
    if (corps) requete.write(corps);
    requete.end();
  });
}

/**
 * Envoie par `fetch` ; si la connexion elle-même échoue (pas une réponse HTTP),
 * retente par le module https en IPv4 forcé. Lève seulement si les deux chemins
 * échouent, avec les deux raisons dans le message.
 */
export async function envoyerAvecRepli(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; delaiMs?: number }
): Promise<ReponseSimple> {
  const delaiMs = init.delaiMs ?? 10_000;
  let premiere: string;
  try {
    const rep = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(delaiMs) });
    return { status: rep.status, texte: await rep.text(), chemin: "fetch" };
  } catch (erreur) {
    premiere = decrireErreur(erreur);
  }
  try {
    const rep = await requeteHttps(url, { ...init, delaiMs, famille: 4 });
    console.warn(`[alertes] fetch a échoué (${premiere}) ; l'envoi est passé par https en IPv4 forcé.`);
    return { ...rep, chemin: "ipv4" };
  } catch (erreur) {
    throw new Error(`fetch : ${premiere} ; https IPv4 : ${decrireErreur(erreur)}`);
  }
}

export type SondeHote = {
  hote: string;
  adresses: { adresse: string; famille: number; tcp: string }[];
  dns?: string;
  fetch: string;
  ipv4: string;
};

function connexionTcp(adresse: string, famille: number, delaiMs = 4000): Promise<string> {
  return new Promise((resoudre) => {
    const debut = Date.now();
    const prise = net.connect({ host: adresse, port: 443, family: famille, timeout: delaiMs });
    const finir = (verdict: string) => {
      prise.destroy();
      resoudre(verdict);
    };
    prise.once("connect", () => finir(`ok ${Date.now() - debut} ms`));
    prise.once("timeout", () => finir(`délai ${delaiMs} ms`));
    prise.once("error", (e) => finir(decrireErreur(e)));
  });
}

async function sonderHote(hote: string, chemin: string): Promise<SondeHote> {
  const resultat: SondeHote = { hote, adresses: [], fetch: "", ipv4: "" };
  try {
    const adresses = await lookup(hote, { all: true });
    resultat.adresses = await Promise.all(
      adresses.slice(0, 6).map(async (a) => ({ adresse: a.address, famille: a.family, tcp: await connexionTcp(a.address, a.family) }))
    );
  } catch (erreur) {
    resultat.dns = decrireErreur(erreur);
  }
  const url = `https://${hote}${chemin}`;
  const debutFetch = Date.now();
  try {
    const rep = await fetch(url, { signal: AbortSignal.timeout(8000) });
    resultat.fetch = `HTTP ${rep.status} en ${Date.now() - debutFetch} ms`;
  } catch (erreur) {
    resultat.fetch = `ÉCHEC en ${Date.now() - debutFetch} ms : ${decrireErreur(erreur)}`;
  }
  const debutIpv4 = Date.now();
  try {
    const rep = await requeteHttps(url, { delaiMs: 8000, famille: 4 });
    resultat.ipv4 = `HTTP ${rep.status} en ${Date.now() - debutIpv4} ms`;
  } catch (erreur) {
    resultat.ipv4 = `ÉCHEC en ${Date.now() - debutIpv4} ms : ${decrireErreur(erreur)}`;
  }
  return resultat;
}

/** Hôtes dont dépendent les alertes et les SMS. Des services publics, rien de propre à ce CRM. */
function hotesASonder(): [string, string][] {
  let ntfy = "ntfy.sh";
  try {
    ntfy = new URL(process.env.NTFY_SERVEUR || "https://ntfy.sh").hostname;
  } catch {
    // NTFY_SERVEUR illisible : la sonde garde ntfy.sh, l'envoi dira lui-même ce qui ne va pas.
  }
  return [
    [ntfy, "/v1/health"],
    ["api.telegram.org", "/"],
    ["api.pushover.net", "/"],
    ["api.brevo.com", "/v3/"],
    ["coverswap.fr", "/"],
  ];
}

let cache: { quand: number; sonde: { node: string; hotes: SondeHote[] } } | null = null;

/** Sonde du réseau sortant, gardée une minute : un appel public répété ne déclenche pas une rafale de connexions. */
export async function sonderReseau(): Promise<{ node: string; ageMs: number; hotes: SondeHote[] }> {
  if (!cache || Date.now() - cache.quand > 60_000) {
    const hotes = await Promise.all(hotesASonder().map(([hote, chemin]) => sonderHote(hote, chemin)));
    cache = { quand: Date.now(), sonde: { node: process.version, hotes } };
  }
  return { ...cache.sonde, ageMs: Date.now() - cache.quand };
}
