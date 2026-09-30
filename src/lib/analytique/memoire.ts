/**
 * Mission 17 (partie B) — le cache mémoire de l'Analytique : une valeur par clé, gardée `dureeMs` (1 minute pour les
 * écrans : relecture B, un chiffre saisi se voit vite). Une promesse en cours est partagée (deux ouvertures simultanées
 * ne calculent qu'une fois) ; un échec n'est pas gardé. Global au processus (survit au rechargement à chaud des modules
 * en développement). Module SANS import : la couche du journal (journal/extension.ts) l'appelle à chaque écriture.
 *
 * Invalidation (relecture B, point 3) : un numéro de VERSION en mémoire, incrémenté par `signalerChangementAnalytique`
 * — appelé par la couche du journal après toute écriture réussie sur un modèle qui change les chiffres (leads, dossiers,
 * devis, accords, encaissements, dépenses, historiques synchronisés, état des sources, paramètres…), donc aussi à la fin
 * d'une synchronisation réussie. Chaque incrément vide le cache mémoire ; les instantanés du jour en base portent le
 * tampon `idProcessus:version` de leur calcul et ne sont repris que s'il est encore le tampon courant (un redémarrage
 * change l'identifiant du processus : les instantanés d'avant sont recalculés une fois).
 */

export const DUREE_CACHE_MS = 60_000;

type Entree = { expireLe: number; valeur: Promise<unknown> };
type Etat = { cache: Map<string, Entree>; version: number; processus: string };
const CLE = "__coverswapCacheAnalytique2";
const globalAvecCache = globalThis as unknown as Record<string, Etat | undefined>;
const etat = (globalAvecCache[CLE] ??= { cache: new Map(), version: 0, processus: Math.random().toString(36).slice(2, 10) });
const cache = etat.cache;

export function memoiser<T>(cle: string, calcul: () => Promise<T>, dureeMs = DUREE_CACHE_MS, maintenantMs = Date.now()): Promise<T> {
  const entree = cache.get(cle);
  if (entree && entree.expireLe > maintenantMs) return entree.valeur as Promise<T>;
  const valeur = calcul();
  cache.set(cle, { expireLe: maintenantMs + dureeMs, valeur });
  valeur.catch(() => {
    if (cache.get(cle)?.valeur === valeur) cache.delete(cle);
  });
  return valeur;
}

/** Oublie tout (ou les clés qui commencent par `prefixe`) : après une synchronisation, une saisie, ou dans les essais. */
export function viderCacheAnalytique(prefixe?: string): void {
  if (!prefixe) return cache.clear();
  for (const cle of [...cache.keys()]) if (cle.startsWith(prefixe)) cache.delete(cle);
}

export const tailleCacheAnalytique = () => cache.size;

/** « Les chiffres ont pu changer » : nouvelle version, cache mémoire vidé, instantanés du jour périmés. Jamais d'exception. */
export function signalerChangementAnalytique(): void {
  etat.version += 1;
  cache.clear();
}

/** Le tampon courant : un instantané calculé sous un autre tampon n'est plus repris. */
export const tamponAnalytique = (): string => `${etat.processus}:${etat.version}`;
export const versionAnalytique = (): number => etat.version;

/**
 * Les modèles dont une écriture change les chiffres de l'Analytique (la couche du journal appelle
 * `signalerChangementAnalytique` après chaque écriture réussie sur l'un d'eux). Hors liste : les mesures du site
 * (EvenementSite, une par page vue : le cache d'une minute suffit) et les instantanés eux-mêmes.
 */
export const MODELES_ANALYTIQUE: ReadonlySet<string> = new Set([
  "Lead",
  "Dossier",
  "Document",
  "AccordDevis",
  "Encaissement",
  "Depense",
  "DossierEvenement",
  "NoteAppel",
  "Interaction",
  "Message",
  "MessageEspace",
  "Sms",
  "MetaLead",
  "SimulationSite",
  "TravailSimulation",
  "SimulationEspace",
  "DepensePubJour",
  "SeoJour",
  "FicheGoogleJour",
  "SourceAnalytique",
  "Parametre",
  "Client",
]);
