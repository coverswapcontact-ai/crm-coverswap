import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { dateCourte, euros } from "@/lib/commun/format";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireObjet, messagesDeLaTache, texteOuNull } from "./json";

/**
 * Mission 17 (partie A) : la coche du CRM (docs/TACHES.md § 2.3 et § 5). Une tâche qu'un passage réussi de sa source
 * ne voit plus est :
 * - « Pas à faire » (SUJET_DISPARU) quand son sujet a disparu : lead archivé ou sans suite, dossier archivé ou perdu ;
 * - « Plus tard » quand c'est un mail reporté (snooze) : jusqu'à la date du report, sans être cochée ;
 * - « Faite » sinon, avec la preuve lue en base : « coché par le CRM : devis 2026-043 déposé ».
 * Lecture seule : le moteur écrit (moteur.ts).
 */

export const PREFIXE_COCHE = "coché par le CRM : ";
export const TEXTE_PAR_DEFAUT = `${PREFIXE_COCHE}plus rien à faire`;

export type IssueAbsence = {
  statut: "FAITE" | "PLUS_TARD" | "PAS_A_FAIRE";
  /** « coché par le CRM : … », rangé dans `reponseTexte`. */
  texte: string;
  /** Code de raison (SUJET_DISPARU), rangé dans `reponseRaison`. */
  raison?: string;
  /** Fin du report (PLUS_TARD). */
  jusqua?: Date;
};

type Tache = Pick<TacheAFaire, "id" | "type" | "leadId" | "dossierId" | "clientId" | "depuis" | "raccourci" | "donnees" | "source">;

/** « 29/09 » : le jour et le mois, heure de Paris (format de `commun/format.ts`). */
export function jourMois(date: Date): string {
  return dateCourte(date).slice(0, 5);
}

const coche = (texte: string): string => `${PREFIXE_COCHE}${texte}`;

/** Le sujet a-t-il disparu ? Rend la raison lisible (« dossier perdu »), ou null. Un dossier l'emporte sur son lead. */
export async function sujetDisparu(tache: Pick<TacheAFaire, "leadId" | "dossierId">): Promise<string | null> {
  if (tache.dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: tache.dossierId }, select: { archiveLe: true, etape: true } });
    if (!dossier) return "dossier introuvable";
    if (dossier.archiveLe) return "dossier archivé";
    if (dossier.etape === "PERDU") return "dossier perdu";
    return null;
  }
  if (tache.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: tache.leadId }, select: { archiveLe: true, statut: true } });
    if (!lead) return "contact introuvable";
    if (lead.archiveLe) return "contact archivé";
    if (lead.statut === "PERDU") return "contact sans suite";
  }
  return null;
}

type EtatFil = { traite: boolean; range: boolean; reporteJusqua: Date | null };

/** L'état des fils mail d'une tâche, comme la vue « À traiter » le lit (mail/vues.ts › ligneDuFil). */
async function etatDesFils(messageIds: string[], maintenant: Date): Promise<EtatFil | null> {
  if (messageIds.length === 0) return null;
  const messages = await prisma.message.findMany({ where: { id: { in: messageIds }, ...AVEC_ARCHIVES }, select: { id: true, canal: true, filCanal: true } });
  if (messages.length === 0) return null;
  const fils = [...new Set(messages.map((m) => m.filCanal).filter((f): f is string => Boolean(f)))];
  const sansFil = messages.filter((m) => !m.filCanal).map((m) => m.id);
  const lignes = await prisma.message.findMany({
    where: { OR: [...(fils.length ? [{ filCanal: { in: fils } }] : []), ...(sansFil.length ? [{ id: { in: sansFil } }] : [])] },
    orderBy: { recuLe: "asc" },
    select: { filCanal: true, id: true, sens: true, traiteLe: true, rangeLe: true, snoozeJusqua: true },
  });
  const parFil = new Map<string, typeof lignes>();
  for (const l of lignes) parFil.set(l.filCanal ?? l.id, [...(parFil.get(l.filCanal ?? l.id) ?? []), l]);
  let traite = parFil.size > 0;
  let range = parFil.size > 0;
  let reporteJusqua: Date | null = null;
  for (const fil of parFil.values()) {
    const entrants = fil.filter((m) => m.sens === "ENTRANT");
    const filTraite = Boolean(fil.at(-1)?.traiteLe);
    const filRange = entrants.length > 0 && entrants.every((m) => m.rangeLe) && !fil.some((m) => m.sens === "SORTANT");
    traite &&= filTraite;
    range &&= filRange;
    const snooze = fil.reduce<Date | null>((max, m) => (m.snoozeJusqua && (!max || m.snoozeJusqua > max) ? m.snoozeJusqua : max), null);
    if (!filTraite && !filRange && snooze && snooze.getTime() > maintenant.getTime() && (!reporteJusqua || snooze < reporteJusqua)) reporteJusqua = snooze;
  }
  return { traite, range, reporteJusqua };
}

const plusAncien = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((min, d) => (d && (!min || d.getTime() < min.getTime()) ? d : min), null);

/** La première réponse partie après `depuis` : mail sortant, réponse d'espace, SMS copié, appel abouti. */
async function reponsePartie(tache: Tache, messageIds: string[]): Promise<Date | null> {
  const depuis = tache.depuis;
  const fils = messageIds.length
    ? [...new Set((await prisma.message.findMany({ where: { id: { in: messageIds }, ...AVEC_ARCHIVES }, select: { filCanal: true } })).map((m) => m.filCanal).filter((f): f is string => Boolean(f)))]
    : [];
  const ciblesMail = [
    ...(fils.length ? [{ filCanal: { in: fils } }] : []),
    ...(tache.dossierId ? [{ dossierId: tache.dossierId }] : []),
    ...(tache.leadId ? [{ leadId: tache.leadId }] : []),
  ];
  const [mail, evenements, echanges] = await Promise.all([
    ciblesMail.length
      ? prisma.message.findFirst({ where: { sens: "SORTANT", automatique: false, recuLe: { gt: depuis }, OR: ciblesMail }, orderBy: { recuLe: "asc" }, select: { recuLe: true } })
      : null,
    tache.dossierId
      ? prisma.dossierEvenement.findMany({
          where: { dossierId: tache.dossierId, type: { in: ["MAIL_ENVOYE", "ESPACE_REPONSE", "SMS_COPIE", "SMS_ENVOYE", "APPEL", "REPONDU_HORS_CRM"] }, createdAt: { gt: depuis } },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { type: true, direction: true, metadata: true, createdAt: true, survenuLe: true },
        })
      : [],
    tache.leadId && !tache.dossierId
      ? prisma.interaction.findMany({ where: { leadId: tache.leadId, type: { in: ["SMS", "EMAIL", "APPEL"] }, createdAt: { gt: depuis } }, orderBy: { createdAt: "asc" }, take: 20, select: { type: true, contenu: true, createdAt: true } })
      : [],
  ]);
  const evenement = evenements.find((e) => {
    const meta = lireObjet(e.metadata);
    if (e.type === "APPEL") return meta.issue !== "PAS_DE_REPONSE";
    if (e.type === "SMS_ENVOYE") return meta.origine !== "ACCUSE_AUTO";
    if (e.type === "MAIL_ENVOYE" || e.type === "ESPACE_REPONSE") return e.direction === "SORTANT";
    return true;
  });
  const echange = echanges.find((e) => e.type !== "APPEL" || !/pas de réponse|messagerie/i.test(e.contenu));
  return plusAncien([mail?.recuLe, evenement ? (evenement.survenuLe ?? evenement.createdAt) : null, echange?.createdAt]);
}

/** Le dernier contact d'un lead (ou d'un dossier) : « appel noté le 29/09 », « SMS copié le 29/09 », « mail parti le 29/09 ». */
async function dernierContact(tache: Tache): Promise<string | null> {
  const candidats: { le: Date; texte: string }[] = [];
  const ajouter = (le: Date | null | undefined, texte: string) => {
    if (le) candidats.push({ le, texte });
  };
  if (tache.leadId) {
    const [lead, sms, mail] = await Promise.all([
      prisma.lead.findUnique({ where: { id: tache.leadId }, select: { dernierAppelLe: true, dernierContactLe: true, rappelLe: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } }),
      prisma.interaction.findFirst({ where: { leadId: tache.leadId, type: "SMS" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.interaction.findFirst({ where: { leadId: tache.leadId, type: "EMAIL", contenu: { startsWith: "Mail envoyé" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    ajouter(lead?.dernierAppelLe, "appel noté le");
    ajouter(sms?.createdAt, "SMS copié le");
    ajouter(mail?.createdAt, "mail parti le");
    if (lead?.dernierContactLe && !candidats.some((c) => Math.abs(c.le.getTime() - lead.dernierContactLe!.getTime()) < 60_000)) ajouter(lead.dernierContactLe, "contacté le");
    ajouter(lead?.dossiers[0]?.createdAt, "dossier ouvert le");
    if (candidats.length === 0 && lead?.rappelLe) return `rappel posé au ${jourMois(lead.rappelLe)}`;
  }
  if (tache.dossierId) {
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId: tache.dossierId, type: { in: ["APPEL", "SMS_COPIE", "MAIL_ENVOYE"] }, direction: "SORTANT" }, orderBy: { createdAt: "desc" }, take: 5, select: { type: true, createdAt: true, survenuLe: true } });
    for (const e of evenements) ajouter(e.survenuLe ?? e.createdAt, e.type === "APPEL" ? "appel noté le" : e.type === "SMS_COPIE" ? "SMS copié le" : "mail parti le");
  }
  const dernier = candidats.sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  return dernier ? `${dernier.texte} ${jourMois(dernier.le)}` : null;
}

/** La preuve de l'achèvement, lue en base, selon le type (docs/TACHES.md § 5). */
async function preuve(tache: Tache, maintenant: Date): Promise<string | null> {
  const raccourci = lireObjet(tache.raccourci);
  const donnees = lireObjet(tache.donnees);
  switch (tache.type) {
    case "DEVIS": {
      if (!tache.dossierId) return null;
      const devis = await prisma.document.findFirst({
        where: { dossierId: tache.dossierId, type: "DEVIS", numero: { not: null }, OR: [{ statut: { in: ["GENERE", "ENVOYE"] }, visibleEspace: true }, { statut: "ACCEPTE" }] },
        orderBy: { createdAt: "desc" },
        select: { numero: true, origine: true },
      });
      return devis ? `devis ${devis.numero} ${devis.origine === "REPRISE" ? "déposé" : "émis"}` : null;
    }
    case "SIMULATION":
    case "PUBLIER": {
      if (!tache.dossierId) return null;
      const simulation = await prisma.simulationEspace.findFirst({ where: { dossierId: tache.dossierId, statut: "PUBLIEE" }, orderBy: [{ publieeLe: "desc" }, { updatedAt: "desc" }], select: { publieeLe: true, updatedAt: true } });
      return simulation ? `simulation publiée le ${jourMois(simulation.publieeLe ?? simulation.updatedAt)}` : null;
    }
    case "REPONDRE":
    case "LIRE_MAIL": {
      const messageIds = messagesDeLaTache(raccourci, donnees);
      const reponse = tache.type === "REPONDRE" ? await reponsePartie(tache, messageIds) : null;
      if (reponse) return `réponse partie le ${jourMois(reponse)}`;
      const fils = await etatDesFils(messageIds, maintenant);
      if (fils?.range) return "mail rangé";
      if (fils) return tache.type === "LIRE_MAIL" && !fils.traite ? "mail lu" : "mail archivé";
      if (texteOuNull(donnees.espaceDossierId) || tache.source === "ESPACE_MESSAGES") return "message lu";
      return null;
    }
    case "APPELER":
    case "RAPPELER":
      return dernierContact(tache);
    case "DATE_CHANTIER": {
      if (!tache.dossierId) return null;
      const dossier = await prisma.dossier.findUnique({ where: { id: tache.dossierId }, select: { dateChantier: true } });
      return dossier?.dateChantier ? `date posée au ${jourMois(dossier.dateChantier)}` : null;
    }
    case "ENCAISSER": {
      if (!tache.dossierId) return null;
      const encaissement = await prisma.encaissement.findFirst({ where: { dossierId: tache.dossierId, statut: "VALIDE" }, orderBy: [{ recuLe: "desc" }, { createdAt: "desc" }], select: { montant: true } });
      return encaissement ? `encaissement de ${euros(encaissement.montant)} saisi` : null;
    }
    case "VALIDER": {
      const propositionId = texteOuNull(donnees.propositionId) ?? texteOuNull(raccourci.propositionId);
      if (!propositionId) return null;
      const proposition = await prisma.proposition.findUnique({ where: { id: propositionId }, select: { statut: true } });
      switch (proposition?.statut) {
        case "VALIDEE":
        case "EXECUTEE":
        case "AUTOMATIQUE":
        case "ECHEC":
          return "proposition validée";
        case "REJETEE":
          return "proposition ignorée";
        case "EXPIREE":
          return "proposition expirée";
        case "ANNULEE":
          return "proposition devenue sans objet";
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * Ce que devient une tâche absente d'un passage réussi de sa source (docs/TACHES.md § 2.3). Jamais appelé pour une
 * tâche MANUELLE (le moteur ne les coche que par leur condition).
 */
export async function issueDeLAbsence(tache: Tache, maintenant: Date): Promise<IssueAbsence> {
  const disparu = await sujetDisparu(tache);
  if (disparu) return { statut: "PAS_A_FAIRE", raison: "SUJET_DISPARU", texte: coche(disparu) };
  if (tache.type === "REPONDRE" || tache.type === "LIRE_MAIL") {
    const fils = await etatDesFils(messagesDeLaTache(lireObjet(tache.raccourci), lireObjet(tache.donnees)), maintenant);
    if (fils?.reporteJusqua) return { statut: "PLUS_TARD", jusqua: fils.reporteJusqua, texte: `${PREFIXE_COCHE}mail reporté au ${jourMois(fils.reporteJusqua)}` };
  }
  const texte = await preuve(tache, maintenant);
  return { statut: "FAITE", texte: texte ? coche(texte) : TEXTE_PAR_DEFAUT };
}
