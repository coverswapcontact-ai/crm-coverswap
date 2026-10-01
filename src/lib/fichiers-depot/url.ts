import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { detecterFormat, MESSAGE_FORMAT_REFUSE } from "./format";
import { OCTETS_MAX_FICHIER } from "./types";

/**
 * Mission 17 (partie C) — un fichier téléchargé par le CRM depuis une URL
 * donnée par Lucas (lien public, lien de partage Google Drive), sans jamais
 * pouvoir viser le réseau interne (falsification de requête côté serveur) :
 *
 * - schémas http et https seulement, ports 80 et 443, pas d'identifiants dans l'adresse ;
 * - noms réservés refusés d'emblée (localhost, *.local, *.internal, nom sans point…) ;
 * - le nom est résolu (DNS) et TOUTES ses adresses sont vérifiées : privées, locales,
 *   lien-local (169.254.0.0/16, dont les métadonnées des hébergeurs), partagées (CGNAT),
 *   documentation, multidiffusion, réservées, IPv6 locales (::1, fc00::/7, fe80::/10),
 *   IPv4 dans IPv6 (::ffff:a.b.c.d, 64:ff9b::/96) vérifiées comme IPv4 ;
 * - la connexion part vers l'adresse VÉRIFIÉE (épinglée : pas de seconde résolution entre
 *   la vérification et la connexion, donc pas de « DNS rebinding ») ;
 * - chaque redirection (5 au plus) est revérifiée de la même façon ;
 * - la taille est plafonnée EN FLUX (Content-Length annoncé, puis octets comptés : le
 *   flux est coupé dès le dépassement) ; 20 secondes au plus en tout ;
 * - le type est lu dans les octets (format.ts), jamais dans l'en-tête.
 *
 * Un lien de partage Google Drive (ou Docs) est d'abord converti en lien de
 * téléchargement direct. Le réseau (résolution et transport) est remplaçable
 * pour les essais : aucun test ne sort du poste.
 */

export const REDIRECTIONS_MAX = 5;
export const DELAI_TELECHARGEMENT_MS = 20_000;
const PORTS_PERMIS = new Set(["", "80", "443"]);

/* ── Adresses interdites ───────────────────────────────────────── */

const INTERDITES = new net.BlockList();
for (const [reseau, prefixe] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  INTERDITES.addSubnet(reseau, prefixe, "ipv4");
for (const [reseau, prefixe] of [
  ["::", 96], // non spécifiée, bouclage (::1), IPv4 « compatible » (obsolète)
  // IPv4 dans IPv6 (::ffff:0:0/96) : PAS de règle ici — BlockList l'appliquerait à toute IPv4. Elle est vérifiée comme
  // IPv4 (ipv4Portee), avec les règles IPv4 ci-dessus.
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  INTERDITES.addSubnet(reseau, prefixe, "ipv6");

/** Les 16 octets d'une adresse IPv6 (forme textuelle valide), ou null. */
function octetsIpv6(adresse: string): number[] | null {
  let texte = adresse.toLowerCase().split("%")[0];
  const octets4: number[] = [];
  const derniere = texte.lastIndexOf(":");
  if (texte.slice(derniere + 1).includes(".")) {
    const v4 = texte.slice(derniere + 1).split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    octets4.push(...v4);
    texte = `${texte.slice(0, derniere + 1)}0:0`;
  }
  const [gauche, droite] = texte.includes("::") ? texte.split("::") : [texte, null];
  const g = gauche ? gauche.split(":") : [];
  const d = droite ? droite.split(":") : [];
  const manquants = 8 - g.length - d.length;
  if (droite === null && g.length !== 8) return null;
  const groupes = [...g, ...Array(Math.max(0, manquants)).fill("0"), ...d];
  if (groupes.length !== 8) return null;
  const octets = groupes.flatMap((h) => {
    const n = parseInt(h || "0", 16);
    return [(n >> 8) & 0xff, n & 0xff];
  });
  if (octets4.length) octets.splice(12, 4, ...octets4);
  return octets;
}

/** L'IPv4 portée par une IPv6 (::ffff:a.b.c.d, 64:ff9b::a.b.c.d, ::a.b.c.d), ou null. */
function ipv4Portee(octets: number[]): string | null {
  const zeros = (debut: number, fin: number) => octets.slice(debut, fin).every((o) => o === 0);
  const v4 = octets.slice(12).join(".");
  if (zeros(0, 10) && octets[10] === 0xff && octets[11] === 0xff) return v4;
  if (octets[0] === 0x00 && octets[1] === 0x64 && octets[2] === 0xff && octets[3] === 0x9b && zeros(4, 12)) return v4;
  if (zeros(0, 12)) return v4;
  return null;
}

/** Vrai si l'adresse IP ne doit jamais être jointe par le CRM (réseau interne, bouclage, métadonnées…). */
export function adresseInterdite(adresse: string): boolean {
  const famille = net.isIP(adresse);
  if (famille === 4) return INTERDITES.check(adresse, "ipv4");
  if (famille === 6) {
    const octets = octetsIpv6(adresse);
    if (!octets) return true;
    const v4 = ipv4Portee(octets);
    if (v4 && INTERDITES.check(v4, "ipv4")) return true;
    return INTERDITES.check(adresse.split("%")[0], "ipv6");
  }
  return true;
}

const NOMS_RESERVES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/i;

/** Refuse ce qui ne se télécharge jamais, avant toute résolution. Rend l'URL normalisée. */
export function verifierAdresse(brute: string | URL): URL {
  let url: URL;
  try {
    url = typeof brute === "string" ? new URL(brute.trim()) : brute;
  } catch {
    throw new ErreurMetier("Adresse invalide : donne une URL complète (https://…).", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ErreurMetier("Seules les adresses http et https se téléchargent.", 400);
  if (url.username || url.password) throw new ErreurMetier("Adresse refusée : pas d'identifiants dans l'URL.", 400);
  if (!PORTS_PERMIS.has(url.port)) throw new ErreurMetier("Adresse refusée : seuls les ports web standard (80, 443) sont permis.", 400);
  const hote = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hote) throw new ErreurMetier("Adresse invalide.", 400);
  if (net.isIP(hote)) {
    if (adresseInterdite(hote)) throw new ErreurMetier("Adresse refusée : elle vise le réseau interne ou le serveur lui-même.", 403);
    return url;
  }
  if (NOMS_RESERVES.test(hote) || !hote.includes(".")) throw new ErreurMetier("Adresse refusée : nom réservé au réseau local.", 403);
  return url;
}

/* ── Google Drive ──────────────────────────────────────────────── */

/** Un lien de partage Google Drive ou Docs devient un lien de téléchargement direct ; toute autre URL est rendue telle quelle. */
export function lienDeTelechargementDrive(brute: string): string {
  let url: URL;
  try {
    url = new URL(brute.trim());
  } catch {
    return brute;
  }
  const hote = url.hostname.toLowerCase();
  if (hote === "drive.google.com") {
    if (/^\/drive\/(u\/\d+\/)?folders\//.test(url.pathname)) throw new ErreurMetier("C'est un dossier Google Drive : partage le fichier lui-même (clic droit → Partager → Copier le lien).", 400);
    const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1] ?? url.searchParams.get("id");
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
    return brute;
  }
  if (hote === "docs.google.com") {
    const m = /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
    if (m) return m[1] === "presentation" ? `https://docs.google.com/presentation/d/${m[2]}/export/pdf` : `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=pdf`;
    const id = url.pathname.startsWith("/uc") ? url.searchParams.get("id") : null;
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  return brute;
}

/* ── Réseau (remplaçable pour les essais) ──────────────────────── */

export type AdresseResolue = { address: string; family: number };
export type Resolveur = (hote: string) => Promise<AdresseResolue[]>;
export type ReponseBrute = { statut: number; entetes: Record<string, string | undefined>; corps: AsyncIterable<Uint8Array>; fermer: () => void };
/** Ouvre la requête vers `adresse` (déjà vérifiée) : le nom de l'URL ne sert plus qu'à l'en-tête Host et au TLS. */
export type Transport = (requete: { url: URL; adresse: AdresseResolue; signal: AbortSignal }) => Promise<ReponseBrute>;

const resoudreParDns: Resolveur = (hote) => dns.promises.lookup(hote, { all: true, verbatim: true });

const transportNode: Transport = ({ url, adresse, signal }) =>
  new Promise((resoudre, rejeter) => {
    const client = url.protocol === "https:" ? https : http;
    const requete = client.request(
      url,
      {
        method: "GET",
        signal,
        headers: { "User-Agent": "CoverSwap-CRM/1.0 (+https://coverswap.fr)", Accept: "image/*,application/pdf,*/*;q=0.5" },
        // Connexion épinglée sur l'adresse vérifiée : aucune seconde résolution.
        lookup: ((_hote: string, options: { all?: boolean }, rappel: (...args: unknown[]) => void) => {
          if (options?.all) rappel(null, [{ address: adresse.address, family: adresse.family }]);
          else rappel(null, adresse.address, adresse.family);
        }) as unknown as net.LookupFunction,
      },
      (reponse) => {
        const entetes: Record<string, string | undefined> = {};
        for (const [cle, valeur] of Object.entries(reponse.headers)) entetes[cle.toLowerCase()] = Array.isArray(valeur) ? valeur.join(", ") : valeur;
        resoudre({ statut: reponse.statusCode ?? 0, entetes, corps: reponse, fermer: () => reponse.destroy() });
      }
    );
    requete.on("error", rejeter);
    requete.end();
  });

let reseauEssai: { resoudre?: Resolveur; transport?: Transport } | null = null;
/** Pour les essais : remplace la résolution et le transport (null : le vrai réseau). */
export function definirReseauEssai(reseau: { resoudre?: Resolveur; transport?: Transport } | null): void {
  reseauEssai = reseau;
}

/* ── Téléchargement ────────────────────────────────────────────── */

export type FichierTelecharge = { contenu: Buffer; nom: string; typeMime: string; urlFinale: string };

function nomDepuis(entetes: Record<string, string | undefined>, url: URL): string {
  const disposition = entetes["content-disposition"] ?? "";
  const etoile = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1];
  const simple = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  let nom = "";
  try {
    nom = etoile ? decodeURIComponent(etoile.trim().replace(/^"|"$/g, "")) : simple ?? decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    nom = simple ?? "";
  }
  return nom.replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 150) || "fichier";
}

async function resoudreVerifie(url: URL, resoudre: Resolveur): Promise<AdresseResolue> {
  const hote = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hote)) return { address: hote, family: net.isIP(hote) };
  let adresses: AdresseResolue[];
  try {
    adresses = await resoudre(hote);
  } catch {
    throw new ErreurMetier(`Nom introuvable : ${hote}.`, 400);
  }
  if (adresses.length === 0) throw new ErreurMetier(`Nom introuvable : ${hote}.`, 400);
  // Une seule adresse interne suffit à refuser : le nom pourrait basculer de l'une à l'autre.
  if (adresses.some((a) => adresseInterdite(a.address))) throw new ErreurMetier("Adresse refusée : ce nom mène au réseau interne ou au serveur lui-même.", 403);
  return adresses[0];
}

/**
 * Télécharge le fichier d'une URL (lien Drive converti), avec toutes les gardes. Rend ses octets, son nom et son type
 * lu dans les octets. Toute erreur est une ErreurMetier lisible.
 */
export async function telechargerUrl(brute: string, options: { octetsMax?: number; resoudre?: Resolveur; transport?: Transport; delaiMs?: number } = {}): Promise<FichierTelecharge> {
  const octetsMax = options.octetsMax ?? OCTETS_MAX_FICHIER;
  const resoudre = options.resoudre ?? reseauEssai?.resoudre ?? resoudreParDns;
  const transport = options.transport ?? reseauEssai?.transport ?? transportNode;
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), options.delaiMs ?? DELAI_TELECHARGEMENT_MS);
  try {
    let url = verifierAdresse(lienDeTelechargementDrive(brute));
    for (let saut = 0; ; saut++) {
      const adresse = await resoudreVerifie(url, resoudre);
      let reponse: ReponseBrute;
      try {
        reponse = await transport({ url, adresse, signal: controleur.signal });
      } catch (erreur) {
        if (erreur instanceof ErreurMetier) throw erreur;
        throw new ErreurMetier(controleur.signal.aborted ? "Téléchargement trop long (20 secondes) : abandonné." : `Téléchargement impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}.`, 502);
      }
      if ([301, 302, 303, 307, 308].includes(reponse.statut)) {
        reponse.fermer();
        const destination = reponse.entetes["location"];
        if (!destination) throw new ErreurMetier("Redirection sans destination.", 502);
        if (saut + 1 > REDIRECTIONS_MAX) throw new ErreurMetier(`Trop de redirections (${REDIRECTIONS_MAX} au plus).`, 502);
        url = verifierAdresse(new URL(destination, url));
        continue;
      }
      if (reponse.statut !== 200) {
        reponse.fermer();
        throw new ErreurMetier(reponse.statut === 403 || reponse.statut === 401 ? "Accès refusé par le site : le lien n'est pas public (pour Google Drive : « Tous les utilisateurs disposant du lien »)." : `Le site a répondu ${reponse.statut} : fichier introuvable.`, 502);
      }
      const annonce = Number(reponse.entetes["content-length"] ?? "");
      if (Number.isFinite(annonce) && annonce > octetsMax) {
        reponse.fermer();
        throw new ErreurMetier(`Fichier trop lourd : ${Math.round(octetsMax / 1024 / 1024)} Mo maximum.`, 413);
      }
      const morceaux: Buffer[] = [];
      let total = 0;
      try {
        for await (const morceau of reponse.corps) {
          total += morceau.length;
          if (total > octetsMax) {
            reponse.fermer();
            throw new ErreurMetier(`Fichier trop lourd : ${Math.round(octetsMax / 1024 / 1024)} Mo maximum (téléchargement coupé).`, 413);
          }
          morceaux.push(Buffer.from(morceau));
        }
      } catch (erreur) {
        if (erreur instanceof ErreurMetier) throw erreur;
        throw new ErreurMetier(controleur.signal.aborted ? "Téléchargement trop long (20 secondes) : abandonné." : "Téléchargement interrompu.", 502);
      }
      const contenu = Buffer.concat(morceaux);
      if (contenu.length === 0) throw new ErreurMetier("Le fichier téléchargé est vide.", 400);
      const format = detecterFormat(contenu);
      if (!format) {
        const html = /text\/html/i.test(reponse.entetes["content-type"] ?? "") || /^\s*<(!doctype|html)/i.test(contenu.subarray(0, 200).toString("latin1"));
        throw new ErreurMetier(html ? "L'adresse mène à une page web, pas à un fichier (lien Drive non public, ou page de partage) : donne le lien du fichier lui-même." : MESSAGE_FORMAT_REFUSE, 415);
      }
      return { contenu, nom: nomDepuis(reponse.entetes, url), typeMime: format.typeMime, urlFinale: url.href };
    }
  } finally {
    clearTimeout(minuterie);
  }
}
