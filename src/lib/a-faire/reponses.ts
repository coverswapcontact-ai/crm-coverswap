import { randomBytes } from "node:crypto";
import type { TacheAFaire } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { aHeureParis } from "@/lib/commercial/quand";
import { MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import { jour } from "@/lib/commun/format";
import { dateDepuisJour, estJourValide, jourParis } from "@/lib/dossiers/dates";
import { motifPerteDansUnePhrase, verifierMotifPerte } from "@/lib/dossiers/perte";
import { resoudreContexte } from "@/lib/journal/acteur";
import { acteurValide, avecActeur } from "@/lib/journal/contexte";
import { annulerTache, mettreEnFile } from "@/lib/taches/file";
import { jourMois } from "./achevement";
import { dureeDe, dureeReelle, dureesMesurees } from "./durees";
import { dateOuNull, etatDe, lirePrecedent, type Precedent, type ProgressionEffet } from "./etat";
import { jsonStable, lireObjet, messagesDeLaTache, texteOuNull } from "./json";
import { filtreDuLot, versVue } from "./lecture";
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
/**
 * Mission 17 (partie A, relecture) : ces raisons n'apprennent rien sur le TYPE de tâche — « client perdu » porte sur un
 * client, « autre » est un texte libre ; « plus d'actualité » et « classé en lot » ne sont pas des choix un par un.
 */
const RAISONS_SANS_APPRENTISSAGE = ["SUJET_DISPARU", "CLASSE_EN_LOT", "CLIENT_PERDU", "AUTRE"];
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

/* ── Effets sur la source ──────────────────────────────────────────────── */

type Effet =
  /** `motif` : le motif du rejet (DEJA_FAIT, INUTILE) ; une validation ne part que d'une tâche VALIDER. */
  | { genre: "PROPOSITION"; propositionId: string; decision: "VALIDER" | "REJETER"; motif?: string }
  | { genre: "MAIL_ARCHIVER"; messageId: string }
  | { genre: "MAIL_REPORTER"; messageId: string; jusqua: string }
  | { genre: "ESPACE"; dossierId: string; evenement: "REPONSE_INUTILE" | "REPONDU_HORS_CRM" }
  /** Charges mises en file avant la relecture : « Fait » sur APPELER/RAPPELER posait le dernier contact écrit. */
  | { genre: "DERNIER_CONTACT"; leadId: string }
  /** Mission 17 (partie A, relecture) : « Fait » sur APPELER/RAPPELER note un appel (`dernierAppelLe`), pas un contact écrit. */
  | { genre: "DERNIER_APPEL"; leadId: string }
  /** Mission 17 (partie A, relecture) : « Fait » ou « Pas à faire » sur PROCHAINE_ACTION lève l'action posée à la main. */
  | { genre: "LEVER_ACTION"; dossierId: string; poseeLe: string }
  /** `enLot` : classé depuis « Tout classer » — jamais redirigé vers le dossier du contact (refusé s'il en a un). */
  | { genre: "PERTE_LEAD"; leadId: string; motifPerte: MotifPerte; precision: string | null; enLot?: boolean }
  | { genre: "PERTE_DOSSIER"; dossierId: string; motifPerte: MotifPerte; precision: string | null };

/** Ce que l'effet a changé et que « Annuler » sait défaire. */
type Inverse =
  | { genre: "MAIL_DESARCHIVER"; messageId: string }
  | { genre: "MAIL_SNOOZE"; messageId: string; avant: string | null }
  | { genre: "ESPACE"; dossierId: string; messagesLus: string[]; evenementId: string }
  | { genre: "DERNIER_CONTACT"; leadId: string; le: string; avant?: string | null }
  | { genre: "DERNIER_APPEL"; leadId: string; le: string; avant: string | null }
  | { genre: "ACTION_MANUELLE"; dossierId: string; avant: ActionAvant }
  | { genre: "STATUT_LEAD"; leadId: string; statut: string };

/** La prochaine action d'un dossier telle qu'elle était avant d'être levée (pour « Annuler »). */
type ActionAvant = {
  prochaineAction: string | null;
  prochaineActionDate: string | null;
  prochaineActionInstant: string | null;
  prochaineActionManuelle: string | null;
  prochaineActionManuelleLe: string | null;
  prochaineActionPar: string | null;
};

/** Mission 17 (partie A, relecture) : ce que « Annuler » n'a pas pu défaire, dit en français (jamais un code). */
const LIBELLES_INVERSE: Record<Inverse["genre"], string> = {
  MAIL_DESARCHIVER: "fil à désarchiver",
  MAIL_SNOOZE: "report du fil à annuler",
  ESPACE: "messages de l'espace à remettre non lus",
  DERNIER_CONTACT: "contact à retirer de la fiche",
  DERNIER_APPEL: "appel à retirer de la fiche",
  ACTION_MANUELLE: "prochaine action à remettre sur le dossier",
  STATUT_LEAD: "contact à remettre dans les listes",
};

/** La charge d'une tâche de fond A_FAIRE_EFFET. */
export type ChargeEffet = { tacheId: string; reponse: ReponseTache; reponduLe: string; acteur: string; effets: Effet[] };

/** Le résultat rangé sur la tâche de fond (Tache.resultat) : relu par « Annuler ». */
export type ResultatEffet = { resume: string; faits: string[]; refus: string[]; inverses: Inverse[]; irreversibles: string[] };

type Decision = { reponse: ReponseTache; raison: string | null; jusqua: Date | null; motifPerte: MotifPerte | null; precisionPerte: string | null };

const propositionDe = (raccourci: Record<string, unknown>, donnees: Record<string, unknown>) => texteOuNull(donnees.propositionId) ?? texteOuNull(raccourci.propositionId);

/**
 * Les effets d'une réponse, d'après ce que la tâche désigne (proposition, mails, messages d'espace, lead, dossier).
 *
 * Mission 17 (partie A, relecture) : seule une tâche VALIDER valide sa proposition sur « Fait » (et jamais une
 * proposition sensible : repondreTache le refuse avant). Sur toute autre tâche, une proposition attachée (brouillon de
 * réponse, SMS de relance…) n'est que REJETÉE — « Fait » : déjà fait autrement ; « Pas à faire » : inutile — et le
 * reste des effets (fil archivé, messages lus) s'applique comme sans proposition.
 */
/** Une proposition déjà décidée ailleurs (validée par l'outil MCP avant la réponse, ou dans « À valider ») : rien à mettre en file. */
async function sansPropositionsDecidees(effets: Effet[]): Promise<Effet[]> {
  const ids = effets.flatMap((e) => (e.genre === "PROPOSITION" ? [e.propositionId] : []));
  if (!ids.length) return effets;
  const enAttente = new Set((await prisma.proposition.findMany({ where: { id: { in: ids }, statut: "EN_ATTENTE" }, select: { id: true } })).map((p) => p.id));
  return effets.filter((e) => e.genre !== "PROPOSITION" || enAttente.has(e.propositionId));
}

function effetsDe(tache: TacheAFaire, decision: Decision): Effet[] {
  const raccourci = lireObjet(tache.raccourci);
  const donnees = lireObjet(tache.donnees);
  const effets: Effet[] = [];
  const { reponse } = decision;
  const propositionId = propositionDe(raccourci, donnees);
  const motifRejet = reponse === "FAIT" || decision.raison === "DEJA_FAIT" ? "DEJA_FAIT" : "INUTILE";
  if (tache.type === "VALIDER" && propositionId) {
    // La proposition est l'objet de la tâche : c'est elle qu'on décide, le fil d'où elle vient suit son propre cours.
    if (reponse !== "PLUS_TARD") effets.push(reponse === "FAIT" ? { genre: "PROPOSITION", propositionId, decision: "VALIDER" } : { genre: "PROPOSITION", propositionId, decision: "REJETER", motif: motifRejet });
  } else {
    if (propositionId && reponse !== "PLUS_TARD") effets.push({ genre: "PROPOSITION", propositionId, decision: "REJETER", motif: motifRejet });
    for (const messageId of messagesDeLaTache(raccourci, donnees)) {
      if (reponse === "PLUS_TARD") effets.push({ genre: "MAIL_REPORTER", messageId, jusqua: decision.jusqua!.toISOString() });
      else effets.push({ genre: "MAIL_ARCHIVER", messageId });
    }
  }
  const depuisLEspace = tache.type === "REPONDRE" && (tache.source === "ESPACE_MESSAGES" || raccourci.genre === "ESPACE");
  const espaceDossierId = texteOuNull(donnees.espaceDossierId) ?? (depuisLEspace ? tache.dossierId : null);
  if (espaceDossierId && reponse !== "PLUS_TARD") effets.push({ genre: "ESPACE", dossierId: espaceDossierId, evenement: reponse === "FAIT" ? "REPONDU_HORS_CRM" : "REPONSE_INUTILE" });
  if (reponse === "FAIT" && (tache.type === "APPELER" || tache.type === "RAPPELER") && tache.leadId) effets.push({ genre: "DERNIER_APPEL", leadId: tache.leadId });
  // L'action posée à la main est faite (ou n'a plus lieu d'être) : elle ne tient plus le dossier muet.
  const poseeLe = texteOuNull(donnees.poseeLe);
  if (reponse !== "PLUS_TARD" && tache.type === "PROCHAINE_ACTION" && tache.dossierId && poseeLe) effets.push({ genre: "LEVER_ACTION", dossierId: tache.dossierId, poseeLe });
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

/** Mission 17 (partie A, relecture) : ce qui est sensible (argent, client) passe par l'aperçu et la confirmation d'« À valider ». */
const REFUS_SENSIBLE = "proposition sensible (argent ou client) : valide-la depuis « À valider », avec son aperçu";

/** Une proposition encore à décider et sensible (définition du type ; type inconnu : sensible). */
async function propositionSensible(propositionId: string): Promise<boolean> {
  const proposition = await prisma.proposition.findUnique({ where: { id: propositionId } });
  if (!proposition || proposition.statut !== "EN_ATTENTE") return false;
  const { vueProposition } = await import("@/lib/validation/service");
  return vueProposition(proposition).sensible;
}

const estErreurMetier = (erreur: unknown): erreur is Error => erreur instanceof ErreurMetier || (erreur instanceof Error && erreur.name === "ErreurMetier");
const messageDe = (erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur));
const STATUTS_LEAD_RESTAURABLES = ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE"];

async function appliquerEffet(effet: Effet, contexte: { tacheId: string; reponduLe: Date }, sortie: ResultatEffet): Promise<void> {
  switch (effet.genre) {
    case "PROPOSITION": {
      if (effet.decision === "VALIDER") {
        // Garde (la réponse l'a déjà refusé) : une proposition sensible ne se valide jamais depuis Tâches.
        if (await propositionSensible(effet.propositionId)) throw new ErreurMetier(REFUS_SENSIBLE, 409);
        const { appliquerProposition } = await import("@/lib/mail/appliquer");
        const vue = await appliquerProposition(effet.propositionId);
        sortie.faits.push(vue.statut === "EXECUTEE" ? "proposition validée et exécutée" : "proposition validée");
        sortie.irreversibles.push("la proposition validée ne se défait pas d'ici");
      } else {
        const { rejeterProposition } = await import("@/lib/validation/service");
        await rejeterProposition(effet.propositionId, { motif: effet.motif ?? "INUTILE" });
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
      const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId: effet.dossierId, type: effet.evenement, metadata: { contains: `"reponduLe":"${contexte.reponduLe.toISOString()}"` } }, select: { id: true, metadata: true } });
      if (deja) {
        // Déjà fait par un essai précédent : l'inverse est reconstruit (« Annuler » doit pouvoir le défaire).
        const lus = lireObjet(deja.metadata).messagesLus;
        const messagesLus = Array.isArray(lus) ? lus.filter((id): id is string => typeof id === "string") : [];
        sortie.inverses.push({ genre: "ESPACE", dossierId: effet.dossierId, messagesLus, evenementId: deja.id });
        return;
      }
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
    case "DERNIER_APPEL": {
      // Le dernier appel avance (jamais ne recule) ; « Annuler » remet la date d'avant.
      const lead = await prisma.lead.findUnique({ where: { id: effet.leadId }, select: { dernierAppelLe: true } });
      if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
      const avant = lead.dernierAppelLe;
      if (avant && avant.getTime() >= contexte.reponduLe.getTime()) return;
      const { count } = await prisma.lead.updateMany({ where: { id: effet.leadId, dernierAppelLe: avant }, data: { dernierAppelLe: contexte.reponduLe } });
      if (count === 1) {
        sortie.faits.push("appel noté sur la fiche");
        sortie.inverses.push({ genre: "DERNIER_APPEL", leadId: effet.leadId, le: contexte.reponduLe.toISOString(), avant: avant?.toISOString() ?? null });
      }
      return;
    }
    case "LEVER_ACTION": {
      const dossier = await prisma.dossier.findUnique({
        where: { id: effet.dossierId },
        select: { prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true, prochaineActionManuelle: true, prochaineActionManuelleLe: true, prochaineActionPar: true },
      });
      if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
      // Reposée entre-temps (autre instant) : la nouvelle action tient, on n'y touche pas.
      if (dossier.prochaineActionManuelleLe?.toISOString() !== effet.poseeLe) return;
      // Le texte est encore celui posé à la main : l'action est faite, la prochaine action du dossier se vide (sinon un
      // rappel échu ferait naître « Rappeler » juste après « Fait »). Remplacé depuis : seul le « à la main » tombe.
      const memeTexte = dossier.prochaineAction === dossier.prochaineActionManuelle;
      const { count } = await prisma.dossier.updateMany({
        where: { id: effet.dossierId, prochaineActionManuelleLe: dossier.prochaineActionManuelleLe },
        data: { prochaineActionManuelle: null, prochaineActionManuelleLe: null, prochaineActionPar: null, ...(memeTexte ? { prochaineAction: null, prochaineActionDate: null, prochaineActionInstant: null } : {}) },
      });
      if (count !== 1) return;
      await apresChangementAction(effet.dossierId);
      sortie.faits.push(memeTexte ? "prochaine action retirée du dossier" : "prochaine action rendue au suivi normal");
      sortie.inverses.push({
        genre: "ACTION_MANUELLE",
        dossierId: effet.dossierId,
        avant: {
          prochaineAction: dossier.prochaineAction,
          prochaineActionDate: dossier.prochaineActionDate?.toISOString() ?? null,
          prochaineActionInstant: dossier.prochaineActionInstant?.toISOString() ?? null,
          prochaineActionManuelle: dossier.prochaineActionManuelle,
          prochaineActionManuelleLe: dossier.prochaineActionManuelleLe.toISOString(),
          prochaineActionPar: dossier.prochaineActionPar,
        },
      });
      return;
    }
    case "DERNIER_CONTACT": {
      // Le dernier contact avance (jamais ne recule) ; « Annuler » remet la date d'avant.
      const lead = await prisma.lead.findUnique({ where: { id: effet.leadId }, select: { dernierContactLe: true } });
      if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
      const avant = lead.dernierContactLe;
      if (avant && avant.getTime() >= contexte.reponduLe.getTime()) return;
      const { count } = await prisma.lead.updateMany({ where: { id: effet.leadId, dernierContactLe: avant }, data: { dernierContactLe: contexte.reponduLe } });
      if (count === 1) {
        sortie.faits.push("contact noté sur la fiche");
        sortie.inverses.push({ genre: "DERNIER_CONTACT", leadId: effet.leadId, le: contexte.reponduLe.toISOString(), avant: avant?.toISOString() ?? null });
      }
      return;
    }
    case "PERTE_LEAD": {
      const lead = await prisma.lead.findUnique({ where: { id: effet.leadId }, select: { statut: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
      if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
      if (lead.dossiers[0]) {
        // « Tout classer » ne touche jamais un dossier (étapes engageantes : jamais en lot).
        if (effet.enLot) throw new ErreurMetier("ce contact a un dossier : à classer depuis son dossier, pas en lot", 409);
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

/** Après un changement de la prochaine action d'un dossier : l'agenda suit, la main est recalculée. */
async function apresChangementAction(dossierId: string): Promise<void> {
  const [{ synchroniserRappel }, { recalculerMain }] = await Promise.all([import("@/lib/agenda/rappels"), import("@/lib/dossiers/main")]);
  await synchroniserRappel({ type: "DOSSIER", id: dossierId });
  await recalculerMain(dossierId);
}

const STATUT_DE_LA_REPONSE: Record<ReponseTache, StatutTache> = { FAIT: "FAITE", PLUS_TARD: "PLUS_TARD", PAS_A_FAIRE: "PAS_A_FAIRE" };

/** La réponse que porte la charge est-elle toujours celle de la tâche (ni annulée, ni remplacée, ni rouverte) ? */
function reponseTient(tache: Pick<TacheAFaire, "statut" | "reponse" | "reponduLe"> | null, charge: Pick<ChargeEffet, "reponse" | "reponduLe">): boolean {
  return Boolean(tache && tache.reponse === charge.reponse && tache.reponduLe?.toISOString() === charge.reponduLe && tache.statut === STATUT_DE_LA_REPONSE[charge.reponse]);
}

const progressionVide = (): ProgressionEffet => ({ faits: [], textes: [], refus: [], inverses: [], irreversibles: [] });

/**
 * L'exécution d'une tâche de fond A_FAIRE_EFFET. La tâche est relue avant CHAQUE effet : une réponse annulée,
 * remplacée ou rouverte (le client a écrit, la tâche est de nouveau « à faire ») n'a plus d'effet. Chaque effet est
 * tenté ; un refus métier (proposition déjà décidée, étape déjà atteinte) est noté sans arrêter les autres ; une autre
 * erreur fait réessayer la file.
 *
 * Mission 17 (partie A, relecture) : ce qui est fait est rangé au fil de l'eau sur la tâche (`precedent.progression`,
 * etat.ts) : un nouvel essai saute les effets déjà faits, et « Annuler » défait tout ce qui est rangé, même quand
 * l'effet n'est pas allé au bout. Le résumé ne cite ni titre ni nom (la file des tâches de fond est hors RGPD).
 */
export async function executerEffet(chargeBrute: unknown): Promise<ResultatEffet> {
  const charge = chargeBrute as Partial<ChargeEffet>;
  const vide = (resume: string): ResultatEffet => ({ resume, faits: [], refus: [], inverses: [], irreversibles: [] });
  if (!charge?.tacheId || !Array.isArray(charge.effets) || !charge.reponduLe || !charge.reponse) return vide("Charge illisible : rien à faire.");
  const lire = () => prisma.tacheAFaire.findUnique({ where: { id: charge.tacheId! }, select: { id: true, type: true, statut: true, reponse: true, reponduLe: true, precedent: true } });
  const tache = await lire();
  if (!tache) return vide("Tâche introuvable : rien à faire.");
  const reference = { reponse: charge.reponse, reponduLe: charge.reponduLe };
  if (!reponseTient(tache, reference)) return vide("Réponse annulée ou remplacée : effet abandonné.");
  const acteur = typeof charge.acteur === "string" && acteurValide(charge.acteur) ? charge.acteur : ACTEUR_TACHES;
  const reponduLe = new Date(charge.reponduLe);
  const dejaFaite = lirePrecedent(tache.precedent)?.progression ?? progressionVide();
  const progression: ProgressionEffet = { ...progressionVide(), ...dejaFaite };
  let interrompu = false;
  await avecActeur({ acteur, origine: `a-faire:effet ${tache.id}` }, async () => {
    for (const [index, effet] of charge.effets!.entries()) {
      if (progression.faits.includes(index)) continue;
      const courante = await lire();
      if (!reponseTient(courante, reference)) {
        interrompu = true;
        break;
      }
      const partie = vide("");
      try {
        await appliquerEffet(effet, { tacheId: tache.id, reponduLe }, partie);
      } catch (erreur) {
        if (!estErreurMetier(erreur)) throw erreur;
        partie.refus.push(messageDe(erreur));
      }
      progression.faits.push(index);
      progression.textes.push(...partie.faits);
      progression.refus.push(...partie.refus);
      progression.inverses.push(...partie.inverses);
      progression.irreversibles.push(...partie.irreversibles);
      // Rangé sur la tâche tant que la réponse tient (sinon « Annuler » est passé entre-temps : dit dans le résumé).
      const precedent = lirePrecedent(courante!.precedent);
      const { count } = precedent
        ? await prisma.tacheAFaire.updateMany({ where: { id: tache.id, reponse: charge.reponse, reponduLe }, data: { precedent: JSON.stringify({ ...precedent, progression }) } })
        : { count: 0 };
      if (count !== 1) {
        progression.refus.push(`réponse annulée pendant l'exécution : ${partie.faits.join(", ") || "rien"} à défaire à la main`);
        interrompu = true;
        break;
      }
    }
  });
  await signalerChangementTaches();
  const sortie: ResultatEffet = { resume: "", faits: progression.textes, refus: progression.refus, inverses: progression.inverses as Inverse[], irreversibles: progression.irreversibles };
  const detail = [...sortie.faits, ...sortie.refus.map((r) => `refusé (${r})`)].join(", ") || "rien à changer";
  sortie.resume = `Tâche ${tache.type} ${tache.id} : ${detail}${interrompu ? " (arrêté : réponse annulée ou tâche rouverte)" : ""}.`;
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
    case "FAIT": {
      // Mission 17 (partie A, relecture) : « Fait » sur une tâche VALIDER valide sa proposition — jamais une sensible
      // (argent, client) : elle passe par « À valider », son aperçu et sa confirmation.
      const propositionId = type === "VALIDER" ? propositionDe(lireObjet(tache.raccourci), lireObjet(tache.donnees)) : null;
      if (propositionId && (await propositionSensible(propositionId))) throw new ErreurMetier(`« Fait » impossible ici : ${REFUS_SENSIBLE}.`, 409);
      decision = { reponse: "FAIT", raison: null, jusqua: null, motifPerte: null, precisionPerte: null };
      colonnes = { statut: "FAITE", reponse: "FAIT", reponseRaison: null, reponseTexte: texte, plusTardJusqua: null, dureeReelleSec: dureeReelle(tache.commenceLe, maintenant) ?? tache.dureeReelleSec };
      break;
    }
    case "PLUS_TARD": {
      const raison = e.raison?.trim() || null;
      if (raison && !(RAISONS_PLUS_TARD as readonly string[]).includes(raison)) throw new ErreurMetier(`Raison invalide pour « Plus tard » : ${RAISONS_PLUS_TARD.join(", ")}.`, 400);
      const jusqua = jusquaPlusTard({ quand: e.quand, date: e.date }, maintenant);
      decision = { reponse: "PLUS_TARD", raison, jusqua, motifPerte: null, precisionPerte: null };
      colonnes = { statut: "PLUS_TARD", reponse: "PLUS_TARD", reponseRaison: raison, reponseTexte: texte, plusTardJusqua: jusqua, dureeReelleSec: tache.dureeReelleSec };
      break;
    }
    case "PAS_A_FAIRE": {
      // Mission 17 (partie A, relecture) : « client perdu » exige un client (dossier ou lead) à classer perdu.
      const aClient = Boolean(tache.dossierId || tache.leadId);
      const permises = raisonsPasAFaire(type, { aClient });
      const raison = e.raison?.trim() as RaisonPasAFaire | undefined;
      if (raison === "CLIENT_PERDU" && !aClient) throw new ErreurMetier("« Client perdu » : cette tâche ne porte sur aucun client (ni dossier ni contact) — choisis une autre raison.", 400);
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
  const { ligne, effet } = await enregistrerReponse(tache, colonnes, await sansPropositionsDecidees(effetsDe(tache, decision)), acteur, maintenant);
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
      await prisma.lead.updateMany({ where: { id: inverse.leadId, dernierContactLe: new Date(inverse.le) }, data: { dernierContactLe: dateOuNull(inverse.avant) } });
      return "contact retiré de la fiche";
    case "DERNIER_APPEL":
      await prisma.lead.updateMany({ where: { id: inverse.leadId, dernierAppelLe: new Date(inverse.le) }, data: { dernierAppelLe: dateOuNull(inverse.avant) } });
      return "appel retiré de la fiche";
    case "ACTION_MANUELLE": {
      // Remise seulement si personne n'a reposé d'action depuis.
      const a = inverse.avant;
      const { count } = await prisma.dossier.updateMany({
        where: { id: inverse.dossierId, prochaineActionManuelleLe: null },
        data: {
          prochaineAction: a.prochaineAction,
          prochaineActionDate: dateOuNull(a.prochaineActionDate),
          prochaineActionInstant: dateOuNull(a.prochaineActionInstant),
          prochaineActionManuelle: a.prochaineActionManuelle,
          prochaineActionManuelleLe: dateOuNull(a.prochaineActionManuelleLe),
          prochaineActionPar: a.prochaineActionPar,
        },
      });
      if (count !== 1) throw new ErreurMetier("une autre prochaine action a été posée depuis", 409);
      await apresChangementAction(inverse.dossierId);
      return "prochaine action remise sur le dossier";
    }
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
  const precedent = lirePrecedent(tache.precedent);
  if (!precedent) throw new ErreurMetier("Rien à annuler sur cette tâche.", 409);
  const avant = precedent.avant;
  // L'état d'abord : un effet qui partirait maintenant verra la réponse annulée et ne fera rien (executerEffet).
  const ligne = await prisma.tacheAFaire.update({
    where: { id },
    data: {
      statut: avant.statut,
      reponse: avant.reponse,
      reponseRaison: avant.reponseRaison,
      reponseTexte: avant.reponseTexte,
      reponduLe: dateOuNull(avant.reponduLe),
      reponduPar: avant.reponduPar,
      plusTardJusqua: dateOuNull(avant.plusTardJusqua),
      revenueLe: dateOuNull(avant.revenueLe),
      dureeReelleSec: avant.dureeReelleSec,
      precedent: null,
    },
  });
  const defaits: string[] = [];
  const nonDefaits: string[] = [];
  let effetAnnule = false;
  /** Défait ce que l'effet a fait (inverses), et dit ce qui ne se défait pas. */
  const defaireTout = async (inverses: readonly Inverse[], irreversibles: readonly string[]) => {
    for (const inverse of inverses) {
      try {
        defaits.push(await defaire(inverse, maintenant));
      } catch (erreur) {
        nonDefaits.push(`${LIBELLES_INVERSE[inverse.genre] ?? "à défaire à la main"} : ${messageDe(erreur)}`);
      }
    }
    nonDefaits.push(...irreversibles);
  };
  // Mission 17 (partie A, relecture) : ce que l'effet a déjà fait est rangé au fil de l'eau (executerEffet) : défait
  // même quand l'effet attend un nouvel essai ou a échoué en route.
  const progression = precedent.progression;
  const file = precedent.effet?.cle ? await prisma.tache.findUnique({ where: { cle: precedent.effet.cle } }) : null;
  if (file) {
    if (file.statut === "EN_ATTENTE" || file.statut === "ECHEC_DEFINITIF") {
      try {
        await annulerTache(file.id);
        effetAnnule = true;
      } catch {
        nonDefaits.push("l'effet venait de partir : relance « Annuler » dans un instant");
      }
      if (progression) await defaireTout(progression.inverses as Inverse[], progression.irreversibles);
    } else if (file.statut === "EN_COURS") {
      if (progression) await defaireTout(progression.inverses as Inverse[], progression.irreversibles);
      nonDefaits.push("l'effet est en train de s'exécuter : il s'arrête de lui-même (réponse annulée) ; ce qu'il ferait encore d'ici là est à défaire à la main");
    } else if (file.statut === "TERMINEE") {
      const resultat = lireObjet(file.resultat) as Partial<ResultatEffet>;
      await defaireTout(progression ? (progression.inverses as Inverse[]) : (resultat.inverses ?? []), progression ? progression.irreversibles : (resultat.irreversibles ?? []));
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

/**
 * L'échéance d'une tâche ajoutée, et l'instant où elle doit être dans la liste : un jour (AAAA-MM-JJ) → ce jour à 9 h,
 * heure de Paris ; une date ISO → cet instant.
 */
function echeanceDe(texte: string | null | undefined): { echeance: Date; retour: Date } | null {
  if (!texte) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texte)) {
    if (!estJourValide(texte)) throw new ErreurMetier("Échéance invalide (AAAA-MM-JJ).", 400);
    const echeance = dateDepuisJour(texte);
    return { echeance, retour: aHeureParis(echeance, 0, 9) };
  }
  const d = new Date(texte);
  if (Number.isNaN(d.getTime())) throw new ErreurMetier("Échéance invalide (AAAA-MM-JJ ou date ISO).", 400);
  return { echeance: d, retour: d };
}

/**
 * Une tâche à moi (MANUELLE), dite par Lucas ou Claude : niveau 3, 5 minutes, clé `MANUELLE:<id>`, sujet déduit de la
 * cible (dossier, sinon lead, sinon client, sinon aucun). Jamais cochée par absence ; `condition` (facultative) est lue
 * par le détecteur MANUELLE (detecteurs/manuelles.ts › acheves).
 *
 * Mission 17 (partie A, relecture) : une échéance à venir range la tâche « Plus tard » jusqu'à ce jour-là, 9 h (heure
 * de Paris), raison « pour le 12 oct. » : elle n'encombre pas « Aujourd'hui » ni le badge, et revient en tête le jour dit.
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
  const echeance = echeanceDe(e.echeance);
  const aVenir = echeance && echeance.retour.getTime() > maintenant.getTime() ? echeance.retour : null;
  const raison = [e.raison?.trim() || (aVenir ? null : "ajoutée à la main"), aVenir ? `pour le ${jour(aVenir)}` : null].filter(Boolean).join(" · ");
  const { acteur } = aVenir ? await resoudreContexte() : { acteur: null };
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
      raison,
      niveau: 3,
      montant: null,
      depuis: maintenant,
      echeance: echeance?.echeance ?? null,
      dureeMin: dureeDe("MANUELLE", await dureesMesurees()),
      raccourci: jsonStable(raccourci),
      donnees: jsonStable(e.condition ? { condition: e.condition } : {}),
      statut: aVenir ? "PLUS_TARD" : "A_FAIRE",
      ...(aVenir ? { reponse: "PLUS_TARD", plusTardJusqua: aVenir, reponduLe: maintenant, reponduPar: acteur } : {}),
      detecteLe: maintenant,
    },
  });
  await signalerChangementTaches();
  return versVue(ligne);
}

/* ── Les lots : « Tout classer » ───────────────────────────────────────── */

/**
 * `laissees` : les tâches du lot qui ne se classent pas d'un geste (contact qui a un dossier) : à revoir une par une.
 * `le` : l'instant du classement (ISO), à rendre à `annulerLot` — seules les tâches classées à cet instant reviennent.
 */
export type ResultatLot = { classees: number; effets: number; laissees: number; le: string };

/**
 * « Tout classer » : chaque tâche du lot (à faire, ou « Plus tard » échu : ce que la liste compte) passe « Pas à faire »
 * (CLASSE_EN_LOT) ; un ancien contact (CLASSER_LEAD) est classé sans suite, motif « plus de réponse », par la même file
 * d'effets. Annulable (annulerLot).
 *
 * Mission 17 (partie A, relecture) : un contact qui a un dossier (même signé) n'est jamais classé en lot — son dossier
 * passerait perdu, et les étapes engageantes ne se décident jamais en lot : sa tâche reste à faire (`laissees`).
 * `classees` ne compte que les tâches réellement classées (une tâche cochée par le CRM entre-temps reste comme elle est).
 */
export async function classerLot(lot: string, maintenant: Date = new Date()): Promise<ResultatLot> {
  const candidates = await prisma.tacheAFaire.findMany({ where: filtreDuLot(lot, maintenant) });
  if (candidates.length === 0) throw new ErreurMetier("Rien à classer dans ce lot.", 404);
  const leadIds = [...new Set(candidates.filter((t) => t.type === "CLASSER_LEAD" && t.leadId).map((t) => t.leadId!))];
  const avecDossier = new Set(leadIds.length ? (await prisma.dossier.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true } })).map((d) => d.leadId) : []);
  const taches = candidates.filter((t) => !(t.type === "CLASSER_LEAD" && t.leadId && avecDossier.has(t.leadId)));
  const { acteur } = await resoudreContexte();
  let classees = 0;
  let effets = 0;
  for (const tache of taches) {
    const perte: Effet[] = tache.type === "CLASSER_LEAD" && tache.leadId ? [{ genre: "PERTE_LEAD", leadId: tache.leadId, motifPerte: "SANS_REPONSE", precision: MOTIF_CLASSEMENT_LOT, enLot: true }] : [];
    try {
      const { effet } = await enregistrerReponse(
        tache,
        { statut: "PAS_A_FAIRE", reponse: "PAS_A_FAIRE", reponseRaison: "CLASSE_EN_LOT", reponseTexte: MOTIF_CLASSEMENT_LOT, plusTardJusqua: null, dureeReelleSec: tache.dureeReelleSec },
        perte,
        acteur,
        maintenant
      );
      classees++;
      if (effet) effets++;
    } catch (erreur) {
      // Une tâche qui vient de changer (cochée par le CRM entre-temps) reste comme elle est.
      if (!estErreurMetier(erreur)) throw erreur;
    }
  }
  await signalerChangementTaches();
  return { classees, effets, laissees: candidates.length - taches.length, le: maintenant.toISOString() };
}

/**
 * Défait « Tout classer » : chaque tâche classée en lot revient comme avant, et son effet est annulé ou défait.
 * Mission 17 (partie A, relecture) : seulement le classement de l'instant `le` (rendu par `classerLot`) — jamais celui
 * d'un autre jour ; sans `le`, le dernier classement de ce lot.
 */
export async function annulerLot(lot: string, maintenant: Date = new Date(), le?: string): Promise<{ restaurees: number; nonDefaits: string[] }> {
  const classees = { lot, statut: "PAS_A_FAIRE", reponseRaison: "CLASSE_EN_LOT", precedent: { not: null } };
  let instant: Date | null;
  if (le) {
    instant = new Date(le);
    if (Number.isNaN(instant.getTime())) throw new ErreurMetier("Instant du classement illisible.", 400);
  } else {
    instant = (await prisma.tacheAFaire.findFirst({ where: classees, orderBy: { reponduLe: "desc" }, select: { reponduLe: true } }))?.reponduLe ?? null;
  }
  const taches = instant ? await prisma.tacheAFaire.findMany({ where: { ...classees, reponduLe: instant }, select: { id: true } }) : [];
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
  // Mission 17 (partie A, relecture) : « Ignorer » une validation décide d'UNE proposition, pas du type de tâche : rien à apprendre.
  if (type === "VALIDER" || RAISONS_SANS_APPRENTISSAGE.includes(raison) || !(TYPES_TACHE as readonly string[]).includes(type)) return null;
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
