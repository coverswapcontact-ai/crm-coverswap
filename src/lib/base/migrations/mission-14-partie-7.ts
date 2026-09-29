import { estJourSeul, estRappel, synchroniserRappel } from "@/lib/agenda/rappels";
import { pluriel } from "@/lib/commun/format";
import { ETAPES_CLOSES } from "@/lib/dossiers/constants";
import { debutDuJourParis } from "@/lib/dossiers/dates";
import type { BaseDonnees } from "@/lib/prisma";
import { LEAD_SANS_DOSSIER } from "@/lib/prospects/leads";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 7 — chaque rappel daté a son événement Google Agenda et sa notification 10 minutes
 * avant. Les rappels FUTURS déjà en base (leads des listes Leads avec `rappelLe` à venir — dont ceux que la partie 2 a
 * remis à rappeler —, dossiers ni archivés ni clos dont la prochaine action « Rappeler… » est datée plus tard, ou notée
 * au jour seul pour aujourd'hui ou après) passent par `synchroniserRappel`, comme un rappel posé aujourd'hui : l'événement
 * se pose dès que le droit agenda est accordé (la tâche attend sinon), la notification est programmée. Un rappel noté au
 * jour seul (midi UTC ; l'ancien « planifier » rangeait ainsi même « jeudi 9h ») est un événement « toute la journée »,
 * notifié à 9 h — pas « 14 h ». Rejouable : les clés des tâches sont idempotentes (la
 * tâche d'agenda d'une fiche est remise en file, jamais doublée ; la notification d'un instant n'existe qu'une fois).
 */

const NOM = "agenda-des-rappels-14-7";

export async function inscrireLesRappels(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  const leads = await client.lead.findMany({ where: { AND: [LEAD_SANS_DOSSIER, { rappelLe: { gt: maintenant } }] }, select: { id: true }, orderBy: { rappelLe: "asc" } });
  const dossiers = (
    await client.dossier.findMany({
      where: { etape: { notIn: ETAPES_CLOSES }, prochaineActionDate: { gte: debutDuJourParis(maintenant) } },
      select: { id: true, prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true },
      orderBy: { prochaineActionDate: "asc" },
    })
  ).filter((d) => estRappel(d.prochaineAction) && d.prochaineActionDate && (d.prochaineActionDate.getTime() > maintenant.getTime() || estJourSeul(d.prochaineActionDate, d.prochaineActionInstant)));
  for (const lead of leads) await synchroniserRappel({ type: "LEAD", id: lead.id }, maintenant);
  for (const dossier of dossiers) await synchroniserRappel({ type: "DOSSIER", id: dossier.id }, maintenant);
  console.info(`[migration ${NOM}] ${pluriel(leads.length, "rappel de lead", "rappels de lead")} et ${pluriel(dossiers.length, "rappel de dossier", "rappels de dossier")} à venir, mis en file pour l'agenda et la notification`);
  return { leads: leads.length, dossiers: dossiers.length };
}

export const migrationAgendaDesRappels14: MigrationDonnees = {
  nom: NOM,
  description: "Rappels futurs (leads et dossiers) mis en file pour Google Agenda et la notification 10 minutes avant",
  executer: (client) => inscrireLesRappels(client),
};
