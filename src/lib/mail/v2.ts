import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { resoudreContexte } from "@/lib/journal/acteur";
import { lireListe } from "@/lib/messages/stockage";
import { retirerCitations } from "@/lib/messages/texte";
import { demanderEtatGmail } from "./boite";
import { A_COMPLETER } from "./redaction";
import { lireDatesExtraites, type DateExtraite } from "./priorite";

/**
 * Mail v2 (mission 9) : ce que le CRM stocke sur un mail et que l'assistant
 * Claude remplit par le MCP — intention, ce qui est attendu, résumé de fil,
 * dates extraites, remise à plus tard, rangement à la main, brouillon déposé —
 * et ce qu'il cherche pour lui (recherche plein texte, mails non classés).
 * Le CRM n'appelle aucun modèle : il stocke, structure, expose. Tout ce qui
 * s'écrit ici porte l'acteur (Claude ou Lucas) et se défait.
 */

export { INTENTIONS, LIBELLES_INTENTION, type Intention } from "./intentions";
import type { Intention } from "./intentions";

const FENETRE_JOURS = 120;
const JOUR = 86_400_000;

async function acteurCourant(): Promise<string> {
  return (await resoudreContexte()).acteur;
}

/** « LUCAS » ou « ASSISTANT » pour les colonnes courtes (rangePar, classePar). */
export function courtDe(acteur: string): "LUCAS" | "ASSISTANT" {
  return acteur.startsWith("ASSISTANT:") ? "ASSISTANT" : "LUCAS";
}

/* ── Intention et dates ─────────────────────────────────────────────── */

export type Classement = { messageId: string; intention: Intention | null; attendu?: string | null; dates?: DateExtraite[] | null };

/** Classe un ou plusieurs mails : intention, ce qui est attendu, dates extraites (chacune avec son passage). */
export async function classerIntention(classements: Classement[]): Promise<{ classes: number; inconnus: string[] }> {
  const acteur = await acteurCourant();
  const maintenant = new Date();
  const ids = classements.map((c) => c.messageId);
  const connus = new Set((await prisma.message.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((m) => m.id));
  const inconnus = ids.filter((id) => !connus.has(id));
  let classes = 0;
  for (const c of classements) {
    if (!connus.has(c.messageId)) continue;
    await prisma.message.update({
      where: { id: c.messageId },
      data: {
        intention: c.intention,
        intentionAttendu: c.attendu?.trim().slice(0, 300) || null,
        intentionPar: acteur,
        intentionLe: maintenant,
        ...(c.dates !== undefined && c.dates !== null ? { datesExtraites: JSON.stringify(c.dates.slice(0, 12).map((d) => ({ date: d.date, heure: d.heure ?? null, nature: d.nature, passage: d.passage.slice(0, 300) }))) } : {}),
      },
    });
    classes += 1;
  }
  return { classes, inconnus };
}

/* ── Résumé de fil ──────────────────────────────────────────────────── */

export type PointEnSuspens = { texte: string; date?: string | null };

async function filDe(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, canal: true, filCanal: true } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  const cle = message.filCanal ?? message.id;
  const messages = await prisma.message.findMany({ where: message.filCanal ? { canal: message.canal, filCanal: message.filCanal } : { id: message.id }, select: { id: true, sens: true, de: true, rangeLe: true, snoozeJusqua: true }, orderBy: { recuLe: "asc" } });
  return { canal: message.canal, filCanal: cle, messages };
}

export async function resumerFil(messageId: string, entree: { resume: string; pointsEnSuspens: PointEnSuspens[] }): Promise<{ filCanal: string; messages: number }> {
  const acteur = await acteurCourant();
  const fil = await filDe(messageId);
  const resume = entree.resume.trim().split("\n").filter(Boolean).slice(0, 3).join("\n").slice(0, 600);
  const points = JSON.stringify(entree.pointsEnSuspens.slice(0, 10).map((p) => ({ texte: p.texte.trim().slice(0, 200), date: p.date ?? null })));
  await prisma.resumeFil.upsert({
    where: { canal_filCanal: { canal: fil.canal, filCanal: fil.filCanal } },
    create: { canal: fil.canal, filCanal: fil.filCanal, resume, pointsEnSuspens: points, messages: fil.messages.length, par: acteur },
    update: { resume, pointsEnSuspens: points, messages: fil.messages.length, par: acteur },
  });
  return { filCanal: fil.filCanal, messages: fil.messages.length };
}

export type ResumeVue = { resume: string; pointsEnSuspens: PointEnSuspens[]; messages: number; messagesActuels: number; perime: boolean; par: string | null; le: string };

export async function resumeDuFil(canal: string, filCanal: string, messagesActuels: number): Promise<ResumeVue | null> {
  const r = await prisma.resumeFil.findUnique({ where: { canal_filCanal: { canal, filCanal } } });
  if (!r) return null;
  let points: PointEnSuspens[] = [];
  try {
    const lu: unknown = JSON.parse(r.pointsEnSuspens);
    points = Array.isArray(lu) ? lu.filter((p): p is PointEnSuspens => Boolean(p && typeof (p as PointEnSuspens).texte === "string")) : [];
  } catch {
    points = [];
  }
  return { resume: r.resume, pointsEnSuspens: points, messages: r.messages, messagesActuels, perime: messagesActuels > r.messages, par: r.par, le: r.updatedAt.toISOString() };
}

/* ── Remettre à plus tard ───────────────────────────────────────────── */

export async function snoozer(messageId: string, jusqua: Date): Promise<void> {
  const acteur = await acteurCourant();
  if (Number.isNaN(jusqua.getTime())) throw new ErreurMetier("Date de retour invalide.", 400);
  await prisma.message.update({ where: { id: messageId }, data: { snoozeJusqua: jusqua, snoozeLe: new Date(), snoozePar: acteur } });
}

export async function annulerSnooze(messageId: string): Promise<void> {
  const fil = await filDe(messageId);
  await prisma.message.updateMany({ where: { id: { in: fil.messages.map((m) => m.id) } }, data: { snoozeJusqua: null } });
}

/* ── Ranger à la main (lu + libellé), et le contraire ───────────────── */

/** Range le fil (lu, libellé CoverSwap/Rangé, hors de la boîte) sans poser de règle ; « déranger » le défait. */
export async function rangerMail(messageId: string, motif = "Rangé à la main"): Promise<{ ranges: number; adresse: string | null }> {
  const acteur = await acteurCourant();
  const fil = await filDe(messageId);
  const entrants = fil.messages.filter((m) => m.sens === "ENTRANT");
  if (entrants.length === 0) throw new ErreurMetier("Ce fil est parti de votre boîte : rien à ranger.", 400);
  const maintenant = new Date();
  await prisma.message.updateMany({ where: { id: { in: entrants.map((m) => m.id) } }, data: { rangeLe: maintenant, rangePar: courtDe(acteur), rangeMotif: motif.slice(0, 200), lu: true, remonteLe: null } });
  for (const m of entrants) await demanderEtatGmail(m.id);
  const adresse = entrants[entrants.length - 1]?.de ?? null;
  if (adresse) {
    const { detecterRegleApprise } = await import("./regles-apprises");
    await detecterRegleApprise(adresse).catch((erreur) => console.error("[mail] règle apprise :", erreur));
  }
  return { ranges: entrants.length, adresse };
}

export async function derangerMail(messageId: string): Promise<{ remis: number }> {
  const fil = await filDe(messageId);
  const ranges = fil.messages.filter((m) => m.rangeLe);
  await prisma.message.updateMany({ where: { id: { in: ranges.map((m) => m.id) } }, data: { rangeLe: null, rangePar: null, rangeMotif: null } });
  for (const m of ranges) await demanderEtatGmail(m.id);
  return { remis: ranges.length };
}

/* ── Ce que Claude va lire ──────────────────────────────────────────── */

export type MailACLasser = { messageId: string; fil: string; de: string; deNom: string | null; objet: string | null; recuLe: string; classe: string | null; contact: { type: "CLIENT" | "LEAD"; id: string; nom: string } | null; texte: string; pieces: number; messagesDuFil: number };

/** Les mails reçus, conservés, sans intention : la file de « Classe mes mails ». Un par fil (le dernier reçu), avec son texte. */
export async function mailsNonClasses(options: { limite?: number } = {}): Promise<MailACLasser[]> {
  const depuis = new Date(Date.now() - FENETRE_JOURS * JOUR);
  // Un fil est classé quand son DERNIER mail reçu l'est : on lit les fils, pas les mails un à un.
  const messages = await prisma.message.findMany({
    where: { canal: "EMAIL", sens: "ENTRANT", rangeLe: null, traiteLe: null, archiveLe: null, automatique: false, recuLe: { gte: depuis }, OR: [{ classe: { in: ["CLIENT", "HUMAIN", "ADMINISTRATIF"] } }, { classe: null }] },
    orderBy: { recuLe: "desc" },
    take: 600,
    select: { id: true, filCanal: true, de: true, deNom: true, objet: true, extrait: true, recuLe: true, classe: true, intention: true, clientId: true, leadId: true, client: { select: { nom: true } }, lead: { select: { prenom: true, nom: true } }, contenu: { select: { texte: true } }, _count: { select: { pieces: true } } },
  });
  const parFil = new Map<string, typeof messages>();
  for (const m of messages) {
    const cle = m.filCanal ?? m.id;
    parFil.set(cle, [...(parFil.get(cle) ?? []), m]);
  }
  return [...parFil.entries()].filter(([, liste]) => liste[0].intention === null).slice(0, options.limite ?? 15).map(([fil, liste]) => {
    const m = liste[0];
    return {
      messageId: m.id,
      fil,
      de: m.de,
      deNom: m.deNom,
      objet: m.objet,
      recuLe: m.recuLe.toISOString(),
      classe: m.classe,
      contact: m.clientId ? { type: "CLIENT" as const, id: m.clientId, nom: m.client?.nom ?? "" } : m.leadId ? { type: "LEAD" as const, id: m.leadId, nom: `${m.lead?.prenom ?? ""} ${m.lead?.nom ?? ""}`.trim() } : null,
      texte: (retirerCitations(m.contenu?.texte ?? m.extrait ?? "").trim() || m.extrait || "").slice(0, 1500),
      pieces: m._count.pieces,
      messagesDuFil: liste.length,
    };
  });
}

export type MailTrouve = { messageId: string; sens: "ENTRANT" | "SORTANT"; de: string; deNom: string | null; a: string[]; objet: string | null; recuLe: string; contact: { type: "CLIENT" | "LEAD"; id: string; nom: string } | null; dossierId: string | null; passage: string | null };

function passageAutour(texte: string, mots: string[]): string | null {
  const bas = texte.toLowerCase();
  for (const mot of mots) {
    const i = bas.indexOf(mot);
    if (i >= 0) return `…${texte.slice(Math.max(0, i - 90), Math.min(texte.length, i + mot.length + 110)).replace(/\s+/g, " ").trim()}…`;
  }
  return null;
}

/** Recherche plein texte : objet, corps, expéditeur, contact rattaché ; chaque mot doit s'y trouver ; dates facultatives. */
export async function rechercherMails(entree: { texte: string; du?: string | null; au?: string | null; limite?: number }): Promise<MailTrouve[]> {
  const mots = entree.texte.toLowerCase().split(/[\s,;]+/).map((m) => m.replace(/^[«"'(]+|[»"'.),!?]+$/g, "")).filter((m) => m.length >= 2).slice(0, 8);
  if (mots.length === 0) throw new ErreurMetier("Donne au moins un mot de deux lettres.", 400);
  const messages = await prisma.message.findMany({
    where: {
      canal: "EMAIL",
      archiveLe: null,
      ...(entree.du ? { recuLe: { gte: new Date(`${entree.du}T00:00:00+02:00`) } } : {}),
      ...(entree.au ? { AND: [{ recuLe: { lt: new Date(`${entree.au}T23:59:59+02:00`) } }] } : {}),
      // Chaque mot, quelque part : objet, texte, expéditeur, nom du client ou du lead.
      ...{ AND: mots.map((mot) => ({ OR: [{ objet: { contains: mot } }, { extrait: { contains: mot } }, { de: { contains: mot } }, { deNom: { contains: mot } }, { contenu: { texte: { contains: mot } } }, { client: { nom: { contains: mot } } }, { lead: { OR: [{ nom: { contains: mot } }, { prenom: { contains: mot } }] } }] })) },
    },
    orderBy: { recuLe: "desc" },
    take: entree.limite ?? 10,
    select: { id: true, sens: true, de: true, deNom: true, a: true, objet: true, extrait: true, recuLe: true, clientId: true, leadId: true, dossierId: true, client: { select: { nom: true } }, lead: { select: { prenom: true, nom: true } }, contenu: { select: { texte: true } } },
  });
  return messages.map((m) => ({
    messageId: m.id,
    sens: m.sens as "ENTRANT" | "SORTANT",
    de: m.de,
    deNom: m.deNom,
    a: lireListe(m.a),
    objet: m.objet,
    recuLe: m.recuLe.toISOString(),
    contact: m.clientId ? { type: "CLIENT" as const, id: m.clientId, nom: m.client?.nom ?? "" } : m.leadId ? { type: "LEAD" as const, id: m.leadId, nom: `${m.lead?.prenom ?? ""} ${m.lead?.nom ?? ""}`.trim() } : null,
    dossierId: m.dossierId,
    passage: passageAutour(retirerCitations(m.contenu?.texte ?? m.extrait ?? ""), mots) ?? m.extrait,
  }));
}

/* ── Brouillon déposé par l'assistant ───────────────────────────────── */

export type DepotBrouillon = { messageId?: string | null; clientId?: string | null; leadId?: string | null; dossierId?: string | null; a?: string | null; objet: string; texte: string };

/** Un texte écrit par Claude, attaché au mail ou au contact ; jamais envoyé : l'onglet Mail le montre avec Envoyer. */
export async function deposerBrouillon(entree: DepotBrouillon): Promise<{ id: string; a: string | null; enReponseA: string | null; aCompleter: number }> {
  let { clientId = null, leadId = null, dossierId = null, a = null } = entree;
  let enReponseA: string | null = null;
  if (entree.messageId) {
    const m = await prisma.message.findUnique({ where: { id: entree.messageId }, select: { id: true, sens: true, de: true, a: true, clientId: true, leadId: true, dossierId: true } });
    if (!m) throw new ErreurMetier("Mail introuvable.", 404);
    enReponseA = m.sens === "ENTRANT" ? m.id : null;
    clientId ??= m.clientId;
    leadId ??= m.leadId;
    dossierId ??= m.dossierId;
    a ??= m.sens === "ENTRANT" ? m.de : (lireListe(m.a)[0] ?? null);
  }
  const aCompleter = entree.texte.split(A_COMPLETER).length - 1;
  const b = await prisma.brouillonMail.create({
    data: {
      messageId: enReponseA,
      clientId,
      leadId,
      dossierId,
      a,
      source: "ASSISTANT",
      objetIa: entree.objet.trim().slice(0, 200),
      texteIa: entree.texte.trim().slice(0, 10_000),
      manques: JSON.stringify(aCompleter ? [`${aCompleter} « ${A_COMPLETER} » à remplacer avant l'envoi`] : []),
      corrections: "[]",
      contexte: "{}",
      coutEuros: null,
      statut: "BROUILLON",
    },
  });
  return { id: b.id, a, enReponseA, aCompleter };
}

export const lireDates = lireDatesExtraites;
