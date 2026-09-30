import type { TacheAFaire } from "@prisma/client";
import { lireObjet } from "./json";
import type { ReponseTache, StatutTache } from "./types";

/**
 * Mission 17 (partie A) : l'état d'une réponse, rangé dans `TacheAFaire.precedent` pour « Annuler » (docs/TACHES.md
 * § 4). Écrit par une réponse de Lucas ou de Claude (reponses.ts) comme par une coche du CRM (moteur.ts) : « Annuler »
 * remet toujours l'état d'avant la DERNIÈRE réponse, et une coche du CRM qui a recouvert un « Plus tard » de Lucas le
 * rend quand la condition revient (moteur.ts). Pur.
 */

export type EtatReponse = {
  statut: StatutTache;
  reponse: string | null;
  reponseRaison: string | null;
  reponseTexte: string | null;
  reponduLe: string | null;
  reponduPar: string | null;
  plusTardJusqua: string | null;
  revenueLe: string | null;
  dureeReelleSec: number | null;
};

/**
 * Mission 17 (partie A, relecture) : ce que l'effet a déjà fait, rangé au fil de l'eau (reponses.ts › executerEffet).
 * Un nouvel essai de la file saute les effets déjà faits ; « Annuler » défait ce qui est rangé ici, même si l'effet
 * n'est pas allé au bout.
 */
export type ProgressionEffet = { faits: number[]; textes: string[]; refus: string[]; inverses: unknown[]; irreversibles: string[] };

export type Precedent = { avant: EtatReponse; reponse: ReponseTache; le: string; effet: { cle: string } | null; progression?: ProgressionEffet };

export function etatDe(t: TacheAFaire): EtatReponse {
  return {
    statut: t.statut as StatutTache,
    reponse: t.reponse,
    reponseRaison: t.reponseRaison,
    reponseTexte: t.reponseTexte,
    reponduLe: t.reponduLe?.toISOString() ?? null,
    reponduPar: t.reponduPar,
    plusTardJusqua: t.plusTardJusqua?.toISOString() ?? null,
    revenueLe: t.revenueLe?.toISOString() ?? null,
    dureeReelleSec: t.dureeReelleSec,
  };
}

/** Le `precedent` d'une tâche, ou null s'il est vide ou illisible. */
export function lirePrecedent(texte: string | null | undefined): Precedent | null {
  const lu = lireObjet(texte) as Partial<Precedent>;
  const avant = lu.avant as Partial<EtatReponse> | undefined;
  if (!avant || typeof avant !== "object" || typeof avant.statut !== "string") return null;
  return lu as Precedent;
}

export const dateOuNull = (iso: string | null | undefined): Date | null => (iso ? new Date(iso) : null);
