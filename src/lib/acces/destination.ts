/** Écran d'arrivée par défaut, après connexion ou depuis la racine du site. */
export const ACCUEIL = "/leads";

/**
 * Page où revenir après la connexion : le `callbackUrl` posé par le proxy
 * (chemin relatif) ou par NextAuth (adresse absolue du CRM). Tout ce qui
 * sortirait du CRM est ignoré : pas de redirection ouverte.
 */
export function destinationApresConnexion(recherche: string, origine: string): string {
  const demandee = new URLSearchParams(recherche).get("callbackUrl");
  if (!demandee) return ACCUEIL;
  if (demandee.startsWith("/") && (demandee.startsWith("//") || demandee.startsWith("/\\"))) return ACCUEIL;
  try {
    const adresse = new URL(demandee, origine);
    if (adresse.origin !== origine) return ACCUEIL;
    const chemin = `${adresse.pathname}${adresse.search}${adresse.hash}`;
    return chemin.startsWith("/auth/") ? ACCUEIL : chemin;
  } catch {
    return ACCUEIL;
  }
}
