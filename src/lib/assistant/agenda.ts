import { PORTEES_GOOGLE, appelGoogle, connexionActive } from "@/lib/google/connexion";

/**
 * Google Calendar, pour les rappels et actions que l'assistant planifie
 * (mission 8). Le droit « calendar.events » est demandé à la prochaine
 * reconnexion Google (Paramètres → Connexions) ; tant qu'il manque, tout se
 * planifie dans le CRM et l'outil le dit — rien ne se perd.
 */

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type EvenementAgenda = { titre: string; description?: string | null; debut: Date; fin: Date; lieu?: string | null };

export async function agendaDisponible(): Promise<boolean> {
  return Boolean(await connexionActive(PORTEES_GOOGLE.AGENDA));
}

/** Crée l'événement ; rend null (sans erreur) si le droit Google manque. */
export async function creerEvenementAgenda(evenement: EvenementAgenda): Promise<{ id: string; lien: string | null } | null> {
  if (!(await agendaDisponible())) return null;
  const reponse = await appelGoogle(API, {
    portee: PORTEES_GOOGLE.AGENDA,
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      summary: evenement.titre.slice(0, 200),
      description: evenement.description?.slice(0, 2000) ?? undefined,
      location: evenement.lieu ?? undefined,
      start: { dateTime: evenement.debut.toISOString(), timeZone: "Europe/Paris" },
      end: { dateTime: evenement.fin.toISOString(), timeZone: "Europe/Paris" },
      reminders: { useDefault: true },
    }),
  });
  if (!reponse.ok) throw new Error(`Google Calendar a refusé l'événement (${reponse.status}).`);
  const corps = (await reponse.json()) as { id?: string; htmlLink?: string };
  return { id: corps.id ?? "", lien: corps.htmlLink ?? null };
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
  const plusJours = (n: number) => jourParisDe(new Date(maintenant.getTime() + n * 86_400_000));
  const dans = /dans\s+(une|un|\d+)\s*(jour|semaine|mois)/.exec(brut);
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
    return aParis(plusJours(ecart));
  }
  return null;
}
