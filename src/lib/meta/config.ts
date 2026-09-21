/**
 * Ce dont l'intégration Meta a besoin, et ce qu'elle sait faire sans.
 *
 * Aucun secret en dur : tout vient des variables d'environnement (Railway).
 * Chaque brique se déclare indépendamment, pour que le webhook continue de
 * recevoir même quand la récupération des leads n'est pas encore autorisée
 * (l'App Review de `leads_retrieval` prend du temps).
 */
export const VERSION_GRAPH = process.env.META_API_VERSION || "v26.0";
/** Adresse de l'API Graph. META_GRAPH_URL sert aux essais (simulateur local) ; jamais en production. */
export const GRAPH = `${(process.env.META_GRAPH_URL || "https://graph.facebook.com").replace(/\/$/, "")}/${VERSION_GRAPH}`;

/** Jeton qui lit les leads et interroge la page : jeton de page longue durée. */
export function jetonPage(): string | undefined {
  return process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || undefined;
}

/** Jeton qui envoie les conversions : celui du dataset si distinct, sinon le jeton de page. */
export function jetonConversions(): string | undefined {
  return process.env.META_CONVERSIONS_TOKEN || jetonPage();
}

export function pixelId(): string | undefined {
  return process.env.META_PIXEL_ID || process.env.META_DATASET_ID || undefined;
}

export type EtatConfiguration = {
  /** Le webhook peut vérifier les appels de Meta (obligatoire). */
  signature: boolean;
  /** Le webhook peut répondre à la vérification initiale de Meta. */
  verification: boolean;
  /** Les réponses du formulaire peuvent être récupérées dans l'API Graph. */
  lecture: boolean;
  /** Les conversions peuvent repartir vers Meta. */
  conversions: boolean;
  /** Identifiant de la page, pour vérifier l'abonnement du webhook. */
  pageId: string | null;
  version: string;
};

export function etatConfiguration(env: NodeJS.ProcessEnv = process.env): EtatConfiguration {
  return {
    signature: Boolean(env.META_APP_SECRET),
    verification: Boolean(env.META_VERIFY_TOKEN),
    lecture: Boolean(env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN),
    conversions: Boolean((env.META_PIXEL_ID || env.META_DATASET_ID) && (env.META_CONVERSIONS_TOKEN || env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN)),
    pageId: env.META_PAGE_ID || null,
    version: env.META_API_VERSION || "v26.0",
  };
}

/** Adresse de la fiche d'un contact dans le CRM, telle qu'elle part dans les notifications. */
export function lienFiche(leadId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
  return `${base}/leads?lead=${leadId}`;
}
