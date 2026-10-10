/**
 * Mission 25 — le contrôleur : tout texte écrit par l'IA passe par ces règles fixes, sans IA (cahier, § L'IA). Si une
 * règle casse, le message validé part à la place et l'écart est noté au journal. Pur.
 *
 * - 320 caractères au plus, une seule question ;
 * - le lien prévu est présent, et seulement lui ;
 * - aucun montant, pourcentage, date, jour ou créneau qui ne vienne pas du CRM ou de l'agenda (les valeurs permises
 *   sont données : date du chantier, créneaux, moment du rappel…) ;
 * - aucun de ces mots : gratuit, offert, remise, promo, garanti, promis ;
 * - vouvoiement ; pas de « Lucas de CoverSwap » après le premier contact ; pas de prénom s'il n'est pas fiable ;
 * - jamais la mention d'une IA ou d'un assistant.
 */

export const LONGUEUR_MAX_IA = 320;
/**
 * Un mot entier, accents compris : `\b` ne connaît que les lettres sans accent (« prête » finirait par le mot « te »).
 * Lot 3 : relevé en remplissant les 41 messages (« dès qu'elle est prête » passait pour du tutoiement).
 */
const mot = (motif: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${motif})(?![\\p{L}\\p{N}_])`, "iu");
const MOTS_INTERDITS = mot("gratuit\\p{L}*|offert\\p{L}*|remise\\p{L}*|promo\\p{L}*|garanti\\p{L}*|promis\\p{L}*|promesse\\p{L}*|r[ée]duction\\p{L}*|rabais");
const IA = mot("ia|i\\.a\\.|intelligence artificielle|assistante?|chat ?gpt|claude|robot|bot");
const TUTOIEMENT = new RegExp(`${mot("tu|toi|ton|ta|tes|te|tiens|peux-tu|veux-tu|as-tu|es-tu").source}|(?<![\\p{L}\\p{N}_])t['’](?=\\p{L})`, "iu");
const MONTANT = /(\d[\d\s.,]*\s?(€|euros?|eur\b|ht\b|ttc\b))|(€\s?\d)/i;
const POURCENTAGE = /\d\s?(%|pour ?cent)/i;
const DATE_CHIFFRES = /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/;
const HEURE = /\b\d{1,2}\s?(h|heures?)\s?\d{0,2}\b|\b\d{1,2}:\d{2}\b/i;
const JOURS = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apr[eè]s-demain|aujourd'hui|ce soir|ce matin|semaine prochaine|(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre))\b/i;
const LIEN = /https?:\/\/\S+/gi;

export type ContexteControle = {
  /** Le lien que le message doit porter (et seul lien permis), ou null : aucun lien. */
  lienAttendu: string | null;
  /** Premier contact : « Lucas de CoverSwap » permis. */
  premierContact: boolean;
  /** Le prénom fiable, ou null : aucun prénom ne doit apparaître après « Bonjour ». */
  prenom: string | null;
  /** Valeurs venues du CRM ou de l'agenda que le texte peut citer telles quelles (dates, créneaux, heure, moment). */
  permis: string[];
};

export type Ecart = { regle: string; detail: string };

/** Les écarts du texte aux règles (vide : le texte passe). */
export function controlerTexte(texte: string, contexte: ContexteControle): Ecart[] {
  const ecarts: Ecart[] = [];
  const t = texte.trim();
  if (!t) return [{ regle: "VIDE", detail: "Texte vide." }];
  if (t.length > LONGUEUR_MAX_IA) ecarts.push({ regle: "LONGUEUR", detail: `${t.length} caractères (320 au plus).` });
  const questions = (t.match(/\?/g) ?? []).length;
  if (questions > 1) ecarts.push({ regle: "QUESTIONS", detail: `${questions} questions (une seule).` });

  const liens = t.match(LIEN) ?? [];
  if (contexte.lienAttendu) {
    if (!t.includes(contexte.lienAttendu)) ecarts.push({ regle: "LIEN_ABSENT", detail: "Le lien prévu manque." });
    if (liens.some((l) => !l.replace(/[.,;!?)]+$/, "").startsWith(contexte.lienAttendu!))) ecarts.push({ regle: "LIEN_ETRANGER", detail: "Un autre lien que celui prévu." });
  } else if (liens.length) ecarts.push({ regle: "LIEN_ETRANGER", detail: "Un lien alors qu'aucun n'est prévu." });

  // Les valeurs permises sont retirées avant de chercher montants, dates et jours (elles viennent du CRM).
  let sansPermis = t.replace(LIEN, " ");
  for (const valeur of contexte.permis.filter(Boolean).sort((a, b) => b.length - a.length)) sansPermis = sansPermis.split(valeur).join(" ");
  if (MONTANT.test(sansPermis)) ecarts.push({ regle: "MONTANT", detail: "Un montant que le CRM n'a pas donné." });
  if (POURCENTAGE.test(sansPermis)) ecarts.push({ regle: "POURCENTAGE", detail: "Un pourcentage." });
  if (DATE_CHIFFRES.test(sansPermis) || HEURE.test(sansPermis) || JOURS.test(sansPermis)) ecarts.push({ regle: "DATE", detail: "Une date, un jour ou un créneau qui ne vient ni du CRM ni de l'agenda." });
  const interdit = t.match(MOTS_INTERDITS);
  if (interdit) ecarts.push({ regle: "MOT_INTERDIT", detail: `« ${interdit[0]} » est interdit.` });
  if (TUTOIEMENT.test(t)) ecarts.push({ regle: "TUTOIEMENT", detail: "Le client est vouvoyé." });
  if (IA.test(t)) ecarts.push({ regle: "IA", detail: "Jamais la mention d'une IA ou d'un assistant." });
  if (!contexte.premierContact && /lucas de coverswap/i.test(t)) ecarts.push({ regle: "PRESENTATION", detail: "« Lucas de CoverSwap » seulement au premier contact." });
  const salutation = t.match(/^bonjour\s+([\p{L}'’-]+)\s*,/iu);
  if (salutation && (!contexte.prenom || salutation[1].toLowerCase() !== contexte.prenom.toLowerCase())) ecarts.push({ regle: "PRENOM", detail: "Un prénom qui n'est pas fiable." });
  return ecarts;
}

/**
 * Lot 5 — les deux lignes de « Où on en est » écrites par l'IA (règle d'or 3) : non vides, courtes (110 et 80
 * caractères), des dates absolues seulement (« le 14/10 », « jeudi 15/10 ») : jamais « demain », « hier », « jeudi »
 * seul, « la semaine prochaine », « dans 3 jours » — la ligne serait fausse le lendemain. Sinon les lignes des règles.
 */
const DATE_RELATIVE = new RegExp(
  `${mot("demain|après-demain|hier|avant-hier|aujourd'hui|ce matin|ce midi|ce soir|cet après-midi|tout à l'heure|cette semaine|la semaine (?:prochaine|dernière)|le mois (?:prochain|dernier)|ce week-end|dans (?:\\d+|un|une|deux|trois|quelques) (?:jours?|semaines?|mois)|il y a (?:\\d+|un|une|deux|trois|quelques) (?:jours?|semaines?|mois)").source}|${mot("lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche").source}(?!\\s+\\d)`,
  "iu"
);

export function controlerOuEnEst(lignes: { situation: string | null; client: string | null }): Ecart[] {
  const ecarts: Ecart[] = [];
  const situation = lignes.situation?.trim() ?? "";
  const client = lignes.client?.trim() ?? "";
  if (!situation || !client) return [{ regle: "VIDE", detail: "Une ligne vide." }];
  if (situation.length > 110) ecarts.push({ regle: "LONGUEUR", detail: `Situation de ${situation.length} caractères (110 au plus).` });
  if (client.length > 80) ecarts.push({ regle: "LONGUEUR", detail: `Ligne client de ${client.length} caractères (80 au plus).` });
  const relative = `${situation} ${client}`.match(DATE_RELATIVE);
  if (relative) ecarts.push({ regle: "DATE_RELATIVE", detail: `« ${relative[0]} » : une date absolue (le 14/10), jamais relative.` });
  return ecarts;
}

/** Le texte à garder : celui de l'IA s'il passe, sinon le texte validé, avec l'écart pour le journal. */
export function texteControle(propose: string | null | undefined, valide: string, contexte: ContexteControle): { texte: string; ia: boolean; ecart: string | null } {
  if (!propose || !propose.trim()) return { texte: valide, ia: false, ecart: null };
  const ecarts = controlerTexte(propose, contexte);
  if (!ecarts.length) return { texte: propose.trim(), ia: true, ecart: null };
  return { texte: valide, ia: false, ecart: ecarts.map((e) => e.detail).join(" ") };
}
