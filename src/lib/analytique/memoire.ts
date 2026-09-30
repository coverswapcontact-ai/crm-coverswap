/**
 * Mission 17 (partie B) — le cache mémoire de l'Analytique : une valeur par clé, gardée `dureeMs` (5 minutes pour les
 * écrans). Une promesse en cours est partagée (deux ouvertures simultanées ne calculent qu'une fois) ; un échec n'est
 * pas gardé. Global au processus (survit au rechargement à chaud des modules en développement).
 */

export const DUREE_CACHE_MS = 5 * 60_000;

type Entree = { expireLe: number; valeur: Promise<unknown> };
const CLE = "__coverswapCacheAnalytique";
const globalAvecCache = globalThis as unknown as Record<string, Map<string, Entree> | undefined>;
const cache = (globalAvecCache[CLE] ??= new Map());

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
