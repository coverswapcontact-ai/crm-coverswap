import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Les avis Google de l'entreprise pour le site (mission 16, partie 3) : la
 * note, le nombre d'avis et quelques extraits, lus chez Google par la Places
 * API (New) — `GET https://places.googleapis.com/v1/places/<GOOGLE_PLACE_ID>`
 * avec l'en-tête `X-Goog-Api-Key: <GOOGLE_PLACES_API_KEY>` (la clé ne quitte
 * jamais le serveur, jamais dans une adresse ni un journal).
 *
 *  - Sans clé ou sans lieu : `{ disponible: false }`, aucun appel. Le site
 *    n'affiche alors AUCUN chiffre (sa section n'existe pas).
 *  - Une réponse est gardée 24 h sur le volume (`<uploads>/cache/avis-google.json`,
 *    comme les échantillons) et en mémoire : un appel à Google par jour au
 *    plus ; un appel en cours sert à tous (pas de doublon). Une copie de plus
 *    de 24 h n'est JAMAIS servie, même quand Google ne répond pas : une note
 *    ou un nombre d'avis périmés ne passent pas pour actuels.
 *  - Un échec (réseau, clé refusée) ne réessaie pas avant une heure ; pendant
 *    ce temps, `{ disponible: false }` (sauf copie de moins de 24 h).
 *  - Normalisation : la note (1 à 5, une décimale) et le nombre (entier ≥ 1)
 *    tels que Google les donne, sinon `{ disponible: false }` ; chaque avis =
 *    texte de 300 caractères au plus, note, date, et l'ATTRIBUTION exigée par
 *    les règles de la Places API (« You must always credit the author when
 *    displaying photos or reviews » ; chaque avis doit mener à sa source sur
 *    Google Maps) : le nom de l'auteur TEL QUE Google le donne, le lien de son
 *    profil, son avatar, et le lien de l'avis (`googleMapsUri`). Liens et
 *    avatar en `https:` seulement, sinon rien. Le site affiche aussi la
 *    mention « Google Maps » (bloc sans carte).
 *  - À trancher par Lucas : la copie sur le volume (les conditions de Google
 *    n'autorisent à stocker que l'identifiant du lieu).
 *
 * Le client HTTP est injectable : les essais ne parlent jamais à Google.
 */

export type AvisGoogle = {
  /** Le nom de l'auteur tel que Google le donne (`authorAttribution.displayName`). */
  auteur: string;
  /** Son profil Google Maps (`authorAttribution.uri`) et son avatar (`authorAttribution.photoUri`). */
  lienAuteur: string | null;
  photoAuteur: string | null;
  /** L'avis sur Google Maps (`googleMapsUri`). */
  lienAvis: string | null;
  note: number | null;
  texte: string;
  date: string | null;
};
export type ReponseAvisGoogle = { disponible: false } | { disponible: true; note: number; nombre: number; avis: AvisGoogle[] };
export type ClientPlaces = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const DUREE_CACHE_AVIS_MS = 24 * 3_600_000;
export const PAUSE_APRES_ECHEC_MS = 3_600_000;
export const TEXTE_AVIS_MAX = 300;
export const AVIS_MAX = 5;
const CHAMPS = "rating,userRatingCount,reviews";

export const fichierCacheAvis = () => path.join(resolveUploadsDir(), "cache", "avis-google.json");

type Configuration = { cle: string; lieu: string };
/** Les variables lues (process.env par défaut ; un objet simple dans les essais). */
type Variables = Record<string, string | undefined>;

/** La clé et le lieu, ou null si l'un manque (une variable posée à vide compte comme absente). */
export function configurationAvisGoogle(env: Variables = process.env): Configuration | null {
  const cle = env.GOOGLE_PLACES_API_KEY?.trim();
  const lieu = env.GOOGLE_PLACE_ID?.trim();
  return cle && lieu ? { cle, lieu } : null;
}

export function urlPlaces(lieu: string): string {
  return `https://places.googleapis.com/v1/places/${encodeURIComponent(lieu)}?fields=${CHAMPS}&languageCode=fr`;
}

/** Le nom de l'auteur tel que Google le donne (espaces resserrés : l'attribution n'abrège pas le nom) ; vide → null. */
export function nomAuteur(nom: unknown): string | null {
  if (typeof nom !== "string") return null;
  const propre = nom.replace(/\s+/g, " ").trim();
  return propre ? propre.slice(0, 80) : null;
}

/** Une adresse `https:` (lien ou avatar venus de Google), sinon null : jamais un `javascript:` ni un `http:` sur le site. */
export function lienHttps(valeur: unknown): string | null {
  if (typeof valeur !== "string" || valeur.length > 2000) return null;
  try {
    const url = new URL(valeur);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Le texte d'un avis, espaces resserrés, coupé à un mot près sous `max` caractères (points de suspension compris). */
export function texteCourt(texte: unknown, max = TEXTE_AVIS_MAX): string | null {
  if (typeof texte !== "string") return null;
  const propre = texte.replace(/\s+/g, " ").trim();
  if (!propre) return null;
  if (propre.length <= max) return propre;
  const coupe = propre.slice(0, max - 1);
  const dernierBlanc = coupe.lastIndexOf(" ");
  return `${(dernierBlanc > max * 0.6 ? coupe.slice(0, dernierBlanc) : coupe).replace(/[\s,;:.!?-]+$/, "")}…`;
}

const objet = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** La réponse de la Places API (New) ramenée à ce que le site affiche ; sans note ou sans nombre : indisponible. */
export function normaliserPlaces(brut: unknown): ReponseAvisGoogle {
  const lieu = objet(brut);
  if (!lieu) return { disponible: false };
  const note = typeof lieu.rating === "number" && Number.isFinite(lieu.rating) && lieu.rating >= 1 && lieu.rating <= 5 ? Math.round(lieu.rating * 10) / 10 : null;
  const nombre = typeof lieu.userRatingCount === "number" && Number.isInteger(lieu.userRatingCount) && lieu.userRatingCount >= 1 ? lieu.userRatingCount : null;
  if (note === null || nombre === null) return { disponible: false };
  const avis: AvisGoogle[] = [];
  for (const brutAvis of Array.isArray(lieu.reviews) ? lieu.reviews : []) {
    const a = objet(brutAvis);
    if (!a) continue;
    const attribution = objet(a.authorAttribution);
    const auteur = nomAuteur(attribution?.displayName);
    const texte = texteCourt(objet(a.originalText)?.text ?? objet(a.text)?.text);
    if (!auteur || !texte) continue;
    const noteAvis = typeof a.rating === "number" && Number.isInteger(a.rating) && a.rating >= 1 && a.rating <= 5 ? a.rating : null;
    const temps = typeof a.publishTime === "string" ? Date.parse(a.publishTime) : Number.NaN;
    avis.push({
      auteur,
      lienAuteur: lienHttps(attribution?.uri),
      photoAuteur: lienHttps(attribution?.photoUri),
      lienAvis: lienHttps(a.googleMapsUri),
      note: noteAvis,
      texte,
      date: Number.isNaN(temps) ? null : new Date(temps).toISOString(),
    });
    if (avis.length >= AVIS_MAX) break;
  }
  return { disponible: true, note, nombre, avis };
}

/* ── Cache (mémoire + volume) ─────────────────────────────────────── */

type Copie = { lieu: string; luLe: number; donnees: ReponseAvisGoogle };
type Etat = { copie: Copie | null; echecLe: number | null; erreur: string | null; enCours: Promise<ReponseAvisGoogle> | null };
const CLE = "__coverswapAvisGoogle";
const memoire = globalThis as unknown as Record<string, Etat | undefined>;
const etat = (): Etat => (memoire[CLE] ??= { copie: null, echecLe: null, erreur: null, enCours: null });

/** Essais : oublie ce qui est en mémoire (la copie sur le volume reste). */
export function oublierAvisGoogleEnMemoire(): void {
  memoire[CLE] = undefined;
}

async function lireCopie(): Promise<Copie | null> {
  const enMemoire = etat().copie;
  if (enMemoire) return enMemoire;
  try {
    const brut = JSON.parse(await fs.readFile(fichierCacheAvis(), "utf8")) as Partial<Copie>;
    if (typeof brut.lieu !== "string" || typeof brut.luLe !== "number" || !objet(brut.donnees)) return null;
    const copie: Copie = { lieu: brut.lieu, luLe: brut.luLe, donnees: brut.donnees as ReponseAvisGoogle };
    etat().copie = copie;
    return copie;
  } catch {
    return null;
  }
}

async function ecrireCopie(copie: Copie): Promise<void> {
  etat().copie = copie;
  try {
    await fs.mkdir(path.dirname(fichierCacheAvis()), { recursive: true });
    await fs.writeFile(fichierCacheAvis(), JSON.stringify(copie));
  } catch (erreur) {
    // Volume plein ou absent : la copie en mémoire suffit jusqu'au prochain redémarrage.
    console.error("[avis-google] copie sur le volume impossible :", erreur instanceof Error ? erreur.message : erreur);
  }
}

const clientParDefaut: ClientPlaces = (url, init) => fetch(url, init);

async function lireChezGoogle(config: Configuration, client: ClientPlaces): Promise<ReponseAvisGoogle> {
  const reponse = await client(urlPlaces(config.lieu), { headers: { "X-Goog-Api-Key": config.cle, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!reponse.ok) {
    let detail = "";
    try {
      const corps = objet(await reponse.json());
      const message = objet(corps?.error)?.message;
      if (typeof message === "string") detail = ` : ${message.slice(0, 160)}`;
    } catch {
      /* corps illisible */
    }
    throw new Error(`HTTP ${reponse.status}${detail}`);
  }
  return normaliserPlaces(await reponse.json());
}

export type OptionsAvisGoogle = { client?: ClientPlaces; maintenant?: number; env?: Variables };

/**
 * Ce que le site affiche : la copie de moins de 24 h, sinon une lecture chez Google (une à la fois), sinon rien —
 * jamais une copie plus vieille (après un échec, `{ disponible: false }` : le site n'affiche alors aucune note).
 */
export async function avisGoogle(options: OptionsAvisGoogle = {}): Promise<ReponseAvisGoogle> {
  const config = configurationAvisGoogle(options.env);
  if (!config) return { disponible: false };
  const maintenant = options.maintenant ?? Date.now();
  const copie = await lireCopie();
  if (copie && copie.lieu === config.lieu && maintenant - copie.luLe < DUREE_CACHE_AVIS_MS) return copie.donnees;
  const e = etat();
  if (e.echecLe !== null && maintenant - e.echecLe < PAUSE_APRES_ECHEC_MS) return { disponible: false };
  if (e.enCours) return e.enCours;
  e.enCours = (async () => {
    try {
      const donnees = await lireChezGoogle(config, options.client ?? clientParDefaut);
      await ecrireCopie({ lieu: config.lieu, luLe: maintenant, donnees });
      e.echecLe = null;
      e.erreur = null;
      return donnees;
    } catch (erreur) {
      e.echecLe = maintenant;
      e.erreur = (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 200);
      console.error("[avis-google] lecture chez Google impossible :", e.erreur);
      return { disponible: false };
    } finally {
      e.enCours = null;
    }
  })();
  return e.enCours;
}

export type EtatAvisGoogle = { connectes: boolean; note: number | null; nombre: number | null; luLe: string | null; erreur: string | null };

/** Pour `sante_systeme` : connectés ou non, la dernière lecture et son erreur — sans jamais appeler Google. */
export async function etatAvisGoogle(env: Variables = process.env): Promise<EtatAvisGoogle> {
  const config = configurationAvisGoogle(env);
  if (!config) return { connectes: false, note: null, nombre: null, luLe: null, erreur: null };
  const copie = await lireCopie();
  const donnees = copie && copie.lieu === config.lieu ? copie.donnees : null;
  return {
    connectes: true,
    note: donnees?.disponible ? donnees.note : null,
    nombre: donnees?.disponible ? donnees.nombre : null,
    luLe: donnees && copie ? new Date(copie.luLe).toISOString() : null,
    erreur: etat().erreur,
  };
}
