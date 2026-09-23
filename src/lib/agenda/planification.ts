import { ErreurMetier } from "@/lib/commun/erreurs";
import { noterRapidement } from "@/lib/commercial/appels";
import { jourParis } from "@/lib/dossiers/dates";
import { modifierDossier } from "@/lib/dossiers/dossiers";
import { modifierEntrant } from "@/lib/prospects/entrants";
import { creerEvenementAgenda } from "@/lib/assistant/agenda";

/**
 * Planifier un rappel (lead) ou la prochaine action d'un dossier à un moment
 * donné, dans le CRM d'abord, dans Google Calendar si le droit est accordé.
 * Une seule logique pour l'outil « planifier » de l'assistant et le bouton
 * « Planifier » d'un mail (mission 9) : le CRM garde l'action même si
 * l'agenda refuse.
 */

const heureParis = (date: Date) => date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const jourLong = (date: Date) => date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

export type EntreePlanification = {
  dossierId?: string | null;
  leadId?: string | null;
  /** Le nom du contact, pour le titre de l'événement et la phrase rendue. */
  nom: string;
  action: string;
  debut: Date;
  dureeMinutes?: number;
  /** D'où vient la planification (phrase dictée, mail) : dans la description de l'événement. */
  origine?: string | null;
};

export type ResultatPlanification = {
  debut: string;
  fin: string;
  agenda: { id: string; lien: string | null } | null;
  agendaErreur: string | null;
  quand: string;
  texte: string;
};

export async function planifierAction(entree: EntreePlanification): Promise<ResultatPlanification> {
  const fin = new Date(entree.debut.getTime() + (entree.dureeMinutes ?? 30) * 60_000);
  if (entree.dossierId) await modifierDossier(entree.dossierId, { prochaineAction: entree.action.slice(0, 120), prochaineActionDate: jourParis(entree.debut) } as Parameters<typeof modifierDossier>[1]);
  else if (entree.leadId) await modifierEntrant(entree.leadId, { rappelLe: entree.debut.toISOString() } as Parameters<typeof modifierEntrant>[1]);
  else throw new ErreurMetier("Ni dossier ni lead : rien où planifier.", 400);

  let agenda: { id: string; lien: string | null } | null = null;
  let agendaErreur: string | null = null;
  try {
    agenda = await creerEvenementAgenda({ titre: `${entree.action} — ${entree.nom}`, description: entree.origine ? `Planifié depuis le CRM : ${entree.origine}` : "Planifié depuis le CRM.", debut: entree.debut, fin });
  } catch (erreur) {
    agendaErreur = erreur instanceof Error ? erreur.message : String(erreur);
  }
  const quand = `${jourLong(entree.debut)} à ${heureParis(entree.debut)}`;
  await noterRapidement({ ...(entree.dossierId ? { dossierId: entree.dossierId } : { leadId: entree.leadId ?? undefined }), contenu: `Planifié : ${entree.action} le ${quand}${agenda ? " (inscrit dans Google Calendar)" : ""}.` }).catch(() => undefined);
  const texte = `Planifié : ${entree.action} pour ${entree.nom}, ${quand}. ${agenda ? "Inscrit dans Google Calendar." : agendaErreur ? `Google Calendar a refusé (${agendaErreur}) ; l'action est dans le CRM.` : "Pas inscrit dans Google Calendar : le droit « agenda » sera demandé à la prochaine reconnexion Google (Paramètres) ; l'action est dans le CRM."}`;
  return { debut: entree.debut.toISOString(), fin: fin.toISOString(), agenda, agendaErreur, quand, texte };
}
