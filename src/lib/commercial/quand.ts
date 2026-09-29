/**
 * Mission 14 (29/09/2026), partie 2 — « J+n à HH:MM, heure de Paris », en un
 * seul endroit (rappels d'appel, relances). Pur, sans base : le serveur de
 * Railway tourne en UTC, l'heure de Paris est toujours explicite.
 *
 * Le jour se compte au calendrier de Paris (et non en ajoutant 24 h) : la nuit
 * d'un changement d'heure dure 23 ou 25 h, « demain » reste le jour suivant.
 */

const PARTIES_PARIS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type HeureMurale = { annee: number; mois: number; jour: number; heure: number; minute: number; seconde: number };

/** Ce qu'affiche une horloge de Paris à cet instant. */
function murale(instant: Date): HeureMurale {
  const parties = PARTIES_PARIS.formatToParts(instant);
  const valeur = (type: Intl.DateTimeFormatPartTypes) => Number(parties.find((p) => p.type === type)?.value ?? "0");
  return { annee: valeur("year"), mois: valeur("month"), jour: valeur("day"), heure: valeur("hour") % 24, minute: valeur("minute"), seconde: valeur("second") };
}

/** Avance de Paris sur UTC à cet instant, en millisecondes (1 h l'hiver, 2 h l'été). */
function decalageParis(instant: Date): number {
  const m = murale(instant);
  const aLaSeconde = Math.floor(instant.getTime() / 1000) * 1000;
  return Date.UTC(m.annee, m.mois - 1, m.jour, m.heure, m.minute, m.seconde) - aLaSeconde;
}

/**
 * L'instant (UTC) de « J+`joursPlusTard` à `heure`:`minute`, heure de Paris »,
 * J étant le jour de `maintenant` à Paris. `aHeureParis(maintenant, 1, 18)` :
 * demain 18 h ; `aHeureParis(maintenant, 0, 10)` : aujourd'hui 10 h.
 */
export function aHeureParis(maintenant: Date, joursPlusTard: number, heure: number, minute = 0): Date {
  const aujourdhui = murale(maintenant);
  // L'heure voulue lue « comme si Paris était à UTC » ; Date.UTC reporte les jours sur le mois ou l'année suivante.
  const voulue = Date.UTC(aujourdhui.annee, aujourdhui.mois - 1, aujourdhui.jour + joursPlusTard, heure, minute);
  // Décalage de Paris à l'instant visé : un premier essai, puis la correction si un changement d'heure les sépare.
  const essai = voulue - decalageParis(new Date(voulue));
  return new Date(voulue - decalageParis(new Date(essai)));
}
