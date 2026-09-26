// Routes joignables sans session. TOUT le reste exige une connexion : une route
// ajoutée demain est protégée d'office (refus par défaut). Ajouter une entrée
// ici impose de dire comment la route se protège elle-même.
// Fichier sans dépendance Node : il est importé par le proxy.

export type RoutePublique = {
  chemin: string;
  /** Vrai : le chemin et tout ce qui est en dessous (le chemin doit finir par « / »). */
  prefixe?: boolean;
  /** Comment la route se protège sans session. */
  protection: string;
};

export const ROUTES_PUBLIQUES: readonly RoutePublique[] = [
  { chemin: "/auth/signin", protection: "page de connexion" },
  { chemin: "/api/auth/", prefixe: true, protection: "NextAuth : connexion limitée en fréquence par le proxy" },
  { chemin: "/api/health", protection: "sonde de santé Railway, ne lit ni n'écrit rien" },
  { chemin: "/api/webhook", protection: "formulaires du site : en-tête X-Webhook-Secret vérifié par la route" },
  { chemin: "/api/webhook/meta", protection: "Meta : jeton de vérification, signature X-Hub-Signature-256 si META_APP_SECRET" },
  { chemin: "/api/webhook/zapier", protection: "Zapier : secret partagé vérifié par la route (en-tête X-Webhook-Secret ; ?secret= toléré jusqu'au 26/10/2026)" },
  { chemin: "/api/espace/", prefixe: true, protection: "espace client : jeton signe (HMAC) dans l'adresse, revocable et regenerable ; confirmation du telephone apres 90 jours sans visite ; origine restreinte au site, limite par IP, blocage des essais de liens au hasard" },
  { chemin: "/api/webhook/sms", protection: "SMS entrant pousse par un fournisseur : secret partage verifie par la route (en-tete X-Webhook-Secret ; ?secret= tolere jusqu'au 26/10/2026), idempotent par identifiant de message" },
  { chemin: "/api/webhook/diagnostic", protection: "diagnostic des alertes depuis un téléphone : secret partagé vérifié par la route (en-tête X-Webhook-Secret ; ?secret= toléré jusqu'au 26/10/2026), aucune valeur de variable rendue" },
  { chemin: "/api/cron/", prefixe: true, protection: "tâches planifiées : Authorization Bearer CRON_SECRET, refus si absente" },
  { chemin: "/api/simulate", protection: "simulateur du site : signature HMAC et origine vérifiées par la route" },
  { chemin: "/api/site/evenements", protection: "événements de parcours du site : sans donnée personnelle, origine et limite par IP vérifiées par la route" },
  { chemin: "/api/site/publications", protection: "réalisations et avis publiés avec accord : lecture seule, aucun identifiant de client" },
  { chemin: "/api/site/prestations", protection: "fichier des prestations (familles, sous-parties) : lecture seule, aucun tarif ni donnée de client" },
  { chemin: "/api/site/photos/", prefixe: true, protection: "photos des publications publiées seulement, lues par identifiant de publication" },
  { chemin: "/api/site/desinscription", protection: "désinscription des séquences de mails : jeton HMAC par adresse vérifié par la route ; n'écrit qu'une désinscription (définitive), ne rend rien de privé" },
  { chemin: "/.well-known/oauth-protected-resource", protection: "métadonnées OAuth de la ressource (RFC 9728) : document public, sans donnée" },
  { chemin: "/.well-known/oauth-protected-resource/api/mcp", protection: "métadonnées OAuth de la ressource, variante par chemin (RFC 9728) : document public, sans donnée" },
  { chemin: "/.well-known/oauth-authorization-server", protection: "métadonnées du serveur d'autorisation (RFC 8414) : document public, sans donnée" },
  { chemin: "/api/oauth/ressource", protection: "métadonnées de la ressource protégée (RFC 9728) : public, sans donnée" },
  { chemin: "/api/oauth/serveur", protection: "métadonnées du serveur d'autorisation (RFC 8414) : public, sans donnée" },
  { chemin: "/api/oauth/register", protection: "enregistrement dynamique d'un client OAuth (RFC 7591) : n'ouvre aucun accès, le consentement de Lucas (session) reste requis ; limité en fréquence" },
  { chemin: "/api/oauth/token", protection: "échange d'un code d'autorisation ou d'un jeton de renouvellement (PKCE S256, client vérifié) ; limité en fréquence" },
  { chemin: "/api/mcp", protection: "serveur MCP de l'assistant : jeton porteur OAuth vérifié à chaque requête (401 sinon), plafond d'écritures par heure" },
  { chemin: "/robots.txt", protection: "consigne aux robots, statique" },
  { chemin: "/manifest-crm.webmanifest", protection: "manifeste de l'application installable : nom, icône, couleurs — rien de privé" },
  { chemin: "/manifest-messages.webmanifest", protection: "manifeste de l'application « Messages » : nom, icône, couleurs — rien de privé" },
  { chemin: "/sw.js", protection: "service worker (notifications, hors ligne) : code statique, ne contient aucune donnée" },
  { chemin: "/hors-ligne.html", protection: "page statique affichée sans réseau" },
];

export function estRoutePublique(chemin: string): boolean {
  return ROUTES_PUBLIQUES.some((route) =>
    route.prefixe ? chemin.startsWith(route.chemin) : chemin === route.chemin
  );
}
