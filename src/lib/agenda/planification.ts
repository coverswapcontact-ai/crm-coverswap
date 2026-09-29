import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { noterRapidement } from "@/lib/commercial/appels";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { modifierDossier } from "@/lib/dossiers/dossiers";
import { modifierEntrant } from "@/lib/prospects/entrants";
import { creerEvenementAgenda } from "@/lib/assistant/agenda";
import { etatConnexionGoogle } from "@/lib/google/connexion";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { DUREE_EVENEMENT_RAPPEL_MIN, estRappel, lireRappel, synchroniserRappel, type CibleRappel } from "./rappels";

/**
 * Planifier un rappel (lead) ou la prochaine action d'un dossier à un moment
 * donné, dans le CRM d'abord, dans Google Calendar si le droit est accordé.
 * Une seule logique pour l'outil « planifier » de l'assistant et le bouton
 * « Planifier » d'un mail (mission 9) : le CRM garde l'action même si
 * l'agenda refuse.
 *
 * Mission 14 (partie 7) : un RAPPEL (celui d'un lead, ou une action de dossier
 * qui commence par « Rappeler ») passe par `synchroniserRappel` — un seul
 * événement par rappel (15 minutes, titre et description de la fiche), mis à
 * jour quand on replanifie (plus de doublon dans Google), posé plus tard si le
 * droit manque encore — et garde l'heure exacte (plus de « jour seul » sur le
 * dossier). Un rappel hors des listes (lead sans suite, archivé, après devis ou
 * suivi par son dossier ; dossier clos ou archivé) n'a ni événement suivi ni
 * notification : il garde l'événement direct d'avant, et le texte le dit. Une
 * autre action de dossier crée son événement comme avant.
 */

const heureParis = (date: Date) => date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const jourLong = (date: Date) => date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

export type EntreePlanification = {
  dossierId?: string | null;
  leadId?: string | null;
  /** Le nom du contact, pour la phrase rendue (et le titre d'un événement direct : un rappel suivi prend celui de la fiche). */
  nom: string;
  action: string;
  debut: Date;
  /** Durée d'un événement direct (30 min à défaut) ; un rappel suivi dure toujours 15 minutes. */
  dureeMinutes?: number;
  /** D'où vient la planification (phrase dictée, mail) : dans la description d'un événement direct (pas d'un rappel suivi). */
  origine?: string | null;
};

export type ResultatPlanification = {
  debut: string;
  fin: string;
  /** L'événement créé tout de suite (action de dossier, rappel hors des listes). Un rappel suivi s'inscrit par la file de tâches : null ici. */
  agenda: { id: string; lien: string | null } | null;
  agendaErreur: string | null;
  /** Mission 14 (partie 7) : un rappel suivi, inscrit (ou mis à jour) dans l'agenda par la file de tâches, et notifié. */
  rappel: boolean;
  quand: string;
  texte: string;
};

/**
 * Pourquoi rien ne s'inscrit dans l'agenda : Google pas connecté ou coupé, le droit « agenda » pas accordé, ou (partie 9)
 * l'API Google Calendar pas activée dans le projet Google Cloud ; null quand tout est là.
 */
async function agendaManquant(): Promise<string | null> {
  const etat = await etatConnexionGoogle();
  if (etat.connexion?.echeance.coupee) return "Google est coupé (Paramètres → Connexions → Reconnecter)";
  if (etat.agenda) return etat.agendaApiActivee ? null : "l'API Google Calendar n'est pas activée dans le projet Google Cloud (Paramètres → Connexions)";
  if (!etat.configuree || !etat.connexion) return "Google n'est pas connecté (Paramètres → Connexions)";
  return "le droit « agenda » n'est pas accordé (Paramètres → Connexions → Reconnecter)";
}

/** Pourquoi un rappel n'est pas suivi (ni listes, ni agenda tenu à jour, ni notification) : la règle de `lireRappel`, dite. */
async function horsDesListes(cible: CibleRappel): Promise<string> {
  if (cible.type === "LEAD") {
    const lead = await prisma.lead.findFirst({ where: { ...AVEC_ARCHIVES, id: cible.id }, select: { archiveLe: true, statut: true, dossiers: { where: { archiveLe: null }, select: { id: true } } } });
    if (lead?.archiveLe) return "ce contact est archivé";
    if (lead?.dossiers.length) return "ce contact a un dossier (planifie le rappel sur son dossier)";
    return lead?.statut === "PERDU" ? "ce contact est sans suite" : "ce contact a déjà reçu son devis";
  }
  const dossier = await prisma.dossier.findFirst({ where: { ...AVEC_ARCHIVES, id: cible.id }, select: { archiveLe: true, etape: true } });
  if (dossier?.archiveLe) return "ce dossier est archivé";
  return `ce dossier est ${LIBELLES_ETAPE[dossier?.etape as EtapeDossier]?.toLowerCase() ?? "clos"}`;
}

export async function planifierAction(entree: EntreePlanification): Promise<ResultatPlanification> {
  const estUnRappel = entree.dossierId ? estRappel(entree.action) : Boolean(entree.leadId);
  if (entree.dossierId) {
    if (estUnRappel) {
      // Un rappel garde son heure : la date dictée (« jeudi 14h ») est l'instant exact, comme après un appel.
      const dossier = await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { id: true } });
      if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
      await prisma.dossier.update({ where: { id: entree.dossierId }, data: { prochaineAction: entree.action.slice(0, 120), prochaineActionDate: entree.debut, prochaineActionInstant: entree.debut } });
    } else {
      await modifierDossier(entree.dossierId, { prochaineAction: entree.action.slice(0, 120), prochaineActionDate: jourParis(entree.debut) } as Parameters<typeof modifierDossier>[1]);
    }
  } else if (entree.leadId) await modifierEntrant(entree.leadId, { rappelLe: entree.debut.toISOString() } as Parameters<typeof modifierEntrant>[1]);
  else throw new ErreurMetier("Ni dossier ni lead : rien où planifier.", 400);

  let agenda: { id: string; lien: string | null } | null = null;
  let agendaErreur: string | null = null;
  let manque: string | null = null;
  // Un rappel est SUIVI quand la fiche est dans les listes (la règle de lireRappel) : un seul événement, tenu à jour, et la notification.
  let horsListes: string | null = null;
  if (estUnRappel) {
    const cible: CibleRappel = entree.dossierId ? { type: "DOSSIER", id: entree.dossierId } : { type: "LEAD", id: entree.leadId! };
    // Un seul événement par rappel : créé, ou déplacé s'il existe (la tâche relit le rappel et range l'identifiant).
    await synchroniserRappel(cible);
    if (!(await lireRappel(cible))?.rappelLe) horsListes = await horsDesListes(cible);
  }
  const suivi = estUnRappel && !horsListes;
  const fin = new Date(entree.debut.getTime() + (suivi ? DUREE_EVENEMENT_RAPPEL_MIN : (entree.dureeMinutes ?? 30)) * 60_000);
  if (suivi) {
    manque = await agendaManquant().catch(() => null);
  } else {
    // Une autre action de dossier, ou un rappel hors des listes : l'événement direct, comme avant (replanifier en crée un autre).
    try {
      agenda = await creerEvenementAgenda({ titre: `${entree.action} — ${entree.nom}`, description: entree.origine ? `Planifié depuis le CRM : ${entree.origine}` : "Planifié depuis le CRM.", debut: entree.debut, fin });
      if (!agenda) manque = await agendaManquant().catch(() => null);
    } catch (erreur) {
      agendaErreur = erreur instanceof Error ? erreur.message : String(erreur);
    }
  }
  const inscrit = suivi ? !manque : Boolean(agenda);
  const quand = `${jourLong(entree.debut)} à ${heureParis(entree.debut)}`;
  await noterRapidement({ ...(entree.dossierId ? { dossierId: entree.dossierId } : { leadId: entree.leadId ?? undefined }), contenu: `Planifié : ${entree.action} le ${quand}${inscrit ? " (inscrit dans Google Calendar)" : ""}.` }).catch(() => undefined);
  const nonSuivi = horsListes ? ` ${horsListes[0].toUpperCase()}${horsListes.slice(1)} : ce rappel n'est pas dans les listes du CRM et n'aura pas de notification.` : "";
  const suite = inscrit
    ? suivi
      ? "Inscrit dans Google Calendar (un seul événement par rappel : replanifier le déplace)."
      : `Inscrit dans Google Calendar.${horsListes ? `${nonSuivi} Événement à part : replanifier en crée un autre.` : ""}`
    : agendaErreur
      ? `Google Calendar a refusé (${agendaErreur}) ; l'action est dans le CRM.${nonSuivi}`
      : suivi
        ? `Pas inscrit dans Google Calendar : ${manque ?? "l'agenda n'est pas joignable"} ; le rappel est dans le CRM et s'inscrira dans Google Calendar dès que ce sera fait.`
        : `Pas inscrit dans Google Calendar : ${manque ?? "l'agenda n'est pas joignable"} ; l'action est dans le CRM.${nonSuivi}`;
  const texte = `Planifié : ${entree.action} pour ${entree.nom}, ${quand}. ${suite}`;
  return { debut: entree.debut.toISOString(), fin: fin.toISOString(), agenda, agendaErreur, rappel: suivi, quand, texte };
}
