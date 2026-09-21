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
  { chemin: "/api/webhook/zapier", protection: "Zapier : secret partagé vérifié par la route" },
  { chemin: "/api/espace/", prefixe: true, protection: "espace client : jeton signe (HMAC) dans l'adresse, expirable et revocable ; origine restreinte au site, limite par IP, blocage des essais de liens au hasard" },
  { chemin: "/api/webhook/sms", protection: "SMS entrant pousse par un fournisseur : secret partage verifie par la route, idempotent par identifiant de message" },
  { chemin: "/api/webhook/diagnostic", protection: "diagnostic des alertes depuis un téléphone : secret partagé vérifié par la route, aucune valeur de variable rendue" },
  { chemin: "/api/cron/", prefixe: true, protection: "tâches planifiées : Authorization Bearer CRON_SECRET, refus si absente" },
  { chemin: "/api/simulate", protection: "simulateur du site : signature HMAC et origine vérifiées par la route" },
  { chemin: "/api/site/evenements", protection: "événements de parcours du site : sans donnée personnelle, origine et limite par IP vérifiées par la route" },
  { chemin: "/api/site/publications", protection: "réalisations et avis publiés avec accord : lecture seule, aucun identifiant de client" },
  { chemin: "/api/site/photos/", prefixe: true, protection: "photos des publications publiées seulement, lues par identifiant de publication" },
  { chemin: "/robots.txt", protection: "consigne aux robots, statique" },
];

export function estRoutePublique(chemin: string): boolean {
  return ROUTES_PUBLIQUES.some((route) =>
    route.prefixe ? chemin.startsWith(route.chemin) : chemin === route.chemin
  );
}
