/**
 * Mission 25 — horaires et jours permis (règle d'or 11), à l'heure de Paris. Pur.
 * - Travail : du lundi au vendredi de 9 h à 19 h 30, le samedi de 9 h 30 à 12 h 30, jamais le dimanche ni un jour férié
 *   (calendrier français). Ce qui tombe en dehors part le jour permis suivant entre 9 h 30 et 10 h 30, étalé.
 * - Réponse à un client qui vient d'écrire (A1, S1, D6, D8, E1, E2, réponse proposée) : tous les jours de 8 h 30 à 21 h.
 */

const FUSEAU = "Europe/Paris";
const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSEAU,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const JOURS_SEMAINE: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** L'heure de Paris d'un instant : jour « AAAA-MM-JJ », jour de la semaine (0 = dimanche), minutes depuis minuit. */
export function momentParis(date: Date): { jour: string; semaine: number; minutes: number } {
  const parties = FORMAT.formatToParts(date);
  const v = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  return { jour: `${v("year")}-${v("month")}-${v("day")}`, semaine: JOURS_SEMAINE[v("weekday")] ?? 0, minutes: Number(v("hour")) * 60 + Number(v("minute")) };
}

/** L'instant d'un jour de Paris à une heure donnée (minutes depuis minuit), changement d'heure compris. */
export function instantParis(jour: string, minutes: number): Date {
  const [a, m, j] = jour.split("-").map(Number);
  const supposee = Date.UTC(a, m - 1, j, Math.floor(minutes / 60), minutes % 60);
  // Écart de Paris à cet instant (une heure l'hiver, deux l'été) : deux passes pour le jour du changement d'heure.
  let instant = supposee;
  for (let i = 0; i < 2; i++) {
    const vu = momentParis(new Date(instant));
    const ecartMin = (Date.UTC(Number(vu.jour.slice(0, 4)), Number(vu.jour.slice(5, 7)) - 1, Number(vu.jour.slice(8, 10))) - Date.UTC(a, m - 1, j)) / 60_000 + vu.minutes - minutes;
    instant -= ecartMin * 60_000;
  }
  return new Date(instant);
}

export function jourSuivant(jour: string, n = 1): string {
  const d = new Date(`${jour}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function semaineDuJour(jour: string): number {
  return new Date(`${jour}T12:00:00.000Z`).getUTCDay();
}

/** Dimanche de Pâques (calcul grégorien de Meeus/Jones/Butcher). */
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/** Les onze jours fériés de métropole d'une année. */
export function joursFeries(annee: number): string[] {
  const p = paques(annee);
  return [
    `${annee}-01-01`,
    jourSuivant(p, 1), // lundi de Pâques
    `${annee}-05-01`,
    `${annee}-05-08`,
    jourSuivant(p, 39), // Ascension
    jourSuivant(p, 50), // lundi de Pentecôte
    `${annee}-07-14`,
    `${annee}-08-15`,
    `${annee}-11-01`,
    `${annee}-11-11`,
    `${annee}-12-25`,
  ].sort();
}

export function estFerie(jour: string): boolean {
  return joursFeries(Number(jour.slice(0, 4))).includes(jour);
}

export type Fenetre = { debut: number; fin: number };
const h = (heures: number, minutes = 0) => heures * 60 + minutes;

/** Fenêtre de travail d'un jour (null : rien ne part ce jour-là). */
export function fenetreTravail(jour: string): Fenetre | null {
  if (estFerie(jour)) return null;
  const semaine = semaineDuJour(jour);
  if (semaine === 0) return null;
  if (semaine === 6) return { debut: h(9, 30), fin: h(12, 30) };
  return { debut: h(9), fin: h(19, 30) };
}

/** Fenêtre des réponses à un client qui vient d'écrire : tous les jours, 8 h 30 – 21 h. */
export const FENETRE_REPONSE: Fenetre = { debut: h(8, 30), fin: h(21) };

/** Le jour où commence la fenêtre de rattrapage (9 h 30 – 10 h 30). */
export const RATTRAPAGE = { debut: h(9, 30), duree: 60 };

/** Un petit nombre stable tiré d'une clé : étale les messages rattrapés sur l'heure (pas tous à la même minute). */
export function decalageStable(cle: string, plage: number): number {
  let empreinte = 0;
  for (const caractere of cle) empreinte = (empreinte * 31 + caractere.charCodeAt(0)) >>> 0;
  return plage > 0 ? empreinte % plage : 0;
}

export function dansLesHorairesDeTravail(date: Date): boolean {
  const { jour, minutes } = momentParis(date);
  const fenetre = fenetreTravail(jour);
  return Boolean(fenetre && minutes >= fenetre.debut && minutes < fenetre.fin);
}

export function dansLaFenetreDeReponse(date: Date): boolean {
  const { minutes } = momentParis(date);
  return minutes >= FENETRE_REPONSE.debut && minutes < FENETRE_REPONSE.fin;
}

/** Le prochain jour permis (fenêtre de travail) à partir de `jour` inclus. */
export function prochainJourPermis(jour: string): string {
  let j = jour;
  for (let i = 0; i < 15; i++) {
    if (fenetreTravail(j)) return j;
    j = jourSuivant(j);
  }
  return j;
}

/**
 * Heure d'envoi permise la plus proche, à partir de `voulu` :
 * - RELANCE / EVENEMENT : dans les horaires de travail tel quel ; sinon le jour permis suivant entre 9 h 30 et 10 h 30
 *   (étalé par la clé) ; le même jour s'il est permis et que la fenêtre n'est pas commencée ;
 * - REACTIF : 8 h 30 – 21 h tous les jours ; sinon 8 h 30 (le jour même ou le lendemain).
 */
export function heurePermise(voulu: Date, nature: "REACTIF" | "TRAVAIL", cle = ""): Date {
  const { jour, minutes } = momentParis(voulu);
  if (nature === "REACTIF") {
    if (minutes >= FENETRE_REPONSE.debut && minutes < FENETRE_REPONSE.fin) return voulu;
    return instantParis(minutes < FENETRE_REPONSE.debut ? jour : jourSuivant(jour), FENETRE_REPONSE.debut);
  }
  const fenetre = fenetreTravail(jour);
  if (fenetre && minutes >= fenetre.debut && minutes < fenetre.fin) return voulu;
  const rattrapage = (j: string) => instantParis(j, RATTRAPAGE.debut + decalageStable(cle, RATTRAPAGE.duree));
  if (fenetre && minutes < fenetre.debut) {
    // Avant l'ouverture d'un jour permis : à l'ouverture de la fenêtre de rattrapage (9 h 30), pas avant 9 h.
    return rattrapage(jour);
  }
  return rattrapage(prochainJourPermis(jourSuivant(jour)));
}

/** La veille permise d'un jour (C2 : la veille à 18 h ; un dimanche ou un férié : le dernier créneau permis avant). */
export function veilleA18h(jourChantier: string): Date {
  let j = jourSuivant(jourChantier, -1);
  for (let i = 0; i < 7; i++) {
    const fenetre = fenetreTravail(j);
    if (fenetre) return instantParis(j, Math.min(h(18), fenetre.fin - 30));
    j = jourSuivant(j, -1);
  }
  return instantParis(jourSuivant(jourChantier, -1), h(18));
}

/** « dans la journée », « demain matin », « lundi matin » : quand Lucas rappelle (A1, E2). */
const NOMS_JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export function quandRappelLisible(maintenant: Date, { memeJourAvant = h(17) }: { memeJourAvant?: number } = {}): string {
  const { jour, minutes } = momentParis(maintenant);
  const fenetre = fenetreTravail(jour);
  if (fenetre && minutes < Math.min(memeJourAvant, fenetre.fin - 30)) return "dans la journée";
  const prochain = prochainJourPermis(jourSuivant(jour));
  if (prochain === jourSuivant(jour)) return "demain matin";
  return `${NOMS_JOURS[semaineDuJour(prochain)]} matin`;
}

/** E2 : toujours le prochain jour de travail (le message arrive hors horaires). */
export function quandReponseLisible(maintenant: Date): string {
  const { jour, minutes } = momentParis(maintenant);
  const fenetre = fenetreTravail(jour);
  const prochain = fenetre && minutes < fenetre.debut ? jour : prochainJourPermis(jourSuivant(jour));
  if (prochain === jour) return "ce matin";
  if (prochain === jourSuivant(jour)) return "demain matin";
  return `${NOMS_JOURS[semaineDuJour(prochain)]} matin`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « mardi 20 octobre » (date du chantier, créneaux). */
export function jourEnLettres(jour: string): string {
  const [, m, j] = jour.split("-").map(Number);
  return `${NOMS_JOURS[semaineDuJour(jour)]} ${j === 1 ? "1er" : j} ${MOIS[m - 1]}`;
}

/** « 8 h 30 », « 14 h » (heure du chantier). */
export function heureEnLettres(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? `${heures} h ${String(reste).padStart(2, "0")}` : `${heures} h`;
}

/** « mar. 14/10 à 9 h 30 » — date absolue courte des lignes « Où on en est » et du journal. */
export function dateAbsolue(date: Date, { heure = true }: { heure?: boolean } = {}): string {
  const { jour, minutes } = momentParis(date);
  const base = `${NOMS_JOURS[semaineDuJour(jour)]} ${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
  return heure ? `${base} à ${heureEnLettres(minutes)}` : base;
}

/** « 14/10 » */
export function jourCourt(date: Date): string {
  const { jour } = momentParis(date);
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
}

/** « 14/10 16:03 » — horodatage d'une ligne de journal. */
export function horodatageCourt(date: Date): string {
  const { jour, minutes } = momentParis(date);
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
