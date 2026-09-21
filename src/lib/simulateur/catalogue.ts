import { promises as fs } from "node:fs";
import path from "node:path";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { adresseDuSite } from "@/lib/espace/liens";
import { resolveUploadsDir } from "@/lib/uploads";
import { analyserCouleur, type AnalyseCouleur } from "./couleur";

/**
 * Le catalogue Cover Styl' du CRM : celui du site, jamais une copie tenue à la
 * main. Le site le répare chaque semaine (Cover Styl' renomme ses images) ; le
 * CRM le relit (`GET <site>/api/catalogue`), le garde six heures en mémoire et
 * en recopie la dernière version lue sur le volume : si le site ne répond pas,
 * le simulateur continue avec elle.
 *
 * Les échantillons sont servis par le CRM (cache sur le volume) : l'écran, la
 * planche des teintes et l'espace client ne parlent jamais directement au
 * stockage de Cover Styl'.
 */

export type Reference = { id: string; nom: string; famille: string; categorie: string; finition: string; image: string; tags: string[] };

const DUREE_CACHE_MS = 6 * 3_600_000;
const HOTES_ECHANTILLONS = new Set(["ssi.s3.fr-par.scw.cloud", "cms.coverstyl.com"]);

const dossierSimulateur = () => path.join(resolveUploadsDir(), "simulateur");
const copieCatalogue = () => path.join(dossierSimulateur(), "catalogue.json");
const fichierAnalyses = () => path.join(dossierSimulateur(), "analyses-couleur.json");

type Cache = { references: Reference[]; parId: Map<string, Reference>; luLe: number; source: "site" | "copie" };
const CLE = "__coverswapCatalogue";
const globalCache = globalThis as unknown as Record<string, Cache | undefined>;

function lireListe(brut: unknown): Reference[] {
  const liste = Array.isArray(brut) ? brut : Array.isArray((brut as { references?: unknown })?.references) ? (brut as { references: unknown[] }).references : [];
  return liste
    .filter((r): r is Reference => !!r && typeof r === "object" && typeof (r as Reference).id === "string" && typeof (r as Reference).image === "string")
    .map((r) => ({ id: r.id, nom: String(r.nom ?? r.id), famille: String(r.famille ?? ""), categorie: String(r.categorie ?? ""), finition: String(r.finition ?? ""), image: r.image, tags: Array.isArray(r.tags) ? r.tags.map(String) : [] }));
}

function mettreEnCache(references: Reference[], source: Cache["source"]): Cache {
  const cache: Cache = { references, parId: new Map(references.map((r) => [r.id, r])), luLe: Date.now(), source };
  globalCache[CLE] = cache;
  return cache;
}

/** Pour les essais : un catalogue posé à la main (null : revenir au site). */
export function definirCatalogueEssai(references: Reference[] | null): void {
  globalCache[CLE] = references ? { references, parId: new Map(references.map((r) => [r.id, r])), luLe: Number.MAX_SAFE_INTEGER, source: "site" } : undefined;
}

async function chargerCache(): Promise<Cache> {
  const actuel = globalCache[CLE];
  if (actuel && Date.now() - actuel.luLe < DUREE_CACHE_MS) return actuel;
  try {
    const reponse = await fetch(`${adresseDuSite()}/api/catalogue`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const references = lireListe(await reponse.json());
    if (references.length < 20) throw new Error(`catalogue trop court (${references.length})`);
    await fs.mkdir(dossierSimulateur(), { recursive: true });
    await fs.writeFile(copieCatalogue(), JSON.stringify(references));
    return mettreEnCache(references, "site");
  } catch (erreur) {
    if (actuel) {
      actuel.luLe = Date.now() - DUREE_CACHE_MS + 10 * 60_000; // nouvel essai dans dix minutes
      return actuel;
    }
    const copie = await fs.readFile(copieCatalogue(), "utf8").catch(() => null);
    if (copie) {
      console.warn("[simulateur] catalogue du site injoignable, dernière copie utilisée :", erreur instanceof Error ? erreur.message : erreur);
      const cache = mettreEnCache(lireListe(JSON.parse(copie)), "copie");
      cache.luLe = Date.now() - DUREE_CACHE_MS + 10 * 60_000;
      return cache;
    }
    throw new ErreurMetier("Catalogue Cover Styl' indisponible : le site ne répond pas. Réessayez dans un instant.", 503);
  }
}

export async function catalogue(): Promise<Reference[]> {
  return (await chargerCache()).references;
}

export async function reference(ref: string): Promise<Reference | null> {
  return (await chargerCache()).parId.get(ref) ?? null;
}

export async function referenceObligatoire(ref: string): Promise<Reference> {
  const trouvee = await reference(ref);
  if (!trouvee) throw new ErreurMetier(`La référence ${ref.slice(0, 16)} n'est plus au catalogue Cover Styl'.`, 404);
  return trouvee;
}

/* ── Échantillons (image), servis par le CRM ──────────────────────── */

const nomFichier = (ref: string) => `${ref.replace(/[^A-Za-z0-9_-]/g, "_")}.jpg`;

/** L'image d'un échantillon, lue une fois chez Cover Styl' puis gardée sur le volume. */
export async function imageEchantillon(ref: string): Promise<Buffer> {
  const chemin = path.join(dossierSimulateur(), "echantillons", nomFichier(ref));
  const enCache = await fs.readFile(chemin).catch(() => null);
  if (enCache && enCache.length > 0) return enCache;
  const trouvee = await referenceObligatoire(ref);
  let url: URL;
  try {
    url = new URL(trouvee.image);
  } catch {
    throw new ErreurMetier("Adresse d'échantillon invalide.", 502);
  }
  if (url.protocol !== "https:" || !HOTES_ECHANTILLONS.has(url.hostname)) throw new ErreurMetier("Échantillon hors du stockage Cover Styl'.", 502);
  const reponse = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!reponse?.ok) throw new ErreurMetier("Échantillon injoignable chez Cover Styl' : réessayez dans un instant.", 502);
  const octets = Buffer.from(await reponse.arrayBuffer());
  if (octets.length < 200) throw new ErreurMetier("Échantillon vide.", 502);
  await fs.mkdir(path.dirname(chemin), { recursive: true });
  await fs.writeFile(chemin, octets);
  return octets;
}

/* ── Couleur mesurée de chaque échantillon ────────────────────────── */

type Analyses = Record<string, AnalyseCouleur>;
let analysesEnMemoire: Analyses | null = null;

async function lireAnalyses(): Promise<Analyses> {
  if (analysesEnMemoire) return analysesEnMemoire;
  const brut = await fs.readFile(fichierAnalyses(), "utf8").catch(() => null);
  try {
    analysesEnMemoire = brut ? (JSON.parse(brut) as Analyses) : {};
  } catch {
    analysesEnMemoire = {};
  }
  return analysesEnMemoire;
}

let ecriture: Promise<void> = Promise.resolve();
async function garderAnalyse(ref: string, analyse: AnalyseCouleur): Promise<void> {
  const analyses = await lireAnalyses();
  analyses[ref] = analyse;
  ecriture = ecriture.then(async () => {
    await fs.mkdir(dossierSimulateur(), { recursive: true });
    await fs.writeFile(fichierAnalyses(), JSON.stringify(analyses));
  }).catch((erreur) => console.error("[simulateur] analyses de couleur non enregistrées :", erreur));
  await ecriture;
}

/** Couleur moyenne, clarté et contraste du décor, mesurés sur l'image de l'échantillon. */
export async function analyseDe(ref: string): Promise<AnalyseCouleur | null> {
  const analyses = await lireAnalyses();
  if (analyses[ref]) return analyses[ref];
  try {
    const analyse = await analyserCouleur(await imageEchantillon(ref));
    await garderAnalyse(ref, analyse);
    return analyse;
  } catch (erreur) {
    console.warn(`[simulateur] couleur de ${ref} non mesurée :`, erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

/** Analyses déjà faites, sans rien télécharger (tri par goûts, liste de l'écran). */
export async function analysesConnues(): Promise<Analyses> {
  return lireAnalyses();
}

/**
 * Mesure en arrière-plan les échantillons pas encore analysés (quelques-uns par
 * passage) : la sélection « selon ses goûts » s'affine au fil des heures.
 */
export async function analyserCatalogueParLots(taille = 40, signal?: AbortSignal): Promise<{ analysees: number; restantes: number }> {
  const [references, analyses] = await Promise.all([catalogue(), lireAnalyses()]);
  const aFaire = references.filter((r) => !analyses[r.id]);
  let analysees = 0;
  for (const r of aFaire.slice(0, taille)) {
    if (signal?.aborted) break;
    if (await analyseDe(r.id)) analysees++;
  }
  return { analysees, restantes: Math.max(0, aFaire.length - analysees) };
}
