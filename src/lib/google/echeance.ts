// Échéance de la connexion Google. Tant que l'application reste en mode Test
// dans Google Cloud, Google fait expirer le jeton de renouvellement 7 jours
// après l'autorisation (portées Drive et Gmail) : il faut reconnecter le compte
// à la main. Fonctions pures, pour le rappel affiché sur tous les écrans et
// pour la carte des Paramètres.

const HEURE_MS = 60 * 60_000;

/** Durée de vie du jeton de renouvellement en mode Test. */
export const DUREE_JETON_MODE_TEST_MS = 7 * 24 * HEURE_MS;
/** Le rappel apparaît 48 h avant l'expiration, plus insistant les dernières 24 h. */
export const RAPPEL_PROCHE_MS = 48 * HEURE_MS;
export const RAPPEL_IMMINENT_MS = 24 * HEURE_MS;

export type NiveauEcheanceGoogle = "LOINTAINE" | "PROCHE" | "IMMINENTE" | "EXPIREE";

export type EcheanceGoogle = {
  niveau: NiveauEcheanceGoogle;
  /** Expiration prévue ; null si l'application est publiée (plus d'expiration à 7 jours). */
  expireLe: string | null;
  resteMs: number | null;
  /** Google a refusé le renouvellement (accès retiré ou expiré). */
  coupee: boolean;
};

export type RappelGoogle = EcheanceGoogle & { compte: string };

/**
 * Application publiée dans Google Cloud (plus en mode Test) : à signaler au
 * serveur par GOOGLE_APPLICATION_PUBLIEE=1, et le rappel des 7 jours s'éteint.
 */
export function applicationGooglePubliee(env: Record<string, string | undefined> = process.env): boolean {
  return env.GOOGLE_APPLICATION_PUBLIEE === "1";
}

export function echeanceJetonGoogle(
  connexion: { depuis: Date | string; derniereErreur?: string | null },
  options: { maintenant?: Date; modeTest?: boolean } = {}
): EcheanceGoogle {
  const maintenant = options.maintenant ?? new Date();
  const modeTest = options.modeTest ?? true;
  const expire = modeTest ? new Date(new Date(connexion.depuis).getTime() + DUREE_JETON_MODE_TEST_MS) : null;
  const resteMs = expire ? expire.getTime() - maintenant.getTime() : null;
  const coupee = Boolean(connexion.derniereErreur);

  let niveau: NiveauEcheanceGoogle = "LOINTAINE";
  if (coupee || (resteMs !== null && resteMs <= 0)) niveau = "EXPIREE";
  else if (resteMs !== null && resteMs <= RAPPEL_IMMINENT_MS) niveau = "IMMINENTE";
  else if (resteMs !== null && resteMs <= RAPPEL_PROCHE_MS) niveau = "PROCHE";

  return { niveau, expireLe: expire?.toISOString() ?? null, resteMs, coupee };
}

/** « 1 j 20 h », « 5 h », « moins d'une heure ». */
export function dureeRestante(resteMs: number): string {
  const heures = Math.floor(Math.max(0, resteMs) / HEURE_MS);
  if (heures < 1) return "moins d'une heure";
  const jours = Math.floor(heures / 24);
  const reste = heures % 24;
  if (jours === 0) return `${heures} h`;
  return reste === 0 ? `${jours} j` : `${jours} j ${reste} h`;
}
