/**
 * Mission 25 — l'analyse d'un suivi, à chaque événement (cahier, § La boucle) : relire le dossier (faits, dernières
 * lignes du journal, derniers échanges), puis rendre dans cet ordre les faits, une ligne de journal, « Où on en est »,
 * la prochaine action, au plus un message proposé par événement, une alerte si quelque chose est chaud ou va mal.
 *
 * Rejouable sans doublon : chaque ligne de journal et chaque message ont une clé ; un message du client ou une note déjà
 * analysés portent une ligne `analyse:<élément>` et ne repassent pas. Sans IA (pause, plafond, échec), les règles fixes
 * font le même travail (regles.ts, ou-en-est.ts).
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametre } from "@/lib/parametres/service";
import { quandLisible } from "@/lib/commercial/quand";
import { definitionMessage, estCodeMessage, estRelance, type CodeMessage } from "./catalogue";
import { prevenirLucas } from "./alertes";
import { chargerEtat, type ElementHistoire, type SuiviLu } from "./etat";
import { dansLaFenetreDeReponse, dansLesHorairesDeTravail, heurePermise, horodatageCourt, jourCourt, momentParis } from "./horaires";
import { analyserParIa, type AnalyseIa } from "./ia";
import { ouEnEstParRegles } from "./ou-en-est";
import { HORIZON_MS, planifier } from "./planificateur";
import { canalDe, ecrireMessage, lienEspaceDuDossier, libelleDuCode, lireSurcharges, rediger, type Surcharges } from "./redaction";
import { classerMessage, faitsDuMessage, fusionnerFaits, lireNote, LIBELLES_CLASSE, dateDite, type ClasseMessage } from "./regles";
import { enDouceur, lancementMessagerie, suiviPour } from "./suivis";
import { texteControle } from "./controleur";
import { formuleBonjour, remplirTexte, texteDeLaListe } from "./texte";
import type { EtatSuivi, Intention, OuEnEst } from "./types";

/** Plafonds du cahier : 40 messages préparés par jour, 8 propositions du démarrage en douceur. */
export const MESSAGES_PAR_JOUR = 40;
export const PROPOSITIONS_DOUCES_PAR_JOUR = 8;

const CLE_CRENEAUX = "__coverswapCreneauxMessagerieEssai";
const globalEssai = globalThis as unknown as Record<string, ((maintenant: Date) => Promise<string[] | null>) | undefined>;
/** Essais seulement : remplace la lecture de l'agenda (deux jours libres, ou null). */
export function definirCreneauxEssai(lecteur: ((maintenant: Date) => Promise<string[] | null>) | null): void {
  globalEssai[CLE_CRENEAUX] = lecteur ?? undefined;
}

/** Deux jours libres de l'agenda Google (à 25 km ou moins : visite), ou null si l'agenda n'est pas lu. */
async function deuxCreneaux(maintenant: Date): Promise<string[] | null> {
  const essai = globalEssai[CLE_CRENEAUX];
  if (essai) return essai(maintenant);
  try {
    const { creneauxLibres } = await import("@/lib/agenda/creneaux");
    const { agenda, libres } = await creneauxLibres(maintenant, { nombre: 6 });
    if (!agenda || libres.length < 2) return null;
    return libres.slice(0, 2).map((j) => j.libelle);
  } catch {
    return null;
  }
}

export async function ecrireLigne(suiviId: string, ligne: { cle: string; le: Date; acteur: string; texte: string }): Promise<boolean> {
  try {
    await prisma.ligneJournalSuivi.create({ data: { suiviId, cle: ligne.cle.slice(0, 190), le: ligne.le, acteur: ligne.acteur, texte: ligne.texte.slice(0, 300) } });
    return true;
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "P2002") return false;
    throw erreur;
  }
}

async function compterCreesAujourdhui(maintenant: Date, douceur: boolean): Promise<number> {
  const debut = new Date(maintenant.getTime() - (momentParis(maintenant).minutes + 1) * 60_000);
  return prisma.messagePrepare.count({ where: { ...AVEC_ARCHIVES, createdAt: { gte: debut }, reponse: false, ...(douceur ? { douceur: true } : {}) } });
}

export type ResultatAnalyse = { suiviId: string; crees: string[]; annules: number; ia: boolean; ouEnEst: OuEnEst | null };

type Instantane = { dateChantier?: string | null; consultations?: Record<string, number>; accord?: string | null };

/** Les éléments de l'histoire qui sont des notes de Lucas (le texte entier, pas l'extrait du journal). */
async function textesDesNotes(cles: string[]): Promise<Map<string, string>> {
  const textes = new Map<string, string>();
  const ev = cles.filter((c) => c.startsWith("ev:")).map((c) => c.slice(3));
  const inter = cles.filter((c) => c.startsWith("in:")).map((c) => c.slice(3));
  const na = cles.filter((c) => c.startsWith("na:")).map((c) => c.slice(3));
  if (ev.length) for (const e of await prisma.dossierEvenement.findMany({ where: { id: { in: ev } }, select: { id: true, contenu: true } })) textes.set(`ev:${e.id}`, e.contenu);
  if (inter.length) for (const i of await prisma.interaction.findMany({ where: { id: { in: inter } }, select: { id: true, contenu: true } })) textes.set(`in:${i.id}`, i.contenu);
  if (na.length) for (const n of await prisma.noteAppel.findMany({ where: { id: { in: na } }, select: { id: true, texte: true } })) textes.set(`na:${n.id}`, n.texte);
  return textes;
}

const estNote = (e: ElementHistoire) => e.acteur === "TOI" && /^(Note|Note après appel|Appel)/.test(e.texte) && !/Planifié :/.test(e.texte);

/**
 * Analyse un suivi : journal, messages du client, notes, faits, messages préparés, « Où on en est ». Ne jette pas :
 * une erreur est journalisée et l'analyse suivante reprend.
 */
export async function analyserSuivi(suiviId: string, maintenant: Date = new Date()): Promise<ResultatAnalyse> {
  let suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) return { suiviId, crees: [], annules: 0, ia: false, ouEnEst: null };
  // Un lead qui a reçu son dossier : le suivi passe au dossier (même identifiant).
  if (suivi.leadId && !suivi.dossierId) suivi = (await suiviPour({ leadId: suivi.leadId })) ?? suivi;
  const lancement = await lancementMessagerie(maintenant);
  const pauseGlobale = (await lireParametre("MESSAGERIE_PAUSE", maintenant)) === "EN_PAUSE";
  const lu: SuiviLu = { id: suivi.id, leadId: suivi.leadId, dossierId: suivi.dossierId, clientId: suivi.clientId, faits: suivi.faits, pauseJusquau: suivi.pauseJusquau, pauseMotif: suivi.pauseMotif, stopLe: suivi.stopLe, demarrageDoux: suivi.demarrageDoux, validationForcee: suivi.validationForcee };
  let { etat, histoire } = await chargerEtat(lu, lancement, maintenant);
  const crees: string[] = [];
  let annules = 0;

  // ── 1. Journal : les éléments nouveaux de l'histoire (les dix derniers à la première analyse) ──
  const connues = new Set((await prisma.ligneJournalSuivi.findMany({ where: { ...AVEC_ARCHIVES, suiviId: suivi.id }, select: { cle: true } })).map((l) => l.cle));
  const curseur = suivi.curseur ? (JSON.parse(suivi.curseur) as { le: string }) : null;
  const nouveaux = histoire.filter((h) => !connues.has(h.cle));
  const aEcrire = curseur ? nouveaux : nouveaux.slice(-10);
  for (const ligne of aEcrire) await ecrireLigne(suivi.id, ligne);

  // ── 2. Les messages du client et les notes à analyser (après la mise en service, pas encore analysés) ──
  const depuis = Math.max(lancement.getTime(), curseur ? 0 : maintenant.getTime() - 3 * 86_400_000);
  const messagesAAnalyser = etat.messagesClient.filter((m) => m.le.getTime() >= depuis && !connues.has(`analyse:${m.id}`));
  const notesBrutes = histoire.filter((h) => estNote(h) && h.le.getTime() >= depuis && !connues.has(`analyse:${h.cle}`));
  const textesNotes = notesBrutes.length ? await textesDesNotes(notesBrutes.map((n) => n.cle)) : new Map<string, string>();
  const notes = notesBrutes.map((n) => ({ id: n.cle, le: n.le, texte: (textesNotes.get(n.cle) ?? n.texte).replace(/^Appel — [^:]*:?\s*/, "") })).filter((n) => n.texte.trim().length > 2);

  const surcharges = await lireSurcharges();
  const lienEspace = etat.cible.dossierId && (messagesAAnalyser.length || notes.length) ? await lienEspaceDuDossier(etat.cible.dossierId) : null;
  let analyseIa: AnalyseIa | null = null;
  if (messagesAAnalyser.length || notes.length) {
    const journal = (await prisma.ligneJournalSuivi.findMany({ where: { suiviId: suivi.id }, orderBy: { le: "desc" }, take: 10, select: { le: true, acteur: true, texte: true } })).map((l) => `${horodatageCourt(l.le)} · ${l.acteur} · ${l.texte}`);
    const echanges = [...etat.envois.map((e) => ({ le: e.le, t: `Lucas (${e.canal}) : ${e.texte ?? e.code ?? ""}` })), ...etat.messagesClient.map((m) => ({ le: m.le, t: `Client (${m.canal}) : ${m.texte}` }))]
      .sort((a, b) => a.le.getTime() - b.le.getTime())
      .map((x) => `${horodatageCourt(x.le)} ${x.t.slice(0, 300)}`);
    analyseIa = await analyserParIa({ etat, journal, echanges, messages: messagesAAnalyser.map((m) => ({ id: m.id, le: m.le, texte: m.texte, canal: m.canal })), notes, permis: [], lienEspace }, maintenant);
  }

  let faits = etat.faits;
  if (analyseIa) faits = fusionnerFaits(faits, analyseIa.faits);
  const majSuivi: Record<string, unknown> = {};

  // ── 3. Notes : faits, rappel daté, « va signer » (pause + « comme convenu » au jour J), note sensible ──
  for (const note of notes) {
    const lecture = lireNote(note.texte, maintenant);
    const ia = analyseIa?.notes.find((n) => n.id === note.id);
    faits = fusionnerFaits(faits, lecture.faits);
    const rappel = ia?.rappel ? { le: ia.rappel.le, motif: ia.vaSigner ? ("COMME_CONVENU" as const) : ("RAPPEL" as const), libelle: ia.vaSigner ? "va signer" : ia.rappel.motif } : lecture.rappel;
    const sensible = lecture.sensible || Boolean(ia?.sensible);
    if (sensible) {
      faits.sensible = true;
      majSuivi.validationForcee = true;
    }
    const morceaux: string[] = [];
    if (rappel) {
      if (rappel.motif === "COMME_CONVENU") {
        majSuivi.pauseJusquau = rappel.le;
        majSuivi.pauseMotif = "COMME_CONVENU";
        etat = { ...etat, pause: { jusquau: rappel.le, motif: "COMME_CONVENU" } };
      }
      if (!memeJour(etat.rappel?.le, rappel.le)) await poserRappel(etat, rappel.le, rappel.motif === "COMME_CONVENU" ? "Rappeler (va signer)" : "Rappeler").catch((e: unknown) => console.error("[messagerie] rappel non posé :", e));
      morceaux.push(`rappel le ${jourCourt(rappel.le)}${rappel.motif === "COMME_CONVENU" ? ", relances en pause, « comme convenu » préparé pour ce jour-là" : ""}`);
    }
    if (lecture.faits.teintesEvoquees?.length) morceaux.push(`teinte ${lecture.faits.teintesEvoquees.join(", ")}`);
    if (lecture.faits.decideur) morceaux.push(`décide avec ${lecture.faits.decideur}`);
    if (sensible) morceaux.push("note sensible : ses messages passent en Validation");
    await ecrireLigne(suivi.id, { cle: `analyse:${note.id}`, le: maintenant, acteur: "IA", texte: morceaux.length ? `Note rangée : ${morceaux.join(" ; ")}` : "Note lue, rien de daté" });
  }

  // ── 4. Messages du client : classe, faits, réponse proposée (au plus une par événement), alertes ──
  const intentionsReponse: Intention[] = [];
  const ordonnes = [...messagesAAnalyser].sort((a, b) => a.le.getTime() - b.le.getTime());
  const dernier = ordonnes.at(-1);
  for (const message of ordonnes) {
    const ia = analyseIa?.messages.find((m) => m.id === message.id);
    const classe: ClasseMessage = message.photos ? "PHOTOS" : ia?.classe ?? classerMessage(message.texte, { photos: message.photos });
    faits = fusionnerFaits(faits, faitsDuMessage(message.texte, classe));
    if (classe === "TROP_CHER" || classe === "MECONTENTEMENT") {
      faits.sensible = true;
      majSuivi.validationForcee = true;
    }
    await ecrireLigne(suivi.id, { cle: `analyse:${message.id}`, le: maintenant, acteur: "IA", texte: `Message lu : ${LIBELLES_CLASSE[classe]}${classe === "MERCI" ? ", rien à répondre" : ""}` });
    if (classe === "STOP") {
      majSuivi.stopLe = maintenant;
      etat = { ...etat, stop: true };
      continue;
    }
    if (["PRIX", "TROP_CHER", "MECONTENTEMENT"].includes(classe)) {
      await prevenirLucas({
        titre: classe === "PRIX" ? `${etat.nom} demande le prix` : classe === "TROP_CHER" ? `${etat.nom} trouve ça cher` : `${etat.nom} n'est pas content`,
        texte: ia?.alerte ?? `« ${message.texte.slice(0, 120)} »`,
        chemin: `/messagerie?suivi=${suivi.id}`,
        libelleLien: "Ouvrir la conversation",
        telephone: etat.telephone,
        urgence: classe === "MECONTENTEMENT" ? 5 : 4,
        etiquette: `messagerie-alerte-${suivi.id}`,
        origine: "messagerie-alerte",
      });
    }
    if (classe === "MERCI" || message !== dernier) continue; // une seule réponse : au dernier message d'une rafale
    const horsHoraires = !dansLesHorairesDeTravail(message.le);
    // E2 : reçu le soir ou un jour sans travail, entre 8 h 30 et 21 h, une fois par soirée.
    if (horsHoraires && dansLaFenetreDeReponse(maintenant)) {
      intentionsReponse.push({ code: "E2", cle: `E2:suivi:${suivi.id}:${momentParis(message.le).jour}`, voulu: maintenant, variante: "defaut", raison: "Message reçu hors horaires", sourceId: message.id, reponse: true });
    }
    const intention = await intentionDeReponse(etat, classe, message, ia?.reponse ?? null, ia?.rappel ?? null, maintenant, surcharges, lienEspace);
    if (intention) intentionsReponse.push({ ...intention, reponse: true, voulu: horsHoraires ? heurePermise(maintenant, "TRAVAIL", intention.cle) : intention.voulu });
  }
  if (messagesAAnalyser.some((m) => m.canal === "SMS") && !etat.espace?.premierAccesLe && faits.canalPrefere === "INCONNU") faits.canalPrefere = "SMS_DABORD";
  // Un rappel posé, une pause, un STOP : l'état est relu (la prochaine action du dossier a pu changer).
  if (messagesAAnalyser.length || notes.length) {
    const relu = await chargerEtat(
      {
        ...lu,
        pauseJusquau: (majSuivi.pauseJusquau as Date | undefined) ?? lu.pauseJusquau,
        pauseMotif: (majSuivi.pauseMotif as string | undefined) ?? lu.pauseMotif,
        stopLe: (majSuivi.stopLe as Date | undefined) ?? lu.stopLe,
        validationForcee: Boolean(majSuivi.validationForcee) || lu.validationForcee,
      },
      lancement,
      maintenant
    );
    etat = { ...relu.etat, faits };
    histoire = relu.histoire;
  }

  // ── 5. Faits dérivés : pièces, température ──
  faits.pieces = [...new Set([...faits.pieces, ...(etat.piece.connue ? [etat.piece.nom] : [])])];
  const recent = etat.dernierGesteClientLe && maintenant.getTime() - etat.dernierGesteClientLe.getTime() < 2 * 86_400_000;
  const devisLuDeuxFois = etat.devis.some((d) => d.consultations >= 2 && d.premiereOuvertureLe && d.consulteLe && d.consulteLe.getTime() - d.premiereOuvertureLe.getTime() < 86_400_000);
  if (etat.accord || devisLuDeuxFois || recent) faits.temperature = "CHAUD";
  else if (etat.envois.length && (!etat.dernierGesteClientLe || maintenant.getTime() - etat.dernierGesteClientLe.getTime() > 21 * 86_400_000)) faits.temperature = "FROID";
  else if (faits.temperature === "INCONNUE" && etat.dernierGesteClientLe) faits.temperature = "TIEDE";
  etat = { ...etat, faits, ...(majSuivi.validationForcee ? { validationForcee: true } : {}) };

  // ── 6. Signal chaud : le devis lu deux fois en 24 h ──
  const instantane = JSON.parse(suivi.etat || "{}") as Instantane;
  const consultations: Record<string, number> = Object.fromEntries(etat.devis.map((d) => [d.id, d.consultations]));
  for (const d of etat.devis) {
    const avant = instantane.consultations?.[d.id] ?? 0;
    if (avant < 2 && d.consultations >= 2 && d.consulteLe && maintenant.getTime() - d.consulteLe.getTime() < 30 * 60_000 && devisLuDeuxFois && (await ecrireLigne(suivi.id, { cle: `chaud:${d.id}`, le: maintenant, acteur: "IA", texte: `Signal chaud : devis ouvert ${d.consultations} fois en 24 h` }))) {
      await prevenirLucas({ titre: `${etat.nom} regarde son devis en ce moment`, texte: `Devis ouvert ${d.consultations} fois en 24 h. Un appel maintenant tombe bien.`, chemin: `/messagerie?suivi=${suivi.id}`, libelleLien: "Ouvrir", telephone: etat.telephone, urgence: 4, etiquette: `messagerie-chaud-${suivi.id}`, origine: "messagerie-chaud" });
    }
  }

  // ── 7. Messages préparés (sauf « Tout mettre en pause ») ──
  const plan = planifier(etat, suivi.analyseLe ? instantane : null, maintenant);
  if (!pauseGlobale) {
    if (Object.keys(majSuivi).length) {
      await prisma.suivi.update({ where: { id: suivi.id }, data: majSuivi });
      suivi = { ...suivi, ...majSuivi } as typeof suivi;
    }
    for (const a of plan.annulations) {
      const { count } = await prisma.messagePrepare.updateMany({ where: { id: a.messageId, statut: { in: ["PREVU", "A_ENVOYER", "A_VALIDER"] } }, data: { statut: "ANNULE", motif: a.motif } });
      if (count) {
        annules++;
        const m = etat.messages.find((x) => x.id === a.messageId);
        await ecrireLigne(suivi.id, { cle: `msg:${a.messageId}:annule`, le: maintenant, acteur: "IA", texte: `${m?.code ?? "Message"} annulé : ${a.motif}` });
      }
    }
    if (etat.stop) {
      const { count } = await prisma.messagePrepare.updateMany({ where: { suiviId: suivi.id, statut: { in: ["PREVU", "A_ENVOYER", "A_VALIDER"] } }, data: { statut: "ANNULE", motif: "STOP" } });
      if (count) await ecrireLigne(suivi.id, { cle: `stop:${suivi.id}`, le: maintenant, acteur: "IA", texte: "STOP : plus aucun message ne part à ce client" });
    }
    const douceur = enDouceur(suivi, lancement, maintenant);
    for (const intention of [...intentionsReponse, ...plan.intentions]) {
      if (etat.stop) break;
      const id = await preparer(suivi.id, etat, intention, surcharges, douceur, maintenant);
      if (id) crees.push(id);
    }
  } else if (Object.keys(majSuivi).length) {
    await prisma.suivi.update({ where: { id: suivi.id }, data: majSuivi });
  }

  // ── 8. Ce qui est déjà dû part dans la file (garde, horaires) et prévient Lucas ──
  if (!pauseGlobale && crees.length) {
    const { traiterEcheances } = await import("./moteur");
    await traiterEcheances(maintenant, { suiviId: suivi.id, sansAnalyse: true });
  }

  // ── 9. « Où on en est », prochaine action, instantané, curseur ──
  const messages = await prisma.messagePrepare.findMany({ where: { ...AVEC_ARCHIVES, suiviId: suivi.id } });
  const etatFinal: EtatSuivi = {
    ...etat,
    messages: messages.map((m) => ({ id: m.id, code: m.code, cle: m.cle, statut: m.statut as EtatSuivi["messages"][number]["statut"], prevuLe: m.prevuLe, envoyeLe: m.envoyeLe, createdAt: m.createdAt, ouvertLe: m.ouvertLe, nonConfirmeLe: m.nonConfirmeLe, reponse: m.reponse, douceur: m.douceur })),
  };
  const parRegles = ouEnEstParRegles(etatFinal, plan, maintenant);
  let ouEnEst: OuEnEst = parRegles.ouEnEst;
  const precedent = (() => {
    try {
      return JSON.parse(suivi.ouEnEst || "{}") as Partial<OuEnEst>;
    } catch {
      return {} as Partial<OuEnEst>;
    }
  })();
  if (analyseIa?.situation && analyseIa.client) {
    const total = analyseIa.situation.length + analyseIa.client.length + ouEnEst.suite.length;
    if (total <= 240) ouEnEst = { ...ouEnEst, situation: analyseIa.situation, client: analyseIa.client, par: "IA" };
  } else if (precedent.par === "IA" && !nouveaux.length && precedent.situation && precedent.client && precedent.situation.length + precedent.client.length + ouEnEst.suite.length <= 240) {
    // Les deux lignes de l'IA restent tant qu'aucun fait nouveau n'est arrivé ; la suite, elle, suit toujours la règle.
    ouEnEst = { ...ouEnEst, situation: precedent.situation, client: precedent.client, par: "IA" };
  }
  const dernierFait = histoire.at(-1)?.le ?? null;
  const manuel = suivi.ouEnEstManuel ? (JSON.parse(suivi.ouEnEstManuel) as Partial<OuEnEst> & { le: string }) : null;
  const manuelValable = manuel && (!dernierFait || dernierFait.getTime() <= Date.parse(manuel.le));
  if (manuelValable) ouEnEst = { ...ouEnEst, situation: manuel.situation || ouEnEst.situation, client: manuel.client || ouEnEst.client, suite: manuel.suite || ouEnEst.suite, par: "TOI" };
  if (analyseIa?.journal && (messagesAAnalyser.length || notes.length)) {
    await ecrireLigne(suivi.id, { cle: `ia:${[...messagesAAnalyser.map((m) => m.id), ...notes.map((n) => n.id)].join(",")}`.slice(0, 190), le: maintenant, acteur: "IA", texte: analyseIa.journal });
  }

  const ouverts = messages.filter((m) => ["PREVU"].includes(m.statut)).map((m) => m.prevuLe.getTime());
  const reveils = [
    ...ouverts,
    plan.aVenir ? plan.aVenir.voulu.getTime() - HORIZON_MS + 60_000 : null,
    suivi.pauseJusquau && suivi.pauseJusquau.getTime() > maintenant.getTime() ? suivi.pauseJusquau.getTime() : null,
    etat.rappel && etat.rappel.le.getTime() > maintenant.getTime() ? etat.rappel.le.getTime() : null,
    maintenant.getTime() + 24 * 3_600_000,
  ].filter((t): t is number => typeof t === "number" && t > maintenant.getTime());
  const dernierEchange = [...etat.envois.map((e) => ({ le: e.le, texte: e.texte ?? "", sens: "TOI" })), ...etat.messagesClient.map((m) => ({ le: m.le, texte: m.texte, sens: "CLIENT" }))].sort((a, b) => b.le.getTime() - a.le.getTime())[0];
  const nouvelInstantane: Instantane = {
    dateChantier: etat.dossier?.dateChantier ? `${momentParis(etat.dossier.dateChantier).jour}${etat.dossier.heureChantier != null ? `T${etat.dossier.heureChantier}` : ""}` : null,
    consultations,
    accord: etat.accord?.id ?? null,
  };
  await prisma.suivi.update({
    where: { id: suivi.id },
    data: {
      nom: etat.nom.slice(0, 120),
      telephone: etat.telephone,
      clientId: etat.cible.clientId,
      faits: JSON.stringify(faits),
      ouEnEst: JSON.stringify(ouEnEst),
      prochaineAction: parRegles.prochaineAction.texte.slice(0, 200),
      prochaineActionLe: parRegles.prochaineAction.le,
      etat: JSON.stringify(nouvelInstantane),
      curseur: JSON.stringify({ le: (dernierFait ?? maintenant).toISOString() }),
      analyseLe: maintenant,
      revoirLe: new Date(Math.min(...reveils)),
      ...(dernierEchange ? { dernierEchangeLe: dernierEchange.le, dernierExtrait: dernierEchange.texte.replace(/\s+/g, " ").slice(0, 120), dernierSens: dernierEchange.sens } : {}),
      ...(manuel && !manuelValable ? { ouEnEstManuel: null } : {}),
    },
  });

  return { suiviId: suivi.id, crees, annules, ia: Boolean(analyseIa), ouEnEst };
}

/** Prépare un message (plafonds, démarrage en douceur, rédaction, journal). Rend son identifiant s'il est nouveau. */
async function preparer(suiviId: string, etat: EtatSuivi, intention: Intention, surcharges: Surcharges, douceurActive: boolean, maintenant: Date): Promise<string | null> {
  if (etat.messages.some((m) => m.cle === intention.cle)) return null;
  const reponse = intention.code === "REPONSE" || (estCodeMessage(intention.code) && definitionMessage(intention.code as CodeMessage).nature === "REACTIF") || intention.cle.startsWith("REPONSE:");
  const douceur = douceurActive && estRelance(intention.code);
  if (!reponse) {
    if ((await compterCreesAujourdhui(maintenant, false)) >= MESSAGES_PAR_JOUR) return null;
    if (douceur && (await compterCreesAujourdhui(maintenant, true)) >= PROPOSITIONS_DOUCES_PAR_JOUR) return null;
  }
  const brouillon = await rediger(etat, intention, surcharges, maintenant);
  if ("refus" in brouillon) {
    await ecrireLigne(suiviId, { cle: `refus:${intention.cle}`, le: maintenant, acteur: "IA", texte: `${libelleDuCode(intention.code)} non préparé : ${brouillon.refus}` });
    return null;
  }
  const id = await ecrireMessage(suiviId, { ...brouillon, reponse: brouillon.reponse || reponse }, douceur ? "A_VALIDER" : "PREVU", { douceur });
  if (!id) return null;
  const quand = brouillon.prevuLe.getTime() - maintenant.getTime() > 5 * 60_000 ? ` pour ${jourCourt(brouillon.prevuLe)} ${horodatageCourt(brouillon.prevuLe).slice(6)}` : "";
  await ecrireLigne(suiviId, {
    cle: `msg:${id}:prepare`,
    le: maintenant,
    acteur: "IA",
    texte: `${libelleDuCode(brouillon.code)} ${douceur ? "proposé (démarrage en douceur)" : "préparé"}${quand} : ${brouillon.raison}${brouillon.ecartControle ? ` (texte de l'IA écarté : ${brouillon.ecartControle})` : ""}`,
  });
  return id;
}

/** La réponse au dernier message du client, d'après sa classe : un code de la liste, ou la réponse de l'IA contrôlée. */
async function intentionDeReponse(
  etat: EtatSuivi,
  classe: ClasseMessage,
  message: { id: string; le: Date; texte: string },
  reponseIa: string | null,
  rappelIa: { le: Date; motif: string } | null,
  maintenant: Date,
  surcharges: Surcharges,
  lienEspace: string | null
): Promise<Intention | null> {
  const cle = `REPONSE:${message.id}`;
  const base = { cle, voulu: maintenant, sourceId: message.id };
  switch (classe) {
    case "LIEN_PERDU":
      return lienEspace ? { ...base, code: "E1", variante: "defaut", raison: "Le client ne retrouve plus son lien" } : { ...base, code: "Q6", variante: "defaut", raison: "Le client ne retrouve plus son lien (pas d'espace ouvert)" };
    case "PHOTOS":
      return null; // S1 vient du planificateur (une seule fois)
    case "VISITE": {
      if (etat.zone === "PROCHE") {
        const creneaux = await deuxCreneaux(maintenant);
        if (creneaux) return { ...base, code: "Q5", variante: "proche", raison: "Le client propose une visite : deux créneaux libres de l'agenda", valeurs: { creneau_1: creneaux[0], creneau_2: creneaux[1] } };
        return { ...base, code: "Q6", variante: "defaut", raison: "Le client propose une visite (agenda non lu : pas de créneau proposé)" };
      }
      return { ...base, code: "Q5", variante: etat.zone === "LOIN" ? "loin" : "defaut", raison: "Le client veut voir les échantillons (au-delà de 25 km : la poste)" };
    }
    case "DISPONIBILITES": {
      const date = rappelIa?.le ?? dateDite(message.texte, maintenant);
      if (date) {
        if (!memeJour(etat.rappel?.le, date)) await poserRappel(etat, date, "Rappeler (dispo du client)").catch((e: unknown) => console.error("[messagerie] rappel non posé :", e));
        return { ...base, code: "E3", variante: "defaut", raison: `Ses disponibilités : rappel posé le ${jourCourt(date)}`, valeurs: { quand: quandLisible(date, maintenant) } };
      }
      return { ...base, code: "Q6", variante: "defaut", raison: "Ses disponibilités (aucune date lisible)" };
    }
    default: {
      // Réponse de l'IA contrôlée, sinon « Bien reçu, je regarde et je reviens vers vous très vite. » (Q6).
      const valide = remplirTexte(texteDeLaListe("Q6", "defaut", surcharges.textes), { bonjour: formuleBonjour(etat.prenom) }, etat.piece).texte;
      if (reponseIa) {
        const controle = texteControle(reponseIa, valide, { lienAttendu: null, premierContact: false, prenom: etat.prenom, permis: [] });
        if (controle.ia) return { ...base, code: "REPONSE", variante: "defaut", raison: `Réponse à ${LIBELLES_CLASSE[classe]}`, valeurs: { texte: controle.texte } };
        return { ...base, code: "Q6", variante: "defaut", raison: `Réponse à ${LIBELLES_CLASSE[classe]} (texte de l'IA écarté : ${controle.ecart})` };
      }
      return { ...base, code: "Q6", variante: "defaut", raison: `Réponse à ${LIBELLES_CLASSE[classe]}` };
    }
  }
}

const memeJour = (a: Date | null | undefined, b: Date) => Boolean(a && momentParis(a).jour === momentParis(b).jour);

/** Pose un rappel daté sur le dossier (prochaine action « Rappeler… ») ou sur le lead, par la fonction de « planifier ». */
async function poserRappel(etat: EtatSuivi, le: Date, action: string): Promise<void> {
  const { planifierAction } = await import("@/lib/agenda/planification");
  await planifierAction({ dossierId: etat.cible.dossierId, leadId: etat.cible.dossierId ? null : etat.cible.leadId, nom: etat.nom, action, debut: le, origine: "messagerie" });
}

/** Le canal d'un suivi, pour les écrans (SMS, mail, espace). */
export { canalDe };
