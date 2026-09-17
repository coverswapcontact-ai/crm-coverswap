// Dates du module Dossiers, toujours lues à l'heure de Paris : le serveur
// Railway tourne en UTC, un devis émis à 23h30 porterait sinon la date (et,
// le 31 décembre, l'année de numérotation) du lendemain.

const FUSEAU = "Europe/Paris";

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const FORMAT_JOUR = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSEAU,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FORMAT_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const FORMAT_HORODATAGE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FORMAT_DATE_COURTE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function versDate(date: Date | string): Date {
  return date instanceof Date ? date : new Date(date);
}

/** Jour calendaire à Paris, au format AAAA-MM-JJ. */
export function jourParis(date: Date | string): string {
  const parties = FORMAT_JOUR.formatToParts(versDate(date));
  const valeur = (type: Intl.DateTimeFormatPartTypes) =>
    parties.find((p) => p.type === type)?.value ?? "";
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

export function anneeParis(date: Date | string): number {
  return Number(jourParis(date).slice(0, 4));
}

/** « 14 octobre 2026 », « 1er octobre 2026 ». */
export function dateEnLettres(date: Date | string): string {
  const [annee, mois, jour] = jourParis(date).split("-").map(Number);
  return `${jour === 1 ? "1er" : jour} ${MOIS[mois - 1]} ${annee}`;
}

export function estJourValide(jour: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  const date = new Date(`${jour}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === jour;
}

/** Une date sans heure (champ <input type="date">) est stockée à midi UTC :
 *  elle reste le même jour calendaire à Paris, été comme hiver. */
export function dateDepuisJour(jour: string): Date {
  return new Date(`${jour}T12:00:00.000Z`);
}

/**
 * Instant d'un événement daté au jour (passage d'étape, ouverture) : midi,
 * sans jamais dépasser maintenant. Saisi « aujourd'hui » à 3 h du matin, il ne
 * doit pas tomber dans le futur et fausser les durées.
 */
export function instantDuJour(jour: string, maintenant: Date = new Date()): Date {
  const date = dateDepuisJour(jour);
  return date.getTime() > maintenant.getTime() ? maintenant : date;
}

/** Nombre de jours de retard (0 si la date est aujourd'hui ou à venir). */
export function joursDeRetard(date: Date | string, maintenant: Date = new Date()): number {
  const jourEnMs = (jour: string) => Date.parse(`${jour}T00:00:00.000Z`);
  const ecart = (jourEnMs(jourParis(maintenant)) - jourEnMs(jourParis(date))) / 86_400_000;
  return Math.max(0, Math.round(ecart));
}

export function estAujourdhui(date: Date | string, maintenant: Date = new Date()): boolean {
  return jourParis(date) === jourParis(maintenant);
}

/** « mer. 16 sept. » */
export function formatJourCourt(date: Date | string): string {
  return FORMAT_JOUR_COURT.format(versDate(date));
}

/** « 16 sept. 2026, 14:32 » */
export function formatHorodatage(date: Date | string): string {
  return FORMAT_HORODATAGE.format(versDate(date));
}

/** « 16/09/2026 » */
export function formatDateCourte(date: Date | string): string {
  return FORMAT_DATE_COURTE.format(versDate(date));
}
