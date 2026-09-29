import { compterRappelsDuJour } from "@/lib/prospects/leads";
import { relancesProposables } from "@/lib/relances/proposables";

/**
 * Mission 14 (29/09/2026), partie 7 — les nombres du jour, en un endroit : « N rappels aujourd'hui, N en retard, N
 * relances proposables ». Les rappels sont ceux des LEADS (listes « À rappeler » : à venir d'ici ce soir, heure de
 * Paris, et déjà passés, tous jours confondus) ; les rappels de dossier restent dans Dossiers. Les relances viennent de
 * la source unique de la partie 6. Lu par le point du jour ; l'écran Leads lit les mêmes comptes (liste et feuille).
 */
export type ResumeDuJour = { rappelsAujourdhui: number; rappelsEnRetard: number; relancesProposables: number };

export async function resumeDuJour(maintenant: Date = new Date()): Promise<ResumeDuJour> {
  const [rappels, relances] = await Promise.all([compterRappelsDuJour(maintenant), relancesProposables(maintenant)]);
  return { rappelsAujourdhui: rappels.aujourdhui, rappelsEnRetard: rappels.enRetard, relancesProposables: relances.total };
}

