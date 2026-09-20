"use client";

/**
 * File d'attente des SMS écrits sans réseau (chantier, sous-sol, zone blanche).
 *
 * Le message s'affiche tout de suite dans le fil ; s'il n'a pas pu rejoindre le
 * serveur, il est gardé ici (stockage du navigateur) et repart dès que la
 * connexion revient. La clé d'envoi rend l'opération idempotente côté serveur :
 * un message renvoyé deux fois ne part qu'une fois.
 */
export type EnvoiEnAttente = {
  cleEnvoi: string;
  conversationId: string;
  texte: string;
  modele: string | null;
  textePropose: string | null;
  creeLe: string;
};

const CLE = "coverswap:sms:file-attente";

function lire(): EnvoiEnAttente[] {
  try {
    const brut = window.localStorage.getItem(CLE);
    const valeur: unknown = brut ? JSON.parse(brut) : [];
    return Array.isArray(valeur) ? (valeur as EnvoiEnAttente[]) : [];
  } catch {
    return [];
  }
}

function ecrire(file: EnvoiEnAttente[]): void {
  try {
    window.localStorage.setItem(CLE, JSON.stringify(file.slice(-50)));
  } catch {
    // Stockage plein ou interdit : le message reste affiché « en attente », rien d'autre à faire.
  }
}

export function enAttente(conversationId?: string): EnvoiEnAttente[] {
  const file = lire();
  return conversationId ? file.filter((e) => e.conversationId === conversationId) : file;
}

export function mettreEnAttente(envoi: EnvoiEnAttente): void {
  const file = lire().filter((e) => e.cleEnvoi !== envoi.cleEnvoi);
  ecrire([...file, envoi]);
}

export function retirerDeLAttente(cleEnvoi: string): void {
  ecrire(lire().filter((e) => e.cleEnvoi !== cleEnvoi));
}

/* ── Brouillons ────────────────────────────────────────────────────── */

const CLE_BROUILLON = (conversationId: string) => `coverswap:sms:brouillon:${conversationId}`;

export function lireBrouillonLocal(conversationId: string): string | null {
  try {
    return window.localStorage.getItem(CLE_BROUILLON(conversationId));
  } catch {
    return null;
  }
}

export function ecrireBrouillonLocal(conversationId: string, texte: string): void {
  try {
    if (texte.trim()) window.localStorage.setItem(CLE_BROUILLON(conversationId), texte);
    else window.localStorage.removeItem(CLE_BROUILLON(conversationId));
  } catch {
    // Sans stockage local, le brouillon vit côté serveur seulement.
  }
}

export function nouvelleCleEnvoi(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `cle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
