/**
 * Mission 13 (26/09/2026), lot 5 — petits formats de texte partagés par les
 * écrans et par les outils de l'assistant. Les accords se calculent : plus de
 * « (s) », ni à l'écran ni dans ce que Claude lit.
 */

/** Le mot seul, accordé : « ouvert » / « ouverts » ; forme plurielle donnée quand un « s » ne suffit pas. */
export function accord(nombre: number, singulier: string, plurielForme = `${singulier}s`): string {
  return Math.abs(nombre) > 1 ? plurielForme : singulier;
}

/** « 1 lead », « 3 leads », « 2 photos reçues », « 0 relance ». */
export function pluriel(nombre: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${nombre} ${accord(nombre, singulier, plurielForme)}`;
}

/** « Beites Marie — Recouvrement de cuisine », ou le nom seul quand l'objet est vide (plus de tiret orphelin). */
export function titreDossier(dossier: { clientNom: string; objet?: string | null }): string {
  const objet = dossier.objet?.trim();
  return objet ? `${dossier.clientNom} — ${objet}` : dossier.clientNom;
}

/* ── Dates et montants (mission 13, lot 7) ──────────────────────────────────
 * Une seule définition pour tous les écrans et les outils de l'assistant, en
 * heure de Paris quelle que soit la machine (le serveur de Railway est en UTC :
 * sans fuseau explicite, le rendu serveur et le rendu du téléphone divergent).
 * Une valeur vide rend null (les écrans mettent leur propre « — » ou « jamais »).
 */

const PARIS = "Europe/Paris";
type Instant = string | Date | null | undefined;

function instant(valeur: Instant): Date | null {
  if (!valeur) return null;
  // Une date seule (« 2026-09-12 ») se lit à midi UTC : elle ne change pas de jour d'un fuseau à l'autre.
  const date = valeur instanceof Date ? valeur : new Date(/^\d{4}-\d{2}-\d{2}$/.test(valeur) ? `${valeur}T12:00:00.000Z` : valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formater(valeur: Instant, options: Intl.DateTimeFormatOptions): string | null {
  const date = instant(valeur);
  return date ? date.toLocaleString("fr-FR", { ...options, timeZone: PARIS }) : null;
}

/** « 1 250 € », « 12,5 € » ; `decimales` = 2 force les centimes (devis, factures, prix). */
export function euros(montant: number, decimales: 0 | 2 | "auto" = "auto"): string {
  const options = decimales === "auto" ? { minimumFractionDigits: 0, maximumFractionDigits: 2 } : { minimumFractionDigits: decimales, maximumFractionDigits: decimales };
  return `${montant.toLocaleString("fr-FR", options)} €`;
}

/** « 12 sept. » */
export function jour(valeur: string | Date): string;
export function jour(valeur: Instant): string | null;
export function jour(valeur: Instant): string | null {
  return formater(valeur, { day: "numeric", month: "short" });
}

/** « 12 sept. 2026 » */
export function jourAvecAnnee(valeur: string | Date): string;
export function jourAvecAnnee(valeur: Instant): string | null;
export function jourAvecAnnee(valeur: Instant): string | null {
  return formater(valeur, { day: "numeric", month: "short", year: "numeric" });
}

/** « 12 septembre 2026 » */
export function jourLong(valeur: string | Date): string;
export function jourLong(valeur: Instant): string | null;
export function jourLong(valeur: Instant): string | null {
  return formater(valeur, { day: "numeric", month: "long", year: "numeric" });
}

/** « 12/09/2026 » */
export function dateCourte(valeur: string | Date): string;
export function dateCourte(valeur: Instant): string | null;
export function dateCourte(valeur: Instant): string | null {
  return formater(valeur, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** « 12 sept. 14:05 » */
export function jourHeure(valeur: string | Date): string;
export function jourHeure(valeur: Instant): string | null;
export function jourHeure(valeur: Instant): string | null {
  return formater(valeur, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** « jeu. 1 oct. 18:00 » : un rendez-vous (rappel), le jour de la semaine d'abord. */
export function jourSemaineHeure(valeur: string | Date): string;
export function jourSemaineHeure(valeur: Instant): string | null;
export function jourSemaineHeure(valeur: Instant): string | null {
  const date = instant(valeur);
  return date ? `${formater(date, { weekday: "short", day: "numeric", month: "short" })} ${formater(date, { hour: "2-digit", minute: "2-digit" })}` : null;
}

/** « 12/09 14:05 » */
export function jourHeureCourt(valeur: string | Date): string;
export function jourHeureCourt(valeur: Instant): string | null;
export function jourHeureCourt(valeur: Instant): string | null {
  return formater(valeur, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** « 14:05 » */
export function heure(valeur: string | Date): string;
export function heure(valeur: Instant): string | null;
export function heure(valeur: Instant): string | null {
  return formater(valeur, { hour: "2-digit", minute: "2-digit" });
}

const JOUR_MS = 86_400_000;
const jourParisDe = (date: Date) => date.toLocaleDateString("fr-CA", { timeZone: PARIS });

/** Relatif, pour les listes : « à l'instant », « il y a 12 min », « il y a 3 h », « hier », « il y a 4 jours », puis la date. */
export function quand(valeur: string | Date, maintenant?: Date | number): string;
export function quand(valeur: Instant, maintenant?: Date | number): string | null;
export function quand(valeur: Instant, maintenant: Date | number = new Date()): string | null {
  const date = instant(valeur);
  if (!date) return null;
  const reference = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const ecartMs = reference.getTime() - date.getTime();
  const minutes = Math.round(ecartMs / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const memeJour = jourParisDe(date) === jourParisDe(reference);
  if (memeJour) return `il y a ${Math.round(minutes / 60)} h`;
  if (jourParisDe(date) === jourParisDe(new Date(reference.getTime() - JOUR_MS))) return "hier";
  const jours = Math.round(ecartMs / JOUR_MS);
  if (jours < 7) return `il y a ${jours} jours`;
  return date.getFullYear() === reference.getFullYear() ? jour(date) : jourAvecAnnee(date);
}
