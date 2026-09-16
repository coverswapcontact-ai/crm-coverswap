// Appels API côté navigateur : erreurs en français, session expirée signalée.

/** Erreur d'une route : message en français, statut HTTP et corps (détails éventuels). */
export class ErreurApi extends Error {
  readonly status: number;
  readonly corps: unknown;

  constructor(message: string, status: number, corps: unknown) {
    super(message);
    this.name = "ErreurApi";
    this.status = status;
    this.corps = corps;
  }
}

export async function appelApi<T>(url: string, init?: RequestInit): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(url, init);
  } catch {
    throw new Error("Connexion impossible : vérifie ton réseau.");
  }
  const texte = await reponse.text();
  let corps: unknown = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = null;
  }
  if (!reponse.ok) {
    if (reponse.status === 401) throw new ErreurApi("Session expirée : reconnecte-toi.", 401, null);
    const message = (corps as { error?: unknown } | null)?.error;
    throw new ErreurApi(typeof message === "string" ? message : `Erreur ${reponse.status}.`, reponse.status, corps);
  }
  return corps as T;
}

export function envoyerJson<T>(url: string, methode: "POST" | "PATCH" | "DELETE", donnees?: unknown): Promise<T> {
  return appelApi<T>(url, {
    method: methode,
    headers: donnees === undefined ? undefined : { "Content-Type": "application/json" },
    body: donnees === undefined ? undefined : JSON.stringify(donnees),
  });
}

export function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : "Erreur inattendue.";
}
