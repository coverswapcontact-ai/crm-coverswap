import type { TacheAFaire } from "@prisma/client";
import prisma from "@/lib/prisma";
import { aHeureParis } from "@/lib/commercial/quand";
import { dateCourte, euros, heure } from "@/lib/commun/format";
import { jourParis } from "@/lib/dossiers/dates";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireObjet, messagesDeLaTache, texteOuNull } from "./json";

/**
 * Mission 17 (partie A) : la coche du CRM (docs/TACHES.md § 2.3 et § 5). Une tâche qu'un passage réussi de sa source
 * ne voit plus est :
 * - « Pas à faire » (SUJET_DISPARU) quand son sujet a disparu : lead archivé ou sans suite, dossier archivé ou perdu ;
 * - « Plus tard » quand c'est un mail reporté (snooze) : jusqu'à la date du report, sans être cochée ;
 * - « Faite » sinon, avec la preuve lue en base : « coché par le CRM : devis 2026-043 déposé ».
 * Lecture seule : le moteur écrit (moteur.ts).
 *
 * Mission 17 (partie A, relecture) : une preuve est toujours datée APRÈS la naissance du besoin (`depuis` ; pour un
 * rappel, le début de son jour : un appel passé le matin d'un rappel prévu l'après-midi compte) — une ancienne preuve
 * (l'acompte d'un autre besoin, un vieil appel) ne coche rien : sans preuve, « plus rien à faire ». Un contact ne compte
 * que SORTANT et de la main de Lucas (jamais un SMS ou un mail reçu, ni un accusé automatique) ; un lead jamais contacté
 * qui a écrit dit « il a écrit : à lui répondre ». Une preuve du jour se lit à l'heure (« réponse partie à 21:40 »).
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

/** « à 21:40 » le jour même (heure de Paris), sinon « le 29/09 ». */
export function leOuA(date: Date, maintenant: Date): string {
  return jourParis(date) === jourParis(maintenant) ? `à ${heure(date)}` : `le ${jourMois(date)}`;
}

/** Une interaction de lead SORTANTE de la main de Lucas : SMS copié ou envoyé, mail envoyé, appel. */
const SMS_COPIE = /^SMS(?: \S+)? copié/;
const smsSortant = (contenu: string) => SMS_COPIE.test(contenu) || contenu.startsWith("SMS envoyé");
const mailSortant = (contenu: string) => contenu.startsWith("Mail envoyé");
const appelAbouti = (contenu: string) => !/pas de réponse|messagerie/i.test(contenu);

/**
 * Le sujet a-t-il disparu ? Rend la raison lisible (« dossier perdu »), ou null. Un dossier l'emporte sur son lead.
 * Mission 18 (A4) : la réactivation (REACTIVER) porte justement sur un contact sans suite — il n'a pas disparu pour elle.
 */
export async function sujetDisparu(tache: Pick<TacheAFaire, "leadId" | "dossierId"> & { type?: string }): Promise<string | null> {
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
    if (lead.statut === "PERDU" && tache.type !== "REACTIVER") return "contact sans suite";
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
  // Jamais un « SMS reçu » ni un « Mail reçu » (les échanges d'un lead gardent les deux sens) ; ni un accusé automatique.
  const echange = echanges.find((e) => (e.type === "APPEL" ? appelAbouti(e.contenu) : e.type === "SMS" ? smsSortant(e.contenu) : mailSortant(e.contenu)));
  return plusAncien([mail?.recuLe, evenement ? (evenement.survenuLe ?? evenement.createdAt) : null, echange?.createdAt]);
}

/**
 * Le dernier contact SORTANT d'un lead (ou d'un dossier) après `apres` : « appel noté le 29/09 », « SMS copié à 14:05 »,
 * « mail parti le 29/09 ». Un SMS ou un mail reçu n'est jamais un contact ; l'accusé automatique non plus. Sans contact :
 * le lead a écrit (« il a écrit : à lui répondre »), ou un rappel est posé, ou rien.
 */
async function dernierContact(tache: Tache, apres: Date, maintenant: Date): Promise<string | null> {
  const candidats: { le: Date; texte: string }[] = [];
  const ajouter = (le: Date | null | undefined, texte: string) => {
    if (le && le.getTime() > apres.getTime()) candidats.push({ le, texte });
  };
  let rappelLe: Date | null = null;
  if (tache.leadId) {
    const leadId = tache.leadId;
    const [lead, echanges, smsEnvoye] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId }, select: { dernierAppelLe: true, dernierContactLe: true, rappelLe: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } }),
      prisma.interaction.findMany({ where: { leadId, type: { in: ["SMS", "EMAIL", "APPEL"] }, createdAt: { gt: apres } }, orderBy: { createdAt: "desc" }, take: 50, select: { type: true, contenu: true, createdAt: true } }),
      // Un SMS parti de la messagerie (hors accusé automatique) : sa trace dit « SMS envoyé », comme l'accusé.
      prisma.sms.findFirst({ where: { sens: "SORTANT", origine: { not: "ACCUSE_AUTO" }, statut: { not: "ECHEC" }, createdAt: { gt: apres }, OR: [{ leadId }, { conversation: { leadId } }] }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    ajouter(lead?.dernierAppelLe, "appel noté");
    ajouter(echanges.find((e) => e.type === "APPEL" && appelAbouti(e.contenu))?.createdAt, "appel noté");
    ajouter(echanges.find((e) => e.type === "SMS" && SMS_COPIE.test(e.contenu))?.createdAt, "SMS copié");
    ajouter(smsEnvoye?.createdAt, "SMS envoyé");
    ajouter(echanges.find((e) => e.type === "EMAIL" && mailSortant(e.contenu))?.createdAt, "mail parti");
    const contactLe = lead?.dernierContactLe;
    if (contactLe && !candidats.some((c) => Math.abs(c.le.getTime() - contactLe.getTime()) < 60_000)) ajouter(contactLe, "contacté");
    // Le dossier ouvert clôt une tâche du LEAD (il vit désormais dans son dossier) ; pour une tâche du dossier lui-même,
    // ouvrir n'est pas appeler (mission 18, A2 : le dossier s'ouvre tout seul, « Appeler · Nom » reste à faire).
    if (!tache.dossierId) ajouter(lead?.dossiers[0]?.createdAt, "dossier ouvert");
    rappelLe = lead?.rappelLe ?? null;
  }
  if (tache.dossierId) {
    const evenements = await prisma.dossierEvenement.findMany({
      where: { dossierId: tache.dossierId, type: { in: ["APPEL", "SMS_COPIE", "SMS_ENVOYE", "MAIL_ENVOYE"] }, direction: "SORTANT", OR: [{ createdAt: { gt: apres } }, { survenuLe: { gt: apres } }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { type: true, metadata: true, createdAt: true, survenuLe: true },
    });
    for (const e of evenements) {
      const meta = lireObjet(e.metadata);
      if (e.type === "APPEL" && meta.issue === "PAS_DE_REPONSE") continue;
      if (e.type === "SMS_ENVOYE" && meta.origine === "ACCUSE_AUTO") continue;
      ajouter(e.survenuLe ?? e.createdAt, e.type === "APPEL" ? "appel noté" : e.type === "SMS_COPIE" ? "SMS copié" : e.type === "SMS_ENVOYE" ? "SMS envoyé" : "mail parti");
    }
  }
  const dernier = candidats.sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  if (dernier) return `${dernier.texte} ${leOuA(dernier.le, maintenant)}`;
  if (tache.leadId && (await aEcritDepuis(tache.leadId, apres))) return "il a écrit : à lui répondre";
  if (rappelLe) return `rappel posé au ${jourMois(rappelLe)}`;
  return null;
}

/** Le lead a-t-il écrit (SMS, mail) après `apres` ? */
async function aEcritDepuis(leadId: string, apres: Date): Promise<boolean> {
  const [sms, mail, trace] = await Promise.all([
    prisma.sms.findFirst({ where: { sens: "ENTRANT", createdAt: { gt: apres }, OR: [{ leadId }, { conversation: { leadId } }] }, select: { id: true } }),
    prisma.message.findFirst({ where: { leadId, sens: "ENTRANT", automatique: false, recuLe: { gt: apres } }, select: { id: true } }),
    prisma.interaction.findFirst({ where: { leadId, createdAt: { gt: apres }, OR: [{ contenu: { startsWith: "SMS reçu" } }, { contenu: { startsWith: "Mail reçu" } }] }, select: { id: true } }),
  ]);
  return Boolean(sms || mail || trace);
}

/** La preuve de l'achèvement, lue en base, selon le type (docs/TACHES.md § 5). */
async function preuve(tache: Tache, maintenant: Date): Promise<string | null> {
  const raccourci = lireObjet(tache.raccourci);
  const donnees = lireObjet(tache.donnees);
  const depuis = tache.depuis;
  switch (tache.type) {
    case "DEVIS": {
      if (!tache.dossierId) return null;
      const devis = await prisma.document.findFirst({
        where: {
          dossierId: tache.dossierId,
          type: "DEVIS",
          numero: { not: null },
          AND: [{ OR: [{ statut: { in: ["GENERE", "ENVOYE"] }, visibleEspace: true }, { statut: "ACCEPTE" }] }, { OR: [{ createdAt: { gt: depuis } }, { dateEmission: { gt: depuis } }] }],
        },
        orderBy: { createdAt: "desc" },
        select: { numero: true, origine: true },
      });
      return devis ? `devis ${devis.numero} ${devis.origine === "REPRISE" ? "déposé" : "émis"}` : null;
    }
    case "ENVOYER_DEVIS": {
      // Mission 18 (B1) : le devis parti par le mail du CRM (« Envoyé »), mis en ligne (« Devis envoyé »), ou devenu sans objet.
      if (!tache.dossierId) return null;
      const ids = Array.isArray(donnees.documentIds) ? donnees.documentIds.filter((id): id is string => typeof id === "string") : [];
      if (ids.length === 0) return null;
      const devis = await prisma.document.findMany({ where: { id: { in: ids }, ...AVEC_ARCHIVES }, select: { id: true, numero: true, statut: true } });
      const misEnLigne = await prisma.dossierEvenement.findFirst({
        where: { dossierId: tache.dossierId, type: "DEVIS_ENVOYE", createdAt: { gt: depuis }, OR: ids.map((id) => ({ metadata: { contains: id } })) },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, metadata: true },
      });
      const parMail = devis.find((d) => d.statut === "ENVOYE" || d.statut === "ACCEPTE");
      if (parMail) return `devis ${parMail.numero} ${parMail.statut === "ACCEPTE" ? "accepté" : "envoyé par mail"}`;
      if (misEnLigne) {
        const numero = devis.find((d) => misEnLigne.metadata.includes(d.id))?.numero;
        return `devis${numero ? ` ${numero}` : ""} mis en ligne ${leOuA(misEnLigne.createdAt, maintenant)}`;
      }
      const caduc = devis.find((d) => d.statut === "ANNULEE" || d.statut === "REMPLACE");
      return caduc ? `devis ${caduc.numero} ${caduc.statut === "ANNULEE" ? "annulé" : "remplacé"}` : null;
    }
    case "ENREGISTRER_DEVIS": {
      // Mission 18 (B3) : le PDF parti de Gmail enregistré (« Devis envoyé » qui porte sa pièce), ou le devis de ce
      // numéro entré dans le dossier autrement (dépôt, mail du CRM, mise en ligne).
      if (!tache.dossierId) return null;
      const pieceId = texteOuNull(donnees.pieceId);
      const enregistre = pieceId
        ? await prisma.dossierEvenement.findFirst({ where: { dossierId: tache.dossierId, type: "DEVIS_ENVOYE", metadata: { contains: `"pieceId":"${pieceId}"` } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true } })
        : null;
      if (enregistre) {
        const documentId = texteOuNull(lireObjet(enregistre.metadata).documentId);
        const devis = documentId ? await prisma.document.findUnique({ where: { id: documentId }, select: { numero: true } }) : null;
        return `devis${devis?.numero ? ` ${devis.numero}` : ""} enregistré comme envoyé depuis Gmail ${leOuA(enregistre.createdAt, maintenant)}`;
      }
      const numero = texteOuNull(donnees.numero);
      if (!numero) return null;
      const devis = await prisma.document.findFirst({ where: { dossierId: tache.dossierId, type: "DEVIS", numero, archiveLe: null }, select: { numero: true, statut: true, origine: true } });
      if (!devis || devis.statut === "GENERE") return null;
      return `devis ${devis.numero} ${devis.origine === "REPRISE" ? "déposé" : devis.statut === "ACCEPTE" ? "accepté" : "envoyé"}`;
    }
    case "SIMULATION":
    case "PUBLIER": {
      if (!tache.dossierId) return null;
      const simulation = await prisma.simulationEspace.findFirst({
        where: { dossierId: tache.dossierId, statut: "PUBLIEE", OR: [{ publieeLe: { gt: depuis } }, { publieeLe: null, updatedAt: { gt: depuis } }] },
        orderBy: [{ publieeLe: "desc" }, { updatedAt: "desc" }],
        select: { publieeLe: true, updatedAt: true },
      });
      if (simulation) return `simulation publiée ${leOuA(simulation.publieeLe ?? simulation.updatedAt, maintenant)}`;
      // Préparée, pas encore publiée : la tâche « Publier » la reprend.
      if (tache.type === "SIMULATION") {
        const brouillon = await prisma.simulationEspace.findFirst({ where: { dossierId: tache.dossierId, statut: "BROUILLON", archiveLe: null }, select: { id: true } });
        if (brouillon) return "simulation préparée, à publier";
      }
      return null;
    }
    case "REPONDRE":
    case "LIRE_MAIL": {
      const messageIds = messagesDeLaTache(raccourci, donnees);
      const reponse = tache.type === "REPONDRE" ? await reponsePartie(tache, messageIds) : null;
      if (reponse) return `réponse partie ${leOuA(reponse, maintenant)}`;
      const fils = await etatDesFils(messageIds, maintenant);
      if (fils?.range) return "mail rangé";
      if (fils) return tache.type === "LIRE_MAIL" && !fils.traite ? "mail lu" : "mail archivé";
      if (texteOuNull(donnees.espaceDossierId) || tache.source === "ESPACE_MESSAGES") return "message lu";
      return null;
    }
    case "APPELER":
      return dernierContact(tache, depuis, maintenant);
    case "RAPPELER":
      // Un appel passé le matin d'un rappel prévu l'après-midi compte.
      return dernierContact(tache, plusAncien([depuis, aHeureParis(depuis, 0, 0)]) ?? depuis, maintenant);
    case "DATE_CHANTIER": {
      if (!tache.dossierId) return null;
      const dossier = await prisma.dossier.findUnique({ where: { id: tache.dossierId }, select: { dateChantier: true } });
      return dossier?.dateChantier ? `date posée au ${jourMois(dossier.dateChantier)}` : null;
    }
    case "ENCAISSER": {
      if (!tache.dossierId) return null;
      const encaissement = await prisma.encaissement.findFirst({
        where: { dossierId: tache.dossierId, statut: "VALIDE", OR: [{ createdAt: { gt: depuis } }, { recuLe: { gt: depuis } }] },
        orderBy: [{ recuLe: "desc" }, { createdAt: "desc" }],
        select: { montant: true },
      });
      return encaissement ? `encaissement de ${euros(encaissement.montant)} saisi` : null;
    }
    case "RELANCER_DEVIS":
    case "RELANCER_PHOTOS":
    case "RELANCER_AVIS": {
      // La relance faite : un SMS de relance DE CE TYPE copié, ou le mail de relance du devis parti (docs/TACHES.md § 5).
      // Mission 18 (A4) : le type de la relance est lu — un SMS d'avis ne coche pas la relance d'un devis.
      if (!tache.dossierId) return null;
      const sms = tache.type === "RELANCER_DEVIS" ? '"relance":{"documentId"' : tache.type === "RELANCER_PHOTOS" ? '"type":"PHOTOS"' : '"type":"AVIS"';
      const trace = await prisma.dossierEvenement.findFirst({
        where: { dossierId: tache.dossierId, createdAt: { gt: depuis }, OR: [{ type: "SMS_COPIE", metadata: { contains: sms } }, ...(tache.type === "RELANCER_DEVIS" ? [{ type: "MAIL_ENVOYE", metadata: { contains: "RELANCE_DEVIS" } }] : [])] },
        orderBy: { createdAt: "desc" },
        select: { type: true, createdAt: true },
      });
      if (!trace) return null;
      return `${trace.type === "SMS_COPIE" ? (tache.type === "RELANCER_AVIS" ? "SMS de demande d'avis copié" : "SMS de relance copié") : "mail de relance parti"} ${leOuA(trace.createdAt, maintenant)}`;
    }
    case "REACTIVER": {
      // Mission 18 (A4) : la réactivation copiée se trace sur le lead (relances/reactivation.ts).
      if (!tache.leadId) return null;
      const trace = await prisma.interaction.findFirst({ where: { leadId: tache.leadId, type: "SMS", contenu: { startsWith: "SMS REACTIVATION copié" }, createdAt: { gt: depuis } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      return trace ? `SMS de réactivation copié ${leOuA(trace.createdAt, maintenant)}` : null;
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
  // Mission 25 (lot 6) : une relance de l'ancien circuit, jamais faite, que la messagerie reprend : « Pas à faire »,
  // pas « Faite » (la relance n'a pas eu lieu ; le message préparé l'attend dans la Messagerie).
  if (!texte && RELANCES_CONFIEES.includes(tache.type)) {
    const { messagerieEnService } = await import("@/lib/messagerie/suivis");
    if (await messagerieEnService(maintenant)) return { statut: "PAS_A_FAIRE", raison: "AUTRE", texte: coche("relance confiée à la messagerie") };
  }
  return { statut: "FAITE", texte: texte ? coche(texte) : TEXTE_PAR_DEFAUT };
}

const RELANCES_CONFIEES: readonly string[] = ["RELANCER_DEVIS", "RELANCER_PHOTOS", "RELANCER_AVIS", "REACTIVER"];
