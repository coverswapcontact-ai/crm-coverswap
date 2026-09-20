/**
 * Code postal → commune.
 *
 * Les formulaires Meta laissent souvent la ville en saisie libre : on reçoit
 * « Ablis », « 78660 », « 78660 Ablis », parfois rien. Quand il ne reste qu'un
 * code postal, on demande la commune à l'API publique des communes
 * (geo.api.gouv.fr, service de l'État, sans clé ni quota gênant).
 *
 * Règles : on ne devine jamais en silence. Une commune trouvée seule est sûre ;
 * quand plusieurs communes partagent le code postal, on retient la plus peuplée
 * et on le dit (`certaine: false`, `autres`). Si l'API ne répond pas, on ne
 * remplit rien : le code postal suffit à travailler.
 */
const API = process.env.API_COMMUNES_URL || "https://geo.api.gouv.fr";
const DELAI_MS = 6_000;

export type Commune = {
  nom: string;
  /** Une seule commune porte ce code postal. */
  certaine: boolean;
  /** Les autres communes du même code postal, pour ne rien cacher. */
  autres: string[];
};

const cache = new Map<string, Commune | null>();

export const estCodePostal = (valeur: string): boolean => /^\d{5}$/.test(valeur.trim());

export async function communeDuCodePostal(codePostal: string): Promise<Commune | null> {
  const cle = codePostal.trim();
  if (!estCodePostal(cle)) return null;
  if (cache.has(cle)) return cache.get(cle) ?? null;
  try {
    const rep = await fetch(`${API}/communes?codePostal=${cle}&fields=nom,population`, {
      cache: "no-store",
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    const communes = (await rep.json()) as { nom?: string; population?: number }[];
    const triees = communes.filter((c) => c.nom).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    const trouvee: Commune | null = triees.length
      ? { nom: triees[0].nom as string, certaine: triees.length === 1, autres: triees.slice(1, 6).map((c) => c.nom as string) }
      : null;
    cache.set(cle, trouvee);
    return trouvee;
  } catch (erreur) {
    // Pas de commune : le code postal reste, la ville reste vide. Rien n'est inventé.
    console.warn(`[communes] ${cle} non résolu : ${(erreur as Error).message}`);
    return null;
  }
}

/** Pour les essais. */
export function viderCacheCommunes(): void {
  cache.clear();
}
