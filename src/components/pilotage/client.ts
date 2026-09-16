// Appels API côté navigateur : erreurs en français, session expirée signalée.

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
    if (reponse.status === 401) throw new Error("Session expirée : reconnecte-toi.");
    const message = (corps as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : `Erreur ${reponse.status}.`);
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
