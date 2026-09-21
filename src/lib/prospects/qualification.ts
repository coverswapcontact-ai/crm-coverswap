import type { Prisma } from "@prisma/client";
import prisma, { type BaseDonnees } from "@/lib/prisma";
import { lireParametres } from "@/lib/parametres/service";
import { lireDepartements, qualifier, type Qualification, type ReponseLue, type ZoneIntervention } from "./priorite";

/**
 * Classement d'un contact entrant, écrit sur sa fiche : priorité, motif, et ce
 * que le formulaire disait (propriétaire ou locataire, délai, taille).
 *
 * La zone d'intervention vient des paramètres datés (ZONE_DEPARTEMENTS et
 * ZONE_DEPARTEMENTS_PROCHES) : tant qu'ils ne sont pas saisis, personne n'est
 * « hors zone » — on ne classe pas quelqu'un à écarter sur une règle absente.
 * Une priorité posée à la main n'est jamais recalculée.
 */
export async function zoneIntervention(date: Date = new Date()): Promise<ZoneIntervention> {
  const valeurs = await lireParametres(["ZONE_DEPARTEMENTS", "ZONE_DEPARTEMENTS_PROCHES"], date);
  return { departements: lireDepartements(valeurs.ZONE_DEPARTEMENTS), proches: lireDepartements(valeurs.ZONE_DEPARTEMENTS_PROCHES) };
}

/** Réponses du formulaire : celles gardées sur l'événement Meta, sinon les lignes « Question : réponse » des notes. */
export function reponsesDepuis(reponsesMeta: string | null | undefined, notes: string | null | undefined): ReponseLue[] {
  if (reponsesMeta) {
    try {
      const lues = JSON.parse(reponsesMeta) as { question?: unknown; reponse?: unknown }[];
      if (Array.isArray(lues)) {
        return lues.filter((r) => typeof r?.question === "string" && typeof r?.reponse === "string").map((r) => ({ question: String(r.question), reponse: String(r.reponse) }));
      }
    } catch {
      // Réponses illisibles : on se rabat sur les notes.
    }
  }
  return (notes ?? "")
    .split(/\n|\s\|\s/)
    .map((ligne) => /^(.{3,160}?)\s*:\s+(.{1,300})$/.exec(ligne.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ question: m[1], reponse: m[2] }));
}

const SELECTION = {
  id: true,
  codePostal: true,
  notes: true,
  message: true,
  source: true,
  statut: true,
  prioriteManuelle: true,
  metaLeads: { select: { reponses: true }, orderBy: { recuLe: "desc" as const }, take: 1 },
  _count: { select: { simulations: { where: { archiveLe: null } } } },
} satisfies Prisma.LeadSelect;

type LeadAClasser = Prisma.LeadGetPayload<{ select: typeof SELECTION }>;

/** Lead du simulateur : venu par lui, ou ayant au moins une simulation sur sa fiche. */
export function estIssuDuSimulateur(lead: { source: string; _count: { simulations: number } }): boolean {
  return lead.source === "SITE_SIMULATEUR" || lead._count.simulations > 0;
}

function qualifierLead(lead: LeadAClasser, zone: ZoneIntervention): Qualification {
  return qualifier(
    {
      codePostal: lead.codePostal,
      reponses: reponsesDepuis(lead.metaLeads[0]?.reponses, lead.notes),
      devisDemande: lead.source === "SITE_DEVIS" || lead.statut === "DEVIS_DEMANDE",
      simulation: estIssuDuSimulateur(lead),
    },
    zone
  );
}

/** Classe un contact et l'écrit. Rend la qualification, ou null si la priorité est posée à la main. */
export async function classerLead(leadId: string, client: BaseDonnees = prisma, zone?: ZoneIntervention): Promise<Qualification | null> {
  const lead = await client.lead.findUnique({ where: { id: leadId }, select: SELECTION });
  if (!lead || lead.prioriteManuelle) return null;
  const qualification = qualifierLead(lead, zone ?? (await zoneIntervention()));
  await client.lead.update({
    where: { id: leadId },
    data: {
      priorite: qualification.priorite,
      prioriteMotif: qualification.motif,
      occupation: qualification.occupation,
      delaiProjet: qualification.delai,
      delaiProjetTexte: qualification.delaiTexte,
      tailleCuisine: qualification.tailleCuisine,
    },
  });
  return qualification;
}

/** Classement qui ne doit jamais faire échouer l'arrivée d'un contact. */
export async function classerLeadSansBloquer(leadId: string): Promise<Qualification | null> {
  try {
    return await classerLead(leadId);
  } catch (erreur) {
    console.error(`[prospects] classement du contact ${leadId} impossible (non bloquant) :`, erreur);
    return null;
  }
}

/** Priorité décidée par Lucas (« je le traite quand même ») : elle ne sera plus recalculée. `null` rend la main au calcul. */
export async function poserPriorite(leadId: string, priorite: Qualification["priorite"] | null): Promise<void> {
  if (priorite === null) {
    await prisma.lead.update({ where: { id: leadId }, data: { prioriteManuelle: false } });
    await classerLead(leadId);
    return;
  }
  await prisma.lead.update({ where: { id: leadId }, data: { priorite, prioriteManuelle: true, prioriteMotif: "Priorité posée à la main" } });
}

/** Reclasse tous les contacts encore à traiter (paramètres de zone changés, reprise). Rend le nombre de fiches écrites. */
export async function reclasserLesContactsActifs(client: BaseDonnees = prisma): Promise<number> {
  const zone = await zoneIntervention();
  const leads = await client.lead.findMany({ where: { prioriteManuelle: false, statut: { in: ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE"] } }, select: { id: true } });
  let ecrits = 0;
  for (const { id } of leads) {
    if (await classerLead(id, client, zone)) ecrits++;
  }
  return ecrits;
}
