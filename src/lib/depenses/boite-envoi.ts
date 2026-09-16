// File d'envoi des dépenses saisies sur le téléphone, dans le navigateur
// (IndexedDB) : une dépense saisie pendant une coupure réseau n'est pas perdue,
// elle part au retour du réseau. Chaque saisie porte un identifiant : le
// serveur ne l'enregistre qu'une fois, même envoyée deux fois.

const BASE = "coverswap-depenses";
const MAGASIN = "envois";

export type EnvoiEnAttente = {
  identifiant: string;
  donnees: Record<string, unknown>;
  justificatif: Blob | null;
  nomJustificatif: string | null;
  creeLe: string;
  derniereErreur: string | null;
};

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    if (typeof indexedDB === "undefined") {
      rejeter(new Error("Stockage du téléphone indisponible."));
      return;
    }
    const requete = indexedDB.open(BASE, 1);
    requete.onupgradeneeded = () => requete.result.createObjectStore(MAGASIN, { keyPath: "identifiant" });
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error ?? new Error("Stockage du téléphone indisponible."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (magasin: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const base = await ouvrir();
  try {
    return await new Promise<T>((resoudre, rejeter) => {
      const requete = action(base.transaction(MAGASIN, mode).objectStore(MAGASIN));
      requete.onsuccess = () => resoudre(requete.result);
      requete.onerror = () => rejeter(requete.error ?? new Error("Écriture impossible sur le téléphone."));
    });
  } finally {
    base.close();
  }
}

export function mettreEnAttente(envoi: EnvoiEnAttente): Promise<IDBValidKey> {
  return transaction("readwrite", (magasin) => magasin.put(envoi));
}

export async function envoisEnAttente(): Promise<EnvoiEnAttente[]> {
  try {
    const liste = await transaction<EnvoiEnAttente[]>("readonly", (magasin) => magasin.getAll());
    return liste.sort((a, b) => a.creeLe.localeCompare(b.creeLe));
  } catch {
    return [];
  }
}

export function retirerEnvoi(identifiant: string): Promise<undefined> {
  return transaction("readwrite", (magasin) => magasin.delete(identifiant));
}

/** Envoie une saisie ; « reseau » : à retenter plus tard, « refus » : le serveur a répondu non. */
export async function envoyerDepense(
  envoi: Pick<EnvoiEnAttente, "donnees" | "justificatif" | "nomJustificatif">
): Promise<{ etat: "ok"; corps: unknown } | { etat: "reseau" } | { etat: "refus"; statut: number; message: string; corps: unknown }> {
  const formulaire = new FormData();
  formulaire.set("donnees", JSON.stringify(envoi.donnees));
  if (envoi.justificatif) formulaire.set("justificatif", envoi.justificatif, envoi.nomJustificatif ?? "justificatif");
  let reponse: Response;
  try {
    reponse = await fetch("/api/depenses", { method: "POST", body: formulaire });
  } catch {
    return { etat: "reseau" };
  }
  const corps: unknown = await reponse.json().catch(() => null);
  if (reponse.ok) return { etat: "ok", corps };
  // Passerelle ou serveur indisponible : c'est le réseau, pas la saisie.
  if (reponse.status === 502 || reponse.status === 503 || reponse.status === 504) return { etat: "reseau" };
  const message = (corps as { error?: unknown } | null)?.error;
  return { etat: "refus", statut: reponse.status, message: typeof message === "string" ? message : `Erreur ${reponse.status}.`, corps };
}

/** Vide la file : ce qui passe est retiré, un refus reste avec son message. */
export async function envoyerFile(): Promise<{ envoyes: number; restants: number }> {
  let envoyes = 0;
  for (const envoi of await envoisEnAttente()) {
    const resultat = await envoyerDepense(envoi);
    if (resultat.etat === "ok") {
      await retirerEnvoi(envoi.identifiant);
      envoyes++;
    } else if (resultat.etat === "refus") {
      await mettreEnAttente({ ...envoi, derniereErreur: resultat.message });
    } else {
      break;
    }
  }
  return { envoyes, restants: (await envoisEnAttente()).length };
}
