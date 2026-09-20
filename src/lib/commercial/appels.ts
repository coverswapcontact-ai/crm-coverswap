import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { changerEtape } from "@/lib/dossiers/transitions";
import { ecrireNote } from "@/lib/dossiers/dossiers";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { ISSUES_APPEL, LIBELLES_ISSUE, type SuiteAppel } from "./constantes";

/**
 * Fin d'appel : une ligne de note, une issue, et le CRM fixe la suite.
 *
 *  - INTERESSE      : le contact est « contacté » ; la suite est l'envoi du lien
 *                     de son espace (proposé, jamais envoyé seul) ;
 *  - A_RAPPELER     : un rappel est posé (demain 10 h à défaut) ;
 *  - PAS_DE_REPONSE : rappel le lendemain, et le SMS « j'ai essayé de vous
 *                     joindre » est PROPOSÉ à l'écran ;
 *  - PAS_INTERESSE  : le contact est classé sans suite (ou le dossier perdu),
 *                     avec la note pour motif.
 *
 * L'appel s'écrit dans l'histoire du contact : événement du dossier s'il y en a
 * un, échange du contact entrant sinon — c'est la règle du CRM (section 19).
 */
export { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "./constantes";

export const schemaAppel = z
  .object({
    leadId: z.string().max(40).optional(),
    dossierId: z.string().max(40).optional(),
    issue: z.enum(ISSUES_APPEL, "Issue de l'appel invalide."),
    note: z.string().trim().max(2000, "Note trop longue.").default(""),
    /** Date du rappel (ISO) pour « à rappeler » ; à défaut, demain 10 h. */
    rappelLe: z.iso.datetime("Date de rappel invalide.").nullable().optional(),
  })
  .refine((v) => v.leadId || v.dossierId, "Indique le contact ou le dossier concerné.");

/** Demain à 10 h, heure de Paris (le serveur tourne en UTC). */
export function demainDixHeures(maintenant: Date = new Date()): Date {
  const jourParis = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(maintenant.getTime() + 86_400_000));
  // Décalage de Paris ce jour-là : +01:00 ou +02:00.
  const decalage = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(new Date(`${jourParis}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "UTC+1";
  const heures = Number(/([+-]\d+)/.exec(decalage)?.[1] ?? 1);
  return new Date(`${jourParis}T${String(10 - heures).padStart(2, "0")}:00:00Z`);
}

export async function noterAppel(entree: z.output<typeof schemaAppel>): Promise<SuiteAppel> {
  let dossierId = entree.dossierId ?? null;
  let leadId = entree.leadId ?? null;
  if (dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, leadId: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    leadId = leadId ?? dossier.leadId;
  } else if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
    if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
    dossierId = lead.dossiers[0]?.id ?? null;
  }

  const rappel = entree.issue === "A_RAPPELER" || entree.issue === "PAS_DE_REPONSE" ? (entree.rappelLe ? new Date(entree.rappelLe) : demainDixHeures()) : null;
  const libelle = LIBELLES_ISSUE[entree.issue];
  const contenu = [`Appel — ${libelle}`, entree.note].filter(Boolean).join(" : ");
  const rappelLisible = rappel?.toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) ?? null;

  if (dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    await prisma.$transaction(async (tx) => {
      await tx.dossierEvenement.create({ data: { dossierId: dossierId!, type: "APPEL", direction: "SORTANT", contenu, metadata: JSON.stringify({ issue: entree.issue }) } });
      if (rappel) await tx.dossier.update({ where: { id: dossierId! }, data: { prochaineAction: entree.issue === "PAS_DE_REPONSE" ? "Rappeler (pas de réponse)" : "Rappeler", prochaineActionDate: rappel } });
      if (entree.issue === "INTERESSE") await tx.dossier.update({ where: { id: dossierId! }, data: { updatedAt: new Date() } });
      if (entree.note && entree.issue !== "PAS_DE_REPONSE") await ecrireNote(tx, dossierId!, { etape: (dossier?.etape ?? "QUALIFICATION") as EtapeDossier, contenu: `${libelle} — ${entree.note}` });
    });
    if (entree.issue === "PAS_INTERESSE" && dossier && dossier.etape !== "PERDU") {
      await changerEtape(dossierId, { vers: "PERDU", motifPerte: "PROJET_ABANDONNE", perteCommentaire: entree.note || "Pas intéressé (dit au téléphone)" });
    }
  } else if (leadId) {
    await prisma.$transaction(async (tx) => {
      await tx.interaction.create({ data: { leadId: leadId!, type: "APPEL", contenu } });
      const lead = await tx.lead.findUnique({ where: { id: leadId! }, select: { statut: true } });
      const aTraiter = lead?.statut === "NOUVEAU" || lead?.statut === "DEVIS_DEMANDE";
      if (entree.issue === "PAS_INTERESSE") await tx.lead.update({ where: { id: leadId! }, data: { statut: "PERDU", rappelLe: null } });
      // Pas de réponse : la personne n'a pas été jointe, elle reste « à traiter » — avec un rappel.
      else if (entree.issue === "PAS_DE_REPONSE") await tx.lead.update({ where: { id: leadId! }, data: { rappelLe: rappel } });
      else await tx.lead.update({ where: { id: leadId! }, data: { ...(aTraiter ? { statut: "CONTACTE" } : {}), rappelLe: rappel } });
    });
  }

  return {
    cible: dossierId ? "DOSSIER" : "CONTACT",
    dossierId,
    leadId,
    rappelLe: rappel?.toISOString() ?? null,
    messagePropose: entree.issue === "INTERESSE" ? "LIEN_ESPACE" : entree.issue === "PAS_DE_REPONSE" ? "INJOIGNABLE_LIEN" : null,
    resume:
      entree.issue === "INTERESSE"
        ? "Appel noté. Suite : envoyer le lien de son espace pour les photos."
        : entree.issue === "PAS_INTERESSE"
          ? "Appel noté. Contact classé sans suite."
          : `Appel noté. Rappel prévu ${rappelLisible}.`,
  };
}

export const schemaNoteRapide = z
  .object({ leadId: z.string().max(40).optional(), dossierId: z.string().max(40).optional(), contenu: z.string("La note est vide.").trim().min(1, "La note est vide.").max(4000, "Note trop longue.") })
  .refine((v) => v.leadId || v.dossierId, "Indique le contact ou le dossier concerné.");

/** Note en une ligne, écrite au bon endroit : sur le dossier s'il existe, sinon sur le contact. */
export async function noterRapidement(entree: z.output<typeof schemaNoteRapide>): Promise<{ cible: "DOSSIER" | "CONTACT" }> {
  let dossierId = entree.dossierId ?? null;
  if (!dossierId && entree.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: entree.leadId }, select: { dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
    if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
    dossierId = lead.dossiers[0]?.id ?? null;
  }
  if (dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    await prisma.$transaction((tx) => ecrireNote(tx, dossierId!, { etape: dossier.etape as EtapeDossier, contenu: entree.contenu }));
    return { cible: "DOSSIER" };
  }
  await prisma.interaction.create({ data: { leadId: entree.leadId!, type: "NOTE", contenu: entree.contenu } });
  return { cible: "CONTACT" };
}
