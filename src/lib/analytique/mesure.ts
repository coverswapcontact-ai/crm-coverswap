import { createHash, randomBytes } from "node:crypto";
import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";

/**
 * Mission 17 (partie B) — la mesure du site SANS cookie, calculée par le CRM à la réception d'un événement
 * (docs/ANALYTIQUE.md § 3, modèle « Plausible »). Rien ne reste sur l'appareil du visiteur, et le CRM ne garde jamais
 * ni l'adresse IP ni le navigateur (User-Agent) en clair :
 *
 *  - visiteur du jour = sha256(sel du jour ‖ IP tronquée (/24 en IPv4, /48 en IPv6) ‖ User-Agent ‖ "coverswap.fr"),
 *    tronqué à 16 caractères hexadécimaux. Le sel est tiré au hasard, gardé en mémoire et en base (`CleInterne`, table
 *    HORS journal) sous UNE seule clé, remplacée au premier événement de chaque jour (heure de Paris) : l'ancien sel
 *    disparaît, aucune empreinte ne se relie d'un jour à l'autre, et le journal n'en garde aucune copie ;
 *  - appareil = classe tirée du User-Agent (TELEPHONE, TABLETTE, ORDINATEUR) ; les robots sont écartés (rien n'est
 *    enregistré) ;
 *  - pays = déduit du fuseau horaire que le navigateur envoie (approximation volontaire : aucune géolocalisation d'IP).
 *
 * Conservation : 25 mois (`purgerMesureSite`, travail quotidien) — limite des recommandations de la CNIL pour une
 * mesure d'audience exemptée de consentement.
 */

export const CLE_SEL_DU_JOUR = "analytique-sel-du-jour";
export const DOMAINE_MESURE = "coverswap.fr";
export const LONGUEUR_VISITEUR = 16;
export const MOIS_CONSERVATION_MESURE = 25;

export type Appareil = "TELEPHONE" | "TABLETTE" | "ORDINATEUR";

/* ── Robots et appareils ───────────────────────────────────────────────── */

/** Robots, aperçus de liens, outils de test et clients HTTP : jamais comptés. */
const MOTIF_ROBOT =
  /bot\b|bot\/|bots\b|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|quora link|pinterest\/0|vkshare|w3c_validator|validator|curl\/|wget|python-requests|python-urllib|aiohttp|httpx|httpclient|okhttp|axios\/|node-fetch|undici|go-http-client|java\/|libwww|phantomjs|puppeteer|playwright|selenium|webdriver|pingdom|uptime|statuscake|monitor|scanner|scan\b|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|perplexitybot|ccbot|amazonbot|applebot|yandex|baiduspider|duckduckbot|bingpreview|google-inspectiontool|googleother|feedfetcher|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|linkedinbot|twitterbot|vercel|screenshot|prerender|rendertron/i;

export function estRobot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  return !ua || ua.length < 12 || MOTIF_ROBOT.test(ua);
}

/** La classe d'appareil d'un User-Agent (l'iPad récent se dit « Macintosh » : compté ordinateur, c'est admis). */
export function classeAppareil(userAgent: string | null | undefined): Appareil {
  const ua = userAgent ?? "";
  if (/ipad|tablet|kindle|silk\/|playbook|nexus (7|9|10)|sm-t\d|tab\b/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "TABLETTE";
  if (/mobi|iphone|ipod|android|windows phone|blackberry|bb10|opera mini|iemobile/i.test(ua)) return "TELEPHONE";
  return "ORDINATEUR";
}

/* ── Adresse IP tronquée ───────────────────────────────────────────────── */

function developperIpv6(ip: string): number[] | null {
  let adresse = ip.split("%")[0];
  // IPv6 terminée par une IPv4 (« ::ffff:192.0.2.1 ») : deux groupes de 16 bits.
  const v4 = adresse.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const octets = v4[1].split(".").map(Number);
    if (octets.some((o) => o > 255)) return null;
    adresse = adresse.slice(0, -v4[1].length) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const moities = adresse.split("::");
  if (moities.length > 2) return null;
  const lire = (partie: string) => (partie ? partie.split(":") : []);
  const debut = lire(moities[0]);
  const fin = moities.length === 2 ? lire(moities[1]) : [];
  const manquants = 8 - debut.length - fin.length;
  if (moities.length === 1 ? debut.length !== 8 : manquants < 0) return null;
  const groupes = [...debut, ...Array(moities.length === 2 ? manquants : 0).fill("0"), ...fin];
  const nombres = groupes.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nombres.some(Number.isNaN) ? null : nombres;
}

/**
 * L'IP réduite à son réseau : /24 en IPv4 (« 203.0.113.0 »), /48 en IPv6 (« 2001:db8:1:: »). Une IPv4 dans une IPv6
 * (« ::ffff:203.0.113.9 ») est traitée comme IPv4. Inconnue ou illisible : « inconnue ».
 */
export function ipTronquee(ip: string | null | undefined): string {
  const brute = (ip ?? "").trim().replace(/^\[|\]$/g, "");
  const v4 = brute.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/i);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (brute.includes(":")) {
    const groupes = developperIpv6(brute);
    if (groupes) {
      if (groupes.slice(0, 5).every((g) => g === 0) && groupes[5] === 0xffff) return `${groupes[6] >> 8}.${groupes[6] & 255}.${groupes[7] >> 8}.0`;
      return `${groupes.slice(0, 3).map((g) => g.toString(16)).join(":")}::`;
    }
  }
  return "inconnue";
}

/* ── Sel du jour ───────────────────────────────────────────────────────── */

type Sel = { jour: string; sel: string };
const CLE_MEMOIRE = "__coverswapSelDuJour";
const memoire = globalThis as unknown as Record<string, { courant: Sel | null; enCours: Promise<Sel> | null } | undefined>;
const etatSel = (memoire[CLE_MEMOIRE] ??= { courant: null, enCours: null });

async function chargerSel(jour: string): Promise<Sel> {
  const ligne = await prisma.cleInterne.findUnique({ where: { nom: CLE_SEL_DU_JOUR } });
  if (ligne) {
    try {
      const lu = JSON.parse(ligne.valeur) as Partial<Sel>;
      if (lu.jour === jour && typeof lu.sel === "string" && lu.sel.length >= 32) return { jour, sel: lu.sel };
    } catch {
      /* valeur illisible : remplacée ci-dessous */
    }
  }
  // Nouveau jour : un sel neuf REMPLACE l'ancien (une seule clé, table hors journal : aucun historique des sels).
  const sel = { jour, sel: randomBytes(32).toString("hex") };
  const valeur = JSON.stringify(sel);
  await prisma.cleInterne.upsert({ where: { nom: CLE_SEL_DU_JOUR }, create: { nom: CLE_SEL_DU_JOUR, valeur }, update: { valeur } });
  return sel;
}

/** Le sel du jour (heure de Paris) : en mémoire, sinon en base, sinon tiré au hasard et gardé (en remplaçant celui d'hier). */
export async function selDuJour(maintenant: Date = new Date()): Promise<string> {
  const jour = jourParis(maintenant);
  if (etatSel.courant?.jour === jour) return etatSel.courant.sel;
  // Deux événements simultanés au changement de jour : un seul tirage.
  if (!etatSel.enCours) {
    etatSel.enCours = chargerSel(jour).finally(() => {
      etatSel.enCours = null;
    });
  }
  const sel = await etatSel.enCours;
  if (sel.jour !== jour) return selDuJour(maintenant);
  etatSel.courant = sel;
  return sel.sel;
}

/** Pour les essais : oublier le sel gardé en mémoire (il sera relu en base). */
export function oublierSelEnMemoire(): void {
  etatSel.courant = null;
  etatSel.enCours = null;
}

/** L'empreinte du visiteur du jour (pure : le sel est fourni). */
export function empreinteVisiteur(sel: string, ip: string | null | undefined, userAgent: string | null | undefined): string {
  return createHash("sha256")
    .update(`${sel}\u001f${ipTronquee(ip)}\u001f${userAgent ?? ""}\u001f${DOMAINE_MESURE}`)
    .digest("hex")
    .slice(0, LONGUEUR_VISITEUR);
}

export type Mesure = { robot: true } | { robot: false; visiteur: string; appareil: Appareil };

/** Ce que le CRM garde d'une requête du site : l'empreinte du jour et la classe d'appareil. L'IP et l'UA sont oubliés ici. */
export async function mesurerRequete(entree: { ip: string | null | undefined; userAgent: string | null | undefined; maintenant?: Date }): Promise<Mesure> {
  if (estRobot(entree.userAgent)) return { robot: true };
  const sel = await selDuJour(entree.maintenant ?? new Date());
  return { robot: false, visiteur: empreinteVisiteur(sel, entree.ip, entree.userAgent), appareil: classeAppareil(entree.userAgent) };
}

/* ── Pays d'après le fuseau horaire ────────────────────────────────────── */

/** Fuseau IANA → pays (ISO à deux lettres) : l'Europe, l'outre-mer français et les fuseaux courants. */
export const PAYS_PAR_FUSEAU: Readonly<Record<string, string>> = {
  "Europe/Paris": "FR", "Europe/Monaco": "MC", "Europe/Brussels": "BE", "Europe/Luxembourg": "LU", "Europe/Zurich": "CH", "Europe/Busingen": "DE",
  "Europe/Vaduz": "LI", "Europe/Madrid": "ES", "Africa/Ceuta": "ES", "Atlantic/Canary": "ES", "Europe/Andorra": "AD", "Europe/Lisbon": "PT",
  "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT", "Europe/London": "GB", "Europe/Belfast": "GB", "Europe/Dublin": "IE", "Europe/Guernsey": "GG",
  "Europe/Jersey": "JE", "Europe/Isle_of_Man": "IM", "Europe/Gibraltar": "GI", "Europe/Berlin": "DE", "Europe/Amsterdam": "NL", "Europe/Rome": "IT",
  "Europe/Vatican": "VA", "Europe/San_Marino": "SM", "Europe/Malta": "MT", "Europe/Vienna": "AT", "Europe/Prague": "CZ", "Europe/Bratislava": "SK",
  "Europe/Warsaw": "PL", "Europe/Budapest": "HU", "Europe/Ljubljana": "SI", "Europe/Zagreb": "HR", "Europe/Belgrade": "RS", "Europe/Sarajevo": "BA",
  "Europe/Podgorica": "ME", "Europe/Skopje": "MK", "Europe/Tirane": "AL", "Europe/Athens": "GR", "Asia/Nicosia": "CY", "Europe/Nicosia": "CY",
  "Europe/Sofia": "BG", "Europe/Bucharest": "RO", "Europe/Chisinau": "MD", "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Minsk": "BY",
  "Europe/Moscow": "RU", "Europe/Istanbul": "TR", "Europe/Copenhagen": "DK", "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Helsinki": "FI",
  "Europe/Tallinn": "EE", "Europe/Riga": "LV", "Europe/Vilnius": "LT", "Atlantic/Reykjavik": "IS", "Atlantic/Faroe": "FO",
  // Outre-mer français.
  "America/Martinique": "MQ", "America/Guadeloupe": "GP", "America/Cayenne": "GF", "America/St_Barthelemy": "BL", "America/Marigot": "MF",
  "America/Miquelon": "PM", "Indian/Reunion": "RE", "Indian/Mayotte": "YT", "Pacific/Noumea": "NC", "Pacific/Tahiti": "PF", "Pacific/Wallis": "WF",
  // Afrique du Nord et de l'Ouest francophone.
  "Africa/Casablanca": "MA", "Africa/Algiers": "DZ", "Africa/Tunis": "TN", "Africa/Dakar": "SN", "Africa/Abidjan": "CI", "Africa/Douala": "CM",
  "Africa/Kinshasa": "CD", "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA",
  // Amériques, Asie, Océanie : les fuseaux les plus courants.
  "America/Montreal": "CA", "America/Toronto": "CA", "America/Vancouver": "CA", "America/Halifax": "CA", "America/New_York": "US", "America/Chicago": "US",
  "America/Denver": "US", "America/Phoenix": "US", "America/Los_Angeles": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
  "America/Mexico_City": "MX", "America/Sao_Paulo": "BR", "America/Argentina/Buenos_Aires": "AR", "America/Bogota": "CO", "America/Lima": "PE",
  "America/Santiago": "CL", "Asia/Dubai": "AE", "Asia/Jerusalem": "IL", "Asia/Tel_Aviv": "IL", "Asia/Beirut": "LB", "Asia/Riyadh": "SA", "Asia/Qatar": "QA",
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN", "Asia/Singapore": "SG",
  "Asia/Hong_Kong": "HK", "Asia/Shanghai": "CN", "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "Australia/Perth": "AU", "Australia/Brisbane": "AU", "Pacific/Auckland": "NZ",
};

/** Le pays déduit d'un fuseau IANA (« Europe/Paris » → FR) ; inconnu → null. */
export function paysDuFuseau(fuseau: string | null | undefined): string | null {
  const f = (fuseau ?? "").trim();
  return (f && PAYS_PAR_FUSEAU[f]) || null;
}

/* ── Conservation ──────────────────────────────────────────────────────── */

/** La limite de conservation : il y a 25 mois (mois calendaires). */
export function limiteConservationMesure(maintenant: Date = new Date()): Date {
  const limite = new Date(maintenant);
  limite.setUTCMonth(limite.getUTCMonth() - MOIS_CONSERVATION_MESURE);
  return limite;
}

/**
 * Supprime les événements du site de plus de 25 mois. Seule suppression permise par la couche et par la base
 * (exception documentée : `MODELES_PURGEABLES` de journal/declencheurs.ts) — mesures anonymes, sans `archiveLe`,
 * dont la conservation est bornée par la politique CNIL.
 */
export async function purgerMesureSite(maintenant: Date = new Date()): Promise<{ supprimes: number; avant: string }> {
  const limite = limiteConservationMesure(maintenant);
  const { count } = await prisma.evenementSite.deleteMany({ where: { createdAt: { lt: limite } } });
  return { supprimes: count, avant: limite.toISOString() };
}
