// Appels API côté navigateur : erreurs en français, session expirée signalée.

import { PHOTO_OCTETS_MAX } from "@/lib/dossiers/constants";
import { rafraichirCompteurs } from "./evenements";

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
  // Mission 13 (lot 5, B9) : chaque écriture réussie rafraîchit les badges de la navigation.
  if (init?.method && init.method.toUpperCase() !== "GET") rafraichirCompteurs();
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

/* ── Photos, côté navigateur (mission 13, lot 7 : venait de dossiers/_components/client.ts) ── */

const COTE_MAX = 2400;
const QUALITE_JPEG = 0.85;

/**
 * Réduit une photo avant l'envoi (2 400 px de côté, JPEG 85 %) quand le
 * navigateur sait la décoder : une photo de téléphone passe de 4-8 Mo à
 * moins de 1 Mo, ce qui compte en 4G sur un chantier. Un format que le
 * navigateur ne décode pas (HEIC hors Safari) part tel quel.
 */
export async function preparerPhoto(fichier: File): Promise<File> {
  if (!fichier.type.startsWith("image/")) return fichier;
  try {
    const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    if (echelle === 1 && fichier.type === "image/jpeg" && fichier.size <= 1.5 * 1024 * 1024) {
      image.close();
      return fichier;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((resoudre) => canvas.toBlob(resoudre, "image/jpeg", QUALITE_JPEG));
    if (!blob || blob.size >= fichier.size) return fichier;
    return new File([blob], `${fichier.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } catch {
    return fichier;
  }
}

export function photoTropLourde(fichier: File): boolean {
  return fichier.size > PHOTO_OCTETS_MAX;
}
