import { aHeureParis } from "@/lib/commercial/quand";
import { jourParis } from "@/lib/dossiers/dates";
import { PORTEES_GOOGLE, appelGoogle } from "@/lib/google/connexion";
import { agendaDisponible } from "@/lib/assistant/agenda";

/**
 * Mission 17 (partie A) — les jours libres pour fixer la date d'un chantier (tâche « Fixer la date du chantier »).
 *
 * Les 10 prochains jours ouvrés (lundi-vendredi, heure de Paris), à partir de demain. Si l'agenda Google est connecté
 * (droit `calendar.events`), ses événements sont lus (`calendars/primary/events`, `singleEvents=true`) et un jour est
 * écarté quand un événement l'occupe « toute la journée » ou au moins 4 h. Sans agenda, les jours ouvrés sont proposés
 * tels quels et la réponse le dit (« agenda non connecté »). Rien n'est écrit, ni ici ni chez Google.
 *
 * Ne bloquent pas un jour : un événement annulé, un événement marqué « disponible » (transparent) et les rappels que le
 * CRM inscrit lui-même (« Rappeler … », « Rappel … » : un rappel noté au jour seul est un événement « toute la journée »).
 */

export const JOURS_PROPOSES = 10;
export const DUREE_OCCUPANTE_MS = 4 * 3_600_000;
const API_EVENEMENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export type JourCreneau = {
  /** AAAA-MM-JJ (ce qu'attend `PATCH /api/dossiers/<id> { dateChantier }`). */
  jour: string;
  /** « lundi 5 octobre » */
  libelle: string;
};

export type CreneauxLibres = {
  /** L'agenda Google a été lu. */
  agenda: boolean;
  /** Pourquoi il ne l'a pas été (« agenda non connecté », « agenda illisible (…) »), sinon null. */
  message: string | null;
  libres: JourCreneau[];
  /** Les jours ouvrés écartés parce qu'occupés (sans le titre des événements). */
  occupes: JourCreneau[];
};

/** Un événement Google, tel que l'API le rend (les champs lus ici). */
export type EvenementGoogle = {
  status?: string;
  transparency?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

/** Lecture des événements entre deux instants (remplaçable dans les essais). */
export type LecteurEvenements = (debut: Date, fin: Date) => Promise<EvenementGoogle[]>;

/** « lundi 5 octobre » pour un jour AAAA-MM-JJ. */
export function libelleJour(jour: string): string {
  const date = new Date(`${jour}T12:00:00.000Z`);
  return `${JOURS_SEMAINE[date.getUTCDay()]} ${date.getUTCDate() === 1 ? "1er" : date.getUTCDate()} ${MOIS[date.getUTCMonth()]}`;
}

/** Les `nombre` prochains jours ouvrés (lundi-vendredi) à Paris, à partir de demain. */
export function prochainsJoursOuvres(maintenant: Date, nombre = JOURS_PROPOSES): string[] {
  const jours: string[] = [];
  for (let decalage = 1; jours.length < nombre && decalage < nombre * 3 + 7; decalage++) {
    const jour = jourParis(aHeureParis(maintenant, decalage, 12));
    const semaine = new Date(`${jour}T12:00:00.000Z`).getUTCDay();
    if (semaine !== 0 && semaine !== 6) jours.push(jour);
  }
  return jours;
}

/** Début (0 h) et fin (0 h le lendemain) d'un jour de Paris, en instants. */
function bornesDuJour(jour: string): [number, number] {
  const midi = new Date(`${jour}T12:00:00.000Z`);
  return [aHeureParis(midi, 0, 0).getTime(), aHeureParis(midi, 1, 0).getTime()];
}

const ajouterJour = (jour: string, n: number) => new Date(Date.parse(`${jour}T12:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Ce que le CRM inscrit lui-même dans l'agenda (rappels) : ne dit rien de la disponibilité d'un chantier. */
const RAPPEL_DU_CRM = /^rappel(er)?\b/i;

/** Les jours (AAAA-MM-JJ) qu'un événement occupe : tout le jour (« toute la journée »), ou au moins 4 h de ce jour. */
export function joursOccupes(evenement: EvenementGoogle, jours: readonly string[]): string[] {
  if (evenement.status === "cancelled" || evenement.transparency === "transparent") return [];
  if (RAPPEL_DU_CRM.test(evenement.summary?.trim() ?? "")) return [];
  const debutJour = evenement.start?.date;
  if (debutJour) {
    // « Toute la journée » : de start.date (inclus) à end.date (exclu) ; sans fin, le seul jour de début.
    const finJour = evenement.end?.date && evenement.end.date > debutJour ? evenement.end.date : ajouterJour(debutJour, 1);
    return jours.filter((j) => j >= debutJour && j < finJour);
  }
  const debut = Date.parse(evenement.start?.dateTime ?? "");
  const fin = Date.parse(evenement.end?.dateTime ?? "");
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return [];
  return jours.filter((j) => {
    const [a, b] = bornesDuJour(j);
    return Math.min(fin, b) - Math.max(debut, a) >= DUREE_OCCUPANTE_MS;
  });
}

/** Les événements de l'agenda principal entre deux instants (toutes les pages, événements récurrents dépliés). */
export const lireEvenementsGoogle: LecteurEvenements = async (debut, fin) => {
  const evenements: EvenementGoogle[] = [];
  let page: string | undefined;
  for (let tour = 0; tour < 10; tour++) {
    const parametres = new URLSearchParams({ timeMin: debut.toISOString(), timeMax: fin.toISOString(), singleEvents: "true", maxResults: "250", orderBy: "startTime" });
    if (page) parametres.set("pageToken", page);
    const reponse = await appelGoogle(`${API_EVENEMENTS}?${parametres}`, { portee: PORTEES_GOOGLE.AGENDA });
    if (!reponse.ok) throw new Error(`Google Calendar a refusé la lecture (${reponse.status}).`);
    const corps = (await reponse.json()) as { items?: EvenementGoogle[]; nextPageToken?: string };
    evenements.push(...(corps.items ?? []));
    page = corps.nextPageToken;
    if (!page) break;
  }
  return evenements;
};

/**
 * Les jours libres des 10 prochains jours ouvrés. `options.disponible` et `options.lire` remplacent la vérification de
 * la connexion Google et la lecture des événements (essais : aucun appel réseau).
 */
export async function creneauxLibres(maintenant: Date = new Date(), options: { disponible?: () => Promise<boolean>; lire?: LecteurEvenements; nombre?: number } = {}): Promise<CreneauxLibres> {
  const jours = prochainsJoursOuvres(maintenant, options.nombre ?? JOURS_PROPOSES);
  const tous = jours.map((jour) => ({ jour, libelle: libelleJour(jour) }));
  let connecte = false;
  try {
    connecte = await (options.disponible ?? agendaDisponible)();
  } catch {
    connecte = false;
  }
  if (!connecte) return { agenda: false, message: "agenda non connecté", libres: tous, occupes: [] };
  try {
    const [debut] = bornesDuJour(jours[0]);
    const [, fin] = bornesDuJour(jours[jours.length - 1]);
    const evenements = await (options.lire ?? lireEvenementsGoogle)(new Date(debut), new Date(fin));
    const occupes = new Set(evenements.flatMap((e) => joursOccupes(e, jours)));
    return { agenda: true, message: null, libres: tous.filter((j) => !occupes.has(j.jour)), occupes: tous.filter((j) => occupes.has(j.jour)) };
  } catch (erreur) {
    const raison = erreur instanceof Error ? erreur.message : String(erreur);
    return { agenda: false, message: `agenda illisible (${raison.slice(0, 120)})`, libres: tous, occupes: [] };
  }
}
