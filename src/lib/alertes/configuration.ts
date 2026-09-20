/**
 * Quels canaux d'alerte existent, et lesquels sont réellement configurés.
 *
 * Module volontairement sans dépendance : la sonde de santé /api/health le lit
 * pour dire, sans session et sans base, si le téléphone du gérant peut sonner.
 * Aucune VALEUR de variable ne sort d'ici, seulement des noms et des booléens.
 */
export const CANAUX = ["telegram", "ntfy", "pushweb", "mail"] as const;
export type Canal = (typeof CANAUX)[number];

/** Les canaux qui font vibrer le téléphone. Le mail n'en est pas un. */
export const CANAUX_PUSH: readonly Canal[] = ["telegram", "ntfy", "pushweb"];

/** Variables à poser pour qu'un canal existe. Des noms, jamais des valeurs. */
export const VARIABLES_CANAL: Record<Canal, readonly string[]> = {
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  ntfy: ["NTFY_TOPIC"],
  // Push web : aucune variable. Le canal existe dès qu'un appareil s'est abonné
  // depuis l'application installée (les clés VAPID se génèrent toutes seules).
  pushweb: [],
  mail: ["RESEND_API_KEY"],
};

const memoirePushWeb = globalThis as unknown as { __pushWebAbonnes?: number };

export type ResultatCanal = {
  canal: Canal;
  ok: boolean;
  /** Faux = aucune variable posée, rien n'a été tenté. À distinguer d'un envoi raté. */
  configure: boolean;
  detail?: string;
};

/** Variables manquantes pour ce canal, dans l'ordre où il faut les poser. */
export function variablesManquantes(canal: Canal, env: NodeJS.ProcessEnv = process.env): string[] {
  return VARIABLES_CANAL[canal].filter((nom) => !env[nom]?.trim());
}
export function canalConfigure(canal: Canal, env: NodeJS.ProcessEnv = process.env): boolean {
  // Le push web ne dépend d'aucune variable mais d'un appareil abonné (compté par pushweb.ts).
  if (canal === "pushweb") return env === process.env && (memoirePushWeb.__pushWebAbonnes ?? 0) > 0;
  return variablesManquantes(canal, env).length === 0;
}
export function canauxConfigures(env: NodeJS.ProcessEnv = process.env): Canal[] {
  return CANAUX.filter((canal) => canalConfigure(canal, env));
}
/** Vrai si au moins un canal fait sonner le téléphone. Un mail seul ne suffit pas. */
export function pushDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  return CANAUX_PUSH.some((canal) => canalConfigure(canal, env));
}
