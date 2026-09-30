/**
 * CORS des routes publiques du simulateur du site (/api/simulate, /image,
 * /prevenir) : le site en production, plus le site local hors production.
 * Mission 15 (partie 1) : une origine étrangère est REFUSÉE (403) par la
 * route, comme le fait l'API de l'espace client — avant, seul l'en-tête
 * était posé.
 */
const ORIGINES_AUTORISEES = ["https://coverswap.fr", "https://www.coverswap.fr"];

export function origineSimulateurAutorisee(origine: string | null): boolean {
  if (!origine) return true;
  if (ORIGINES_AUTORISEES.includes(origine)) return true;
  return process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origine);
}

export function entetesCorsSimulateur(origine: string | null): Record<string, string> {
  const autorisee = origine && origineSimulateurAutorisee(origine) ? origine : ORIGINES_AUTORISEES[0];
  return {
    "Access-Control-Allow-Origin": autorisee,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** IP du visiteur telle que l'hébergeur la transmet. */
export function ipDuVisiteurSimulateur(entetes: { get(nom: string): string | null }): string {
  return entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || entetes.get("x-real-ip") || "inconnue";
}

/** Identifiant de parcours navigateur bien formé, sinon rien (même règle que le site). */
export function parcoursIdValide(valeur: unknown): string | undefined {
  return typeof valeur === "string" && /^[0-9a-fA-F-]{16,64}$/.test(valeur) ? valeur : undefined;
}

/** Identifiant de travail (cuid) bien formé, sinon rien. */
export function travailIdValide(valeur: unknown): string | undefined {
  return typeof valeur === "string" && /^[a-z0-9]{10,40}$/i.test(valeur) ? valeur : undefined;
}
