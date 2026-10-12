/**
 * Mission 25 — ce que lisent les écrans de la messagerie et les outils MCP : la liste des conversations (une ligne par
 * client), le fil d'un client (tous les canaux réunis), « Où on en est » et les dix dernières lignes du journal, et la
 * file du jour du mode « Un par un ». Lecture seule.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { estMotifRepondre } from "@/lib/dossiers/main";
import { lireParametre } from "@/lib/parametres/service";
import { definitionMessage, estCodeMessage, type CodeMessage } from "./catalogue";
import { texteCite } from "./etat";
import { instantParis, jourCourt, jourSuivant, momentParis } from "./horaires";
import { libelleDuCode } from "./redaction";
import { DEBUT_CAMPAGNE } from "./suivis";
import { lireFaits, lireOuEnEst, PROPOSITIONS_PAR_JOUR, type OuEnEst } from "./types";
import { avecMentionStop } from "@/lib/sms/texte";

export const FILTRES_CONVERSATIONS = ["TOUS", "NON_LUS", "A_ENVOYER", "A_TOI", "ATTENTE_CLIENT", "ARCHIVES"] as const;
export type FiltreConversations = (typeof FILTRES_CONVERSATIONS)[number];
export const LIBELLES_FILTRE: Record<FiltreConversations, string> = { TOUS: "Tous", NON_LUS: "Non lus", A_ENVOYER: "À envoyer", A_TOI: "À toi", ATTENTE_CLIENT: "En attente du client", ARCHIVES: "Archivés" };

export type MessageVue = {
  id: string;
  suiviId: string;
  code: string;
  libelle: string;
  canal: "SMS" | "MAIL" | "ESPACE";
  destinataire: string | null;
  texte: string;
  statut: string;
  prevuLe: string;
  envoyeLe: string | null;
  mode: string;
  reponse: boolean;
  douceur: boolean;
  raison: string | null;
  motif: string | null;
  nonConfirme: boolean;
  ouvert: boolean;
  ia: boolean;
  simulationId: string | null;
  /** Objet du mail (canal MAIL). */
  objet: string | null;
  /** Image à joindre (simulation, client « SMS d'abord ») : appui long pour l'enregistrer. */
  image: string | null;
};

/** Ajoute l'adresse de l'image à joindre (la simulation publiée) aux messages qui en ont une. */
export async function avecImages<T extends MessageVue>(vues: T[]): Promise<T[]> {
  const ids = [...new Set(vues.map((v) => v.simulationId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return vues;
  const simulations = await prisma.simulationEspace.findMany({ where: { ...AVEC_ARCHIVES, id: { in: ids } }, select: { id: true, chemin: true } });
  const chemin = new Map(simulations.map((s) => [s.id, s.chemin]));
  return vues.map((v) => (v.simulationId && chemin.get(v.simulationId) ? { ...v, image: `/api/uploads/${chemin.get(v.simulationId)}` } : v));
}

/**
 * Les suivis dont le prochain SMS sera le PREMIER envoyé à ce numéro (il portera « STOP pour ne plus recevoir nos SMS. ») :
 * aucun SMS de la messagerie confirmé, aucun SMS parti par le fournisseur ni copié d'un autre écran.
 */
export async function premiersSms(suiviIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(suiviIds)];
  if (!ids.length) return new Set();
  const suivis = await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES, id: { in: ids } }, select: { id: true, telephone: true, dossierId: true, leadId: true } });
  const envoyes = new Set((await prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, suiviId: { in: ids }, canal: "SMS", statut: "ENVOYE" }, select: { suiviId: true } })).map((m) => m.suiviId));
  const numeros = suivis.map((s) => s.telephone).filter((n): n is string => Boolean(n));
  const conversations = numeros.length ? await prisma.conversationSms.findMany({ where: { ...AVEC_ARCHIVES, numero: { in: numeros } }, select: { numero: true, premierEnvoiLe: true } }) : [];
  const dejaEcrit = new Set(conversations.filter((c) => c.premierEnvoiLe).map((c) => c.numero));
  const dossierIds = suivis.map((s) => s.dossierId).filter((d): d is string => Boolean(d));
  const copies = dossierIds.length ? new Set((await prisma.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, type: { in: ["SMS_COPIE", "SMS_ENVOYE"] } }, select: { dossierId: true } })).map((e) => e.dossierId)) : new Set<string>();
  return new Set(suivis.filter((s) => !envoyes.has(s.id) && !(s.telephone && dejaEcrit.has(s.telephone)) && !(s.dossierId && copies.has(s.dossierId))).map((s) => s.id));
}

/** Le texte tel qu'il partira : avec la mention STOP s'il est le premier SMS à ce numéro. */
export function texteAEnvoyer(m: { canal: string; texte: string; texteEnvoye?: string | null; statut: string }, premier: boolean): string {
  if (m.texteEnvoye) return m.texteEnvoye;
  return m.canal === "SMS" && premier && m.statut !== "ENVOYE" ? avecMentionStop(m.texte) : m.texte;
}

export function vueDuMessage(m: {
  id: string;
  suiviId: string;
  code: string;
  canal: string;
  destinataire: string | null;
  texte: string;
  texteEnvoye: string | null;
  statut: string;
  prevuLe: Date;
  envoyeLe: Date | null;
  mode: string;
  reponse: boolean;
  douceur: boolean;
  raison: string | null;
  motif: string | null;
  nonConfirmeLe: Date | null;
  ouvertLe: Date | null;
  ia: boolean;
  simulationId: string | null;
}, premier = false): MessageVue {
  const groupe = estCodeMessage(m.code) ? definitionMessage(m.code as CodeMessage).groupe : null;
  return {
    id: m.id,
    suiviId: m.suiviId,
    code: m.code,
    libelle: libelleDuCode(m.code),
    canal: m.canal as MessageVue["canal"],
    destinataire: m.destinataire,
    texte: texteAEnvoyer(m, premier),
    statut: m.statut,
    prevuLe: m.prevuLe.toISOString(),
    envoyeLe: m.envoyeLe?.toISOString() ?? null,
    mode: m.mode,
    reponse: m.reponse,
    douceur: m.douceur,
    raison: m.raison,
    motif: m.motif?.split("|").at(-1) ?? null,
    nonConfirme: Boolean(m.nonConfirmeLe),
    ouvert: Boolean(m.ouvertLe),
    ia: m.ia,
    simulationId: m.simulationId,
    objet: m.canal === "MAIL" ? (groupe === "DEVIS" ? "Votre devis CoverSwap" : groupe === "SIMULATION" ? "Votre simulation CoverSwap" : "Votre projet CoverSwap") : null,
    image: null,
  };
}

/* ── Liste des conversations ────────────────────────────────────────────────── */

export type LigneConversation = {
  suiviId: string;
  nom: string;
  initiales: string;
  situation: string;
  dernierLe: string | null;
  dernierExtrait: string | null;
  dernierSens: string | null;
  nonLu: boolean;
  etape: string;
  aEnvoyer: number;
  main: "A_TOI" | "AU_CLIENT" | null;
  telephone: string | null;
  ville: string | null;
  dossierId: string | null;
  leadId: string | null;
  archive: boolean;
  stop: boolean;
};

const initialesDe = (nom: string) =>
  nom
    .split(/[\s-]+/)
    .filter((m) => /\p{L}/u.test(m))
    .slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase())
    .join("") || "?";

const sansAccent = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export async function listerConversations(entree: { filtre?: FiltreConversations; recherche?: string | null; limite?: number } = {}, maintenant: Date = new Date()): Promise<{ lignes: LigneConversation[]; compteurs: Record<FiltreConversations, number> }> {
  const filtre = entree.filtre ?? "TOUS";
  const suivis = await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES }, orderBy: [{ dernierEchangeLe: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] });
  const ids = suivis.map((s) => s.id);
  const ouverts = ids.length ? await prisma.messagePrepare.groupBy({ by: ["suiviId"], where: { suiviId: { in: ids }, statut: { in: ["A_ENVOYER", "A_VALIDER"] } }, _count: { _all: true } }) : [];
  const parSuivi = new Map(ouverts.map((o) => [o.suiviId, o._count._all]));
  const dossierIds = suivis.map((s) => s.dossierId).filter((d): d is string => Boolean(d));
  const leadIds = suivis.map((s) => s.leadId).filter((d): d is string => Boolean(d));
  const [dossiers, leads] = await Promise.all([
    dossierIds.length ? prisma.dossier.findMany({ where: { ...AVEC_ARCHIVES, id: { in: dossierIds } }, select: { id: true, etape: true, clientVille: true, main: true, mainMotif: true, archiveLe: true } }) : [],
    leadIds.length ? prisma.lead.findMany({ where: { ...AVEC_ARCHIVES, id: { in: leadIds } }, select: { id: true, ville: true, statut: true, archiveLe: true } }) : [],
  ]);
  const dossierDe = new Map(dossiers.map((d) => [d.id, d]));
  const leadDe = new Map(leads.map((l) => [l.id, l]));
  const toutes: LigneConversation[] = suivis.map((s) => {
    const d = s.dossierId ? dossierDe.get(s.dossierId) : undefined;
    const l = s.leadId ? leadDe.get(s.leadId) : undefined;
    const ouEnEst = lireOuEnEst(s.ouEnEst);
    const nonLu = s.nonLu || (s.dernierSens === "CLIENT" && Boolean(s.dernierEchangeLe) && (!s.luLe || s.dernierEchangeLe!.getTime() > s.luLe.getTime()));
    const aToi = Boolean(d ? d.main === "MOI" || estMotifRepondre(d.mainMotif) : s.dernierSens === "CLIENT");
    return {
      suiviId: s.id,
      nom: s.nom,
      initiales: initialesDe(s.nom),
      situation: ouEnEst?.situation ?? "",
      dernierLe: s.dernierEchangeLe?.toISOString() ?? null,
      dernierExtrait: s.dernierExtrait,
      dernierSens: s.dernierSens,
      nonLu,
      etape: d ? LIBELLES_ETAPE[d.etape as EtapeDossier] ?? d.etape : l?.statut === "PERDU" ? "Sans suite" : "Lead",
      aEnvoyer: parSuivi.get(s.id) ?? 0,
      main: d?.main === "CLIENT" && !aToi ? "AU_CLIENT" : aToi ? "A_TOI" : null,
      telephone: s.telephone,
      ville: d?.clientVille ?? l?.ville ?? null,
      dossierId: s.dossierId,
      leadId: s.leadId,
      archive: Boolean(s.archiveLe || d?.archiveLe || (!d && l?.archiveLe)),
      stop: Boolean(s.stopLe),
    };
  });
  const garder = (f: FiltreConversations, x: LigneConversation) => {
    if (f === "ARCHIVES") return x.archive;
    if (x.archive) return false;
    switch (f) {
      case "NON_LUS":
        return x.nonLu;
      case "A_ENVOYER":
        return x.aEnvoyer > 0;
      case "A_TOI":
        return x.main === "A_TOI";
      case "ATTENTE_CLIENT":
        return x.main === "AU_CLIENT";
      default:
        return true;
    }
  };
  const compteurs = Object.fromEntries(FILTRES_CONVERSATIONS.map((f) => [f, toutes.filter((x) => garder(f, x)).length])) as Record<FiltreConversations, number>;
  const q = sansAccent(entree.recherche?.trim() ?? "");
  const chiffres = q.replace(/\D/g, "");
  let lignes = toutes.filter((x) => garder(filtre, x));
  if (q) lignes = lignes.filter((x) => sansAccent(x.nom).includes(q) || (x.ville && sansAccent(x.ville).includes(q)) || (chiffres.length >= 4 && (x.telephone ?? "").replace(/\D/g, "").includes(chiffres.replace(/^0/, ""))));
  void maintenant;
  return { lignes: lignes.slice(0, entree.limite ?? 200), compteurs };
}

/* ── Le fil d'un client ─────────────────────────────────────────────────────── */

export type ElementFil =
  | { genre: "BULLE"; id: string; le: string; sens: "CLIENT" | "TOI"; canal: "SMS" | "ESPACE" | "MAIL"; texte: string; code?: string | null; etat?: string | null }
  | { genre: "MAIL"; id: string; le: string; sens: "CLIENT" | "TOI"; objet: string; extrait: string }
  | { genre: "LIGNE"; id: string; le: string; texte: string }
  | { genre: "PREPARE"; id: string; le: string; message: MessageVue };

const TYPES_LIGNE = ["APPEL", "NOTE_AJOUTEE", "NOTE_APPEL", "CHANGEMENT_ETAPE", "DEVIS_ENVOYE", "ESPACE_SIMULATION_DEPOSEE", "ESPACE_PHOTOS", "ESPACE_DEVIS_ACCEPTE", "ENCAISSEMENT_ENREGISTRE", "ESPACE_SIMULATION_CHOISIE"];

function ligneGrise(type: string, contenu: string, metadata: string): string | null {
  const m = (() => {
    try {
      return JSON.parse(metadata || "{}") as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  switch (type) {
    case "APPEL":
      return contenu.replace(/^Appel — /, "Appel sortant · ").slice(0, 120);
    case "NOTE_AJOUTEE":
      if (m.documentId) return null;
      return `Note : ${contenu.replace(/^[^:]{0,30} : /, "").slice(0, 110)}`;
    case "NOTE_APPEL":
      return `Note : ${contenu.replace(/^Note d'appel\s*:?\s*/i, "").slice(0, 110)}`;
    case "CHANGEMENT_ETAPE":
      return typeof m.vers === "string" ? `Étape : ${LIBELLES_ETAPE[m.vers as EtapeDossier] ?? m.vers}` : null;
    case "DEVIS_ENVOYE":
      return contenu.slice(0, 120);
    case "ESPACE_SIMULATION_DEPOSEE":
      return "Simulation publiée dans son espace";
    case "ESPACE_PHOTOS":
      return contenu.slice(0, 120);
    case "ESPACE_DEVIS_ACCEPTE":
      return "Accord donné sur le devis";
    case "ESPACE_SIMULATION_CHOISIE":
      return "Simulation choisie";
    case "ENCAISSEMENT_ENREGISTRE":
      return `Paiement reçu${typeof m.montant === "number" ? ` · ${Math.round(m.montant)} €` : ""}`;
    default:
      return null;
  }
}

export async function filDuSuivi(suiviId: string): Promise<ElementFil[]> {
  const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) return [];
  const elements: ElementFil[] = [];
  const messages = await prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, suiviId } });
  const idsMessagerie = new Set(messages.map((m) => m.id));
  const numero = suivi.telephone;
  const conversation = numero ? await prisma.conversationSms.findFirst({ where: { ...AVEC_ARCHIVES, numero } }) : null;
  const sms = conversation ? await prisma.sms.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } }) : [];
  const smsMontres = new Set<string>();
  for (const s of sms) {
    smsMontres.add(s.id);
    elements.push({ genre: "BULLE", id: `sms:${s.id}`, le: (s.recuLe ?? s.envoyeLe ?? s.createdAt).toISOString(), sens: s.sens === "ENTRANT" ? "CLIENT" : "TOI", canal: "SMS", texte: s.texte, etat: s.sens === "SORTANT" ? (s.statut === "DELIVRE" ? "Distribué" : s.statut === "ECHEC" ? "Échec" : null) : null });
  }
  if (suivi.dossierId) {
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId: suivi.dossierId }, orderBy: { createdAt: "asc" } });
    for (const e of evenements) {
      const le = (e.survenuLe ?? e.createdAt).toISOString();
      const meta = (() => {
        try {
          return JSON.parse(e.metadata || "{}") as Record<string, unknown>;
        } catch {
          return {} as Record<string, unknown>;
        }
      })();
      if (e.type === "SMS_RECU" || e.type === "SMS_ENVOYE") {
        if (typeof meta.smsId === "string" && smsMontres.has(meta.smsId)) continue;
        elements.push({ genre: "BULLE", id: `ev:${e.id}`, le, sens: e.type === "SMS_RECU" ? "CLIENT" : "TOI", canal: "SMS", texte: texteCite(e.contenu) });
      } else if (e.type === "SMS_COPIE") {
        if (typeof meta.messageId === "string" && idsMessagerie.has(meta.messageId)) continue;
        elements.push({ genre: "BULLE", id: `ev:${e.id}`, le, sens: "TOI", canal: meta.canal === "MAIL" ? "MAIL" : "SMS", texte: typeof meta.texte === "string" ? meta.texte : texteCite(e.contenu), code: typeof meta.code === "string" ? meta.code : null });
      } else if (e.type === "ESPACE_MESSAGE" || e.type === "ESPACE_COMMENTAIRE" || e.type === "ESPACE_NOUVELLE_PROPOSITION") {
        elements.push({ genre: "BULLE", id: `ev:${e.id}`, le, sens: "CLIENT", canal: "ESPACE", texte: texteCite(e.contenu) });
      } else if (e.type === "ESPACE_REPONSE") {
        elements.push({ genre: "BULLE", id: `ev:${e.id}`, le, sens: "TOI", canal: "ESPACE", texte: texteCite(e.contenu) });
      } else if (e.type === "MAIL_RECU" || e.type === "MAIL_ENVOYE") {
        const texte = texteCite(e.contenu);
        elements.push({ genre: "MAIL", id: `ev:${e.id}`, le, sens: e.type === "MAIL_RECU" ? "CLIENT" : "TOI", objet: (typeof meta.objet === "string" ? meta.objet : texte.split("\n")[0]).slice(0, 90), extrait: texte.slice(0, 400) });
      } else if (TYPES_LIGNE.includes(e.type)) {
        const texte = ligneGrise(e.type, e.contenu, e.metadata);
        if (texte) elements.push({ genre: "LIGNE", id: `ev:${e.id}`, le, texte });
      }
    }
  } else if (suivi.leadId) {
    const interactions = await prisma.interaction.findMany({ where: { leadId: suivi.leadId }, orderBy: { createdAt: "asc" } });
    for (const i of interactions) {
      const le = i.createdAt.toISOString();
      if (i.type === "SMS") {
        if (/^Messagerie — /.test(i.contenu)) continue;
        if (/^SMS reçu/.test(i.contenu)) {
          if (sms.some((s) => s.sens === "ENTRANT" && Math.abs(s.createdAt.getTime() - i.createdAt.getTime()) < 5_000)) continue;
          elements.push({ genre: "BULLE", id: `in:${i.id}`, le, sens: "CLIENT", canal: "SMS", texte: texteCite(i.contenu) });
        } else {
          if (sms.some((s) => s.sens === "SORTANT" && Math.abs(s.createdAt.getTime() - i.createdAt.getTime()) < 5_000)) continue;
          elements.push({ genre: "BULLE", id: `in:${i.id}`, le, sens: "TOI", canal: "SMS", texte: texteCite(i.contenu) });
        }
      } else if (i.type === "APPEL") elements.push({ genre: "LIGNE", id: `in:${i.id}`, le, texte: i.contenu.replace(/^Appel — /, "Appel sortant · ").slice(0, 120) });
      else if (i.type === "NOTE") elements.push({ genre: "LIGNE", id: `in:${i.id}`, le, texte: `Note : ${i.contenu.split("\n")[0].slice(0, 110)}` });
    }
  }
  const premier = (await premiersSms([suiviId])).has(suiviId);
  for (const m of messages) {
    if (m.statut === "ENVOYE" && m.envoyeLe) elements.push({ genre: "BULLE", id: `msg:${m.id}`, le: m.envoyeLe.toISOString(), sens: "TOI", canal: m.canal as "SMS" | "MAIL" | "ESPACE", texte: m.texteEnvoye ?? m.texte, code: m.code });
    else if (["A_ENVOYER", "A_VALIDER", "PREVU"].includes(m.statut)) elements.push({ genre: "PREPARE", id: `msg:${m.id}`, le: (m.statut === "PREVU" ? m.prevuLe : m.createdAt).toISOString(), message: vueDuMessage(m, premier) });
    else if (m.statut === "NON_ENVOYE") elements.push({ genre: "LIGNE", id: `msg:${m.id}`, le: m.updatedAt.toISOString(), texte: `${libelleDuCode(m.code)} non envoyé${m.motif ? ` : ${m.motif.split("|").at(-1)!.toLowerCase()}` : ""}` });
  }
  const prepares = elements.filter((e): e is Extract<ElementFil, { genre: "PREPARE" }> => e.genre === "PREPARE");
  const illustres = await avecImages(prepares.map((p) => p.message));
  prepares.forEach((p, i) => (p.message = illustres[i]));
  return elements.sort((a, b) => a.le.localeCompare(b.le));
}

/** « Où on en est » et les dix dernières lignes du journal (les plus récentes en haut). */
export async function ouEnEstDuSuivi(suiviId: string): Promise<{ ouEnEst: OuEnEst | null; journal: { le: string; acteur: string; texte: string }[]; prochaineAction: string | null; faits: ReturnType<typeof lireFaits> } | null> {
  const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) return null;
  const lignes = await prisma.ligneJournalSuivi.findMany({ where: { suiviId }, orderBy: [{ le: "desc" }, { createdAt: "desc" }], take: 10 });
  return { ouEnEst: lireOuEnEst(suivi.ouEnEst), journal: lignes.map((l) => ({ le: l.le.toISOString(), acteur: l.acteur, texte: l.texte })), prochaineAction: suivi.prochaineAction, faits: lireFaits(suivi.faits) };
}

/* ── La file du jour (« Un par un ») ────────────────────────────────────────── */

export type CarteUnParUn = {
  cle: string;
  genre: "REPONSE" | "MESSAGE" | "APPEL" | "PROPOSITION";
  suiviId: string;
  nom: string;
  telephone: string | null;
  ouEnEst: OuEnEst | null;
  message: MessageVue | null;
  /** Le message du client auquel répondre (cartes « réponse »). */
  dernierMessageClient: { le: string; texte: string } | null;
  raison: string;
  dossierId: string | null;
  leadId: string | null;
  /** Corrections du 12/10 : la carte propose de classer le client (« Sans suite », ou « Perdu » après D5). */
  classer?: "SANS_SUITE" | "PERDU" | null;
};

/** Un rappel passé depuis plus de 7 jours sort des appels : il est proposé « Sans suite » (corrections du 12/10). */
export const JOURS_RAPPEL_SANS_SUITE = 7;

/**
 * La file du jour, dans l'ordre du cahier : les réponses des clients à traiter, puis les messages dont l'heure est
 * passée (ceux d'hier non confirmés en tête), puis les appels à passer, puis les propositions à valider.
 *
 * Corrections du 12/10 : une seule carte par client (par suivi, et par numéro : deux fiches, un client) ; pas d'appel
 * pour un dossier perdu, ni pour un client qui a déjà un message dans la file (sa carte est ce message) ; un rappel
 * passé depuis plus de 7 jours devient une proposition « Sans suite » ; 8 propositions au plus, toutes situations
 * confondues (messages à valider, passages d'étape, « Sans suite »).
 */
export async function fileDuJour(maintenant: Date = new Date()): Promise<{ cartes: CarteUnParUn[]; compteurs: Record<CarteUnParUn["genre"], number>; pause: boolean }> {
  const pause = (await lireParametre("MESSAGERIE_PAUSE", maintenant)) === "EN_PAUSE";
  const finDuJour = instantParis(jourSuivant(momentParis(maintenant).jour), 0);
  const limiteRappel = new Date(maintenant.getTime() - JOURS_RAPPEL_SANS_SUITE * 86_400_000);
  const ouverts = await prisma.messagePrepare.findMany({ where: { statut: { in: ["A_ENVOYER", "A_VALIDER"] } }, orderBy: [{ prevuLe: "asc" }] });
  const premiers = await premiersSms(ouverts.map((m) => m.suiviId));
  const suivis = await prisma.suivi.findMany({ where: { archiveLe: null } });
  const suiviDe = new Map(suivis.map((s) => [s.id, s]));
  const suiviDuLead = new Map(suivis.filter((s) => s.leadId).map((s) => [s.leadId!, s]));
  const suiviDuDossier = new Map(suivis.filter((s) => s.dossierId).map((s) => [s.dossierId!, s]));
  // Fermés : dossier perdu ou archivé, lead perdu ou archivé (sans dossier). Jamais d'appel ni de proposition pour eux.
  const [dossiersFermes, leadsFermes] = await Promise.all([
    prisma.dossier.findMany({ where: { ...AVEC_ARCHIVES, id: { in: [...suiviDuDossier.keys()] }, OR: [{ etape: "PERDU" }, { archiveLe: { not: null } }] }, select: { id: true } }),
    prisma.lead.findMany({ where: { ...AVEC_ARCHIVES, id: { in: suivis.filter((s) => s.leadId && !s.dossierId).map((s) => s.leadId!) }, OR: [{ statut: "PERDU" }, { archiveLe: { not: null } }] }, select: { id: true } }),
  ]);
  const fermes = new Set<string>([...dossiersFermes.map((d) => suiviDuDossier.get(d.id)?.id), ...leadsFermes.map((l) => suiviDuLead.get(l.id)?.id)].filter((x): x is string => Boolean(x)));
  const avecMessage = new Set(ouverts.map((m) => m.suiviId));

  const cartes: CarteUnParUn[] = [];
  const suivisPris = new Set<string>();
  const numerosPris = new Set<string>();
  const base = (s: (typeof suivis)[number]) => ({ suiviId: s.id, nom: s.nom, telephone: s.telephone, ouEnEst: lireOuEnEst(s.ouEnEst), dossierId: s.dossierId, leadId: s.leadId });
  /** Une carte par client : un suivi, ou un numéro, qui a déjà sa carte n'en reçoit pas d'autre. */
  const ajouter = (carte: CarteUnParUn): boolean => {
    if (suivisPris.has(carte.suiviId) || (carte.telephone && numerosPris.has(carte.telephone))) return false;
    cartes.push(carte);
    suivisPris.add(carte.suiviId);
    if (carte.telephone) numerosPris.add(carte.telephone);
    return true;
  };

  // 1. Réponses des clients à traiter : une réponse proposée, ou un client qui attend une réponse.
  for (const m of ouverts.filter((x) => x.statut === "A_ENVOYER" && x.cle.startsWith("REPONSE:"))) {
    const s = suiviDe.get(m.suiviId);
    if (!s || suivisPris.has(s.id)) continue;
    const dernier = await dernierMessageClient(s.id, s.dossierId, s.leadId, s.telephone);
    ajouter({ cle: `msg:${m.id}`, genre: "REPONSE", ...base(s), message: vueDuMessage(m, premiers.has(m.suiviId)), dernierMessageClient: dernier, raison: m.raison ?? "Réponse proposée" });
  }
  const dossiersARepondre = await prisma.dossier.findMany({ where: { archiveLe: null, main: "MOI", mainMotif: { startsWith: "Répondre" } }, select: { id: true } });
  for (const d of dossiersARepondre) {
    const s = suiviDuDossier.get(d.id);
    if (!s || suivisPris.has(s.id)) continue;
    const dernier = await dernierMessageClient(s.id, s.dossierId, s.leadId, s.telephone);
    ajouter({ cle: `repondre:${s.id}`, genre: "REPONSE", ...base(s), message: null, dernierMessageClient: dernier, raison: "Le client attend ta réponse" });
  }

  // 2. Les messages dont l'heure est passée (non confirmés d'hier en tête).
  const dus = ouverts
    .filter((m) => m.statut === "A_ENVOYER" && !m.cle.startsWith("REPONSE:"))
    .sort((a, b) => Number(Boolean(b.nonConfirmeLe)) - Number(Boolean(a.nonConfirmeLe)) || a.prevuLe.getTime() - b.prevuLe.getTime());
  for (const m of dus) {
    const s = suiviDe.get(m.suiviId);
    if (!s) continue;
    ajouter({ cle: `msg:${m.id}`, genre: "MESSAGE", ...base(s), message: vueDuMessage(m, premiers.has(m.suiviId)), dernierMessageClient: null, raison: m.nonConfirmeLe ? "Pas confirmé hier : l'avais-tu envoyé ?" : m.raison ?? "" });
  }

  // 3. Les appels à passer : leads de la campagne jamais appelés, rappels de moins de 7 jours, suite « l'appeler ».
  //    Un rappel plus ancien est proposé « Sans suite » (4) ; un dossier perdu, un client qui a un message dans la file
  //    (sa carte est ce message) ou qui a dit STOP n'ont pas de carte d'appel.
  const leadsAAppeler = await prisma.lead.findMany({ where: { archiveLe: null, createdAt: { gte: DEBUT_CAMPAGNE }, dernierAppelLe: null, statut: { not: "PERDU" }, dossiers: { none: {} } }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const rappelsLeads = await prisma.lead.findMany({ where: { archiveLe: null, rappelLe: { lt: finDuJour }, statut: { not: "PERDU" } }, select: { id: true, rappelLe: true }, orderBy: { rappelLe: "asc" } });
  const rappelsDossiers = await prisma.dossier.findMany({ where: { archiveLe: null, etape: { not: "PERDU" }, prochaineAction: { startsWith: "Rappeler" }, prochaineActionDate: { lt: finDuJour } }, select: { id: true, prochaineActionDate: true }, orderBy: { prochaineActionDate: "asc" } });
  const sansSuite = new Map<string, Date>();
  const aAppeler = new Set<string>();
  const rappel = (s: (typeof suivis)[number] | undefined, le: Date | null) => {
    if (!s) return;
    if (le && le.getTime() < limiteRappel.getTime()) {
      if (!sansSuite.has(s.id)) sansSuite.set(s.id, le);
    } else aAppeler.add(s.id);
  };
  for (const l of rappelsLeads) rappel(suiviDuLead.get(l.id), l.rappelLe);
  for (const d of rappelsDossiers) rappel(suiviDuDossier.get(d.id), d.prochaineActionDate);
  for (const l of leadsAAppeler) {
    const s = suiviDuLead.get(l.id);
    if (s && !sansSuite.has(s.id)) aAppeler.add(s.id);
  }
  for (const s of suivis) if (/^l'appeler/.test(s.prochaineAction ?? "") && !sansSuite.has(s.id)) aAppeler.add(s.id);
  for (const id of aAppeler) {
    const s = suiviDe.get(id);
    if (!s || s.stopLe || fermes.has(id) || avecMessage.has(id) || sansSuite.has(id)) continue;
    ajouter({ cle: `appel:${id}`, genre: "APPEL", ...base(s), message: null, dernierMessageClient: null, raison: s.prochaineAction ?? "À appeler" });
  }

  // 4. Les propositions à valider, 8 au plus : démarrage en douceur, passages d'étape proposés, rappels sans suite.
  let propositions = 0;
  const proposer = (carte: CarteUnParUn) => {
    if (propositions >= PROPOSITIONS_PAR_JOUR) return;
    if (ajouter(carte)) propositions++;
  };
  for (const m of ouverts.filter((x) => x.statut === "A_VALIDER")) {
    const s = suiviDe.get(m.suiviId);
    if (!s || fermes.has(s.id)) continue;
    proposer({ cle: `msg:${m.id}`, genre: "PROPOSITION", ...base(s), message: vueDuMessage(m, premiers.has(m.suiviId)), dernierMessageClient: null, raison: m.raison ?? "Proposition" });
  }
  for (const s of suivis.filter((x) => /^décider/.test(x.prochaineAction ?? ""))) {
    if (fermes.has(s.id)) continue;
    proposer({ cle: `etape:${s.id}`, genre: "PROPOSITION", ...base(s), message: null, dernierMessageClient: null, raison: s.prochaineAction ?? "", classer: /perdu/i.test(s.prochaineAction ?? "") ? "PERDU" : "SANS_SUITE" });
  }
  for (const [id, le] of sansSuite) {
    const s = suiviDe.get(id);
    if (!s || s.stopLe || fermes.has(id) || avecMessage.has(id)) continue;
    proposer({ cle: `sans-suite:${id}`, genre: "PROPOSITION", ...base(s), message: null, dernierMessageClient: null, raison: `Rappel prévu le ${jourCourt(le)}, sans nouvelles depuis : le classer « Sans suite » ?`, classer: "SANS_SUITE" });
  }

  const compteurs = { REPONSE: 0, MESSAGE: 0, APPEL: 0, PROPOSITION: 0 };
  for (const c of cartes) compteurs[c.genre]++;
  const avecTexte = cartes.filter((c) => c.message);
  const illustres = await avecImages(avecTexte.map((c) => c.message!));
  avecTexte.forEach((c, i) => (c.message = illustres[i]));
  return { cartes, compteurs, pause };
}

/** Le dernier message du client (SMS, espace, mail), pour la carte « réponse ». */
async function dernierMessageClient(suiviId: string, dossierId: string | null, leadId: string | null, telephone: string | null): Promise<{ le: string; texte: string } | null> {
  const candidats: { le: Date; texte: string }[] = [];
  if (dossierId) {
    const e = await prisma.dossierEvenement.findFirst({ where: { dossierId, direction: "ENTRANT", type: { in: ["SMS_RECU", "ESPACE_MESSAGE", "ESPACE_COMMENTAIRE", "MAIL_RECU", "WHATSAPP_RECU", "ESPACE_NOUVELLE_PROPOSITION"] } }, orderBy: { createdAt: "desc" } });
    if (e) candidats.push({ le: e.survenuLe ?? e.createdAt, texte: texteCite(e.contenu) });
  }
  if (telephone) {
    const conversation = await prisma.conversationSms.findFirst({ where: { ...AVEC_ARCHIVES, numero: telephone } });
    const s = conversation ? await prisma.sms.findFirst({ where: { conversationId: conversation.id, sens: "ENTRANT" }, orderBy: { createdAt: "desc" } }) : null;
    if (s) candidats.push({ le: s.recuLe ?? s.createdAt, texte: s.texte });
  }
  void suiviId;
  void leadId;
  const dernier = candidats.sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  return dernier ? { le: dernier.le.toISOString(), texte: dernier.texte } : null;
}

/** L'état de la messagerie pour les écrans (mode, pause, IA, compteurs). */
export async function etatMessagerie(maintenant: Date = new Date()) {
  const [mode, pause, aEnvoyer, aValider] = await Promise.all([
    lireParametre("MESSAGERIE_MODE_ENVOI", maintenant),
    lireParametre("MESSAGERIE_PAUSE", maintenant),
    prisma.messagePrepare.count({ where: { statut: "A_ENVOYER" } }),
    prisma.messagePrepare.count({ where: { statut: "A_VALIDER" } }),
  ]);
  const { iaDisponible } = await import("./ia");
  const ia = await iaDisponible(maintenant);
  return { mode: mode === "ANDROID" ? "ANDROID" : "MANUEL", pause: pause === "EN_PAUSE", aEnvoyer, aValider, ia: { active: ia.ok, raison: ia.raison, depense: Math.round(ia.depense * 100) / 100, budget: ia.budget } };
}
