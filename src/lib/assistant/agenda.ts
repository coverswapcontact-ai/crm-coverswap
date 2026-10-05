import { PORTEES_GOOGLE, appelGoogle, connexionActive } from "@/lib/google/connexion";
import { jourParis } from "@/lib/dossiers/dates";

/**
 * Google Calendar, pour les rappels et actions que l'assistant planifie
 * (mission 8). Le droit « calendar.events » est demandé à la prochaine
 * reconnexion Google (Paramètres → Connexions) ; tant qu'il manque, tout se
 * planifie dans le CRM et l'outil le dit — rien ne se perd.
 *
 * Mission 14 (partie 7) : chaque rappel daté (lead, ou « Rappeler… » d'un
 * dossier), quelle que soit son origine (appel noté, puce de la liste, dossier,
 * planifier, migration), a ici UN événement, créé, déplacé ou supprimé par la
 * tâche AGENDA_RAPPEL (`agenda/rappels.ts`) ; sans le droit, la tâche attend la
 * reconnexion. Un rappel noté au jour seul est un événement « toute la journée ».
 */

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** `journee` (mission 14, partie 7) : événement « toute la journée » du jour de Paris de `debut` (`fin` est ignorée). */
export type EvenementAgenda = { titre: string; description?: string | null; debut: Date; fin: Date; lieu?: string | null; journee?: boolean };

const lendemain = (jour: string) => new Date(Date.parse(`${jour}T12:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

export async function agendaDisponible(): Promise<boolean> {
  return Boolean(await connexionActive(PORTEES_GOOGLE.AGENDA));
}

/**
 * Le corps envoyé à Google : titre, description, lieu, début et fin en heure de Paris (ou le jour entier), rappels par
 * défaut de l'agenda. `effacerAutreForme` (PATCH) : Google fusionne les objets d'un PATCH, l'autre forme de l'horaire
 * (`date` ou `dateTime`) est donc remise à null pour qu'un rappel passe de « à l'heure » à « toute la journée » et retour.
 */
function corpsEvenement(evenement: EvenementAgenda, effacerAutreForme = false) {
  const jour = jourParis(evenement.debut);
  const horaire = (instant: Date) => ({ dateTime: instant.toISOString(), timeZone: "Europe/Paris", ...(effacerAutreForme ? { date: null } : {}) });
  const journee = (date: string) => ({ date, ...(effacerAutreForme ? { dateTime: null, timeZone: null } : {}) });
  return {
    summary: evenement.titre.slice(0, 200),
    description: evenement.description?.slice(0, 2000) ?? undefined,
    location: evenement.lieu ?? undefined,
    start: evenement.journee ? journee(jour) : horaire(evenement.debut),
    end: evenement.journee ? journee(lendemain(jour)) : horaire(evenement.fin),
    reminders: { useDefault: true },
  };
}

const JSON_UTF8 = { "Content-Type": "application/json; charset=UTF-8" };
const adresseEvenement = (id: string) => `${API}/${encodeURIComponent(id)}`;

/** Crée l'événement ; rend null (sans erreur) si le droit Google manque. */
export async function creerEvenementAgenda(evenement: EvenementAgenda): Promise<{ id: string; lien: string | null } | null> {
  if (!(await agendaDisponible())) return null;
  const reponse = await appelGoogle(API, { portee: PORTEES_GOOGLE.AGENDA, method: "POST", headers: JSON_UTF8, body: JSON.stringify(corpsEvenement(evenement)) });
  if (!reponse.ok) throw new Error(`Google Calendar a refusé l'événement (${reponse.status}).`);
  const corps = (await reponse.json()) as { id?: string; htmlLink?: string };
  return { id: corps.id ?? "", lien: corps.htmlLink ?? null };
}

/**
 * Mission 14 (partie 7) — met à jour l'événement `id` (PATCH : titre, description, horaires). Un événement effacé à la
 * main dans Google revient (`status: confirmed`). Rend null si le droit Google manque, ou si l'événement n'existe
 * plus chez Google (404, 410) : l'appelant en crée un autre.
 */
export async function modifierEvenementAgenda(id: string, evenement: EvenementAgenda): Promise<{ id: string; lien: string | null } | null> {
  if (!(await agendaDisponible())) return null;
  const reponse = await appelGoogle(adresseEvenement(id), { portee: PORTEES_GOOGLE.AGENDA, method: "PATCH", headers: JSON_UTF8, body: JSON.stringify({ ...corpsEvenement(evenement, true), status: "confirmed" }) });
  if (reponse.status === 404 || reponse.status === 410) return null;
  if (!reponse.ok) throw new Error(`Google Calendar a refusé la mise à jour de l'événement (${reponse.status}).`);
  const corps = (await reponse.json().catch(() => ({}))) as { id?: string; htmlLink?: string };
  return { id: corps.id ?? id, lien: corps.htmlLink ?? null };
}

/**
 * Mission 14 (partie 7) — retire l'événement `id` de l'agenda. Déjà parti (404, 410 : effacé à la main dans Google) :
 * ce n'est pas une erreur. Rend false si le droit Google manque (rien n'a été tenté).
 */
export async function supprimerEvenementAgenda(id: string): Promise<boolean> {
  if (!(await agendaDisponible())) return false;
  const reponse = await appelGoogle(adresseEvenement(id), { portee: PORTEES_GOOGLE.AGENDA, method: "DELETE" });
  if (reponse.ok || reponse.status === 404 || reponse.status === 410) return true;
  throw new Error(`Google Calendar a refusé la suppression de l'événement (${reponse.status}).`);
}

/**
 * « jeudi 14h », « demain 10h30 », « 2026-09-25 14:00 » : la date que Lucas
 * dicte, en heure de Paris. Rend null si l'on ne comprend pas — l'outil
 * demande alors une date en clair plutôt que de deviner.
 */
export function lireDateDictee(texte: string, maintenant: Date = new Date(), heureDefaut = 10): Date | null {
  const brut = texte.trim().toLowerCase();
  const heure = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i.exec(brut);
  const h = heure ? Number(heure[1]) : heureDefaut;
  const m = heure?.[2] ? Number(heure[2]) : 0;
  if (h > 23 || m > 59) return null;
  const decalage = (jour: string) => {
    const nom = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(new Date(`${jour}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "UTC+1";
    return Number(/([+-]\d+)/.exec(nom)?.[1] ?? 1);
  };
  const aParis = (jour: string) => {
    const date = new Date(`${jour}T00:00:00Z`);
    date.setUTCHours(h - decalage(jour), m, 0, 0);
    return date;
  };
  const jourParisDe = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(brut);
  if (iso) return aParis(iso[0]);
  const fr = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(brut);
  if (fr) {
    const annee = fr[3] ? (fr[3].length === 2 ? 2000 + Number(fr[3]) : Number(fr[3])) : Number(jourParisDe(maintenant).slice(0, 4));
    return aParis(`${annee}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`);
  }
  const aujourdhui = jourParisDe(maintenant);
  // « 12 octobre », « 1er novembre 2026 » (mission 10) : sans année, la prochaine occurrence (l'année suivante si le jour est passé de plus d'un mois).
  const mois = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  const enMots = /(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)(?:\s+(\d{4}))?/.exec(brut);
  if (enMots) {
    const numeroMois = mois.indexOf(enMots[2].normalize("NFD").replace(/\p{M}/gu, "")) + 1;
    const anneeCourante = Number(aujourdhui.slice(0, 4));
    const jourDe = (annee: number) => `${annee}-${String(numeroMois).padStart(2, "0")}-${enMots[1].padStart(2, "0")}`;
    const annee = enMots[3] ? Number(enMots[3]) : new Date(`${jourDe(anneeCourante)}T12:00:00Z`).getTime() < maintenant.getTime() - 31 * 86_400_000 ? anneeCourante + 1 : anneeCourante;
    return aParis(jourDe(annee));
  }
  // Mission 17 (partie A) : « le 12 », « le 1er » — le jour du mois seul : ce mois-ci s'il n'est pas passé, sinon le mois suivant.
  const leJour = /\ble\s+(\d{1,2})(?:er)?\b(?!\s*(?:h\b|:|\/|\d))/.exec(brut);
  if (leJour) {
    const numero = Number(leJour[1]);
    const [annee, moisCourant, jourCourant] = aujourdhui.split("-").map(Number);
    const decale = numero < jourCourant ? 1 : 0;
    const anneeVisee = moisCourant + decale > 12 ? annee + 1 : annee;
    const moisVise = ((moisCourant - 1 + decale) % 12) + 1;
    const joursDuMois = new Date(Date.UTC(anneeVisee, moisVise, 0)).getUTCDate();
    if (numero < 1 || numero > joursDuMois) return null;
    return aParis(`${anneeVisee}-${String(moisVise).padStart(2, "0")}-${String(numero).padStart(2, "0")}`);
  }
  const plusJours = (n: number) => jourParisDe(new Date(maintenant.getTime() + n * 86_400_000));
  const dans =/dans\s+(une|un|\d+)\s*(jour|semaine|mois)/.exec(brut);
  if (dans) {
    const n = dans[1] === "une" || dans[1] === "un" ? 1 : Number(dans[1]);
    return aParis(plusJours(dans[2] === "semaine" ? 7 * n : dans[2] === "mois" ? 30 * n : n));
  }
  if (/aujourd/.test(brut)) return aParis(aujourdhui);
  if (/apr[eè]s[- ]demain/.test(brut)) return aParis(plusJours(2));
  if (/demain/.test(brut)) return aParis(plusJours(1));
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const index = jours.findIndex((j) => brut.includes(j));
  if (index >= 0) {
    const courant = new Date(`${aujourdhui}T12:00:00Z`).getUTCDay();
    let ecart = (index - courant + 7) % 7;
    if (ecart === 0) ecart = /prochain/.test(brut) ? 7 : 0;
    // « lundi » dit un lundi après l'heure visée : le lundi suivant, pas un moment déjà passé.
    if (ecart === 0 && aParis(aujourdhui) <= maintenant) ecart = 7;
    return aParis(plusJours(ecart));
  }
  return null;
}
