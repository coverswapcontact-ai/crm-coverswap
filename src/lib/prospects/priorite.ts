/**
 * Priorité d'un contact entrant : dans quel ordre rappeler.
 *
 * Lucas rappelle dans l'ordre de VALEUR, pas d'arrivée. Quatre classes, ses mots :
 *  - PRIORITAIRE : propriétaire, délai court, dans la zone ;
 *  - STANDARD    : propriétaire, délai indéterminé, dans la zone ;
 *  - SECONDAIRE  : locataire, ou délai lointain ;
 *  - A_ECARTER   : hors zone — sauf s'il décide de le traiter (priorité posée à la main).
 *
 * Tout se lit dans ce que la personne a répondu au formulaire (Meta : propriétaire
 * ou locataire, délai du projet, taille de la cuisine) et dans son code postal.
 * Une réponse absente ne pénalise pas : on ne sait pas, on appelle, on saura.
 *
 * Fonctions pures, testées, sans dépendance serveur (l'écran les lit aussi).
 */

export const PRIORITES = ["PRIORITAIRE", "STANDARD", "SECONDAIRE", "A_ECARTER"] as const;
export type Priorite = (typeof PRIORITES)[number];

export const LIBELLES_PRIORITE: Record<Priorite, string> = {
  PRIORITAIRE: "Prioritaire",
  STANDARD: "Standard",
  SECONDAIRE: "Secondaire",
  A_ECARTER: "À écarter",
};

/** Rang de tri : plus petit = rappelé en premier. Un contact jamais classé passe avant les secondaires. */
export const RANG_PRIORITE: Record<Priorite | "INCONNUE", number> = { PRIORITAIRE: 0, STANDARD: 1, INCONNUE: 1.5, SECONDAIRE: 2, A_ECARTER: 3 };

export type Occupation = "PROPRIETAIRE" | "LOCATAIRE";
export type DelaiProjet = "COURT" | "MOYEN" | "LOINTAIN" | "INDETERMINE";
export type Zone = "ZONE" | "PROCHE" | "HORS_ZONE" | "INCONNUE";

export const LIBELLES_DELAI: Record<DelaiProjet, string> = { COURT: "délai court", MOYEN: "délai de quelques mois", LOINTAIN: "délai lointain", INDETERMINE: "délai indéterminé" };

export type ReponseLue = { question: string; reponse: string };

export type ZoneIntervention = {
  /** Départements où Lucas intervient sans se poser de question (ex. ["34"]). */
  departements: readonly string[];
  /** Départements voisins, encore traités comme « dans la zone ». */
  proches: readonly string[];
};

export type Qualification = {
  occupation: Occupation | null;
  delai: DelaiProjet;
  /** La réponse telle que la personne l'a donnée, pour la relire dans la fiche. */
  delaiTexte: string | null;
  tailleCuisine: string | null;
  zone: Zone;
  departement: string | null;
  priorite: Priorite;
  /** Pourquoi cette classe, en une phrase lisible. */
  motif: string;
};

function sansAccent(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Département d'un code postal français : « 34470 » → « 34 », Corse « 20 », outre-mer « 971 »… */
export function departementDuCodePostal(codePostal: string | null | undefined): string | null {
  const cp = (codePostal ?? "").replace(/\s/g, "");
  if (!/^\d{5}$/.test(cp)) return null;
  return cp.startsWith("97") || cp.startsWith("98") ? cp.slice(0, 3) : cp.slice(0, 2);
}

export function zoneDuDepartement(departement: string | null, zone: ZoneIntervention): Zone {
  if (!departement) return "INCONNUE";
  // Zone jamais saisie : personne n'est « hors zone » sur une règle absente.
  if (zone.departements.length === 0 && zone.proches.length === 0) return "INCONNUE";
  if (zone.departements.includes(departement)) return "ZONE";
  if (zone.proches.includes(departement)) return "PROCHE";
  return "HORS_ZONE";
}

/** « 34, 30 ; 11 » → ["34", "30", "11"] : la saisie d'un paramètre, tolérante. */
export function lireDepartements(saisie: string | number | null | undefined): string[] {
  return String(saisie ?? "")
    .split(/[^0-9AB]+/i)
    .map((d) => d.trim().toUpperCase())
    .filter((d) => /^(\d{2,3}|2[AB])$/.test(d));
}

/** Propriétaire ou locataire, d'après la question et la réponse (« Êtes-vous propriétaire ? » → « Oui »). */
export function lireOccupation(reponses: readonly ReponseLue[]): Occupation | null {
  for (const { question, reponse } of reponses) {
    const q = sansAccent(question);
    const r = sansAccent(reponse);
    // La réponse parle d'elle-même, quelle que soit la question.
    if (/\blocataire\b/.test(r) && !/proprietaire/.test(r)) return "LOCATAIRE";
    if (/\bproprietaire\b/.test(r) && !/locataire/.test(r)) return "PROPRIETAIRE";
    if (/proprietaire/.test(q) && !/locataire/.test(q)) {
      if (/^(oui|yes|o)\b/.test(r)) return "PROPRIETAIRE";
      if (/^(non|no|n)\b/.test(r)) return "LOCATAIRE";
    }
    if (/locataire/.test(q) && !/proprietaire/.test(q)) {
      if (/^(oui|yes|o)\b/.test(r)) return "LOCATAIRE";
      if (/^(non|no|n)\b/.test(r)) return "PROPRIETAIRE";
    }
  }
  return null;
}

/**
 * Délai du projet d'après la réponse. Court : tout de suite à trois mois.
 * Moyen : trois à six mois. Lointain : au-delà, ou « je me renseigne ».
 */
export function lireDelai(reponses: readonly ReponseLue[]): { delai: DelaiProjet; texte: string | null } {
  for (const { question, reponse } of reponses) {
    const q = sansAccent(question);
    if (!/delai|quand|echeance|date|travaux|realiser|demarrer|commencer|horizon|urgence/.test(q)) continue;
    const r = sansAccent(reponse);
    const texte = reponse.trim();
    if (/ne sais pas|pas encore|indetermine|a definir|aucune idee|je ne sais/.test(r)) return { delai: "INDETERMINE", texte };
    if (/renseigne|curiosite|simple information|pas de projet|un jour/.test(r)) return { delai: "LOINTAIN", texte };
    if (/plus de (6|six)|\+ ?de (6|six)|(6|six) mois et plus|dans l annee|un an|1 an|12 mois|annee prochaine|plus d un an|plus tard/.test(r)) return { delai: "LOINTAIN", texte };
    if (/(3|trois) (a|-|et) (6|six)|entre (3|trois) et (6|six)|(4|5|6|quatre|cinq|six) mois|dans les (6|six) mois|moins de (6|six) mois/.test(r)) return { delai: "MOYEN", texte };
    if (/des que possible|au plus vite|immediat|urgent|tout de suite|maintenant|ce mois|semaine|moins d ?(1|un) mois|(1|un|2|deux|3|trois) mois|dans le mois|rapidement|bientot|asap|moins de (3|trois)/.test(r)) return { delai: "COURT", texte };
    return { delai: "INDETERMINE", texte };
  }
  return { delai: "INDETERMINE", texte: null };
}

/** Taille de la cuisine, telle que répondue (« 5 à 10 façades », « Moyenne », « 4 mètres »). */
export function lireTailleCuisine(reponses: readonly ReponseLue[]): string | null {
  for (const { question, reponse } of reponses) {
    const q = sansAccent(question);
    if (/taille|surface|dimension|lineaire|metre|combien de (meubles|facades|portes|placards)|nombre de (meubles|facades|portes|placards)|grande/.test(q) && reponse.trim()) {
      return reponse.trim().slice(0, 120);
    }
  }
  return null;
}

export type EntreeQualification = {
  codePostal?: string | null;
  /** Département déjà connu (déduit de la ville), quand le code postal manque. */
  departement?: string | null;
  reponses?: readonly ReponseLue[];
  /** Le contact a demandé un devis de lui-même (site) : il est venu chercher Lucas. */
  devisDemande?: boolean;
  /** Le contact a fait une simulation sur le site : il a déjà vu sa pièce rénovée. */
  simulation?: boolean;
};

export function qualifier(entree: EntreeQualification, zoneIntervention: ZoneIntervention): Qualification {
  const reponses = entree.reponses ?? [];
  const occupation = lireOccupation(reponses);
  const { delai, texte: delaiTexte } = lireDelai(reponses);
  const tailleCuisine = lireTailleCuisine(reponses);
  const departement = departementDuCodePostal(entree.codePostal) ?? entree.departement ?? null;
  const zone = zoneDuDepartement(departement, zoneIntervention);

  const faits = [
    occupation === "PROPRIETAIRE" ? "propriétaire" : occupation === "LOCATAIRE" ? "locataire" : "propriétaire ou locataire : non précisé",
    delaiTexte ? `${LIBELLES_DELAI[delai]} (« ${delaiTexte} »)` : LIBELLES_DELAI[delai],
    zone === "ZONE" ? `dans la zone (${departement})` : zone === "PROCHE" ? `département voisin (${departement})` : zone === "HORS_ZONE" ? `hors zone (${departement})` : "zone inconnue",
  ];

  let priorite: Priorite;
  if (zone === "HORS_ZONE") priorite = "A_ECARTER";
  // Le lead le plus chaud : il a vu un rendu de SA pièce. Prioritaire d'office, sauf hors zone (règle de Lucas, 21/09/2026).
  else if (entree.simulation) {
    priorite = "PRIORITAIRE";
    faits.unshift("a fait une simulation : il a vu sa pièce rénovée");
  } else if (occupation === "LOCATAIRE" || delai === "LOINTAIN") priorite = "SECONDAIRE";
  else if (occupation === "PROPRIETAIRE" && delai === "COURT") priorite = "PRIORITAIRE";
  else if (entree.devisDemande) {
    priorite = "PRIORITAIRE";
    faits.unshift("a demandé un devis de lui-même");
  } else priorite = "STANDARD";

  return { occupation, delai, delaiTexte, tailleCuisine, zone, departement, priorite, motif: faits.join(" · ") };
}

/** Tri de la liste « à rappeler » : la classe d'abord, puis le plus récent. */
export function comparerPourRappel(a: { priorite: string | null; recuLe: string | Date }, b: { priorite: string | null; recuLe: string | Date }): number {
  const rang = (p: string | null) => RANG_PRIORITE[(p as Priorite) ?? "INCONNUE"] ?? RANG_PRIORITE.INCONNUE;
  return rang(a.priorite) - rang(b.priorite) || new Date(b.recuLe).getTime() - new Date(a.recuLe).getTime();
}
