import { dateCourte, heure } from "@/lib/commun/format";

/**
 * Mission 17 (partie A) : les petits textes des tâches vues par les détecteurs MAIL, ESPACE_MESSAGES, PROPOSITIONS,
 * RELANCES et SIGNAUX (docs/TACHES.md § 3). Un titre est « verbe · Nom », sans code ni identifiant ; une raison tient
 * en quelques mots ; les dates se lisent à l'heure de Paris (`commun/format.ts`). Pur.
 */

/** Le nom d'un client tel qu'on le lit dans une liste : espaces resserrés, « Inconnu » ou « Client » écartés. */
export function nomLisible(nom: string | null | undefined, defaut = "client sans nom"): string {
  const propre = (nom ?? "").replace(/\s+/g, " ").replace(/\binconnu\b/gi, "").replace(/\s+/g, " ").trim();
  return propre && !/^client$/i.test(propre) ? propre : defaut;
}

/** « Répondre · Bloch ». */
export const titreTache = (verbe: string, nom: string | null | undefined): string => `${verbe} · ${nomLisible(nom)}`;

/** Un texte sur une ligne, coupé à `max` caractères (« … » à la fin). */
export function raccourcir(texte: string | null | undefined, max = 60): string {
  const propre = (texte ?? "").replace(/\s+/g, " ").trim();
  return propre.length > max ? `${propre.slice(0, max - 1).trimEnd()}…` : propre;
}

/** « « Votre devis » », ou « (sans objet) ». */
export function entreGuillemets(texte: string | null | undefined, max = 50, vide = "(sans objet)"): string {
  const court = raccourcir(texte, max);
  return court ? `« ${court} »` : vide;
}

/** « 14 h », « 9 h 30 » (heure de Paris). */
export function heureLisible(date: Date): string {
  const [h, m] = heure(date).split(":");
  return `${Number(h)} h${m && m !== "00" ? ` ${m}` : ""}`;
}

/** « 29/09 » : le jour et le mois, heure de Paris. */
export const jourEtMois = (date: Date): string => dateCourte(date).slice(0, 5);

/**
 * « le 29/09 à 14 h 05 » : un moment passé, à lire après un participe (« reçu le 29/09 à 14 h 05 »).
 * Mission 17 (partie A, relecture) : toujours une date ABSOLUE dans une raison — un « il y a 12 min » réécrivait la
 * tâche à chaque passage ; l'écran calcule le relatif s'il le veut (depuis `depuis`).
 */
export function moment(date: Date): string {
  return `le ${jourEtMois(date)} à ${heureLisible(date)}`;
}

/** « 1re », « 2e ». */
export const rang = (n: number): string => (n === 1 ? "1re" : `${n}e`);

/** La date la plus ancienne d'une liste (au moins une). */
export const plusAncienne = (dates: readonly Date[]): Date => dates.reduce((a, b) => (b.getTime() < a.getTime() ? b : a));

/** Découpe une liste d'identifiants (limite de variables de SQLite). */
export function paquets<T>(liste: readonly T[], taille = 400): T[][] {
  const sortie: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) sortie.push(liste.slice(i, i + taille));
  return sortie;
}
