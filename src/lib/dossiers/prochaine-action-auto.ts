import type { Transaction } from "@/lib/prisma";
import { jsonStable } from "@/lib/a-faire/json";
import { DUREES_DEPART, type NiveauTache, type Raccourci } from "@/lib/a-faire/types";

/**
 * Mission 18 (B0) : la prochaine action écrite par un événement automatique (photos reçues, simulation choisie,
 * devis émis, accord donné, chèque rejeté…), dans la transaction de l'appelant (`dossiers/synchro.ts`).
 *
 * Règle : une prochaine action posée à la main (Lucas ou Claude : `prochaine-action-manuelle.ts`) n'est JAMAIS écrasée.
 * Tant que le texte du dossier est celui retenu à la main (`prochaineActionManuelleLe` posé et `prochaineAction ===
 * prochaineActionManuelle`), l'événement automatique ne touche pas au dossier : il range à la place une tâche à moi
 * (MANUELLE) de clé stable `MANUELLE:synchro:<dossierId>:<code>`, « ta prochaine action « … » est gardée ». La même clé
 * fait qu'un événement rejoué ne crée jamais de seconde tâche ; une tâche déjà répondue revient à faire au geste
 * suivant (un nouveau besoin), une tâche « Plus tard » garde son report, une tâche archivée n'est plus touchée.
 *
 * Avant la mission 18, ces écritures remplaçaient le texte et la vigueur de l'action manuelle tombait (a-faire/vigueur.ts).
 */

export type ProchaineActionAuto = {
  /** Le texte voulu ; null l'efface (une action posée à la main n'est jamais effacée, et sans tâche : rien à faire). */
  texte: string | null;
  /** Nouvelle date de la prochaine action (null : retirée) ; absente : la date ne bouge pas. */
  date?: Date | null;
  /** Condition sur le texte actuel (les règles d'avant : « si vide ou « attendre les photos » »…). Absente : toujours. */
  si?: (actuelle: string | null) => boolean;
  /** Code stable de la tâche rangée à la place (`MANUELLE:synchro:<dossierId>:<code>`). */
  code: string;
  /** Niveau de cette tâche : 2 (chaud) par défaut, un geste du client. */
  niveau?: NiveauTache;
};

/** ECRITE : le texte est posé. GARDEE : l'action manuelle reste, une tâche est rangée. INCHANGEE : rien à faire. SANS_OBJET : la condition n'est pas remplie. */
export type IssueProchaineAction = "ECRITE" | "GARDEE" | "INCHANGEE" | "SANS_OBJET";

export const PREFIXE_TACHE_SYNCHRO = "MANUELLE:synchro:";
export const cleTacheSynchro = (dossierId: string, code: string): string => `${PREFIXE_TACHE_SYNCHRO}${dossierId}:${code}`;

/** La prochaine action du dossier est-elle celle posée à la main (texte inchangé depuis) ? Pure. */
export function estActionManuelleEnPlace(dossier: { prochaineAction: string | null; prochaineActionManuelle: string | null; prochaineActionManuelleLe: Date | null }): boolean {
  return Boolean(dossier.prochaineActionManuelleLe && dossier.prochaineActionManuelle?.trim() && dossier.prochaineAction === dossier.prochaineActionManuelle);
}

const REPONSE_EFFACEE = { reponse: null, reponseRaison: null, reponseTexte: null, reponduLe: null, reponduPar: null, plusTardJusqua: null, precedent: null } as const;

/**
 * Écrit la prochaine action d'un événement automatique, ou range une tâche si l'action posée à la main est en place.
 * N'utilise que `tx` (SQLite n'a qu'un écrivain) ; le signal des tâches et l'agenda partent après la transaction.
 */
export async function ecrireProchaineActionAuto(tx: Transaction, dossierId: string, voulu: ProchaineActionAuto, maintenant: Date = new Date()): Promise<IssueProchaineAction> {
  const dossier = await tx.dossier.findUnique({
    where: { id: dossierId },
    select: { prochaineAction: true, prochaineActionManuelle: true, prochaineActionManuelleLe: true, clientNom: true, leadId: true, clientId: true },
  });
  if (!dossier) return "SANS_OBJET";
  const actuelle = dossier.prochaineAction ?? null;
  if (voulu.si && !voulu.si(actuelle)) return "SANS_OBJET";

  if (!estActionManuelleEnPlace(dossier)) {
    await tx.dossier.update({ where: { id: dossierId }, data: { prochaineAction: voulu.texte, ...(voulu.date !== undefined ? { prochaineActionDate: voulu.date } : {}) } });
    return "ECRITE";
  }
  // L'action posée à la main reste. Effacer, ou dire ce qu'elle dit déjà : rien à ranger.
  if (!voulu.texte || voulu.texte === actuelle) return "INCHANGEE";

  const cle = cleTacheSynchro(dossierId, voulu.code);
  const titre = `${voulu.texte} · ${dossier.clientNom}`.slice(0, 300);
  const raison = `ta prochaine action « ${actuelle} » est gardée`.slice(0, 500);
  const donnees = jsonStable({ synchro: voulu.code, actionGardee: actuelle, actionProposee: voulu.texte });
  const existante = await tx.tacheAFaire.findUnique({ where: { cle } });
  if (existante) {
    if (existante.archiveLe) return "GARDEE";
    const rouverte = existante.statut === "FAITE" || existante.statut === "PAS_A_FAIRE";
    if (rouverte || existante.titre !== titre || existante.raison !== raison || existante.donnees !== donnees) {
      await tx.tacheAFaire.update({
        where: { id: existante.id },
        data: { titre, raison, donnees, ...(rouverte ? { statut: "A_FAIRE", ...REPONSE_EFFACEE, depuis: maintenant, detecteLe: maintenant, revenueLe: maintenant } : {}) },
      });
    }
    return "GARDEE";
  }
  const raccourci: Raccourci = { genre: "DOSSIER", libelle: "Ouvrir le dossier", dossierId, href: `/dossiers?dossier=${dossierId}` };
  await tx.tacheAFaire.create({
    data: {
      cle,
      type: "MANUELLE",
      source: "MANUELLE",
      sujetType: "DOSSIER",
      sujetId: dossierId,
      dossierId,
      leadId: dossier.leadId,
      clientId: dossier.clientId,
      titre,
      raison,
      niveau: voulu.niveau ?? 2,
      montant: null,
      depuis: maintenant,
      echeance: null,
      dureeMin: DUREES_DEPART.MANUELLE,
      raccourci: jsonStable(raccourci),
      donnees,
      statut: "A_FAIRE",
      detecteLe: maintenant,
    },
  });
  return "GARDEE";
}
