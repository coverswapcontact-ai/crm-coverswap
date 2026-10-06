/**
 * Mission 22 (A1) — les dates de la v2, en phrases, heure de Paris, sans dépendance serveur (importable par les écrans
 * comme par les essais). Une seule fonction de date relative pour tous les écrans v2 (règle 4 de docs/CRM-V2.md) ;
 * la date exacte s'affiche au survol ou à l'appui long (`dateExacte`).
 */

const PARIS = "Europe/Paris";
const JOUR_MS = 86_400_000;

function partiesParis(date: Date) {
  const lire = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, ...options }).format(date);
  const jour = new Intl.DateTimeFormat("sv-SE", { timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const heure = Number(new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", hour12: false }).format(date)) % 24;
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, minute: "2-digit" }).format(date));
  return { jour, heure, minute, lire };
}

const ecartJours = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / JOUR_MS);

/** « 9 h », « 18 h 30 ». */
export function heureLisible(date: Date): string {
  const p = partiesParis(date);
  return p.minute ? `${p.heure} h ${String(p.minute).padStart(2, "0")}` : `${p.heure} h`;
}

function instant(valeur: string | Date): Date | null {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Un moment passé, en phrase : « à l'instant », « il y a 12 min », « il y a 3 h » (le même jour), « hier 18 h 40 »,
 * « lundi 9 h » (moins d'une semaine), « le 12 oct. 9 h » au-delà (avec l'année si elle change). Un moment à venir
 * (horloge en avance, date posée) rend « dans N min », « dans N h », « demain 9 h », puis le jour.
 */
export function dateRelative(valeur: string | Date, maintenant: Date = new Date()): string {
  const date = instant(valeur);
  if (!date) return "";
  const ecartMs = maintenant.getTime() - date.getTime();
  const minutes = Math.round(ecartMs / 60_000);
  if (Math.abs(minutes) < 1) return "à l'instant";
  const cible = partiesParis(date);
  const ici = partiesParis(maintenant);
  const jours = ecartJours(cible.jour, ici.jour);
  const h = heureLisible(date);
  if (minutes > 0) {
    if (minutes < 60) return `il y a ${minutes} min`;
    if (jours === 0) return `il y a ${Math.round(minutes / 60)} h`;
    if (jours === 1) return `hier ${h}`;
    if (jours < 7) return `${cible.lire({ weekday: "long" })} ${h}`;
  } else {
    if (minutes > -60) return `dans ${-minutes} min`;
    if (jours === 0) return `dans ${Math.round(-minutes / 60)} h`;
    if (jours === -1) return `demain ${h}`;
    if (jours > -7) return `${cible.lire({ weekday: "long" })} ${h}`;
  }
  const memeAnnee = cible.jour.slice(0, 4) === ici.jour.slice(0, 4);
  return `le ${cible.lire(memeAnnee ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })} ${h}`;
}

/** « lundi 12 octobre 2026 à 9 h 05 » : la date exacte, pour le survol ou l'appui long. */
export function dateExacte(valeur: string | Date): string {
  const date = instant(valeur);
  if (!date) return "";
  const p = partiesParis(date);
  return `${p.lire({ weekday: "long", day: "numeric", month: "long", year: "numeric" })} à ${heureLisible(date)}`;
}

/** « depuis hier 18 h 40 », « depuis 2 jours » : le point de départ d'une période (le journal, la main). */
export function depuisLisible(valeur: string | Date, maintenant: Date = new Date()): string {
  const date = instant(valeur);
  if (!date) return "";
  const jours = ecartJours(partiesParis(date).jour, partiesParis(maintenant).jour);
  if (jours >= 7) return `depuis ${jours} jours`;
  return `depuis ${dateRelative(date, maintenant).replace(/^il y a /, "")}`;
}
