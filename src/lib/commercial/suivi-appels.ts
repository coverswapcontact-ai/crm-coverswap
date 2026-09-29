import type { Prisma } from "@prisma/client";
import { noteVide } from "./notes-appel";
import { issueDesMetadonnees, issueDuContenu, tentativesALaFin } from "./sans-reponse";

/**
 * Mission 14 (29/09/2026), partie 3 — le suivi des appels d'un lead lu dans son
 * historique, en un seul endroit (migration `appels-des-leads-14-3`, fusion d'un
 * doublon). Il redonne ce que la fin d'appel (`noterAppel`), « Noter un échange »
 * (`ajouterEchange`) et les notes d'appel (`creerNoteAppel`) tiennent à jour en
 * direct :
 *  - `dernierAppelLe` : le plus récent de ses échanges « appel », des événements
 *    « appel » de ses dossiers (date réelle, sinon saisie) et de ses notes d'appel
 *    qui disent quelque chose (texte ou étiquette) ;
 *  - `tentatives` : les appels sans réponse d'affilée à la fin de l'historique
 *    (échanges et événements « appel », règle `appelSansReponse`) ; une note
 *    d'appel n'en ajoute ni n'en retire.
 * Les lignes archivées de l'historique ne comptent pas ; les dossiers archivés,
 * si (un `select` imbriqué n'est pas filtré par l'extension du journal).
 */

/** Ce qu'il faut lire d'un lead pour son suivi d'appels (`select` Prisma). */
export const HISTORIQUE_APPELS = {
  interactions: { where: { archiveLe: null, type: "APPEL" }, select: { contenu: true, createdAt: true } },
  notesAppel: { where: { archiveLe: null }, select: { appelLe: true, texte: true, etiquettes: true } },
  dossiers: { select: { evenements: { where: { archiveLe: null, type: "APPEL" }, select: { contenu: true, metadata: true, survenuLe: true, createdAt: true } } } },
} satisfies Prisma.LeadSelect;

export type HistoriqueAppels = Prisma.LeadGetPayload<{ select: typeof HISTORIQUE_APPELS }>;
export type SuiviAppels = { dernierAppelLe: Date | null; tentatives: number };

/** Le suivi d'un historique, ou de plusieurs réunis (un doublon fusionné apporte le sien). */
export function suiviDesAppels(...historiques: HistoriqueAppels[]): SuiviAppels {
  const appels = historiques.flatMap((h) => [
    ...h.interactions.map((i) => ({ le: i.createdAt, texte: i.contenu, issue: issueDuContenu(i.contenu) })),
    ...h.dossiers.flatMap((d) => d.evenements.map((e) => ({ le: e.survenuLe ?? e.createdAt, texte: e.contenu, issue: issueDesMetadonnees(e.metadata) }))),
  ]);
  const notes = historiques.flatMap((h) => h.notesAppel.filter((n) => !noteVide(n)).map((n) => n.appelLe));
  const instants = [...appels.map((a) => a.le.getTime()), ...notes.map((d) => d.getTime())];
  return { dernierAppelLe: instants.length > 0 ? new Date(Math.max(...instants)) : null, tentatives: tentativesALaFin(appels) };
}
