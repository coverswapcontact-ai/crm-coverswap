/**
 * Mission 25 — les gestes de Lucas dans la messagerie (cartes, conversation, outils MCP) : Envoyé, Modifié, Plus tard,
 * Ne pas envoyer, Valider une proposition, Maintenant, Annuler ; la réponse du client rapportée (texte, heure, photos),
 * la note, la carte « Qu'est-ce qui s'est dit ? » après un appel, la pause des relances, « Ne plus écrire », le message
 * libre et les réponses rapides, « Tout mettre en pause ». Rien n'est envoyé ici : en mode Manuel, Lucas envoie depuis
 * son téléphone et le CRM note ce qui est parti.
 */
import { randomBytes } from "node:crypto";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { resoudreContexte } from "@/lib/journal/acteur";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { enregistrerParametre } from "@/lib/parametres/service";
import { recalculerMain } from "@/lib/dossiers/main";
import { signalerChangementTaches } from "@/lib/a-faire/signal";
import { retenirContactEcrit } from "@/lib/prospects/contact-ecrit";
import { estDemandeArret } from "@/lib/sms/texte";
import { estCodeMessage, definitionMessage, type CodeMessage } from "./catalogue";
import { analyserSuivi, ecrireLigne } from "./analyse";
import { dateAbsolue, instantParis, jourSuivant, momentParis, prochainJourPermis } from "./horaires";
import { demanderAnalyse, demanderEcheance, traiterEcheances } from "./moteur";
import { canalDe, ecrireMessage, libelleDuCode, lireSurcharges, rediger } from "./redaction";
import { formuleBonjour, remplirTexte, texteDeLaListe } from "./texte";
import { chargerEtat } from "./etat";
import { lancementMessagerie, suiviPour } from "./suivis";
import { LIBELLES_RAISON_NON_ENVOI, type OuEnEst, type RaisonNonEnvoi } from "./types";
import { LIBELLES_MOTIF_PERTE, type MotifPerte } from "@/lib/dossiers/constants";

const OUVERTS = ["PREVU", "A_ENVOYER", "A_VALIDER"];

async function acteur(): Promise<string> {
  return (await resoudreContexte()).acteur;
}

async function messageDe(id: string) {
  const message = await prisma.messagePrepare.findUnique({ where: { id } });
  if (!message || message.archiveLe) throw new ErreurMetier("Message introuvable.", 404);
  const suivi = await prisma.suivi.findUnique({ where: { id: message.suiviId } });
  if (!suivi) throw new ErreurMetier("Conversation introuvable.", 404);
  return { message, suivi };
}

export async function suiviExige(suiviId: string) {
  const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) throw new ErreurMetier("Conversation introuvable.", 404);
  return suivi;
}

/** Les étapes de relance d'un code, pour que les anciens comptes (relances de devis, photos, avis) voient la relance faite. */
function relanceDe(code: string, cle: string): Record<string, unknown> | null {
  const devis = cle.match(/^D[2-5]:(.+)$/);
  if (devis) return { documentId: devis[1], rang: Math.min(2, Number(code.slice(1)) - 1) };
  if (code === "P2" || code === "P3") return { type: "PHOTOS", rang: code === "P2" ? 1 : 2 };
  if (code === "C4" || code === "C5") return { type: "AVIS", rang: 1 };
  return null;
}

/** ✅ Envoyé (ou ✏️ Modifié : le texte vraiment parti) : le message s'inscrit dans la conversation à l'heure du geste. */
export async function confirmerEnvoi(id: string, entree: { texte?: string | null; le?: Date | null; origine?: "ECRAN" | "ASSISTANT" } = {}, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (message.statut === "ENVOYE") return { deja: true, messageId: id };
  if (!OUVERTS.includes(message.statut) && message.statut !== "NON_ENVOYE") throw new ErreurMetier("Ce message n'est plus à envoyer.", 409);
  const texteEnvoye = entree.texte?.trim() && entree.texte.trim() !== message.texte.trim() ? entree.texte.trim().slice(0, 1600) : null;
  const le = entree.le && entree.le.getTime() <= maintenant.getTime() ? entree.le : maintenant;
  const texte = texteEnvoye ?? message.texte;
  await prisma.messagePrepare.update({ where: { id }, data: { statut: "ENVOYE", envoyeLe: le, texteEnvoye, decidePar: await acteur(), motif: null } });
  const libelleCanal = message.canal === "MAIL" ? "Mail" : message.canal === "ESPACE" ? "Message dans l'espace" : "SMS";
  if (suivi.dossierId) {
    const relance = relanceDe(message.code, message.cle);
    await prisma.dossierEvenement.create({
      data: {
        dossierId: suivi.dossierId,
        type: "SMS_COPIE",
        direction: "SORTANT",
        contenu: `${libelleCanal} ${message.code} envoyé : « ${texte} »`.slice(0, 1800),
        metadata: JSON.stringify({ code: message.code, texte, canal: message.canal, origine: entree.origine === "ASSISTANT" ? "ASSISTANT" : "MESSAGERIE", messageId: id, ...(relance ? { relance } : {}) }),
        survenuLe: le,
      },
    });
    if (/^D[2-5]$/.test(message.code)) {
      const { passerEnRelance } = await import("@/lib/relances/etape");
      const { effetsDuChangementEtape } = await import("@/lib/dossiers/transitions");
      const changement = await prisma.$transaction((tx) => passerEnRelance(tx, suivi.dossierId!, "relance envoyée par la messagerie"));
      if (changement) await effetsDuChangementEtape(changement);
    }
    await recalculerMain(suivi.dossierId);
  } else if (suivi.leadId) {
    await prisma.interaction.create({ data: { leadId: suivi.leadId, type: "SMS", contenu: `Messagerie — ${libelleCanal} ${message.code} envoyé : « ${texte} »`.slice(0, 1800) } });
  }
  // Le premier SMS d'un numéro porte la mention STOP : la conversation retient qu'il est parti.
  if (message.canal === "SMS" && message.destinataire) {
    const numero = normaliserTelephone(message.destinataire);
    if (numero) {
      const conversation = await prisma.conversationSms.findUnique({ where: { numero } });
      if (conversation) await prisma.conversationSms.update({ where: { id: conversation.id }, data: { premierEnvoiLe: conversation.premierEnvoiLe ?? le, dernierMessageLe: le, dernierExtrait: texte.slice(0, 120), dernierSens: "SORTANT" } });
      else await prisma.conversationSms.create({ data: { numero, leadId: suivi.leadId, clientId: suivi.clientId, nomAffiche: suivi.nom, premierEnvoiLe: le, dernierMessageLe: le, dernierExtrait: texte.slice(0, 120), dernierSens: "SORTANT" } }).catch(() => undefined);
    }
  }
  // A1 et l'accusé du soir ne sont pas un contact (personne n'a encore parlé au client) : le lead reste « À appeler ».
  if (!["A1", "E2"].includes(message.code)) {
    const lead = suivi.leadId ?? (suivi.dossierId ? (await prisma.dossier.findUnique({ where: { id: suivi.dossierId }, select: { leadId: true } }))?.leadId : null);
    await retenirContactEcrit(lead, le);
  }
  await ecrireLigne(suivi.id, { cle: `msg:${id}:envoye`, le, acteur: "TOI", texte: `${libelleDuCode(message.code)} envoyé${texteEnvoye ? " (modifié)" : ""}${message.canal !== "SMS" ? ` par ${message.canal === "MAIL" ? "mail" : "l'espace"}` : ""}` });
  await prisma.suivi.update({ where: { id: suivi.id }, data: { dernierEchangeLe: le, dernierExtrait: texte.slice(0, 120), dernierSens: "TOI" } });
  await signalerChangementTaches();
  await demanderAnalyse(suivi.id);
  return { deja: false, messageId: id };
}

/**
 * Canal « espace » : le message part dans l'espace du client (la réponse de l'espace, celle de l'onglet Mail et de
 * l'outil `repondre_espace`), au clic de Lucas, puis il est confirmé envoyé.
 */
export async function envoyerDansLEspace(id: string, texte: string | null = null, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (!OUVERTS.includes(message.statut)) throw new ErreurMetier("Ce message n'est plus à envoyer.", 409);
  if (!suivi.dossierId) throw new ErreurMetier("Pas de dossier, donc pas d'espace : envoie-le par SMS ou par mail.", 409);
  const { repondreDansLEspace } = await import("@/lib/espace/messages");
  await repondreDansLEspace(suivi.dossierId, (texte?.trim() || message.texte).slice(0, 2000));
  return confirmerEnvoi(id, { texte, origine: "ECRAN" }, maintenant);
}

/** « Ouvrir Messages » touché : noté (le message attend son ✅). */
export async function noterOuverture(id: string, maintenant: Date = new Date()): Promise<void> {
  await prisma.messagePrepare.updateMany({ where: { id, ouvertLe: null }, data: { ouvertLe: maintenant } });
}

/** ⏰ Plus tard : dans 1 h, dans 3 h, demain 9 h 30, ou une date. « Maintenant » : un message programmé passe à envoyer. */
export async function reporterMessage(id: string, quand: "1H" | "3H" | "DEMAIN" | "MAINTENANT" | Date, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (!OUVERTS.includes(message.statut)) throw new ErreurMetier("Ce message n'est plus à envoyer.", 409);
  if (quand === "MAINTENANT") {
    await prisma.messagePrepare.update({ where: { id }, data: { statut: "A_ENVOYER", prevuLe: maintenant, notifieLe: maintenant, decidePar: await acteur() } });
    await ecrireLigne(suivi.id, { cle: `msg:${id}:maintenant`, le: maintenant, acteur: "TOI", texte: `${libelleDuCode(message.code)} : à envoyer maintenant` });
    await demanderAnalyse(suivi.id);
    return { prevuLe: maintenant };
  }
  const prevuLe =
    quand === "1H"
      ? new Date(maintenant.getTime() + 3_600_000)
      : quand === "3H"
        ? new Date(maintenant.getTime() + 3 * 3_600_000)
        : quand === "DEMAIN"
          ? instantParis(prochainJourPermis(jourSuivant(momentParis(maintenant).jour)), 9 * 60 + 30)
          : quand;
  if (prevuLe.getTime() <= maintenant.getTime()) throw new ErreurMetier("Choisis un moment à venir.", 400);
  await prisma.messagePrepare.update({ where: { id }, data: { statut: "PREVU", prevuLe, notifieLe: null, nonConfirmeLe: null, ouvertLe: null, reports: { increment: 1 }, decidePar: await acteur() } });
  await ecrireLigne(suivi.id, { cle: `msg:${id}:plus-tard:${prevuLe.toISOString()}`, le: maintenant, acteur: "TOI", texte: `${libelleDuCode(message.code)} reporté au ${dateAbsolue(prevuLe)}` });
  await demanderEcheance(prevuLe);
  await demanderAnalyse(suivi.id);
  return { prevuLe };
}

/** 🚫 Ne pas envoyer, avec la raison en un appui ; « déjà fait par téléphone » compte comme un contact. */
export async function nePasEnvoyer(id: string, raison: RaisonNonEnvoi, commentaire: string | null = null, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (!OUVERTS.includes(message.statut)) throw new ErreurMetier("Ce message n'est plus à envoyer.", 409);
  if (raison === "AUTRE" && !commentaire?.trim()) throw new ErreurMetier("Dis en quelques mots pourquoi.", 400);
  const motif = `${LIBELLES_RAISON_NON_ENVOI[raison]}${commentaire?.trim() ? ` : ${commentaire.trim().slice(0, 200)}` : ""}`;
  await prisma.messagePrepare.update({ where: { id }, data: { statut: "NON_ENVOYE", motif: `${raison}|${motif}`, decidePar: await acteur(), envoyeLe: raison === "DEJA_FAIT_TELEPHONE" ? maintenant : null } });
  await ecrireLigne(suivi.id, { cle: `msg:${id}:non-envoye`, le: maintenant, acteur: "TOI", texte: `${libelleDuCode(message.code)} non envoyé : ${motif.charAt(0).toLowerCase()}${motif.slice(1)}` });
  await demanderAnalyse(suivi.id);
  return { motif };
}

/** Une proposition (démarrage en douceur) validée : elle devient un message à envoyer. */
export async function validerProposition(id: string, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (message.statut !== "A_VALIDER") throw new ErreurMetier("Ce message n'attend pas de validation.", 409);
  await prisma.messagePrepare.update({ where: { id }, data: { statut: "A_ENVOYER", douceur: false, notifieLe: maintenant, decidePar: await acteur() } });
  await ecrireLigne(suivi.id, { cle: `msg:${id}:valide`, le: maintenant, acteur: "TOI", texte: `${libelleDuCode(message.code)} validé` });
  await demanderAnalyse(suivi.id);
}

/** Un message programmé annulé par Lucas (bulle « Prévu… » → Annuler). */
export async function annulerMessage(id: string, maintenant: Date = new Date()) {
  const { message, suivi } = await messageDe(id);
  if (!OUVERTS.includes(message.statut)) throw new ErreurMetier("Ce message n'est plus à envoyer.", 409);
  await prisma.messagePrepare.update({ where: { id }, data: { statut: "ANNULE", motif: "annulé par toi", decidePar: await acteur() } });
  await ecrireLigne(suivi.id, { cle: `msg:${id}:annule-toi`, le: maintenant, acteur: "TOI", texte: `${libelleDuCode(message.code)} annulé` });
  await demanderAnalyse(suivi.id);
}

/**
 * 📥 Réponse du client, rapportée par Lucas (texte, heure, photos) : rangée dans sa conversation et son dossier, ses
 * photos dans son espace (parmi les photos avant), STOP reconnu ; puis l'analyse, tout de suite (la réponse proposée
 * arrive en quelques secondes, sans IA en quelques millisecondes).
 */
export async function rapporterReponse(entree: { suiviId: string; texte: string; recuLe?: Date | null; photos?: File[] }, maintenant: Date = new Date()) {
  const suivi = await suiviExige(entree.suiviId);
  const texte = entree.texte.trim().slice(0, 1600);
  const photos = entree.photos ?? [];
  if (!texte && !photos.length) throw new ErreurMetier("Colle sa réponse ou ajoute ses photos.", 400);
  const recuLe = entree.recuLe && entree.recuLe.getTime() <= maintenant.getTime() + 60_000 ? entree.recuLe : maintenant;
  const lancement = await lancementMessagerie(maintenant);
  let dossierId = suivi.dossierId;
  // Ses photos vont dans son espace : un lead sans dossier en reçoit un (avec son espace), comme « Intéressé ».
  let deposees = 0;
  if (photos.length) {
    const { ouvrirEspace, ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    const ouvert = dossierId ? await ouvrirEspace(dossierId) : suivi.leadId ? await ouvrirEspaceDuContact(suivi.leadId) : null;
    if (!ouvert) throw new ErreurMetier("Ni dossier ni contact : impossible de ranger les photos.", 409);
    dossierId = "dossierId" in ouvert ? (ouvert as { dossierId: string }).dossierId : dossierId;
    const { deposerPhotos } = await import("@/lib/espace/service");
    deposees = (await deposerPhotos(ouvert.espace, photos)).deposees;
  }
  const leSuivi = (dossierId && dossierId !== suivi.dossierId ? await suiviPour({ dossierId }, { lancement }) : suivi) ?? suivi;
  const corps = texte || `📷 ${deposees} photo${deposees > 1 ? "s" : ""}`;
  const numero = normaliserTelephone(leSuivi.telephone);
  let smsId: string | null = null;
  if (numero) {
    const { conversationDuNumero } = await import("@/lib/sms/conversations");
    const conversation = await conversationDuNumero(numero, { leadId: leSuivi.leadId ?? undefined, clientId: leSuivi.clientId ?? undefined });
    const sms = await prisma.sms.create({
      data: { conversationId: conversation.id, sens: "ENTRANT", texte: corps, statut: "RECU", fournisseur: "rapporte", identifiantFournisseur: randomBytes(9).toString("base64url"), origine: "MANUEL", recuLe, luLe: maintenant, leadId: leSuivi.leadId, dossierId, clientId: leSuivi.clientId },
    });
    smsId = sms.id;
    const stop = estDemandeArret(texte);
    await prisma.conversationSms.update({ where: { id: conversation.id }, data: { dernierMessageLe: recuLe, dernierExtrait: corps.slice(0, 120), dernierSens: "ENTRANT", ...(stop ? { stopLe: maintenant, stopTexte: texte.slice(0, 200) } : {}) } });
  }
  if (dossierId) {
    await prisma.dossierEvenement.create({
      data: { dossierId, type: "SMS_RECU", direction: "ENTRANT", contenu: corps, metadata: JSON.stringify({ smsId, origine: "RAPPORTE", ...(deposees ? { photos: deposees } : {}) }), survenuLe: recuLe },
    });
    await recalculerMain(dossierId);
  } else if (leSuivi.leadId) {
    await prisma.interaction.create({ data: { leadId: leSuivi.leadId, type: "SMS", contenu: `SMS reçu : ${corps}` } });
  }
  if (estDemandeArret(texte)) await prisma.suivi.update({ where: { id: leSuivi.id }, data: { stopLe: maintenant } });
  await prisma.suivi.update({ where: { id: leSuivi.id }, data: { luLe: maintenant, nonLu: false, ...(deposees && !texte ? {} : {}) } });
  await signalerChangementTaches();
  const resultat = await analyserSuivi(leSuivi.id, maintenant);
  const proposee = await prisma.messagePrepare.findFirst({ where: { suiviId: leSuivi.id, id: { in: resultat.crees } }, orderBy: { createdAt: "asc" } });
  return { suiviId: leSuivi.id, photos: deposees, proposee };
}

/** 📝 Note (écrite ou dictée au clavier) : rangée sur le dossier, sinon sur le contact ; l'IA (ou les règles) la range. */
export async function ajouterNote(entree: { suiviId: string; texte: string }, maintenant: Date = new Date()) {
  const suivi = await suiviExige(entree.suiviId);
  const texte = entree.texte.trim();
  if (texte.length < 2) throw new ErreurMetier("La note est vide.", 400);
  const { noterRapidement } = await import("@/lib/commercial/appels");
  await noterRapidement({ ...(suivi.dossierId ? { dossierId: suivi.dossierId } : { leadId: suivi.leadId ?? undefined }), contenu: texte.slice(0, 4000) });
  await signalerChangementTaches();
  return analyserSuivi(suivi.id, maintenant);
}

/** « Pause relances » jusqu'à une date (rien d'autre ne part avant), ou reprise (`jusquau` nul). */
export async function mettreEnPause(entree: { suiviId: string; jusquau: Date | null; motif?: string | null }, maintenant: Date = new Date()) {
  const suivi = await suiviExige(entree.suiviId);
  if (entree.jusquau && entree.jusquau.getTime() <= maintenant.getTime()) throw new ErreurMetier("Choisis une date à venir.", 400);
  await prisma.suivi.update({ where: { id: suivi.id }, data: { pauseJusquau: entree.jusquau, pauseMotif: entree.jusquau ? entree.motif?.trim().slice(0, 80) || "PAUSE" : null } });
  await ecrireLigne(suivi.id, { cle: `pause:${maintenant.toISOString()}`, le: maintenant, acteur: "TOI", texte: entree.jusquau ? `Relances en pause jusqu'au ${dateAbsolue(entree.jusquau, { heure: false })}` : "Relances reprises" });
  return analyserSuivi(suivi.id, maintenant);
}

/** « Ne plus écrire » : le numéro passe en STOP, plus aucun SMS ne part (définitif). */
export async function arreterLesSms(suiviId: string, maintenant: Date = new Date()) {
  const suivi = await suiviExige(suiviId);
  await prisma.suivi.update({ where: { id: suivi.id }, data: { stopLe: maintenant } });
  const numero = normaliserTelephone(suivi.telephone);
  if (numero) {
    const conversation = await prisma.conversationSms.findFirst({ where: { ...AVEC_ARCHIVES, numero } });
    if (conversation) await prisma.conversationSms.update({ where: { id: conversation.id }, data: { stopLe: conversation.stopLe ?? maintenant, stopTexte: conversation.stopTexte ?? "STOP posé à la main (messagerie)" } });
    else await prisma.conversationSms.create({ data: { numero, leadId: suivi.leadId, clientId: suivi.clientId, nomAffiche: suivi.nom, stopLe: maintenant, stopTexte: "STOP posé à la main (messagerie)" } }).catch(() => undefined);
  }
  await prisma.messagePrepare.updateMany({ where: { suiviId: suivi.id, statut: { in: OUVERTS } }, data: { statut: "ANNULE", motif: "STOP" } });
  await ecrireLigne(suivi.id, { cle: `stop-main:${suivi.id}`, le: maintenant, acteur: "TOI", texte: "Ne plus écrire : plus aucun SMS ne part à ce client" });
  return analyserSuivi(suivi.id, maintenant);
}

export async function marquerLu(suiviId: string, lu: boolean, maintenant: Date = new Date()) {
  await suiviExige(suiviId);
  await prisma.suivi.update({ where: { id: suiviId }, data: lu ? { luLe: maintenant, nonLu: false } : { nonLu: true } });
}

/** Archiver la conversation (glisser vers la gauche) : la liste la range, le dossier ne bouge pas. Réversible. */
export async function archiverConversation(suiviId: string, archiver: boolean, maintenant: Date = new Date()) {
  const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) throw new ErreurMetier("Conversation introuvable.", 404);
  await prisma.suivi.update({ where: { id: suiviId }, data: archiver ? { archiveLe: maintenant, archiveMotif: "Conversation archivée" } : { archiveLe: null, archiveMotif: null } });
}

/** ✍️ Corriger une ligne de « Où on en est » : gardée jusqu'au prochain fait nouveau. */
export async function corrigerOuEnEst(suiviId: string, lignes: Partial<Pick<OuEnEst, "situation" | "client" | "suite">>, maintenant: Date = new Date()) {
  const suivi = await suiviExige(suiviId);
  const propre = Object.fromEntries(Object.entries(lignes).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim().slice(0, 120)]));
  if (!Object.keys(propre).length) throw new ErreurMetier("Rien à corriger.", 400);
  const actuel = JSON.parse(suivi.ouEnEst || "{}") as Partial<OuEnEst>;
  const ouEnEst = { ...actuel, ...propre, le: maintenant.toISOString(), par: "TOI" };
  await prisma.suivi.update({ where: { id: suiviId }, data: { ouEnEstManuel: JSON.stringify({ ...propre, le: maintenant.toISOString() }), ouEnEst: JSON.stringify(ouEnEst) } });
  return ouEnEst;
}

/**
 * Un message écrit par Lucas (texte libre, ou réponse rapide Q1 à Q8) : prêt à envoyer tout de suite (« Ouvrir
 * Messages », puis ✅). Il passe la garde : c'est Lucas qui écrit.
 */
export async function preparerMessageLibre(entree: { suiviId: string; texte?: string | null; code?: string | null; canal?: "SMS" | "MAIL" | "ESPACE" | null }, maintenant: Date = new Date()) {
  const suivi = await suiviExige(entree.suiviId);
  const lancement = await lancementMessagerie(maintenant);
  const { etat } = await chargerEtat(suivi, lancement, maintenant);
  const code = entree.code && estCodeMessage(entree.code) ? (entree.code as CodeMessage) : null;
  let texte = entree.texte?.trim() ?? "";
  if (code && !texte) {
    const variante = code === "Q5" ? (etat.zone === "PROCHE" ? "proche" : "loin") : "defaut";
    const surcharges = await lireSurcharges();
    const brouillon = await rediger(etat, { code, cle: "apercu", voulu: maintenant, variante, raison: "", reponse: true }, surcharges, maintenant);
    if ("refus" in brouillon) {
      // Q5 « proche » sans créneaux (agenda non lu) : la variante « par la poste », jamais de créneau inventé.
      texte = remplirTexte(texteDeLaListe(code, "loin", surcharges.textes), { bonjour: formuleBonjour(etat.prenom) }, etat.piece).texte;
    } else texte = brouillon.texte;
  }
  if (!texte) throw new ErreurMetier("Le message est vide.", 400);
  const destination = entree.canal ? canalChoisi(etat, entree.canal) : canalDe(etat);
  if (!destination) throw new ErreurMetier(etat.stop ? "Ce client a demandé STOP : plus aucun message." : "Ni mobile, ni e-mail, ni espace : écris-lui autrement.", 409);
  const id = await ecrireMessage(
    suivi.id,
    { code: code ?? "LIBRE", cle: `LIBRE:${randomBytes(8).toString("hex")}`, ...destination, texte: texte.slice(0, 1600), texteValide: texte.slice(0, 1600), variante: "defaut", prevuLe: maintenant, mode: "VALIDATION", reponse: true, raison: code ? `Réponse rapide ${code}` : "Message écrit par toi", ia: false, ecartControle: null, simulationId: null, sourceId: null },
    "A_ENVOYER"
  );
  if (!id) throw new ErreurMetier("Message non préparé.", 500);
  await prisma.messagePrepare.update({ where: { id }, data: { notifieLe: maintenant } });
  return prisma.messagePrepare.findUniqueOrThrow({ where: { id } });
}

/** Le canal choisi à la main dans la zone de saisie, s'il est possible pour ce client. */
function canalChoisi(etat: Awaited<ReturnType<typeof chargerEtat>>["etat"], canal: "SMS" | "MAIL" | "ESPACE") {
  if (etat.stop) return null;
  if (canal === "SMS") {
    if (!etat.mobile || !etat.telephone) throw new ErreurMetier("Pas de numéro de mobile : choisis l'espace ou le mail.", 409);
    return { canal: "SMS" as const, destinataire: etat.telephone };
  }
  if (canal === "MAIL") {
    if (!etat.email) throw new ErreurMetier("Pas d'adresse e-mail pour ce client.", 409);
    return { canal: "MAIL" as const, destinataire: etat.email };
  }
  if (!etat.cible.dossierId) throw new ErreurMetier("Pas de dossier, donc pas d'espace : choisis le SMS ou le mail.", 409);
  return { canal: "ESPACE" as const, destinataire: null };
}

/**
 * Outil « Rappel » : un rappel daté (agenda, notification), les relances en pause jusque-là ; « prévenir le client »
 * prépare E3 (« C'est noté, je vous rappelle {quand}. »).
 */
export async function poserRappelManuel(entree: { suiviId: string; le: Date; prevenir: boolean }, maintenant: Date = new Date()) {
  const suivi = await suiviExige(entree.suiviId);
  if (entree.le.getTime() <= maintenant.getTime()) throw new ErreurMetier("Choisis un moment à venir.", 400);
  const { planifierAction } = await import("@/lib/agenda/planification");
  await planifierAction({ dossierId: suivi.dossierId, leadId: suivi.dossierId ? null : suivi.leadId, nom: suivi.nom, action: "Rappeler", debut: entree.le, origine: "messagerie" });
  await prisma.suivi.update({ where: { id: suivi.id }, data: { pauseJusquau: entree.le, pauseMotif: "RAPPEL" } });
  await ecrireLigne(suivi.id, { cle: `rappel:${maintenant.toISOString()}`, le: maintenant, acteur: "TOI", texte: `Rappel posé le ${dateAbsolue(entree.le)}, relances en pause jusque-là` });
  let message = null;
  if (entree.prevenir) {
    const lancement = await lancementMessagerie(maintenant);
    const { etat } = await chargerEtat(await suiviExige(suivi.id), lancement, maintenant);
    const { quandLisible } = await import("@/lib/commercial/quand");
    const brouillon = await rediger(etat, { code: "E3", cle: `E3:suivi:${suivi.id}:${entree.le.toISOString()}`, voulu: maintenant, variante: "defaut", raison: "Rappel posé : le client est prévenu", reponse: true, valeurs: { quand: quandLisible(entree.le, maintenant) } }, await lireSurcharges(), maintenant);
    if (!("refus" in brouillon)) {
      const id = await ecrireMessage(suivi.id, brouillon, "A_ENVOYER");
      if (id) message = await prisma.messagePrepare.update({ where: { id }, data: { notifieLe: maintenant } });
    }
  }
  await analyserSuivi(suivi.id, maintenant);
  return message;
}

/** Outil « Lien de l'espace » : le lien du client (l'espace s'ouvre s'il le faut), à insérer dans le message. */
export async function lienDeLEspace(suiviId: string): Promise<string> {
  const suivi = await suiviExige(suiviId);
  const { lienEspaceDuDossier } = await import("./redaction");
  let dossierId = suivi.dossierId;
  if (!dossierId && suivi.leadId) {
    const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    dossierId = (await ouvrirEspaceDuContact(suivi.leadId)).dossierId;
  }
  const lien = await lienEspaceDuDossier(dossierId);
  if (!lien) throw new ErreurMetier("L'espace de ce client n'a pas pu s'ouvrir (lien désactivé ?).", 409);
  return lien;
}

/** ✨ « Rédiger avec l'IA » : un brouillon court à partir des faits du dossier, contrôlé ; null si l'IA est en pause. */
export async function redigerAvecIa(suiviId: string, maintenant: Date = new Date()): Promise<{ texte: string | null; raison: string | null }> {
  const suivi = await suiviExige(suiviId);
  const lancement = await lancementMessagerie(maintenant);
  const { etat } = await chargerEtat(suivi, lancement, maintenant);
  const { brouillonParIa } = await import("./ia");
  return brouillonParIa(etat, maintenant);
}

/* ── Après un appel : « Qu'est-ce qui s'est dit ? » ─────────────────────────── */

export const ISSUES_APRES_APPEL = ["PAS_DE_REPONSE", "INTERESSE", "VA_SIGNER", "REFLECHIT", "ECHANTILLONS", "PAS_INTERESSE", "A_RAPPELER"] as const;
export type IssueApresAppel = (typeof ISSUES_APRES_APPEL)[number];
export const LIBELLES_ISSUE_APRES_APPEL: Record<IssueApresAppel, string> = {
  PAS_DE_REPONSE: "Pas de réponse",
  INTERESSE: "Intéressé, veut une simulation",
  VA_SIGNER: "Va signer",
  REFLECHIT: "Réfléchit",
  ECHANTILLONS: "Veut voir les échantillons",
  PAS_INTERESSE: "Pas intéressé",
  A_RAPPELER: "À rappeler",
};
export const DELAIS_VA_SIGNER = { "1S": 7, "2S": 14, "1M": 30 } as const;
export type DelaiVaSigner = keyof typeof DELAIS_VA_SIGNER;
/** Pas intéressé : motif en un appui (trop cher · concurrent · reporté · autre), sur la liste des motifs de perte. */
export const MOTIFS_PAS_INTERESSE = { PRIX: "Trop cher", CONCURRENT: "Concurrent", DELAI: "Reporté", AUTRE: "Autre" } as const;

/**
 * La carte « Qu'est-ce qui s'est dit ? » : l'appel noté par `noterAppel` (la fonction des autres écrans, inchangée),
 * puis ce que la messagerie ajoute — « Va signer » : rappel au jour dit, relances en pause jusque-là, « comme convenu »
 * préparé pour ce jour ; « Réfléchit » : rappel dans 3 jours ; « Échantillons » : deux créneaux de l'agenda (25 km ou
 * moins), sinon la poste. L'analyse suit tout de suite : A2 / A4 / A5, P1, etc.
 */
export async function apresAppel(
  entree: { suiviId: string; issue: IssueApresAppel; delai?: DelaiVaSigner | null; motifPerte?: MotifPerte | null; perteCommentaire?: string | null; note?: string | null; rappelLe?: Date | null },
  maintenant: Date = new Date()
) {
  const suivi = await suiviExige(entree.suiviId);
  const { noterAppel } = await import("@/lib/commercial/appels");
  const cible = { ...(suivi.dossierId ? { dossierId: suivi.dossierId } : {}), ...(suivi.leadId ? { leadId: suivi.leadId } : {}) };
  if (!cible.dossierId && !cible.leadId) throw new ErreurMetier("Ni dossier ni contact pour cet appel.", 409);
  const note = entree.note?.trim() ?? "";
  const jourA10h = (jours: number) => instantParis(prochainJourPermis(jourSuivant(momentParis(maintenant).jour, jours)), 10 * 60);
  let suite;
  switch (entree.issue) {
    case "PAS_DE_REPONSE":
      suite = await noterAppel({ ...cible, issue: "PAS_DE_REPONSE", note, ...(entree.rappelLe ? { rappelLe: entree.rappelLe.toISOString() } : {}) }, maintenant);
      break;
    case "A_RAPPELER":
      suite = await noterAppel({ ...cible, issue: "A_RAPPELER", note, rappelLe: entree.rappelLe ? entree.rappelLe.toISOString() : null }, maintenant);
      break;
    case "INTERESSE":
      suite = await noterAppel({ ...cible, issue: "INTERESSE", note }, maintenant);
      break;
    case "ECHANTILLONS":
      suite = await noterAppel({ ...cible, issue: "INTERESSE", note: ["Veut voir les échantillons", note].filter(Boolean).join(" — ") }, maintenant);
      break;
    case "REFLECHIT": {
      const rappel = jourA10h(3);
      suite = await noterAppel({ ...cible, issue: "A_RAPPELER", rappelLe: rappel.toISOString(), note: ["Réfléchit", note].filter(Boolean).join(" — ") }, maintenant);
      break;
    }
    case "VA_SIGNER": {
      const rappel = jourA10h(DELAIS_VA_SIGNER[entree.delai ?? "2S"]);
      suite = await noterAppel({ ...cible, issue: "A_RAPPELER", rappelLe: rappel.toISOString(), note: ["Va signer", note].filter(Boolean).join(" — ") }, maintenant);
      await prisma.suivi.update({ where: { id: suivi.id }, data: { pauseJusquau: rappel, pauseMotif: "COMME_CONVENU" } });
      await ecrireLigne(suivi.id, { cle: `va-signer:${maintenant.toISOString()}`, le: maintenant, acteur: "TOI", texte: `Va signer : rappel le ${dateAbsolue(rappel, { heure: false })}, relances en pause jusque-là` });
      break;
    }
    case "PAS_INTERESSE": {
      const motif = entree.motifPerte ?? "AUTRE";
      const precision = entree.perteCommentaire?.trim() || note;
      if (motif === "AUTRE" && !precision) throw new ErreurMetier("Dis en quelques mots pourquoi (motif « autre »).", 400);
      suite = await noterAppel({ ...cible, issue: "PAS_INTERESSE", note, motifPerte: motif, perteCommentaire: precision || LIBELLES_MOTIF_PERTE[motif] }, maintenant);
      break;
    }
  }
  const resultat = await analyserSuivi((await suiviPour(cible, { geste: true }))?.id ?? suivi.id, maintenant);
  let proposee = await prisma.messagePrepare.findFirst({ where: { id: { in: resultat.crees } }, orderBy: { createdAt: "asc" } });
  if (entree.issue === "ECHANTILLONS" && !proposee) proposee = await preparerMessageLibre({ suiviId: resultat.suiviId, code: "Q5" }, maintenant);
  if (proposee && proposee.statut === "PREVU" && proposee.prevuLe.getTime() <= maintenant.getTime() + 5 * 60_000) {
    await traiterEcheances(new Date(Math.max(maintenant.getTime(), proposee.prevuLe.getTime())), { suiviId: resultat.suiviId });
    proposee = await prisma.messagePrepare.findUnique({ where: { id: proposee.id } });
  }
  return { suiviId: resultat.suiviId, resume: suite?.resume ?? null, proposee, proposerSansSuite: Boolean(suite?.proposerSansSuite), suite: suite ?? null };
}

/** « Tout mettre en pause » (ou relancer) : un seul réglage arrête toutes les préparations et tous les envois. */
export async function toutMettreEnPause(pause: boolean, maintenant: Date = new Date()): Promise<void> {
  await enregistrerParametre({ cle: "MESSAGERIE_PAUSE", valeur: pause ? "EN_PAUSE" : "ACTIVE", valableDu: maintenant, source: pause ? "« Tout mettre en pause » (messagerie)" : "Messagerie relancée" });
}

/** Le libellé d'un code pour les écrans (« D3 · Questions sur le devis »). */
export function libelleMessage(code: string): string {
  return libelleDuCode(code);
}

export { definitionMessage };
