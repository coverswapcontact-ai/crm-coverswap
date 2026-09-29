import prisma, { type Transaction } from "@/lib/prisma";
import type { Alerte } from "@/lib/alertes/canaux";
import { CANAUX_PUSH, type Canal, type ResultatCanal } from "@/lib/alertes/configuration";
import { agendaDisponible, creerEvenementAgenda, modifierEvenementAgenda, supprimerEvenementAgenda, type EvenementAgenda } from "@/lib/assistant/agenda";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { aHeureParis } from "@/lib/commercial/quand";
import { pluriel } from "@/lib/commun/format";
import { estDossierClos } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { GoogleIndisponible, etatConnexionGoogle } from "@/lib/google/connexion";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { LIBELLES_TYPE_PROJET } from "@/lib/prospects/constantes";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement } from "@/lib/taches/registre";

/**
 * Mission 14 (29/09/2026), partie 7 — chaque rappel daté laisse UNE trace dans Google Agenda et fait sonner le
 * téléphone 10 minutes avant.
 *
 * Un rappel, c'est celui d'un LEAD (`Lead.rappelLe`, liste « À rappeler » : ni archivé, ni perdu, ni après devis, sans
 * dossier vivant) ou celui d'un DOSSIER (prochaine action qui commence par « Rappeler », datée, dossier ni archivé ni
 * clos). `synchroniserRappel` est appelée partout où un rappel change, APRÈS l'écriture (jamais dans une transaction) ;
 * elle met en file deux tâches, qui relisent l'état COURANT au moment de s'exécuter :
 *  - AGENDA_RAPPEL (une par fiche, rejouée à chaque changement) : rappel daté → l'événement de 15 minutes est créé ou
 *    mis à jour (même identifiant : un seul événement par rappel), plus de rappel → il est supprimé et l'identifiant
 *    effacé. Sans droit agenda (ou Google coupé), la tâche ATTEND : la reconnexion Google la réveille ;
 *  - RAPPEL_NOTIFICATION (une par rappel et par instant) : 10 minutes avant, si le rappel vaut toujours cet instant, la
 *    notification part sur les canaux poussés (pas le mail), avec le numéro (bouton « Appeler ») et la fiche.
 * Un rappel de dossier noté au JOUR SEUL (écran du dossier, proposition validée, création : midi UTC, sans heure choisie)
 * n'est pas lu comme « 14 h » : son événement dure toute la journée et sa notification part à 9 h (heure de Paris) ce
 * jour-là. Aucun envoi au client : seul le téléphone de Lucas sonne.
 */

export const TACHE_AGENDA_RAPPEL = "AGENDA_RAPPEL";
export const TACHE_RAPPEL_NOTIFICATION = "RAPPEL_NOTIFICATION";
export const DUREE_EVENEMENT_RAPPEL_MIN = 15;
export const AVANCE_NOTIFICATION_MS = 10 * 60_000;
/** Un rappel noté au jour seul : sa notification part à cette heure-là (Paris), le jour dit. */
export const HEURE_RAPPEL_AU_JOUR = 9;
/** Sans droit agenda : la tâche réessaie toutes les 6 h au plus — la reconnexion Google la réveille tout de suite. */
const ATTENTE_SANS_AGENDA_MS = 6 * 60 * 60_000;

export type CibleRappel = { type: "LEAD" | "DOSSIER"; id: string };

/** La prochaine action d'un dossier est un rappel quand elle commence par « Rappeler » (appel, planifier, à la main). */
export function estRappel(action: string | null | undefined): boolean {
  return /^\s*rappeler(?![a-zà-ÿ])/i.test(action ?? "");
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
export const cleAgendaRappel = (cible: CibleRappel) => `agenda-rappel:${cible.type}:${cible.id}`;
export const cleNotificationRappel = (cible: CibleRappel, rappelLe: Date) => `rappel-push:${cible.type}:${cible.id}:${rappelLe.toISOString()}`;
export const lienFicheRappel = (cible: CibleRappel) => `${appUrl()}${cible.type === "LEAD" ? `/leads?lead=${cible.id}` : `/dossiers?dossier=${cible.id}`}`;

/**
 * Une date de prochaine action notée au jour (midi UTC, `dateDepuisJour`) qui n'est pas l'instant choisi à l'heure
 * (`Dossier.prochaineActionInstant` : appel, planifier, rappel repris d'un lead). Toute autre heure est un instant exact.
 */
export function estJourSeul(date: Date, instant: Date | null | undefined): boolean {
  return date.toISOString().endsWith("T12:00:00.000Z") && instant?.getTime() !== date.getTime();
}

/** Ce qu'on sait d'un rappel à l'instant : sa date (null = plus de rappel), l'événement rangé, et de quoi l'écrire. */
export type EtatRappel = {
  rappelLe: Date | null;
  /** Rappel de dossier noté au jour seul (sans heure choisie) : événement « toute la journée », notification à 9 h. */
  jourSeul: boolean;
  evenementId: string | null;
  nom: string;
  ville: string | null;
  /** E.164 (+33…), ou null s'il est illisible. */
  telephone: string | null;
  telephoneLisible: string | null;
  /** « 2 appels sans réponse · Cuisine ». */
  raison: string | null;
  lien: string;
};

/** L'état COURANT du rappel d'une fiche (archivée comprise, pour pouvoir retirer son événement) ; null si elle n'existe pas. */
export async function lireRappel(cible: CibleRappel): Promise<EtatRappel | null> {
  const { LEAD_SANS_DOSSIER, nomDuLead, telephoneLisible, villeLisible } = await import("@/lib/prospects/leads");
  if (cible.type === "LEAD") {
    const lead = await prisma.lead.findFirst({ where: { ...AVEC_ARCHIVES, id: cible.id }, select: { prenom: true, nom: true, telephone: true, ville: true, typeProjet: true, tentatives: true, rappelLe: true, agendaEvenementId: true } });
    if (!lead) return null;
    // La règle des listes Leads : un lead archivé, perdu, après devis ou avec un dossier vivant n'a plus de rappel ici (il vit sur le dossier).
    const actif = lead.rappelLe ? (await prisma.lead.count({ where: { AND: [LEAD_SANS_DOSSIER, { id: cible.id }] } })) > 0 : false;
    return {
      rappelLe: actif ? lead.rappelLe : null,
      jourSeul: false,
      evenementId: lead.agendaEvenementId,
      nom: nomDuLead(lead),
      ville: villeLisible(lead.ville),
      telephone: normaliserTelephone(lead.telephone),
      telephoneLisible: telephoneLisible(lead.telephone),
      raison: raisonDuRappel(lead.tentatives, LIBELLES_TYPE_PROJET[lead.typeProjet] ?? null),
      lien: lienFicheRappel(cible),
    };
  }
  const dossier = await prisma.dossier.findFirst({
    where: { ...AVEC_ARCHIVES, id: cible.id },
    select: { clientNom: true, clientVille: true, clientTelephone: true, objet: true, etape: true, archiveLe: true, prochaineAction: true, prochaineActionDate: true, prochaineActionInstant: true, agendaEvenementId: true, lead: { select: { prenom: true, nom: true, telephone: true, tentatives: true } } },
  });
  if (!dossier) return null;
  const rappelLe = !dossier.archiveLe && !estDossierClos(dossier.etape) && estRappel(dossier.prochaineAction) ? dossier.prochaineActionDate : null;
  const telephone = dossier.clientTelephone.trim() || dossier.lead?.telephone || "";
  // Les appels sans réponse : ceux du lead, sinon ceux lus dans les événements du dossier (la règle de noterAppel).
  const tentatives = dossier.lead ? dossier.lead.tentatives : rappelLe ? await (await import("@/lib/sms/proposition")).tentativesDuDossier(cible.id) : 0;
  return {
    rappelLe,
    jourSeul: rappelLe ? estJourSeul(rappelLe, dossier.prochaineActionInstant) : false,
    evenementId: dossier.agendaEvenementId,
    nom: dossier.clientNom.trim() || (dossier.lead ? nomDuLead(dossier.lead) : "Contact sans nom"),
    ville: villeLisible(dossier.clientVille),
    telephone: normaliserTelephone(telephone),
    telephoneLisible: telephone ? telephoneLisible(telephone) : null,
    raison: raisonDuRappel(tentatives, dossier.objet.trim() || null),
    lien: lienFicheRappel(cible),
  };
}

function raisonDuRappel(tentatives: number, projet: string | null): string | null {
  return [tentatives > 0 ? pluriel(tentatives, "appel sans réponse", "appels sans réponse") : null, projet].filter(Boolean).join(" · ") || null;
}

/**
 * L'événement d'un rappel : 15 minutes (toute la journée pour un rappel noté au jour seul), « Rappeler {nom} – {ville} »,
 * le numéro en tel: et la fiche dans la description.
 */
export function evenementDuRappel(etat: EtatRappel & { rappelLe: Date }): EvenementAgenda {
  return {
    titre: `Rappeler ${etat.nom}${etat.ville ? ` – ${etat.ville}` : ""}`,
    description: [etat.telephone ? `Appeler : tel:${etat.telephone}` : null, `Fiche : ${etat.lien}`].filter(Boolean).join("\n"),
    debut: etat.rappelLe,
    fin: new Date(etat.rappelLe.getTime() + DUREE_EVENEMENT_RAPPEL_MIN * 60_000),
    ...(etat.jourSeul ? { journee: true } : {}),
  };
}

/** Le moment de la notification : rappel − 10 min, ou 9 h (Paris) le jour dit pour un rappel noté au jour seul. */
export function momentDeLaNotification(rappelLe: Date, jourSeul: boolean): Date {
  return jourSeul ? aHeureParis(rappelLe, 0, HEURE_RAPPEL_AU_JOUR) : new Date(rappelLe.getTime() - AVANCE_NOTIFICATION_MS);
}

/**
 * À appeler partout où un rappel change, APRÈS l'écriture. Met en file la synchronisation de l'agenda (une tâche par
 * fiche, rejouée) et la notification 10 minutes avant (une par instant de rappel). Ne lève jamais : l'écriture métier
 * est déjà faite, un souci ici se journalise. Une fiche qui n'a jamais eu de rappel ne crée aucune tâche.
 */
export async function synchroniserRappel(cible: CibleRappel, maintenant: Date = new Date()): Promise<void> {
  try {
    const etat = await lireRappel(cible);
    if (!etat) return;
    const cle = cleAgendaRappel(cible);
    const dejaSuivi = Boolean(etat.evenementId) || Boolean(await prisma.tache.findUnique({ where: { cle }, select: { id: true } }));
    if (etat.rappelLe || dejaSuivi) await mettreEnFile({ type: TACHE_AGENDA_RAPPEL, cle, charge: cible, mode: "RECONCILIATION" });
    if (etat.rappelLe) await programmerNotification(cible, etat.rappelLe, etat.jourSeul, maintenant);
  } catch (erreur) {
    console.error(`[rappels] ${cible.type} ${cible.id} : synchronisation non mise en file :`, erreur);
  }
}

/** Plusieurs fiches à la suite (archivage en lot, fusion…). */
export async function synchroniserRappels(cibles: readonly CibleRappel[], maintenant: Date = new Date()): Promise<void> {
  for (const cible of cibles) await synchroniserRappel(cible, maintenant);
}

/**
 * Dans une transaction qui efface des rappels sans pouvoir attendre sa fin (anonymisation RGPD) : l'agenda de ces
 * fiches est remis en file avec elle ; la tâche relira l'état validé (plus de rappel → événement supprimé). Les
 * notifications programmées se taisent d'elles-mêmes (elles relisent le rappel).
 */
export async function resynchroniserAgendaDans(tx: Transaction, cibles: readonly CibleRappel[]): Promise<void> {
  for (const cible of cibles) await mettreEnFile({ type: TACHE_AGENDA_RAPPEL, cle: cleAgendaRappel(cible), charge: cible, mode: "RECONCILIATION" }, tx);
}

/**
 * Un dossier vient de s'ouvrir (écran Dossiers, fiche client, reprise, bouton du lead) : son lead d'origine n'a plus de
 * rappel à lui (il sort des listes Leads). Son rappel À VENIR passe sur le dossier, à son heure exacte, quand le dossier
 * n'a pas d'autre prochaine action (ou un « Rappeler » du même jour) ; le lead le perd alors. Sinon il reste sur le lead,
 * en sommeil (il revient si le dossier est archivé). Puis l'agenda suit pour les deux : l'événement du lead est supprimé,
 * celui du dossier posé. Ne lève jamais : le dossier est déjà ouvert.
 */
export async function rappelALOuverture(dossierId: string, leadId: string | null, maintenant: Date = new Date()): Promise<void> {
  try {
    const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId }, select: { rappelLe: true } }) : null;
    const rappel = lead?.rappelLe && lead.rappelLe.getTime() > maintenant.getTime() ? lead.rappelLe : null;
    if (leadId && rappel) {
      const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { prochaineAction: true, prochaineActionDate: true } });
      const action = dossier?.prochaineAction?.trim() ?? "";
      const memeJour = !dossier?.prochaineActionDate || jourParis(dossier.prochaineActionDate) === jourParis(rappel);
      if (dossier && (!action || (estRappel(action) && memeJour))) {
        await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: action || "Rappeler", prochaineActionDate: rappel, prochaineActionInstant: rappel } });
        await prisma.lead.update({ where: { id: leadId }, data: { rappelLe: null } });
      }
    }
  } catch (erreur) {
    console.error(`[rappels] dossier ${dossierId} : rappel du lead non repris :`, erreur);
  }
  await synchroniserRappels([...(leadId ? [{ type: "LEAD" as const, id: leadId }] : []), { type: "DOSSIER", id: dossierId }], maintenant);
}

/**
 * La notification, à rappel − 10 min (tout de suite si c'est déjà plus proche) ; rien pour un rappel passé. Un rappel
 * noté au jour seul : à 9 h (Paris) ce jour-là, rien si 9 h est déjà passé (il vient d'être posé). La clé porte
 * l'instant : un rappel déplacé en programme une autre, l'ancienne ne notifiera pas (elle relit le rappel). Une clé déjà
 * passée sans notifier (rappel déplacé puis remis à la même heure) est réarmée.
 */
async function programmerNotification(cible: CibleRappel, rappelLe: Date, jourSeul: boolean, maintenant: Date): Promise<void> {
  const moment = momentDeLaNotification(rappelLe, jourSeul);
  if ((jourSeul ? moment : rappelLe).getTime() <= maintenant.getTime()) return;
  const cle = cleNotificationRappel(cible, rappelLe);
  const existante = await prisma.tache.findUnique({ where: { cle }, select: { statut: true, resultat: true } });
  const rearmer = existante?.statut === "TERMINEE" && lireJson(existante.resultat)?.notifie === false;
  await mettreEnFile({
    type: TACHE_RAPPEL_NOTIFICATION,
    cle,
    charge: { ...cible, rappelLe: rappelLe.toISOString() },
    apres: new Date(Math.max(maintenant.getTime(), moment.getTime())),
    priorite: 5,
    ...(rearmer ? { mode: "RECONCILIATION" as const } : {}),
  });
}

function lireJson(texte: string | null | undefined): Record<string, unknown> | null {
  try {
    return texte ? (JSON.parse(texte) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function lireCible(charge: unknown): CibleRappel {
  const { type, id } = (charge ?? {}) as Partial<CibleRappel>;
  if ((type !== "LEAD" && type !== "DOSSIER") || typeof id !== "string" || !id) throw new Error("Tâche de rappel illisible : type ou identifiant manquant.");
  return { type, id };
}

/** L'identifiant de l'événement, rangé sur la fiche — sans toucher `updatedAt` (ce n'est pas une activité du contact). */
async function rangerEvenement(cible: CibleRappel, evenementId: string | null): Promise<void> {
  if (cible.type === "LEAD") {
    const lead = await prisma.lead.findUnique({ where: { id: cible.id }, select: { updatedAt: true } });
    if (lead) await prisma.lead.update({ where: { id: cible.id }, data: { agendaEvenementId: evenementId, updatedAt: lead.updatedAt } });
    return;
  }
  const dossier = await prisma.dossier.findUnique({ where: { id: cible.id }, select: { updatedAt: true } });
  if (dossier) await prisma.dossier.update({ where: { id: cible.id }, data: { agendaEvenementId: evenementId, updatedAt: dossier.updatedAt } });
}

/** Le droit agenda manque (ou Google n'est pas connecté) : la tâche attend, sans alerte — Paramètres le dit, une fois. */
async function exigerAgenda(): Promise<void> {
  if (await agendaDisponible()) return;
  const etat = await etatConnexionGoogle();
  const raison = !etat.configuree ? "connexion non configurée sur le serveur" : !etat.connexion ? "aucun compte connecté" : "droit « agenda » non accordé : reconnecter le compte dans Paramètres";
  throw new GoogleIndisponible(`${raison} (le rappel s'inscrira dans l'agenda dès que ce sera fait).`, ATTENTE_SANS_AGENDA_MS);
}

export type ResultatAgendaRappel = { resume: string; evenementId: string | null };

/** Le traitement AGENDA_RAPPEL : relit le rappel et met l'agenda d'accord (créer, mettre à jour, supprimer). */
export async function executerAgendaRappel(charge: unknown): Promise<ResultatAgendaRappel> {
  const cible = lireCible(charge);
  const etat = await lireRappel(cible);
  if (!etat) return { resume: "Fiche introuvable : rien dans l'agenda.", evenementId: null };
  if (!etat.rappelLe) {
    if (!etat.evenementId) return { resume: "Pas de rappel : rien dans l'agenda.", evenementId: null };
    await exigerAgenda();
    await supprimerEvenementAgenda(etat.evenementId);
    await rangerEvenement(cible, null);
    return { resume: `Rappel retiré : événement supprimé de l'agenda (${etat.nom}).`, evenementId: null };
  }
  await exigerAgenda();
  const evenement = evenementDuRappel({ ...etat, rappelLe: etat.rappelLe });
  const misAJour = etat.evenementId ? await modifierEvenementAgenda(etat.evenementId, evenement) : null;
  const pose = misAJour ?? (await creerEvenementAgenda(evenement));
  if (!pose) {
    // Le droit a disparu entre la vérification et l'appel : la tâche attend (ou réessaie plus tard).
    await exigerAgenda();
    throw new Error("Google Agenda n'a pas posé l'événement : nouvel essai plus tard.");
  }
  if (pose.id !== etat.evenementId) await rangerEvenement(cible, pose.id);
  const quand = evenement.journee ? `${jourParis(evenement.debut)}, toute la journée` : evenement.debut.toISOString();
  return { resume: `${misAJour ? "Événement mis à jour" : "Événement créé"} : « ${evenement.titre} », ${quand}.`, evenementId: pose.id };
}

/* ── La notification 10 minutes avant (9 h le jour dit, pour un rappel noté au jour seul) ── */

type Alerteur = (alerte: Alerte, options: { canaux?: readonly Canal[]; origine?: string }) => Promise<ResultatCanal[]>;
const CLE_ALERTEUR = "__coverswapAlerteurRappelsEssai";
const globalEssai = globalThis as unknown as Record<string, Alerteur | undefined>;

/** Essais seulement : remplace l'envoi des notifications de rappel. */
export function definirAlerteurRappelsEssai(alerteur: Alerteur | null): void {
  globalEssai[CLE_ALERTEUR] = alerteur ?? undefined;
}

async function alerteur(): Promise<Alerteur> {
  return globalEssai[CLE_ALERTEUR] ?? (await import("@/lib/alertes/canaux")).alerter;
}

export type ResultatNotificationRappel = { notifie: boolean; resume: string; canaux?: string[] };

/**
 * Le traitement RAPPEL_NOTIFICATION : si le rappel vaut toujours l'instant de la tâche (pas déplacé, ni retiré, ni
 * passé), la notification part sur les canaux poussés — une par rappel (même étiquette : elle remplace la précédente).
 */
export async function notifierRappel(charge: unknown, maintenant: Date = new Date()): Promise<ResultatNotificationRappel> {
  const cible = lireCible(charge);
  const prevu = (charge as { rappelLe?: string }).rappelLe ?? "";
  const etat = await lireRappel(cible);
  if (!etat?.rappelLe) return { notifie: false, resume: "Rappel retiré depuis : pas de notification." };
  if (etat.rappelLe.toISOString() !== prevu) return { notifie: false, resume: `Rappel déplacé (${etat.rappelLe.toISOString()} au lieu de ${prevu}) : pas de notification pour cet instant.` };
  let titre: string;
  if (etat.jourSeul) {
    // Noté au jour seul : la notification du matin, tant que c'est encore ce jour-là à Paris.
    if (jourParis(maintenant) > jourParis(etat.rappelLe)) return { notifie: false, resume: "Jour du rappel passé : pas de notification." };
    titre = `Rappel aujourd'hui : ${etat.nom}`;
  } else {
    const resteMs = etat.rappelLe.getTime() - maintenant.getTime();
    if (resteMs <= 0) return { notifie: false, resume: "Rappel déjà passé : pas de notification." };
    const minutes = resteMs < AVANCE_NOTIFICATION_MS - 30_000 ? Math.max(1, Math.round(resteMs / 60_000)) : 10;
    titre = `Rappel dans ${minutes} min : ${etat.nom}`;
  }
  const origine = cleNotificationRappel(cible, etat.rappelLe);
  const resultats = await (await alerteur())(
    {
      titre,
      texte: [etat.ville, etat.telephoneLisible, etat.raison].filter(Boolean).join(" · ") || "Rappel prévu",
      lien: etat.lien,
      libelleLien: "Ouvrir la fiche",
      ...(etat.telephoneLisible ? { telephone: etat.telephoneLisible } : {}),
      etiquette: `rappel:${cible.type}:${cible.id}`,
    },
    { canaux: CANAUX_PUSH, origine }
  );
  return { notifie: true, resume: `Notification envoyée : ${etat.nom}.`, canaux: resultats.map((r) => `${r.canal} : ${r.ok ? "envoyée" : (r.detail ?? "échec")}`) };
}

export function enregistrerTachesRappels(): void {
  enregistrerTraitement(TACHE_AGENDA_RAPPEL, {
    libelle: "Rappel : l'événement de Google Agenda (créé, mis à jour ou supprimé)",
    acteur: "SYSTEME:agenda",
    tentativesMax: 8,
    delaiMaxMs: 60_000,
    executer: (charge) => executerAgendaRappel(charge),
  });
  enregistrerTraitement(TACHE_RAPPEL_NOTIFICATION, {
    libelle: "Rappel : notification 10 minutes avant",
    acteur: "SYSTEME:rappels",
    tentativesMax: 3,
    delaiMaxMs: 60_000,
    executer: (charge) => notifierRappel(charge),
  });
}
