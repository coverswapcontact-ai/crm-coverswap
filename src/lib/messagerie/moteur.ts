/**
 * Mission 25 — le moteur (cahier, § Le moteur de relances) : toutes les 15 minutes, et à l'heure prévue de chaque
 * message (une tâche par quart d'heure), il regarde les messages préparés, applique la garde de silence et les horaires,
 * et place dans la file ce qui est dû ; une seule alerte par quart d'heure (« 3 messages prêts »). L'IA n'y est jamais
 * appelée : elle ne coûte rien quand rien ne se passe.
 *
 * Le balayage repère ce qui a bougé (toutes sources) depuis le précédent et met en file l'analyse des suivis touchés :
 * 90 secondes après le dernier message d'un client (une seule analyse pour une rafale), 2 secondes sinon.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametre } from "@/lib/parametres/service";
import { mettreEnFile } from "@/lib/taches/file";
import { prevenirLucas } from "./alertes";
import { analyserSuivi, ecrireLigne } from "./analyse";
import { chargerEtat } from "./etat";
import { garder } from "./garde";
import { dateAbsolue, instantParis, momentParis } from "./horaires";
import { libelleDuCode } from "./redaction";
import { DEBUT_CAMPAGNE, lancementMessagerie, suiviPour } from "./suivis";
import type { StatutMessage } from "./types";

export const TYPE_ANALYSE = "MESSAGERIE_ANALYSE";
export const TYPE_BALAYAGE = "MESSAGERIE_SCAN";
export const TYPE_ECHEANCE = "MESSAGERIE_ECHEANCE";
export const CLE_BALAYAGE = "messagerie:scan";
export const ATTENTE_RAFALE_MS = 90_000;
export const QUART_D_HEURE_MS = 15 * 60_000;

export async function enPause(maintenant: Date = new Date()): Promise<boolean> {
  return (await lireParametre("MESSAGERIE_PAUSE", maintenant)) === "EN_PAUSE";
}

/** Met en file l'analyse d'un suivi, au plus tôt à `apres` (une seule tâche par suivi, repoussée à chaque geste). */
export async function demanderAnalyse(suiviId: string, apres: Date = new Date(Date.now() + 2_000)): Promise<void> {
  await mettreEnFile({ type: TYPE_ANALYSE, cle: `messagerie-analyse:${suiviId}`, charge: { suiviId }, mode: "RECONCILIATION", apres, tentativesMax: 3 });
}

/** Demande la relecture des messages dus à l'heure voulue (une tâche par quart d'heure). */
export async function demanderEcheance(le: Date): Promise<void> {
  const quart = Math.ceil(le.getTime() / QUART_D_HEURE_MS) * QUART_D_HEURE_MS;
  const vise = new Date(Math.max(le.getTime(), Date.now() + 1_000));
  await mettreEnFile({ type: TYPE_ECHEANCE, cle: `messagerie-echeance:${new Date(quart).toISOString()}`, charge: { le: vise.toISOString() }, apres: vise, tentativesMax: 3 });
}

/**
 * Les messages prévus dont l'heure est passée : garde de silence et horaires, puis « à envoyer » (avec alerte), décalés,
 * retenus ou annulés, chaque décision écrite au journal du suivi avec sa raison.
 */
export async function traiterEcheances(maintenant: Date = new Date(), filtre: { suiviId?: string; sansAnalyse?: boolean } = {}): Promise<{ aEnvoyer: number; reportes: number; retenus: number; annules: number }> {
  const bilan = { aEnvoyer: 0, reportes: 0, retenus: 0, annules: 0 };
  if (await enPause(maintenant)) return bilan;
  const dus = await prisma.messagePrepare.findMany({ where: { statut: "PREVU", prevuLe: { lte: maintenant }, ...(filtre.suiviId ? { suiviId: filtre.suiviId } : {}) }, orderBy: { prevuLe: "asc" } });
  if (!dus.length) {
    await notifierPrets(maintenant);
    return bilan;
  }
  const lancement = await lancementMessagerie(maintenant);
  const parSuivi = new Map<string, typeof dus>();
  for (const m of dus) parSuivi.set(m.suiviId, [...(parSuivi.get(m.suiviId) ?? []), m]);
  for (const [suiviId, messages] of parSuivi) {
    const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
    if (!suivi) continue;
    const { etat } = await chargerEtat(suivi, lancement, maintenant);
    for (const message of messages) {
      const decision = garder(etat, message, maintenant);
      const libelle = libelleDuCode(message.code);
      if (decision.decision === "ENVOYER") {
        await prisma.messagePrepare.update({ where: { id: message.id }, data: { statut: "A_ENVOYER" } });
        const connu = etat.messages.find((m) => m.id === message.id);
        if (connu) connu.statut = "A_ENVOYER";
        await ecrireLigne(suiviId, { cle: `msg:${message.id}:pret`, le: maintenant, acteur: "IA", texte: `${libelle} prêt à envoyer` });
        bilan.aEnvoyer++;
      } else if (decision.decision === "REPORTER") {
        await prisma.messagePrepare.update({ where: { id: message.id }, data: { prevuLe: decision.jusqua, reports: { increment: 1 }, motif: decision.motif } });
        await ecrireLigne(suiviId, { cle: `msg:${message.id}:report:${momentParis(decision.jusqua).jour}:${decision.motif.slice(0, 40)}`, le: maintenant, acteur: "IA", texte: `${libelle} décalé au ${dateAbsolue(decision.jusqua)} : ${decision.motif}` });
        await demanderEcheance(decision.jusqua);
        bilan.reportes++;
      } else {
        const statut: StatutMessage = decision.decision === "RETENIR" ? "RETENU" : "ANNULE";
        await prisma.messagePrepare.update({ where: { id: message.id }, data: { statut, motif: decision.motif } });
        await ecrireLigne(suiviId, { cle: `msg:${message.id}:${statut.toLowerCase()}`, le: maintenant, acteur: "IA", texte: `${libelle} ${statut === "RETENU" ? "retenu" : "annulé"} : ${decision.motif}` });
        if (statut === "RETENU") bilan.retenus++;
        else bilan.annules++;
      }
    }
    if (!filtre.sansAnalyse) await demanderAnalyse(suiviId);
  }
  await notifierPrets(maintenant);
  return bilan;
}

/**
 * Une alerte pour les messages devenus « à envoyer » : une par quart d'heure au plus (« Message prêt pour Mme X »,
 * « 3 messages prêts ») ; les propositions du démarrage en douceur n'en ont pas.
 */
export async function notifierPrets(maintenant: Date = new Date()): Promise<number> {
  const aPrevenir = await prisma.messagePrepare.findMany({ where: { statut: "A_ENVOYER", notifieLe: null, douceur: false }, orderBy: { prevuLe: "asc" } });
  if (!aPrevenir.length) return 0;
  const derniere = await prisma.messagePrepare.aggregate({ _max: { notifieLe: true }, where: { ...AVEC_ARCHIVES, notifieLe: { not: null } } });
  const derniereLe = derniere._max.notifieLe;
  if (derniereLe && maintenant.getTime() - derniereLe.getTime() < QUART_D_HEURE_MS) {
    await demanderEcheance(new Date(derniereLe.getTime() + QUART_D_HEURE_MS));
    return 0;
  }
  const suivis = await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES, id: { in: [...new Set(aPrevenir.map((m) => m.suiviId))] } }, select: { id: true, nom: true, telephone: true } });
  const nomDe = (suiviId: string) => suivis.find((s) => s.id === suiviId)?.nom ?? "un client";
  const premier = aPrevenir[0];
  if (aPrevenir.length === 1) {
    await prevenirLucas({
      titre: premier.cle.startsWith("REPONSE:") ? `Réponse prête pour ${nomDe(premier.suiviId)}` : `Message prêt pour ${nomDe(premier.suiviId)}`,
      texte: `${libelleDuCode(premier.code)} — « ${premier.texte.slice(0, 110)}${premier.texte.length > 110 ? "…" : ""} »`,
      chemin: `/messagerie?message=${premier.id}`,
      libelleLien: "Ouvrir le message",
      etiquette: "messagerie-pret",
      origine: "messagerie-pret",
    });
  } else {
    const noms = [...new Set(aPrevenir.map((m) => nomDe(m.suiviId)))];
    await prevenirLucas({
      titre: `${aPrevenir.length} messages prêts`,
      texte: `${noms.slice(0, 4).join(", ")}${noms.length > 4 ? "…" : ""}. Un par un, depuis la messagerie.`,
      chemin: "/messagerie?vue=un-par-un",
      libelleLien: "Un par un",
      etiquette: "messagerie-pret",
      origine: "messagerie-pret",
    });
  }
  await prisma.messagePrepare.updateMany({ where: { id: { in: aPrevenir.map((m) => m.id) } }, data: { notifieLe: maintenant } });
  return aPrevenir.length;
}

/** 19 h 30 passées sans confirmation : le message est considéré non envoyé et revient en tête le lendemain. */
export async function marquerNonConfirmes(maintenant: Date = new Date()): Promise<number> {
  const { jour, minutes } = momentParis(maintenant);
  const limite = minutes >= 19 * 60 + 30 ? instantParis(jour, 19 * 60 + 30) : instantParis(jour, 0);
  const restes = await prisma.messagePrepare.findMany({ where: { statut: "A_ENVOYER", nonConfirmeLe: null, prevuLe: { lt: limite } }, select: { id: true, suiviId: true, code: true } });
  for (const m of restes) {
    await prisma.messagePrepare.update({ where: { id: m.id }, data: { nonConfirmeLe: maintenant } });
    await ecrireLigne(m.suiviId, { cle: `msg:${m.id}:non-confirme`, le: maintenant, acteur: "IA", texte: `${libelleDuCode(m.code)} pas confirmé à 19 h 30 : considéré non envoyé, il revient en tête demain` });
  }
  return restes.length;
}

/* ── Balayage : ce qui a bougé depuis le précédent ─────────────────────────── */

const CLE_DERNIER_BALAYAGE = "__coverswapDernierBalayageMessagerie";
const memoire = globalThis as unknown as Record<string, number | undefined>;
const TYPES_MESSAGE_ENTRANT = ["SMS_RECU", "ESPACE_MESSAGE", "ESPACE_COMMENTAIRE", "MAIL_RECU", "WHATSAPP_RECU", "ESPACE_NOUVELLE_PROPOSITION"];

/** Les suivis touchés depuis `depuis`, avec l'heure du dernier message entrant (pour attendre la fin d'une rafale). */
export async function balayer(maintenant: Date = new Date(), depuisForce?: Date): Promise<number> {
  const precedent = memoire[CLE_DERNIER_BALAYAGE];
  const depuis = depuisForce ?? new Date(Math.min(maintenant.getTime() - 60_000, precedent ? precedent - 5_000 : maintenant.getTime() - 10 * 60_000));
  memoire[CLE_DERNIER_BALAYAGE] = maintenant.getTime();
  const dossiers = new Map<string, number>();
  const leads = new Map<string, { message: number; geste: boolean }>();
  const toucherDossier = (id: string | null | undefined, message = 0) => id && dossiers.set(id, Math.max(dossiers.get(id) ?? 0, message));
  const toucherLead = (id: string | null | undefined, message = 0, geste = false) => {
    if (!id) return;
    const avant = leads.get(id);
    leads.set(id, { message: Math.max(avant?.message ?? 0, message), geste: Boolean(avant?.geste || geste) });
  };
  const gte = { gte: depuis };
  const [evenements, dossiersModifies, leadsModifies, interactions, notes, sms, documents, simulations, espaces, accords, encaissements] = await Promise.all([
    prisma.dossierEvenement.findMany({ where: { createdAt: gte }, select: { dossierId: true, type: true, direction: true, createdAt: true } }),
    prisma.dossier.findMany({ where: { ...AVEC_ARCHIVES, updatedAt: gte }, select: { id: true } }),
    prisma.lead.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ createdAt: gte }, { updatedAt: gte }] }, select: { id: true, createdAt: true } }),
    prisma.interaction.findMany({ where: { createdAt: gte }, select: { leadId: true } }),
    prisma.noteAppel.findMany({ where: { updatedAt: gte }, select: { leadId: true } }),
    prisma.sms.findMany({ where: { createdAt: gte }, select: { leadId: true, dossierId: true, sens: true, createdAt: true } }),
    prisma.document.findMany({ where: { updatedAt: gte }, select: { dossierId: true } }),
    prisma.simulationEspace.findMany({ where: { updatedAt: gte }, select: { dossierId: true } }),
    prisma.espaceClient.findMany({ where: { updatedAt: gte }, select: { dossierId: true } }),
    prisma.accordDevis.findMany({ where: { createdAt: gte }, select: { dossierId: true } }),
    prisma.encaissement.findMany({ where: { updatedAt: gte }, select: { dossierId: true } }),
  ]);
  for (const e of evenements) toucherDossier(e.dossierId, e.direction === "ENTRANT" && TYPES_MESSAGE_ENTRANT.includes(e.type) ? e.createdAt.getTime() : 0);
  for (const d of [...dossiersModifies.map((x) => x.id), ...documents.map((x) => x.dossierId), ...simulations.map((x) => x.dossierId), ...espaces.map((x) => x.dossierId), ...accords.map((x) => x.dossierId), ...encaissements.map((x) => x.dossierId)]) toucherDossier(d);
  for (const l of leadsModifies) toucherLead(l.id, 0, l.createdAt.getTime() >= depuis.getTime());
  for (const i of interactions) toucherLead(i.leadId, 0, true);
  for (const n of notes) toucherLead(n.leadId, 0, true);
  for (const s of sms) {
    const message = s.sens === "ENTRANT" ? s.createdAt.getTime() : 0;
    if (s.dossierId) toucherDossier(s.dossierId, message);
    else toucherLead(s.leadId, message, true);
  }
  let demandes = 0;
  const lancement = await lancementMessagerie(maintenant);
  const viser = async (suiviId: string, message: number) => {
    const apres = message && maintenant.getTime() - message < ATTENTE_RAFALE_MS ? new Date(message + ATTENTE_RAFALE_MS) : new Date(maintenant.getTime() + 2_000);
    await demanderAnalyse(suiviId, apres);
    demandes++;
  };
  for (const [dossierId, message] of dossiers) {
    const suivi = await suiviPour({ dossierId }, { lancement }).catch((e: unknown) => (console.error("[messagerie] suivi du dossier non créé :", e), null));
    if (suivi) await viser(suivi.id, message);
  }
  for (const [leadId, { message, geste }] of leads) {
    const suivi = await suiviPour({ leadId }, { geste, lancement }).catch((e: unknown) => (console.error("[messagerie] suivi du lead non créé :", e), null));
    if (suivi) await viser(suivi.id, message);
  }
  return demandes;
}

/**
 * Le passage de 15 minutes : balayage de secours, suivis à créer (dossiers et leads de la campagne qui n'en ont pas
 * encore, par paquets), suivis à revoir (relance qui entre dans l'horizon, fin de pause, rappel), échéances, 19 h 30,
 * alertes. Rien quand « Tout mettre en pause » est actif.
 */
export async function passeMoteur(maintenant: Date = new Date()): Promise<{ pause: boolean; crees: number; revus: number; aEnvoyer: number; nonConfirmes: number }> {
  if (await enPause(maintenant)) return { pause: true, crees: 0, revus: 0, aEnvoyer: 0, nonConfirmes: 0 };
  const lancement = await lancementMessagerie(maintenant);
  await balayer(maintenant, new Date(maintenant.getTime() - 20 * 60_000)).catch((e: unknown) => console.error("[messagerie] balayage :", e));

  let crees = 0;
  const tous = await prisma.dossier.findMany({ select: { id: true }, orderBy: { updatedAt: "desc" } });
  const avec = new Set((await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { not: null } }, select: { dossierId: true } })).map((s) => s.dossierId));
  const sansSuivi = tous.filter((d) => !avec.has(d.id)).slice(0, 40);
  for (const d of sansSuivi) {
    const suivi = await suiviPour({ dossierId: d.id }, { lancement }).catch(() => null);
    if (suivi) {
      await analyserSuivi(suivi.id, maintenant).catch((e: unknown) => console.error(`[messagerie] analyse du suivi ${suivi.id} :`, e));
      crees++;
    }
  }
  const leadsCampagne = await prisma.lead.findMany({ where: { createdAt: { gte: DEBUT_CAMPAGNE }, dossiers: { none: {} } }, select: { id: true }, take: 200, orderBy: { createdAt: "desc" } });
  const avecSuivi = new Set((await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadsCampagne.map((l) => l.id) } }, select: { leadId: true } })).map((s) => s.leadId));
  for (const l of leadsCampagne.filter((x) => !avecSuivi.has(x.id)).slice(0, 40)) {
    const suivi = await suiviPour({ leadId: l.id }, { lancement }).catch(() => null);
    if (suivi) {
      await analyserSuivi(suivi.id, maintenant).catch((e: unknown) => console.error(`[messagerie] analyse du suivi ${suivi.id} :`, e));
      crees++;
    }
  }

  const aRevoir = await prisma.suivi.findMany({ where: { revoirLe: { lte: maintenant } }, select: { id: true }, take: 60, orderBy: { revoirLe: "asc" } });
  for (const s of aRevoir) await analyserSuivi(s.id, maintenant).catch((e: unknown) => console.error(`[messagerie] analyse du suivi ${s.id} :`, e));

  const { aEnvoyer } = await traiterEcheances(maintenant);
  const nonConfirmes = await marquerNonConfirmes(maintenant);
  await notifierPrets(maintenant);
  // Lot 7 : le lundi à partir de 9 h, l'alerte STOP de la semaine passée (au-dessus de 3 %), une fois.
  await (await import("./tableau")).surveillerStop(maintenant).catch((e: unknown) => console.error("[messagerie] alerte STOP :", e));
  return { pause: false, crees, revus: aRevoir.length, aEnvoyer, nonConfirmes };
}

/** Oublie l'heure du dernier balayage (essais). */
export function oublierBalayage(): void {
  memoire[CLE_DERNIER_BALAYAGE] = undefined;
}
