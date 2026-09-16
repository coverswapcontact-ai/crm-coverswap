import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Qui écrit, et d'où. Chaque écriture en base porte ce contexte (colonne
 * `ecriture`), que les déclencheurs SQLite recopient dans le journal.
 *
 * Types d'acteurs :
 * - HUMAIN    : personne connectée (HUMAIN:email), ou le poste local sans connexion
 * - AGENT     : agent IA (AGENT:mail) ; ses écritures sont des propositions ou des
 *               actions autorisées sans validation (voir docs/ARCHITECTURE-PILOTAGE.md)
 * - SYSTEME   : traitement interne (file de tâches, miroir Drive, relances)
 * - EXTERNE   : appel entrant non authentifié par session (webhooks du site, Meta, Zapier)
 * - SCRIPT    : script lancé à la main (tsx scripts/…)
 * - MIGRATION : migration de données au démarrage
 * - INCONNU   : écriture passée hors de la couche (SQL brut, outil externe) : à surveiller
 */
export const TYPES_ACTEUR = ["HUMAIN", "AGENT", "SYSTEME", "EXTERNE", "SCRIPT", "MIGRATION", "INCONNU"] as const;
export type TypeActeur = (typeof TYPES_ACTEUR)[number];

export type ContexteEcriture = {
  /** « TYPE:identifiant », ex. « HUMAIN:coverswap.contact@gmail.com », « AGENT:mail ». */
  acteur: string;
  /** Route (« POST /api/dossiers ») ou tâche à l'origine de l'écriture. */
  origine?: string;
  /** Identifiant de la requête ou de la tâche : regroupe les écritures d'un même geste. */
  requete?: string;
};

const FORMAT_ACTEUR = new RegExp(`^(${TYPES_ACTEUR.join("|")}):\\S.*$`);

export function acteurValide(acteur: string): boolean {
  return FORMAT_ACTEUR.test(acteur) && acteur.length <= 200;
}

export function typeActeur(acteur: string): TypeActeur {
  const type = acteur.split(":", 1)[0];
  return (TYPES_ACTEUR as readonly string[]).includes(type) ? (type as TypeActeur) : "INCONNU";
}

// Un seul stockage par processus, même si le module est chargé par plusieurs
// bundles (routes, instrumentation) : il vit sur globalThis.
const CLE_STOCKAGE = "__coverswapContexteEcriture";
const globalAvecStockage = globalThis as unknown as Record<string, AsyncLocalStorage<ContexteEcriture> | undefined>;
const stockage = (globalAvecStockage[CLE_STOCKAGE] ??= new AsyncLocalStorage<ContexteEcriture>());

/**
 * Exécute `fn` en attribuant ses écritures à `contexte`. À utiliser partout où
 * l'auteur ne se déduit pas d'une session : tâches de fond, agent, scripts,
 * migrations. Un contexte explicite l'emporte sur la session HTTP.
 */
export function avecActeur<T>(contexte: ContexteEcriture, fn: () => Promise<T>): Promise<T> {
  if (!acteurValide(contexte.acteur)) {
    throw new Error(`Acteur d'écriture invalide : « ${contexte.acteur} » (attendu TYPE:identifiant)`);
  }
  // Les requêtes Prisma sont paresseuses : elles partent au premier `then`.
  // On attend donc DANS le contexte, sinon la requête partirait hors de lui.
  return stockage.run(contexte, async () => await fn());
}

export function contexteExplicite(): ContexteEcriture | undefined {
  return stockage.getStore();
}
