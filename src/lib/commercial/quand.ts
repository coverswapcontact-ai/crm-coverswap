/**
 * Mission 14 (29/09/2026), partie 2 — « J+n à HH:MM, heure de Paris », en un
 * seul endroit (rappels d'appel, relances, feuille de fin d'appel). Pur, sans
 * base, importable par les écrans : le serveur de
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

const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOUR_MS = 86_400_000;

/**
 * Mission 14 (partie 5) — le moment d'un rappel, tel qu'un SMS le dit au client
 * (`{quand}`), en heure de Paris : « aujourd'hui vers 14 h » (avant 18 h), « ce
 * soir vers 18 h » (18 h ou plus), « demain vers 18 h », « jeudi vers 10 h » (dans
 * les 6 jours), « le 12 octobre vers 10 h » au-delà ; « vers 10 h 30 » quand les
 * minutes ne sont pas nulles. Sans date, ou un jour déjà passé : « prochainement ».
 */
export function quandLisible(date: Date | null | undefined, maintenant: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "prochainement";
  const vise = murale(date);
  const jour = murale(maintenant);
  const jourVise = Date.UTC(vise.annee, vise.mois - 1, vise.jour);
  const ecart = Math.round((jourVise - Date.UTC(jour.annee, jour.mois - 1, jour.jour)) / JOUR_MS);
  if (ecart < 0) return "prochainement";
  const heure = `vers ${vise.heure} h${vise.minute ? ` ${String(vise.minute).padStart(2, "0")}` : ""}`;
  if (ecart === 0) return vise.heure >= 18 ? `ce soir ${heure}` : `aujourd'hui ${heure}`;
  if (ecart === 1) return `demain ${heure}`;
  if (ecart <= 6) return `${JOURS_SEMAINE[new Date(jourVise).getUTCDay()]} ${heure}`;
  return `le ${vise.jour === 1 ? "1er" : vise.jour} ${MOIS[vise.mois - 1]} ${heure}`;
}

/**
 * Mission 14 (partie 8) — le jour d'un rappel noté au jour seul (sans heure
 * choisie, `estJourSeul`), tel qu'un SMS le dit : « aujourd'hui », « demain »,
 * « jeudi » (dans les 6 jours), « le 12 octobre » au-delà — jamais une heure que
 * Lucas n'a pas choisie. Sans date, ou un jour déjà passé : « prochainement ».
 */
export function jourLisible(date: Date | null | undefined, maintenant: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "prochainement";
  const vise = murale(date);
  const jour = murale(maintenant);
  const jourVise = Date.UTC(vise.annee, vise.mois - 1, vise.jour);
  const ecart = Math.round((jourVise - Date.UTC(jour.annee, jour.mois - 1, jour.jour)) / JOUR_MS);
  if (ecart < 0) return "prochainement";
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  if (ecart <= 6) return JOURS_SEMAINE[new Date(jourVise).getUTCDay()];
  return `le ${vise.jour === 1 ? "1er" : vise.jour} ${MOIS[vise.mois - 1]}`;
}

/* ── Mission 14 (partie 4) : le rappel choisi à la fin d'un appel ──────────── */

const deux = (nombre: number) => String(nombre).padStart(2, "0");

/**
 * Le moment d'un rappel, tel que Lucas le lit (feuille de fin d'appel, résumé) :
 * « demain 18:00 », « aujourd'hui 18:00 », « jeudi 10:00 » (dans les 6 jours),
 * « le 12 octobre 10:00 » au-delà ; `liaison` = « à » pour une phrase (« Rappel
 * demain à 18:00. »). Heure de Paris.
 */
export function momentDuRappel(date: Date, maintenant: Date, liaison = ""): string {
  const vise = murale(date);
  const jour = murale(maintenant);
  const jourVise = Date.UTC(vise.annee, vise.mois - 1, vise.jour);
  const ecart = Math.round((jourVise - Date.UTC(jour.annee, jour.mois - 1, jour.jour)) / JOUR_MS);
  const nomDuJour =
    ecart === 0 ? "aujourd'hui" : ecart === 1 ? "demain" : ecart >= 2 && ecart <= 6 ? JOURS_SEMAINE[new Date(jourVise).getUTCDay()] : `le ${vise.jour === 1 ? "1er" : vise.jour} ${MOIS[vise.mois - 1]}`;
  return `${nomDuJour} ${liaison ? `${liaison} ` : ""}${deux(vise.heure)}:${deux(vise.minute)}`;
}

export type RaccourciRappel = { cle: "CE_SOIR" | "DEMAIN_10" | "DEMAIN_18" | "LUNDI_10"; libelle: string; le: Date };

/**
 * Les raccourcis de « À rappeler », en heure de Paris : « Ce soir 18 h » (seulement
 * avant 18 h), « Demain 10 h », « Demain 18 h », « Lundi 10 h » (le prochain lundi :
 * dans une semaine si l'on est lundi).
 */
export function raccourcisRappel(maintenant: Date): RaccourciRappel[] {
  const aujourdhui = murale(maintenant);
  const jourSemaine = new Date(Date.UTC(aujourdhui.annee, aujourdhui.mois - 1, aujourdhui.jour)).getUTCDay();
  const ceSoir = aHeureParis(maintenant, 0, 18);
  return [
    ...(maintenant.getTime() < ceSoir.getTime() ? [{ cle: "CE_SOIR" as const, libelle: "Ce soir 18 h", le: ceSoir }] : []),
    { cle: "DEMAIN_10", libelle: "Demain 10 h", le: aHeureParis(maintenant, 1, 10) },
    { cle: "DEMAIN_18", libelle: "Demain 18 h", le: aHeureParis(maintenant, 1, 18) },
    { cle: "LUNDI_10", libelle: "Lundi 10 h", le: aHeureParis(maintenant, (8 - jourSemaine) % 7 || 7, 10) },
  ];
}

/** Un instant → la valeur d'un champ `datetime-local` (« 2026-10-01T18:00 »), lue à l'horloge de Paris. */
export function versSaisieParis(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const m = murale(date);
  return `${m.annee}-${deux(m.mois)}-${deux(m.jour)}T${deux(m.heure)}:${deux(m.minute)}`;
}

/** La valeur d'un champ `datetime-local`, comprise en heure de Paris (quel que soit le fuseau du téléphone) ; null si illisible. */
export function depuisSaisieParis(valeur: string): Date | null {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valeur.trim());
  if (!morceaux) return null;
  const [annee, mois, jour, heure, minute] = morceaux.slice(1).map(Number);
  // Midi UTC de ce jour-là est le même jour à Paris : `aHeureParis` y pose l'heure voulue.
  const date = aHeureParis(new Date(Date.UTC(annee, mois - 1, jour, 12)), 0, heure, minute);
  return Number.isNaN(date.getTime()) ? null : date;
}
