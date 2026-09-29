import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { changerEtape } from "@/lib/dossiers/transitions";
import { ecrireNote } from "@/lib/dossiers/dossiers";
import { recalculerMain } from "@/lib/dossiers/main";
import { LIBELLES_ETAPE, MOTIFS_PERTE, estDossierClos, type EtapeDossier } from "@/lib/dossiers/constants";
import { motifPerteDansUnePhrase, verifierMotifPerte } from "@/lib/dossiers/perte";
import { libelleSourceLead } from "@/lib/prospects/constantes";
import { nomDuLead, telephoneLisible } from "@/lib/prospects/leads";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { ISSUES_APPEL, LIBELLES_ISSUE, type SuiteAppel } from "./constantes";
import { noterIssueSurNote } from "./notes-appel";
import { aHeureParis, momentDuRappel } from "./quand";
import { appelSansReponse } from "./sans-reponse";

/**
 * Fin d'appel : une ligne de note, une issue, et le CRM fixe la suite.
 *
 * Mission 14 (29/09/2026), partie 4 — la feuille de fin d'appel :
 *  - PAS_DE_REPONSE : une tentative de plus, rappel à l'instant choisi (demain
 *                     18 h à défaut), le lead reste dans « À rappeler » ; le SMS
 *                     « j'ai essayé de vous joindre » est proposé (A, puis D dès
 *                     la 2ᵉ tentative). À la 3ᵉ tentative, le CRM PROPOSE « pas
 *                     intéressé — plus de réponse » (`proposerSansSuite`), sans
 *                     l'imposer ;
 *  - A_RAPPELER     : rappel à l'instant choisi, ou sans date (plus de défaut) ;
 *                     SMS B proposé (« je vous rappelle {quand} ») ;
 *  - INTERESSE      : son dossier vivant (repris, sinon ouvert ; jamais un
 *                     dossier perdu ou encaissé) reçoit l'appel, puis son espace
 *                     s'ouvre — un espace qui refuse de s'ouvrir n'empêche pas
 *                     l'appel d'être noté (le résumé dit pourquoi) ; le SMS avec
 *                     le lien de son espace est proposé ;
 *  - PAS_INTERESSE  : motif de perte OBLIGATOIRE (liste existante, précision pour
 *                     « autre ») : le lead passe « sans suite », ou le dossier
 *                     « perdu » (jamais un dossier encaissé). Aucun SMS.
 * Rien ne part seul : le SMS proposé s'ouvre dans l'écran SMS (copier ou passer).
 *
 * L'appel s'écrit dans l'histoire du contact : événement du dossier s'il y en a
 * un, échange du contact entrant sinon — c'est la règle du CRM (section 19).
 * Le lead (directement, ou celui du dossier) retient son dernier appel
 * (`dernierAppelLe`) et ses appels sans réponse d'affilée (`tentatives`, remis à
 * zéro par un appel abouti) — partie 3.
 */
export { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "./constantes";

export const schemaAppel = z
  .object({
    leadId: z.string().max(40).optional(),
    dossierId: z.string().max(40).optional(),
    issue: z.enum(ISSUES_APPEL, "Issue de l'appel invalide."),
    note: z.string().trim().max(2000, "Note trop longue.").default(""),
    /** Rappel (ISO) : « pas de réponse » → demain 18 h à défaut ; « à rappeler » → sans date à défaut (null). */
    rappelLe: z.iso.datetime("Date de rappel invalide.").nullable().optional(),
    /** « Pas intéressé » : le motif de perte, obligatoire (liste `MOTIFS_PERTE`). */
    motifPerte: z.enum(MOTIFS_PERTE, "Motif de perte invalide.").optional(),
    /** Précision de la perte (obligatoire pour « autre ») ; la note à défaut. */
    perteCommentaire: z.string().trim().max(2000, "Précision trop longue.").optional(),
  })
  .refine((v) => v.leadId || v.dossierId, "Indique le contact ou le dossier concerné.");

type EntreeAppel = z.output<typeof schemaAppel>;

/**
 * Le dossier et le lead de l'appel : le dossier donné (et son lead) ; pour un lead, son dossier vivant (étapes closes
 * exclues, la règle d'`ouvrirDossierDuLead`), sinon son dernier dossier clos — l'appel s'écrit dans son histoire.
 * `clos` : le dossier retenu est perdu ou encaissé.
 */
async function cibleDeLAppel(entree: { leadId?: string | null; dossierId?: string | null }): Promise<{ dossierId: string | null; leadId: string | null; clos: boolean }> {
  if (entree.dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { id: true, leadId: true, etape: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    return { dossierId: dossier.id, leadId: entree.leadId ?? dossier.leadId, clos: estDossierClos(dossier.etape) };
  }
  if (!entree.leadId) throw new ErreurMetier("Indique le contact ou le dossier concerné.", 400);
  const lead = await prisma.lead.findUnique({ where: { id: entree.leadId }, select: { id: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true, etape: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  const dossier = lead.dossiers.find((d) => !estDossierClos(d.etape)) ?? lead.dossiers[0] ?? null;
  return { dossierId: dossier?.id ?? null, leadId: lead.id, clos: dossier ? estDossierClos(dossier.etape) : false };
}

/**
 * « Intéressé » : l'espace du dossier, ouvert APRÈS l'écriture de l'appel — un refus (lien du client désactivé, espace
 * du projet archivé…) ne doit pas empêcher l'appel d'être noté. Jamais sur un projet clos (le client le voit figé,
 * « il se consulte, il ne se modifie plus »). Rend null si l'espace est ouvert, sinon la phrase qui dit pourquoi.
 */
async function espaceNonOuvert(dossierId: string, etape: string | null): Promise<string | null> {
  if (etape === "PERDU") return "Son dossier est perdu : aucun espace ouvert sur un projet clos. Reprends le dossier (change son étape) pour lui ouvrir son espace.";
  if (etape && estDossierClos(etape)) return `Son dossier est ${LIBELLES_ETAPE[etape as EtapeDossier]?.toLowerCase() ?? "clos"} : aucun espace ouvert sur un projet clos. Ouvre-lui un nouveau dossier pour ce projet.`;
  try {
    const { ouvrirEspace } = await import("@/lib/espace/liens");
    const { permanent } = await ouvrirEspace(dossierId);
    if (!permanent.revoqueLe) return null;
    return "Dossier ouvert ; son espace ne s'est pas ouvert. Le lien de ce client est désactivé : le régénérer pour lui rouvrir son espace.";
  } catch (erreur) {
    console.error(`[appels] espace du dossier ${dossierId} non ouvert après l'appel :`, erreur);
    return `Dossier ouvert ; son espace ne s'est pas ouvert. ${erreur instanceof ErreurMetier ? erreur.message : "Réessaie depuis son dossier."}`;
  }
}

/** Le rappel de l'appel : l'instant choisi ; « pas de réponse » sans choix → demain 18 h (Paris) ; « à rappeler » sans choix → sans date. */
function rappelDe(entree: EntreeAppel, maintenant: Date): Date | null {
  if (entree.issue !== "PAS_DE_REPONSE" && entree.issue !== "A_RAPPELER") return null;
  if (entree.rappelLe) return new Date(entree.rappelLe);
  return entree.issue === "PAS_DE_REPONSE" ? aHeureParis(maintenant, 1, 18) : null;
}

export async function noterAppel(entree: EntreeAppel, maintenant: Date = new Date()): Promise<SuiteAppel> {
  const note = (entree.note ?? "").trim();
  // « Pas intéressé » : le motif d'abord, avant toute écriture — la règle unique de la perte (lead et dossier).
  const precisionPerte = entree.perteCommentaire?.trim() || note;
  const motifPerte = entree.issue === "PAS_INTERESSE" ? entree.motifPerte : undefined;
  if (entree.issue === "PAS_INTERESSE") verifierMotifPerte(motifPerte, precisionPerte);

  const cible = await cibleDeLAppel(entree);
  const leadId = cible.leadId;
  let dossierId = cible.dossierId;
  // « Intéressé » : l'appel s'écrit dans son dossier VIVANT — repris, sinon ouvert (`ouvrirDossierDuLead`, qui cherche
  // aussi celui de son client). Un dossier clos (perdu, encaissé) ne reçoit pas un nouveau projet : le lead connu en
  // reçoit un autre. Un rappel à venir du lead devient la prochaine action « Rappeler » du dossier : rien n'est effacé ;
  // le lead, qui a désormais un dossier, sort des listes Leads (voulu). Un refus ici (contact archivé) arrive avant toute
  // écriture. L'espace, lui, s'ouvre après l'écriture de l'appel (`espaceNonOuvert`).
  if (entree.issue === "INTERESSE" && leadId && (!dossierId || cible.clos)) {
    const { ouvrirDossierDuLead } = await import("@/lib/dossiers/depuis-lead");
    dossierId = (await ouvrirDossierDuLead(leadId, { motif: "BOUTON" })).dossierId;
  }
  let sansEspace: string | null = null;
  let etapeClose: string | null = null;

  const rappel = rappelDe(entree, maintenant);
  const libelle = LIBELLES_ISSUE[entree.issue];
  const contenu = [`Appel — ${libelle}`, note].filter(Boolean).join(" : ");
  // Une tentative de plus si l'issue dit « sans réponse », sinon remise à zéro (règle unique : `appelSansReponse`).
  const suiviAppel = { dernierAppelLe: maintenant, tentatives: appelSansReponse({ issue: entree.issue }) ? { increment: 1 } : 0 };
  let tentatives = 0;

  if (dossierId) {
    const idDossier = dossierId;
    const dossier = await prisma.dossier.findUnique({ where: { id: idDossier }, select: { etape: true } });
    etapeClose = dossier && estDossierClos(dossier.etape) ? dossier.etape : null;
    await prisma.$transaction(async (tx) => {
      await tx.dossierEvenement.create({ data: { dossierId: idDossier, type: "APPEL", direction: "SORTANT", contenu, metadata: JSON.stringify({ issue: entree.issue }) } });
      if (leadId) tentatives = (await tx.lead.update({ where: { id: leadId }, data: suiviAppel, select: { tentatives: true } })).tentatives;
      // Le rappel d'un dossier est sa prochaine action ; « à rappeler » sans date : « Rappeler », sans date.
      if (entree.issue === "PAS_DE_REPONSE" || entree.issue === "A_RAPPELER") {
        await tx.dossier.update({ where: { id: idDossier }, data: { prochaineAction: entree.issue === "PAS_DE_REPONSE" ? "Rappeler (pas de réponse)" : "Rappeler", prochaineActionDate: rappel } });
      }
      if (entree.issue === "INTERESSE") await tx.dossier.update({ where: { id: idDossier }, data: { updatedAt: new Date() } });
      if (note && entree.issue !== "PAS_DE_REPONSE") await ecrireNote(tx, idDossier, { etape: (dossier?.etape ?? "QUALIFICATION") as EtapeDossier, contenu: `${libelle} — ${note}` });
    });
    // « Pas intéressé » : le dossier passe perdu — jamais un dossier clos (déjà perdu, ou encaissé : le chantier est payé).
    if (motifPerte && dossier && !etapeClose) {
      await changerEtape(idDossier, { vers: "PERDU", motifPerte, perteCommentaire: precisionPerte || "Pas intéressé (dit au téléphone)" });
    }
    if (entree.issue === "INTERESSE") sansEspace = await espaceNonOuvert(idDossier, etapeClose);
    if (!leadId) {
      const { tentativesDuDossier } = await import("@/lib/sms/proposition");
      tentatives = await tentativesDuDossier(idDossier);
    }
    // Mission 14 (R2) : un appel abouti répond au message du client qui attendait (la main n'y est plus épinglée).
    await recalculerMain(idDossier);
  } else if (leadId) {
    const idLead = leadId;
    tentatives = await prisma.$transaction(async (tx) => {
      await tx.interaction.create({ data: { leadId: idLead, type: "APPEL", contenu } });
      const lead = await tx.lead.findUnique({ where: { id: idLead }, select: { statut: true } });
      const aTraiter = lead?.statut === "NOUVEAU" || lead?.statut === "DEVIS_DEMANDE";
      const data = motifPerte
        ? // Sans suite, avec le motif choisi ; la précision (ou la note) en commentaire.
          { ...suiviAppel, statut: "PERDU", rappelLe: null, motifPerte, perteLe: maintenant, perteCommentaire: precisionPerte || "Pas intéressé (appel)" }
        : entree.issue === "PAS_DE_REPONSE"
          ? // Pas de réponse : la personne n'a pas été jointe, son statut ne bouge pas — un rappel, une tentative de plus.
            { ...suiviAppel, rappelLe: rappel }
          : { ...suiviAppel, ...(aTraiter ? { statut: "CONTACTE" } : {}), rappelLe: rappel };
      return (await tx.lead.update({ where: { id: idLead }, data, select: { tentatives: true } })).tentatives;
    });
  }

  // L'issue s'inscrit aussi sur la note prise pendant l'appel (elle en garde la trace, même sans dossier).
  if (leadId) await noterIssueSurNote(leadId, entree.issue).catch((erreur: unknown) => console.error("[appels] issue non reportée sur la note :", erreur));

  // Le SMS proposé : l'appel est déjà écrit, un SMS impossible à préparer ne doit pas le faire noter deux fois.
  // « Intéressé » sans espace ouvert : pas de SMS avec un lien (il rouvrirait l'espace d'un projet clos, ou échouerait).
  let sms: PropositionSms | null = null;
  if (entree.issue !== "PAS_INTERESSE" && !(entree.issue === "INTERESSE" && sansEspace)) {
    try {
      const { proposerSms } = await import("@/lib/sms/proposition");
      sms = await proposerSms({ action: entree.issue, leadId, dossierId, rappelLe: rappel, tentatives }, maintenant);
    } catch (erreur) {
      console.error("[appels] SMS de fin d'appel non préparé :", erreur);
    }
  }

  return {
    cible: dossierId ? "DOSSIER" : "CONTACT",
    dossierId,
    leadId,
    rappelLe: rappel?.toISOString() ?? null,
    tentatives,
    proposerSansSuite: entree.issue === "PAS_DE_REPONSE" && tentatives >= 3,
    sms,
    resume: resumeDeLAppel(entree.issue, { rappel, maintenant, dossier: Boolean(dossierId), motif: motifPerte ? motifPerteDansUnePhrase(motifPerte, precisionPerte) : null, sansEspace, etapeClose }),
  };
}

/**
 * « Appel noté. Rappel demain à 18:00. », « … Dossier et espace ouverts. » (sinon pourquoi l'espace ne l'est pas),
 * « … Classé sans suite : délai trop long. » (un dossier clos ne passe pas perdu : on le dit).
 */
function resumeDeLAppel(
  issue: EntreeAppel["issue"],
  suite: { rappel: Date | null; maintenant: Date; dossier: boolean; motif: string | null; sansEspace: string | null; etapeClose: string | null }
): string {
  if (issue === "INTERESSE") return `Appel noté. ${suite.sansEspace ?? "Dossier et espace ouverts."}`;
  if (issue === "PAS_INTERESSE") {
    if (suite.etapeClose === "PERDU") return "Appel noté. Son dossier était déjà perdu.";
    if (suite.etapeClose) return `Appel noté. Son dossier est ${LIBELLES_ETAPE[suite.etapeClose as EtapeDossier]?.toLowerCase() ?? "clos"} : il ne passe pas en perdu.`;
    return `Appel noté. Classé sans suite : ${suite.motif ?? "pas intéressé"}.`;
  }
  if (suite.rappel) return `Appel noté. Rappel ${momentDuRappel(suite.rappel, suite.maintenant, "à")}.`;
  return suite.dossier ? "Appel noté. Sans date de rappel : « Rappeler » est la prochaine action de son dossier." : "Appel noté. Sans date de rappel : il est dans À rappeler.";
}

/* ── Mission 14 (partie 4) : ce que la feuille de fin d'appel sait du contact ── */

export type ContexteAppel = {
  nom: string;
  telephone: string | null;
  /** Appels sans réponse d'affilée (avant celui qu'on note) : à 2, le prochain « pas de réponse » est la 3ᵉ tentative. */
  tentatives: number;
  /** « Publicité Meta », « Simulation du site »… ; null pour un dossier sans lead. */
  source: string | null;
  /** Le rappel prévu : celui du lead, ou la date de la prochaine action de son dossier. */
  rappelLe: string | null;
  dossierId: string | null;
};

/**
 * Le contact de la feuille de fin d'appel : son nom, son numéro, ses tentatives (celles du lead ; pour un dossier sans
 * lead, les appels sans réponse d'affilée lus dans ses événements APPEL), sa source, son rappel et son dossier. Un
 * lead qui a un dossier vivant est lu par son dossier (l'appel s'y écrira).
 */
export async function contexteAppel(entree: { leadId?: string | null; dossierId?: string | null }): Promise<ContexteAppel> {
  const { dossierId, leadId } = await cibleDeLAppel(entree);
  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId }, select: { prenom: true, nom: true, telephone: true, source: true, tentatives: true, rappelLe: true } }) : null;
  if (!dossierId) {
    if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
    return { nom: nomDuLead(lead), telephone: telephoneLisible(lead.telephone), tentatives: lead.tentatives, source: libelleSourceLead(lead.source), rappelLe: lead.rappelLe?.toISOString() ?? null, dossierId: null };
  }
  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { clientNom: true, clientTelephone: true, prochaineActionDate: true } });
  const { tentativesDuDossier } = await import("@/lib/sms/proposition");
  return {
    nom: lead ? nomDuLead(lead) : dossier.clientNom.trim() || "Contact sans nom",
    telephone: (lead ? telephoneLisible(lead.telephone) : null) ?? telephoneLisible(dossier.clientTelephone),
    tentatives: lead ? lead.tentatives : await tentativesDuDossier(dossierId),
    source: lead ? libelleSourceLead(lead.source) : null,
    rappelLe: dossier.prochaineActionDate?.toISOString() ?? null,
    dossierId,
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
