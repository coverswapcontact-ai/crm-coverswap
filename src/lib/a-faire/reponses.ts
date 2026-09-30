import { randomBytes } from "node:crypto";
import type { TacheAFaire } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { aHeureParis } from "@/lib/commercial/quand";
import { MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import { dateDepuisJour, estJourValide, jourParis } from "@/lib/dossiers/dates";
import { motifPerteDansUnePhrase, verifierMotifPerte } from "@/lib/dossiers/perte";
import { resoudreContexte } from "@/lib/journal/acteur";
import { acteurValide, avecActeur } from "@/lib/journal/contexte";
import { annulerTache, mettreEnFile } from "@/lib/taches/file";
import { jourMois } from "./achevement";
import { dureeDe, dureeReelle, dureesMesurees } from "./durees";
import { jsonStable, lireObjet, messagesDeLaTache, texteOuNull } from "./json";
import { versVue } from "./lecture";
import { ACTIONS_TYPE, libelleRegle, TYPE_REGLE_TACHE } from "./propositions";
import { signalerChangementTaches, TYPE_TACHE_EFFET } from "./signal";
import {
  ACTEUR_TACHES,
  LIBELLES_RAISON_PAS_A_FAIRE,
  QUAND_PLUS_TARD,
  RAISONS_PLUS_TARD,
  REPONSES_TACHE,
  TYPES_TACHE,
  raisonsPasAFaire,
  type QuandPlusTard,
  type Raccourci,
  type RaisonPasAFaire,
  type ReponseTache,
  type StatutTache,
  type TacheVue,
  type TypeTache,
} from "./types";

/**
 * Mission 17 (partie A) : les réponses de Lucas (ou de Claude) à une tâche (docs/TACHES.md § 4) — « Fait », « Plus
 * tard », « Pas à faire » —, « Annuler », les tâches ajoutées à la main, les lots classés d'un geste, et l'apprentissage
 * des « Pas à faire » répétés.
 *
 * Une réponse s'écrit tout de suite sur la tâche (avec l'état d'avant, pour « Annuler ») ; son EFFET sur la source
 * (proposition validée ou ignorée, fil archivé ou reporté, messages de l'espace lus, contact noté, client perdu) part
 * dans la file des tâches de fond (`A_FAIRE_EFFET`, dans 6 s) : « Annuler » dans les 5 s l'annule avant qu'il parte,
 * plus tard il défait ce qui peut l'être et dit ce qui ne peut pas l'être. L'effet s'exécute au nom de celui qui a
 * répondu (une proposition ne se valide que par une personne).
 */

export { TYPE_TACHE_EFFET };
export const DELAI_EFFET_MS = 6_000;
/** Trois « Pas à faire » de même type et même raison en 30 jours : une règle est proposée. */
export const SEUIL_APPRENTISSAGE = 3;
export const FENETRE_APPRENTISSAGE_JOURS = 30;
const JOUR = 86_400_000;
const RAISONS_SANS_APPRENTISSAGE = ["SUJET_DISPARU", "CLASSE_EN_LOT"];
export const MOTIF_CLASSEMENT_LOT = "Classé en lot depuis Tâches";

/* ── Entrées ───────────────────────────────────────────────────────────── */

export type EntreeReponse = {
  reponse: ReponseTache;
  quand?: QuandPlusTard;
  /** AAAA-MM-JJ (retour à 9 h, heure de Paris) ou ISO (l'instant donné). */
  date?: string;
  raison?: string;
  texte?: string;
  motifPerte?: string;
  precisionPerte?: string;
};

export const schemaReponse = z.object({
  reponse: z.enum(REPONSES_TACHE, "Réponse invalide : FAIT, PLUS_TARD ou PAS_A_FAIRE."),
  quand: z.enum(QUAND_PLUS_TARD, "Quand : CE_SOIR, DEMAIN, LUNDI ou SEMAINE.").nullish(),
  date: z.string().trim().max(40, "Date invalide.").nullish(),
  raison: z.string().trim().max(40, "Raison invalide.").nullish(),
  texte: z.string().trim().max(500, "Précision trop longue (500 caractères au plus).").nullish(),
  motifPerte: z.enum(MOTIFS_PERTE, "Motif de perte invalide.").nullish(),
  precisionPerte: z.string().trim().max(500, "Précision trop longue.").nullish(),
});

export type EntreeAjout = { titre: string; echeance?: string | null; leadId?: string | null; dossierId?: string | null; clientId?: string | null; raison?: string | null; condition?: Record<string, unknown> | null };

export const schemaAjout = z.object({
  titre: z.string("Le titre est obligatoire.").trim().min(2, "Le titre est trop court.").max(200, "Titre trop long (200 caractères au plus)."),
  echeance: z.string().trim().max(40, "Échéance invalide.").nullish(),
  leadId: z.string().trim().max(40).nullish(),
  dossierId: z.string().trim().max(40).nullish(),
  clientId: z.string().trim().max(40).nullish(),
  raison: z.string().trim().max(300, "Raison trop longue.").nullish(),
  condition: z.record(z.string(), z.unknown()).nullish(),
});

/* ── « Plus tard » : l'heure du retour, heure de Paris ─────────────────── */

/** Le jour de la semaine à Paris (0 dimanche … 6 samedi). */
function jourSemaineParis(maintenant: Date): number {
  return new Date(`${jourParis(maintenant)}T12:00:00.000Z`).getUTCDay();
}

/**
 * Quand revient un « Plus tard » : CE_SOIR 18 h (après 18 h : 21 h ; après 21 h : demain 9 h), DEMAIN 9 h, LUNDI 9 h
 * (le prochain lundi : dans une semaine si l'on est lundi), SEMAINE dans 7 jours à 9 h, ou la date donnée à 9 h (une
 * date ISO avec son heure : cet instant). Toujours heure de Paris ; jamais dans le passé.
 */
export function jusquaPlusTard(choix: { quand?: QuandPlusTard | null; date?: string | null }, maintenant: Date): Date {
  let jusqua: Date;
  if (choix.date) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(choix.date)) {
      if (!estJourValide(choix.date)) throw new ErreurMetier("Date de retour invalide (AAAA-MM-JJ).", 400);
      jusqua = aHeureParis(dateDepuisJour(choix.date), 0, 9);
    } else {
      jusqua = new Date(choix.date);
      if (Number.isNaN(jusqua.getTime())) throw new ErreurMetier("Date de retour invalide (AAAA-MM-JJ ou date ISO).", 400);
    }
  } else {
    switch (choix.quand) {
      case "CE_SOIR": {
        const soir = aHeureParis(maintenant, 0, 18);
        const tard = aHeureParis(maintenant, 0, 21);
        jusqua = maintenant < soir ? soir : maintenant < tard ? tard : aHeureParis(maintenant, 1, 9);
        break;
      }
      case "DEMAIN":
        jusqua = aHeureParis(maintenant, 1, 9);
        break;
      case "LUNDI":
        jusqua = aHeureParis(maintenant, (8 - jourSemaineParis(maintenant)) % 7 || 7, 9);
        break;
      case "SEMAINE":
        jusqua = aHeureParis(maintenant, 7, 9);
        break;
      default:
        throw new ErreurMetier("Plus tard : dis quand (ce soir, demain, lundi, dans une semaine) ou donne une date.", 400);
    }
  }
  if (jusqua.getTime() <= maintenant.getTime()) throw new ErreurMetier("La date de retour est déjà passée : choisis un moment à venir.", 400);
  return jusqua;
}

/* ── État d'une réponse (pour « Annuler ») ─────────────────────────────── */

type EtatReponse = {
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

type Precedent = { avant: EtatReponse; reponse: ReponseTache; le: string; effet: { cle: string } | null };

function etatDe(t: TacheAFaire): EtatReponse {
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

const date = (iso: string | null) => (iso ? new Date(iso) : null);

/* ── Effets sur la source ──────────────────────────────────────────────── */

type Effet =
  | { genre: "PROPOSITION"; propositionId: string; decision: "VALIDER" | "REJETER" }
  | { genre: "MAIL_ARCHIVER"; messageId: string }
  | { genre: "MAIL_REPORTER"; messageId: string; jusqua: string }
  | { genre: "ESPACE"; dossierId: string; evenement: "REPONSE_INUTILE" | "REPONDU_HORS_CRM" }
  | { genre: "DERNIER_CONTACT"; leadId: string }
  | { genre: "PERTE_LEAD"; leadId: string; motifPerte: MotifPerte; precision: string | null }
  | { genre: "PERTE_DOSSIER"; dossierId: string; motifPerte: MotifPerte; precision: string | null };

/** Ce que l'effet a changé et que « Annuler » sait défaire. */
type Inverse =
  | { genre: "MAIL_DESARCHIVER"; messageId: string }
  | { genre: "MAIL_SNOOZE"; messageId: string; avant: string | null }
  | { genre: "ESPACE"; dossierId: string; messagesLus: string[]; evenementId: string }
  | { genre: "DERNIER_CONTACT"; leadId: string; le: string }
  | { genre: "STATUT_LEAD"; leadId: string; statut: string };

/** La charge d'une tâche de fond A_FAIRE_EFFET. */
export type ChargeEffet = { tacheId: string; reponse: ReponseTache; reponduLe: string; acteur: string; effets: Effet[] };

/** Le résultat rangé sur la tâche de fond (Tache.resultat) : relu par « Annuler ». */
export type ResultatEffet = { resume: string; faits: string[]; refus: string[]; inverses: Inverse[]; irreversibles: string[] };

type Decision = { reponse: ReponseTache; raison: string | null; jusqua: Date | null; motifPerte: MotifPerte | null; precisionPerte: string | null };

/** Les effets d'une réponse, d'après ce que la tâche désigne (proposition, mails, messages d'espace, lead, dossier). */
function effetsDe(tache: TacheAFaire, decision: Decision): Effet[] {
  const raccourci = lireObjet(tache.raccourci);
  const donnees = lireObjet(tache.donnees);
  const effets: Effet[] = [];
  const { reponse } = decision;
  const propositionId = texteOuNull(donnees.propositionId) ?? texteOuNull(raccourci.propositionId);
  if (propositionId) {
    // Une proposition née d'un mail : c'est elle qu'on décide, le fil suit son propre cours.
    if (reponse !== "PLUS_TARD") effets.push({ genre: "PROPOSITION", propositionId, decision: reponse === "FAIT" ? "VALIDER" : "REJETER" });
  } else {
    for (const messageId of messagesDeLaTache(raccourci, donnees)) {
      if (reponse === "PLUS_TARD") effets.push({ genre: "MAIL_REPORTER", messageId, jusqua: decision.jusqua!.toISOString() });
      else effets.push({ genre: "MAIL_ARCHIVER", messageId });
    }
  }
  const depuisLEspace = tache.type === "REPONDRE" && (tache.source === "ESPACE_MESSAGES" || raccourci.genre === "ESPACE");
  const espaceDossierId = texteOuNull(donnees.espaceDossierId) ?? (depuisLEspace ? tache.dossierId : null);
  if (espaceDossierId && reponse !== "PLUS_TARD") effets.push({ genre: "ESPACE", dossierId: espaceDossierId, evenement: reponse === "FAIT" ? "REPONDU_HORS_CRM" : "REPONSE_INUTILE" });
  if (reponse === "FAIT" && (tache.type === "APPELER" || tache.type === "RAPPELER") && tache.leadId) effets.push({ genre: "DERNIER_CONTACT", leadId: tache.leadId });
  if (reponse === "PAS_A_FAIRE" && decision.raison === "CLIENT_PERDU" && decision.motifPerte) {
    if (tache.dossierId) effets.push({ genre: "PERTE_DOSSIER", dossierId: tache.dossierId, motifPerte: decision.motifPerte, precision: decision.precisionPerte });
    else if (tache.leadId) effets.push({ genre: "PERTE_LEAD", leadId: tache.leadId, motifPerte: decision.motifPerte, precision: decision.precisionPerte });
  }
  return effets;
}

/** La clé du prochain effet de cette tâche : `a-faire-effet:<id>:<n>` (unique : une réponse annulée puis refaite en a une autre). */
async function prochaineCleEffet(tacheId: string): Promise<string> {
  const prefixe = `a-faire-effet:${tacheId}:`;
  return `${prefixe}${(await prisma.tache.count({ where: { cle: { startsWith: prefixe } } })) + 1}`;
}

const estErreurMetier = (erreur: unknown): erreur is Error => erreur instanceof ErreurMetier || (erreur instanceof Error && erreur.name === "ErreurMetier");
const messageDe = (erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur));
const STATUTS_LEAD_RESTAURABLES = ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE"];

async function appliquerEffet(effet: Effet, contexte: { tacheId: string; reponduLe: Date }, sortie: ResultatEffet): Promise<void> {
  switch (effet.genre) {
    case "PROPOSITION": {
      if (effet.decision === "VALIDER") {
        const { appliquerProposition } = await import("@/lib/mail/appliquer");
        const vue = await appliquerProposition(effet.propositionId);
        sortie.faits.push(vue.statut === "EXECUTEE" ? "proposition validée et exécutée" : "proposition validée");
        sortie.irreversibles.push("la proposition validée ne se défait pas d'ici");
      } else {
        const { rejeterProposition } = await import("@/lib/validation/service");
        await rejeterProposition(effet.propositionId, { motif: "INUTILE" });
        sortie.faits.push("proposition ignorée");
        sortie.irreversibles.push("la proposition reste ignorée (un rejet est définitif)");
      }
      return;
    }
    case "MAIL_ARCHIVER": {
      const message = await prisma.message.findUnique({ where: { id: effet.messageId }, select: { canal: true, filCanal: true } });
      if (!message) throw new ErreurMetier("Mail introuvable.", 404);
      const ouverts = await prisma.message.count({ where: { ...(message.filCanal ? { canal: message.canal, filCanal: message.filCanal } : { id: effet.messageId }), traiteLe: null } });
      const { archiverFil } = await import("@/lib/mail/boite");
      await archiverFil(effet.messageId);
      sortie.faits.push("fil archivé");
      if (ouverts > 0) sortie.inverses.push({ genre: "MAIL_DESARCHIVER", messageId: effet.messageId });
      return;
    }
    case "MAIL_REPORTER": {
      const message = await prisma.message.findUnique({ where: { id: effet.messageId }, select: { snoozeJusqua: true } });
      if (!message) throw new ErreurMetier("Mail introuvable.", 404);
      const { snoozer } = await import("@/lib/mail/v2");
      const jusqua = new Date(effet.jusqua);
      await snoozer(effet.messageId, jusqua);
      sortie.faits.push(`fil reporté au ${jourMois(jusqua)}`);
      sortie.inverses.push({ genre: "MAIL_SNOOZE", messageId: effet.messageId, avant: message.snoozeJusqua?.toISOString() ?? null });
      return;
    }
    case "ESPACE": {
      // Rejouée (nouvel essai de la file), l'étape ne double pas l'événement.
      const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId: effet.dossierId, type: effet.evenement, metadata: { contains: `"reponduLe":"${contexte.reponduLe.toISOString()}"` } }, select: { id: true } });
      if (deja) return;
      const nonLus = await prisma.messageEspace.findMany({ where: { dossierId: effet.dossierId, auteur: "CLIENT", luLe: null }, select: { id: true } });
      const { marquerMessagesLus } = await import("@/lib/espace/messages");
      await marquerMessagesLus(effet.dossierId);
      const evenement = await prisma.dossierEvenement.create({
        data: {
          dossierId: effet.dossierId,
          type: effet.evenement,
          direction: "INTERNE",
          contenu: effet.evenement === "REPONSE_INUTILE" ? "Message de l'espace : pas de réponse à faire (depuis Tâches)" : "Message de l'espace : répondu hors du CRM (depuis Tâches)",
          metadata: JSON.stringify({ tacheId: contexte.tacheId, reponduLe: contexte.reponduLe.toISOString(), messagesLus: nonLus.map((m) => m.id) }),
        },
        select: { id: true },
      });
      const { recalculerMain } = await import("@/lib/dossiers/main");
      await recalculerMain(effet.dossierId);
      sortie.faits.push(nonLus.length ? "messages de l'espace marqués lus" : "réponse notée sur le dossier");
      sortie.inverses.push({ genre: "ESPACE", dossierId: effet.dossierId, messagesLus: nonLus.map((m) => m.id), evenementId: evenement.id });
      return;
    }
    case "DERNIER_CONTACT": {
      const { count } = await prisma.lead.updateMany({ where: { id: effet.leadId, dernierContactLe: null }, data: { dernierContactLe: contexte.reponduLe } });
      if (count === 1) {
        sortie.faits.push("contact noté sur la fiche");
        sortie.inverses.push({ genre: "DERNIER_CONTACT", leadId: effet.leadId, le: contexte.reponduLe.toISOString() });
      }
      return;
    }
    case "PERTE_LEAD": {
      const lead = await prisma.lead.findUnique({ where: { id: effet.leadId }, select: { statut: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
      if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
      if (lead.dossiers[0]) {
        await appliquerEffet({ genre: "PERTE_DOSSIER", dossierId: lead.dossiers[0].id, motifPerte: effet.motifPerte, precision: effet.precision }, contexte, sortie);
        return;
      }
      if (lead.statut === "PERDU") return;
      const { modifierEntrant } = await import("@/lib/prospects/entrants");
      await modifierEntrant(effet.leadId, { statut: "PERDU", motifPerte: effet.motifPerte, motif: effet.precision });
      sortie.faits.push("contact classé sans suite");
      if (STATUTS_LEAD_RESTAURABLES.includes(lead.statut)) sortie.inverses.push({ genre: "STATUT_LEAD", leadId: effet.leadId, statut: lead.statut });
      else sortie.irreversibles.push("le contact reste sans suite (son statut d'avant ne se remet pas à la main)");
      return;
    }
    case "PERTE_DOSSIER": {
      const { changerEtape } = await import("@/lib/dossiers/transitions");
      await changerEtape(effet.dossierId, { vers: "PERDU", motifPerte: effet.motifPerte, ...(effet.precision ? { perteCommentaire: effet.precision } : {}) });
      sortie.faits.push("dossier passé perdu");
      sortie.irreversibles.push("le dossier reste perdu : reprends-le depuis son étape si besoin");
      return;
    }
  }
}

/**
 * L'exécution d'une tâche de fond A_FAIRE_EFFET. Relit la tâche : une réponse annulée ou remplacée depuis n'a plus
 * d'effet. Chaque effet est tenté ; un refus métier (proposition déjà décidée, étape déjà atteinte) est noté sans
 * arrêter les autres ; une autre erreur fait réessayer la file (les effets déjà faits ne se doublent pas).
 */
export async function executerEffet(chargeBrute: unknown): Promise<ResultatEffet> {
  const charge = chargeBrute as Partial<ChargeEffet>;
  const vide = (resume: string): ResultatEffet => ({ resume, faits: [], refus: [], inverses: [], irreversibles: [] });
  if (!charge?.tacheId || !Array.isArray(charge.effets) || !charge.reponduLe) return vide("Charge illisible : rien à faire.");
  const tache = await prisma.tacheAFaire.findUnique({ where: { id: charge.tacheId }, select: { id: true, reponse: true, reponduLe: true, titre: true } });
  if (!tache) return vide("Tâche introuvable : rien à faire.");
  if (tache.reponse !== charge.reponse || tache.reponduLe?.toISOString() !== charge.reponduLe) return vide("Réponse annulée ou remplacée : effet abandonné.");
  const acteur = typeof charge.acteur === "string" && acteurValide(charge.acteur) ? charge.acteur : ACTEUR_TACHES;
  const reponduLe = new Date(charge.reponduLe);
  const sortie = vide("");
  await avecActeur({ acteur, origine: `a-faire:effet ${tache.id}` }, async () => {
    for (const effet of charge.effets!) {
      try {
        await appliquerEffet(effet, { tacheId: tache.id, reponduLe }, sortie);
      } catch (erreur) {
        if (!estErreurMetier(erreur)) throw erreur;
        sortie.refus.push(messageDe(erreur));
      }
    }
  });
  await signalerChangementTaches();
  sortie.resume = `${tache.titre} : ${[...sortie.faits, ...sortie.refus.map((r) => `refusé (${r})`)].join(", ") || "rien à changer"}.`;
  return sortie;
}

/* ── Répondre ──────────────────────────────────────────────────────────── */

export type ResultatReponse = { tache: TacheVue; effet: { cle: string; apres: string } | null; regle: { propositionId: string; creee: boolean } | null };

/** Écrit une réponse (avec l'état d'avant) puis met son effet en file (dans 6 s). La tâche doit être encore ouverte. */
async function enregistrerReponse(
  tache: TacheAFaire,
  donnees: { statut: StatutTache; reponse: ReponseTache; reponseRaison: string | null; reponseTexte: string | null; plusTardJusqua: Date | null; dureeReelleSec: number | null },
  effets: Effet[],
  acteur: string,
  maintenant: Date
): Promise<{ ligne: TacheAFaire; effet: { cle: string; apres: Date } | null }> {
  const cle = effets.length ? await prochaineCleEffet(tache.id) : null;
  const precedent: Precedent = { avant: etatDe(tache), reponse: donnees.reponse, le: maintenant.toISOString(), effet: cle ? { cle } : null };
  const { count } = await prisma.tacheAFaire.updateMany({
    where: { id: tache.id, statut: tache.statut, updatedAt: tache.updatedAt },
    data: { ...donnees, reponduLe: maintenant, reponduPar: acteur, revenueLe: null, precedent: JSON.stringify(precedent) },
  });
  if (count !== 1) throw new ErreurMetier("Cette tâche vient de changer : recharge la liste.", 409);
  let effet: { cle: string; apres: Date } | null = null;
  if (cle) {
    const apres = new Date(maintenant.getTime() + DELAI_EFFET_MS);
    const charge: ChargeEffet = { tacheId: tache.id, reponse: donnees.reponse, reponduLe: maintenant.toISOString(), acteur, effets };
    await mettreEnFile({ type: TYPE_TACHE_EFFET, cle, charge, apres, tentativesMax: 5 });
    effet = { cle, apres };
  }
  return { ligne: await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: tache.id } }), effet };
}

async function tacheOuverte(id: string): Promise<TacheAFaire> {
  const tache = await prisma.tacheAFaire.findUnique({ where: { id } });
  if (!tache || tache.archiveLe) throw new ErreurMetier("Tâche introuvable.", 404);
  if (tache.statut !== "A_FAIRE" && tache.statut !== "PLUS_TARD") {
    throw new ErreurMetier(`Cette tâche est déjà ${tache.statut === "FAITE" ? "faite" : "écartée"} : « Annuler » d'abord pour y répondre autrement.`, 409);
  }
  return tache;
}

/**
 * « Fait », « Plus tard » ou « Pas à faire ». Rend la tâche à jour, l'effet programmé (clé et départ) et, après un
 * « Pas à faire », la règle proposée si la même raison revient pour la troisième fois en 30 jours.
 */
export async function repondreTache(id: string, entree: EntreeReponse, maintenant: Date = new Date()): Promise<ResultatReponse> {
  const e = analyser(schemaReponse, entree);
  const tache = await tacheOuverte(id);
  const type = tache.type as TypeTache;
  const { acteur } = await resoudreContexte();
  const texte = e.texte?.trim() || null;
  let decision: Decision;
  let colonnes: Parameters<typeof enregistrerReponse>[1];
  switch (e.reponse) {
    case "FAIT":
      decision = { reponse: "FAIT", raison: null, jusqua: null, motifPerte: null, precisionPerte: null };
      colonnes = { statut: "FAITE", reponse: "FAIT", reponseRaison: null, reponseTexte: texte, plusTardJusqua: null, dureeReelleSec: dureeReelle(tache.commenceLe, maintenant) ?? tache.dureeReelleSec };
      break;
    case "PLUS_TARD": {
      const raison = e.raison?.trim() || null;
      if (raison && !(RAISONS_PLUS_TARD as readonly string[]).includes(raison)) throw new ErreurMetier(`Raison invalide pour « Plus tard » : ${RAISONS_PLUS_TARD.join(", ")}.`, 400);
      const jusqua = jusquaPlusTard({ quand: e.quand, date: e.date }, maintenant);
      decision = { reponse: "PLUS_TARD", raison, jusqua, motifPerte: null, precisionPerte: null };
      colonnes = { statut: "PLUS_TARD", reponse: "PLUS_TARD", reponseRaison: raison, reponseTexte: texte, plusTardJusqua: jusqua, dureeReelleSec: tache.dureeReelleSec };
      break;
    }
    case "PAS_A_FAIRE": {
      const permises = raisonsPasAFaire(type);
      const raison = e.raison?.trim() as RaisonPasAFaire | undefined;
      if (!raison || !permises.includes(raison)) {
        throw new ErreurMetier(`« Pas à faire » : choisis la raison (${permises.map((r) => LIBELLES_RAISON_PAS_A_FAIRE[r].toLowerCase()).join(", ")}).`, 400);
      }
      if (raison === "AUTRE" && (texte?.length ?? 0) < 3) throw new ErreurMetier("« Autre » : précise la raison en quelques mots.", 400);
      let motifPerte: MotifPerte | null = null;
      const precisionPerte = e.precisionPerte?.trim() || null;
      if (raison === "CLIENT_PERDU") {
        verifierMotifPerte(e.motifPerte ?? null, precisionPerte, "Client perdu : motif de perte obligatoire");
        motifPerte = e.motifPerte!;
      }
      decision = { reponse: "PAS_A_FAIRE", raison, jusqua: null, motifPerte, precisionPerte };
      colonnes = {
        statut: "PAS_A_FAIRE",
        reponse: "PAS_A_FAIRE",
        reponseRaison: raison,
        reponseTexte: texte ?? (motifPerte ? motifPerteDansUnePhrase(motifPerte, precisionPerte) : null),
        plusTardJusqua: null,
        dureeReelleSec: tache.dureeReelleSec,
      };
      break;
    }
  }
  const { ligne, effet } = await enregistrerReponse(tache, colonnes, effetsDe(tache, decision), acteur, maintenant);
  const regle = decision.reponse === "PAS_A_FAIRE" && decision.raison ? await proposerRegleSiBesoin(type, decision.raison, maintenant) : null;
  await signalerChangementTaches();
  return { tache: versVue(ligne), effet: effet ? { cle: effet.cle, apres: effet.apres.toISOString() } : null, regle };
}

/* ── Annuler ───────────────────────────────────────────────────────────── */

export type ResultatAnnulation = { tache: TacheVue; effetAnnule: boolean; defaits: string[]; nonDefaits: string[] };

async function defaire(inverse: Inverse, maintenant: Date): Promise<string> {
  switch (inverse.genre) {
    case "MAIL_DESARCHIVER": {
      const { archiverFil } = await import("@/lib/mail/boite");
      await archiverFil(inverse.messageId, false);
      return "fil désarchivé";
    }
    case "MAIL_SNOOZE": {
      const v2 = await import("@/lib/mail/v2");
      if (inverse.avant) await v2.snoozer(inverse.messageId, new Date(inverse.avant));
      else await v2.annulerSnooze(inverse.messageId);
      return "report du fil annulé";
    }
    case "ESPACE": {
      if (inverse.messagesLus.length) await prisma.messageEspace.updateMany({ where: { id: { in: inverse.messagesLus } }, data: { luLe: null } });
      await prisma.dossierEvenement.update({ where: { id: inverse.evenementId }, data: { archiveLe: maintenant, archiveMotif: "Réponse annulée depuis Tâches" } });
      const { recalculerMain } = await import("@/lib/dossiers/main");
      await recalculerMain(inverse.dossierId);
      return inverse.messagesLus.length ? "messages de l'espace remis non lus" : "réponse retirée du dossier";
    }
    case "DERNIER_CONTACT":
      await prisma.lead.updateMany({ where: { id: inverse.leadId, dernierContactLe: new Date(inverse.le) }, data: { dernierContactLe: null } });
      return "contact retiré de la fiche";
    case "STATUT_LEAD": {
      const { modifierEntrant } = await import("@/lib/prospects/entrants");
      await modifierEntrant(inverse.leadId, { statut: inverse.statut as "NOUVEAU" | "DEVIS_DEMANDE" | "CONTACTE" });
      return "contact remis dans les listes";
    }
  }
}

async function annuler(id: string, maintenant: Date, signaler: boolean): Promise<ResultatAnnulation> {
  const tache = await prisma.tacheAFaire.findUnique({ where: { id } });
  if (!tache || tache.archiveLe) throw new ErreurMetier("Tâche introuvable.", 404);
  const precedent = lireObjet(tache.precedent) as Partial<Precedent>;
  if (!precedent.avant) throw new ErreurMetier("Rien à annuler sur cette tâche.", 409);
  const avant = precedent.avant;
  // L'état d'abord : un effet qui partirait maintenant verra la réponse annulée et ne fera rien (executerEffet).
  const ligne = await prisma.tacheAFaire.update({
    where: { id },
    data: {
      statut: avant.statut,
      reponse: avant.reponse,
      reponseRaison: avant.reponseRaison,
      reponseTexte: avant.reponseTexte,
      reponduLe: date(avant.reponduLe),
      reponduPar: avant.reponduPar,
      plusTardJusqua: date(avant.plusTardJusqua),
      revenueLe: date(avant.revenueLe),
      dureeReelleSec: avant.dureeReelleSec,
      precedent: null,
    },
  });
  const defaits: string[] = [];
  const nonDefaits: string[] = [];
  let effetAnnule = false;
  const file = precedent.effet?.cle ? await prisma.tache.findUnique({ where: { cle: precedent.effet.cle } }) : null;
  if (file) {
    if (file.statut === "EN_ATTENTE" || file.statut === "ECHEC_DEFINITIF") {
      try {
        await annulerTache(file.id);
        effetAnnule = true;
      } catch {
        nonDefaits.push("l'effet venait de partir : relance « Annuler » dans un instant");
      }
    } else if (file.statut === "EN_COURS") {
      nonDefaits.push("l'effet est en train de s'exécuter : il s'arrêtera de lui-même (réponse annulée) ou sera à défaire à la main");
    } else if (file.statut === "TERMINEE") {
      const resultat = lireObjet(file.resultat) as Partial<ResultatEffet>;
      for (const inverse of resultat.inverses ?? []) {
        try {
          defaits.push(await defaire(inverse, maintenant));
        } catch (erreur) {
          nonDefaits.push(`${inverse.genre.toLowerCase().replace(/_/g, " ")} : ${messageDe(erreur)}`);
        }
      }
      nonDefaits.push(...(resultat.irreversibles ?? []));
    }
  }
  if (signaler) await signalerChangementTaches();
  return { tache: versVue(ligne), effetAnnule, defaits, nonDefaits };
}

/**
 * « Annuler » : remet l'état d'avant la dernière réponse ; annule l'effet encore en attente dans la file, sinon défait
 * ce qui peut l'être (fil désarchivé, report annulé, messages remis non lus, contact retiré, statut du contact remis) et
 * dit ce qui ne peut pas l'être (proposition validée, dossier perdu).
 */
export function annulerReponse(id: string, maintenant: Date = new Date()): Promise<ResultatAnnulation> {
  return annuler(id, maintenant, true);
}

/* ── Ajouter une tâche à la main ───────────────────────────────────────── */

/** Un identifiant du genre cuid (horodatage + aléa) pour la clé `MANUELLE:<id>`. */
function nouvelIdentifiant(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

function echeanceDe(texte: string | null | undefined): Date | null {
  if (!texte) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte)) {
    if (!estJourValide(texte)) throw new ErreurMetier("Échéance invalide (AAAA-MM-JJ).", 400);
    return dateDepuisJour(texte);
  }
  const d = new Date(texte);
  if (Number.isNaN(d.getTime())) throw new ErreurMetier("Échéance invalide (AAAA-MM-JJ ou date ISO).", 400);
  return d;
}

/**
 * Une tâche à moi (MANUELLE), dite par Lucas ou Claude : niveau 3, 5 minutes, clé `MANUELLE:<id>`, sujet déduit de la
 * cible (dossier, sinon lead, sinon client, sinon aucun). Jamais cochée par absence ; `condition` (facultative) est lue
 * par le détecteur MANUELLE (detecteurs/manuelles.ts › acheves).
 */
export async function ajouterTache(entree: EntreeAjout, maintenant: Date = new Date()): Promise<TacheVue> {
  const e = analyser(schemaAjout, entree);
  const dossierId = e.dossierId || null;
  let leadId = e.leadId || null;
  let clientId = e.clientId || null;
  if (dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { archiveLe: true, leadId: true, clientId: true } });
    if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
    leadId ??= dossier.leadId;
    clientId ??= dossier.clientId;
  }
  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { archiveLe: true, clientId: true } });
    if (!lead || lead.archiveLe) throw new ErreurMetier("Contact introuvable ou archivé.", 404);
    clientId ??= lead.clientId;
  }
  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new ErreurMetier("Fiche client introuvable.", 404);
  }
  const sujet = dossierId ? { type: "DOSSIER", id: dossierId } : leadId ? { type: "LEAD", id: leadId } : clientId ? { type: "CLIENT", id: clientId } : { type: "SYSTEME", id: null };
  const raccourci: Raccourci = dossierId
    ? { genre: "DOSSIER", libelle: "Ouvrir le dossier", dossierId, href: `/dossiers?dossier=${dossierId}` }
    : leadId
      ? { genre: "LEAD", libelle: "Ouvrir la fiche", leadId, href: `/leads?lead=${leadId}` }
      : clientId
        ? { genre: "PAGE", libelle: "Ouvrir la fiche client", href: `/clients/${clientId}` }
        : { genre: "PAGE", libelle: "Faire", href: null };
  const ligne = await prisma.tacheAFaire.create({
    data: {
      cle: `MANUELLE:${nouvelIdentifiant()}`,
      type: "MANUELLE",
      source: "MANUELLE",
      sujetType: sujet.type,
      sujetId: sujet.id,
      leadId,
      dossierId,
      clientId,
      titre: e.titre,
      raison: e.raison?.trim() || "ajoutée à la main",
      niveau: 3,
      montant: null,
      depuis: maintenant,
      echeance: echeanceDe(e.echeance),
      dureeMin: dureeDe("MANUELLE", await dureesMesurees()),
      raccourci: jsonStable(raccourci),
      donnees: jsonStable(e.condition ? { condition: e.condition } : {}),
      statut: "A_FAIRE",
      detecteLe: maintenant,
    },
  });
  await signalerChangementTaches();
  return versVue(ligne);
}

/* ── Les lots : « Tout classer » ───────────────────────────────────────── */

export type ResultatLot = { classees: number; effets: number };

/**
 * « Tout classer » : chaque tâche à faire du lot passe « Pas à faire » (CLASSE_EN_LOT) ; un ancien contact
 * (CLASSER_LEAD) est classé sans suite, motif « plus de réponse », par la même file d'effets. Annulable (annulerLot).
 */
export async function classerLot(lot: string, maintenant: Date = new Date()): Promise<ResultatLot> {
  const taches = await prisma.tacheAFaire.findMany({ where: { lot, statut: "A_FAIRE" } });
  if (taches.length === 0) throw new ErreurMetier("Rien à classer dans ce lot.", 404);
  const { acteur } = await resoudreContexte();
  let effets = 0;
  for (const tache of taches) {
    const perte: Effet[] = tache.type === "CLASSER_LEAD" && tache.leadId ? [{ genre: "PERTE_LEAD", leadId: tache.leadId, motifPerte: "SANS_REPONSE", precision: MOTIF_CLASSEMENT_LOT }] : [];
    try {
      const { effet } = await enregistrerReponse(
        tache,
        { statut: "PAS_A_FAIRE", reponse: "PAS_A_FAIRE", reponseRaison: "CLASSE_EN_LOT", reponseTexte: MOTIF_CLASSEMENT_LOT, plusTardJusqua: null, dureeReelleSec: tache.dureeReelleSec },
        perte,
        acteur,
        maintenant
      );
      if (effet) effets++;
    } catch (erreur) {
      // Une tâche qui vient de changer (cochée par le CRM entre-temps) reste comme elle est.
      if (!estErreurMetier(erreur)) throw erreur;
    }
  }
  await signalerChangementTaches();
  return { classees: taches.length, effets };
}

/** Défait « Tout classer » : chaque tâche classée en lot revient comme avant, et son effet est annulé ou défait. */
export async function annulerLot(lot: string, maintenant: Date = new Date()): Promise<{ restaurees: number; nonDefaits: string[] }> {
  const taches = await prisma.tacheAFaire.findMany({ where: { lot, statut: "PAS_A_FAIRE", reponseRaison: "CLASSE_EN_LOT", precedent: { not: null } }, select: { id: true } });
  const nonDefaits = new Set<string>();
  for (const t of taches) {
    const resultat = await annuler(t.id, maintenant, false);
    for (const n of resultat.nonDefaits) nonDefaits.add(n);
  }
  await signalerChangementTaches();
  return { restaurees: taches.length, nonDefaits: [...nonDefaits] };
}

/* ── Apprentissage ─────────────────────────────────────────────────────── */

/**
 * Après un « Pas à faire » : la troisième réponse de même type et même raison en 30 jours (par Lucas ou Claude, hors
 * « plus d'actualité » et « classé en lot ») propose une règle (REGLE_TACHE) — une seule fois (clé d'unicité), et pas
 * si une règle active existe déjà pour ce type et cette raison. Proposée au nom du CRM.
 */
export async function proposerRegleSiBesoin(type: TypeTache, raison: string, maintenant: Date): Promise<{ propositionId: string; creee: boolean } | null> {
  if (RAISONS_SANS_APPRENTISSAGE.includes(raison) || !(TYPES_TACHE as readonly string[]).includes(type)) return null;
  const nombre = await prisma.tacheAFaire.count({
    where: { type, reponse: "PAS_A_FAIRE", reponseRaison: raison, reponduLe: { gte: new Date(maintenant.getTime() - FENETRE_APPRENTISSAGE_JOURS * JOUR) }, NOT: { reponduPar: { startsWith: "SYSTEME:" } } },
  });
  if (nombre < SEUIL_APPRENTISSAGE) return null;
  const existante = await prisma.regleTache.findFirst({ where: { type, raison }, select: { id: true } });
  if (existante) return null;
  const { proposer } = await import("@/lib/validation/service");
  const libelle = libelleRegle(type, raison);
  const { id, creee } = await avecActeur({ acteur: ACTEUR_TACHES, origine: "a-faire:apprentissage" }, () =>
    proposer({
      type: TYPE_REGLE_TACHE,
      titre: libelle,
      resume: `${nombre} « Pas à faire » en 30 jours sur « ${ACTIONS_TYPE[type]} », raison « ${LIBELLES_RAISON_PAS_A_FAIRE[raison as RaisonPasAFaire] ?? raison} ».`,
      contenu: { type, raison, effet: "ATTENDRE", delaiJours: 3, reponses: nombre },
      cleUnicite: `regle-tache:${type}:${raison}`,
    })
  );
  return { propositionId: id, creee };
}
