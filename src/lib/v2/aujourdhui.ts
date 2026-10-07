import type { EntreeReponse } from "@/lib/a-faire/reponses";
import { LIBELLES_RAISON_PAS_A_FAIRE, type ListeTaches, type RaisonPasAFaire, type TacheVue } from "@/lib/a-faire/types";
import { momentLisible } from "@/lib/a-faire/affichage";
import { valideDansLaLigne } from "./geste-pret";

/**
 * Mission 22 (A2) — la logique pure de l'écran Aujourd'hui (components/v2/taches/Aujourdhui.tsx), importable par les
 * essais : la découpe en blocs (Maintenant, Ensuite, le reste), les bornes des listes (règle 2 de docs/CRM-V2.md :
 * cinq lignes puis « Voir les N autres »), les trois durées de « J'ai N minutes », et la ligne de réponse écrite après
 * chaque geste (règle 6).
 */

/** « Ensuite » montre cinq lignes avant « Voir les N autres ». */
export const ENSUITE_VISIBLES = 5;
/** « Plus tard » en montre trois. */
export const PLUS_TARD_VISIBLES = 3;
/** « J'ai 5 / 15 / 30 min » : trois boutons, qui tiennent sur 390 px (l'heure entière reste au mode Commencer). */
export const MINUTES_V2 = [5, 15, 30] as const;
/** Le journal compact d'Aujourd'hui : vingt lignes au plus au premier rendu (cinq groupes visibles). */
export const JOURNAL_PAR_PAGE = 20;

export type BlocsAujourdhui = {
  /** La première tâche du jour, en grand ; null quand il n'y a rien à faire maintenant. */
  maintenant: TacheVue | null;
  /** Les cinq suivantes. */
  ensuite: TacheVue[];
  /** Le reste, derrière « Voir les N autres ». */
  autres: TacheVue[];
};

/** Maintenant = la première (l'ordre du moteur), Ensuite = les cinq suivantes, le reste replié. */
export function decouper(taches: readonly TacheVue[]): BlocsAujourdhui {
  return { maintenant: taches[0] ?? null, ensuite: taches.slice(1, 1 + ENSUITE_VISIBLES), autres: taches.slice(1 + ENSUITE_VISIBLES) };
}

/** Encore à faire (dans « Aujourd'hui », ou « Plus tard » sans être reportée) : ce qu'un masquage cache. */
export function ouvertes(liste: Pick<ListeTaches, "aujourdhui" | "plusTard">): Set<string> {
  return new Set([...liste.aujourdhui, ...liste.plusTard.filter((t) => t.statut === "A_FAIRE")].map((t) => t.id));
}

/** « Voir les 4 autres », « Voir l'autre ». */
export function libelleVoirAutres(nombre: number): string {
  return nombre === 1 ? "Voir l'autre" : `Voir les ${nombre} autres`;
}

/** La ligne écrite après une réponse : « Fait », « Validé », « Plus tard — revient demain 9 h », « Pas à faire — déjà fait hors CRM ». */
export function messageReponse(tache: Pick<TacheVue, "raccourci" | "donnees" | "type">, entree: EntreeReponse, apres: Pick<TacheVue, "plusTardJusqua"> | null, maintenant: number): string {
  if (entree.reponse === "FAIT") return valideDansLaLigne(tache) ? "Validé" : "Fait";
  if (entree.reponse === "PLUS_TARD") return apres?.plusTardJusqua ? `Plus tard — revient ${momentLisible(apres.plusTardJusqua, new Date(maintenant))}` : "Plus tard";
  if (tache.type === "VALIDER" && entree.raison === "PAS_PERTINENT") return "Ignoré";
  const raison = entree.raison && entree.raison in LIBELLES_RAISON_PAS_A_FAIRE ? LIBELLES_RAISON_PAS_A_FAIRE[entree.raison as RaisonPasAFaire].toLowerCase() : null;
  return raison ? `Pas à faire — ${raison}` : "Pas à faire";
}

/** « Rien à faire maintenant. » et, s'il y a de quoi, « Demain : 3 tâches reviennent ». */
export function phraseVide(demain: number): string {
  if (demain <= 0) return "Rien à faire maintenant.";
  return `Rien à faire maintenant. Demain : ${demain} ${demain > 1 ? "tâches reviennent" : "tâche revient"}.`;
}
