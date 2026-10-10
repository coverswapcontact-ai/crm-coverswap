/**
 * Mission 25 — la version sans IA de l'analyse (IA en pause, plafond atteint, ou réponse de l'IA refusée) : classer un
 * message du client, lire une note de Lucas, en tirer les faits et le message de la liste qui répond. Pur.
 *
 * Tableau du cahier (§ Les messages des clients) : merci → rien ; STOP → coupe tout ; lien perdu → E1 ; photos → S1 ;
 * disponibilités → confirmation + rappel daté ; visite → Q5 (créneaux de l'agenda, 25 km ou moins) ; prix → alerte,
 * « je regarde » ; trop cher → alerte, budget sensible, brouillon prudent ; mécontentement → alerte prioritaire ;
 * le reste → brouillon « je regarde et je reviens vers vous très vite ».
 */
import { estDemandeArret } from "@/lib/sms/texte";
import { instantParis, jourSuivant, momentParis, prochainJourPermis, semaineDuJour } from "./horaires";
import type { Faits } from "./types";

export const CLASSES_MESSAGE = ["MERCI", "STOP", "LIEN_PERDU", "PHOTOS", "VISITE", "DISPONIBILITES", "QUESTION_GENERALE", "PRIX", "TROP_CHER", "MECONTENTEMENT", "AUTRE"] as const;
export type ClasseMessage = (typeof CLASSES_MESSAGE)[number];
export const LIBELLES_CLASSE: Record<ClasseMessage, string> = {
  MERCI: "un merci",
  STOP: "STOP",
  LIEN_PERDU: "son lien perdu",
  PHOTOS: "des photos",
  VISITE: "une visite avec les échantillons",
  DISPONIBILITES: "ses disponibilités",
  QUESTION_GENERALE: "une question",
  PRIX: "le prix",
  TROP_CHER: "« c'est trop cher »",
  MECONTENTEMENT: "un mécontentement",
  AUTRE: "un message",
};

const sansAccent = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Le classement d'un message du client, par mots (sans IA). */
export function classerMessage(texte: string, options: { photos?: number } = {}): ClasseMessage {
  const brut = texte.trim();
  const t = sansAccent(brut);
  if (estDemandeArret(brut)) return "STOP";
  if (options.photos && options.photos > 0) return "PHOTOS";
  if (/\b(decu|decue|pas content|mecontent|inadmissible|arnaque|reclamation|rembours|probleme|souci|se decolle|decolle|abime|rate|honte|scandal)/.test(t)) return "MECONTENTEMENT";
  if (/\b(trop cher|c'?est cher|un peu cher|assez cher|tres cher|plutot cher|cher pour|trop eleve|hors budget|au-dessus|au dessus de (mon|notre) budget|pas les moyens|budget serre|un peu eleve)\b/.test(t)) return "TROP_CHER";
  if (/\b(lien|espace|site)\b/.test(t) && /\b(trouve|perdu|retrouv|marche pas|fonctionne pas|acces|ouvre pas|n'arrive pas|renvoy)/.test(t)) return "LIEN_PERDU";
  if (/\b(passer|venir|visite|rendez-vous|rdv|echantillon)/.test(t) && /\?|\bpouvez|\bpourriez|\bpossible\b/.test(t)) return "VISITE";
  if (brut.includes("?") && /\b(combien de temps|duree|tenue|tient|entretien|nettoy|resist|chaleur|humidit|zone|intervene|garantie|epaisseur|delai)/.test(t)) return "QUESTION_GENERALE";
  if (/\b(prix|tarif|combien|cout|coute|devis|estimation)\b/.test(t)) return "PRIX";
  if (/\b(dispo|disponible|libre|joignable|appelez|rappelez|appeler|rappeler|joindre)/.test(t) && (/\b\d{1,2}\s?h/.test(t) || new RegExp(`\\b(${JOURS.join("|")}|matin|apres-midi|apres midi|soir|demain|midi)\\b`).test(t))) return "DISPONIBILITES";
  if (brut.length <= 60 && !brut.includes("?") && /^(merci|ok|okay|d'accord|daccord|parfait|super|top|tres bien|ca marche|bien recu|entendu|genial|cool|nickel|bonne (soiree|journee))/.test(t)) return "MERCI";
  if (/^\p{Extended_Pictographic}+$/u.test(brut.replace(/\s/g, ""))) return "MERCI";
  if (brut.includes("?") && /\b(combien de temps|duree|tenue|tient|entretien|nettoy|resist|chaleur|humidit|zone|intervene|garantie|epaisseur|delai)/.test(t)) return "QUESTION_GENERALE";
  return "AUTRE";
}

/* ── Dates dites dans une note ou un message ─────────────────────────────────── */

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, quinze: 15 };

/**
 * Une date dite en mots, ramenée à un jour de rappel (10 h, un jour permis) : « dans 2 semaines », « dans trois
 * jours », « dans un mois », « la semaine prochaine », « lundi », « demain », « le 24/10 ». Null si rien n'est dit.
 */
export function dateDite(texte: string, maintenant: Date): Date | null {
  const t = sansAccent(texte);
  const aujourdhui = momentParis(maintenant).jour;
  const versJour = (jour: string, heure = 10 * 60) => instantParis(prochainJourPermis(jour), heure);
  const dans = t.match(/\bdans (\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|dix|quinze) (jours?|semaines?|mois)\b/);
  if (dans) {
    const n = Number(dans[1]) || NOMBRES[dans[1]] || 1;
    const jours = dans[2].startsWith("jour") ? n : dans[2].startsWith("semaine") ? n * 7 : n * 30;
    return versJour(jourSuivant(aujourdhui, jours));
  }
  if (/\b(quinze|15) jours\b/.test(t)) return versJour(jourSuivant(aujourdhui, 14));
  if (/\bsemaine prochaine\b/.test(t)) {
    const decalage = (8 - semaineDuJour(aujourdhui)) % 7 || 7;
    return versJour(jourSuivant(aujourdhui, decalage));
  }
  if (/\bapres-demain\b|\bapres demain\b/.test(t)) return versJour(jourSuivant(aujourdhui, 2));
  if (/\bdemain\b/.test(t)) return versJour(jourSuivant(aujourdhui, 1));
  const date = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (date) {
    const [annee] = aujourdhui.split("-").map(Number);
    const jour = `${annee}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}`;
    const valide = !Number.isNaN(Date.parse(`${jour}T12:00:00Z`));
    if (valide) return versJour(jour < aujourdhui ? `${annee + 1}${jour.slice(4)}` : jour);
  }
  const nomJour = JOURS.findIndex((j) => new RegExp(`\\b${j}\\b`).test(t));
  if (nomJour >= 0) {
    const decalage = (nomJour - semaineDuJour(aujourdhui) + 7) % 7 || 7;
    const heure = t.match(/\b(\d{1,2})\s?h\s?(\d{2})?\b/);
    return versJour(jourSuivant(aujourdhui, decalage), heure ? Number(heure[1]) * 60 + Number(heure[2] ?? 0) : 10 * 60);
  }
  return null;
}

/* ── Faits tirés d'un texte ─────────────────────────────────────────────────── */

const TEINTES = [
  "chêne clair", "chêne foncé", "chêne naturel", "chêne", "noyer", "bois clair", "bois foncé", "bois", "blanc mat", "blanc brillant", "blanc", "noir mat", "noir", "gris anthracite",
  "anthracite", "gris clair", "gris", "béton", "marbre blanc", "marbre", "terrazzo", "vert sauge", "vert olive", "vert", "bleu nuit", "bleu", "beige", "taupe", "greige", "lin", "crème",
  "terracotta", "cuivre", "laiton", "doré", "inox", "pierre", "ardoise",
];

/** Les teintes dites dans un texte (« veut du chêne clair » → « chêne clair »), la plus précise d'abord. */
export function teintesDites(texte: string): string[] {
  const t = ` ${sansAccent(texte)} `;
  const trouvees: string[] = [];
  for (const teinte of TEINTES) {
    const cle = sansAccent(teinte);
    if (t.includes(` ${cle} `) || t.includes(` ${cle},`) || t.includes(` ${cle}.`)) {
      if (!trouvees.some((x) => sansAccent(x).includes(cle))) trouvees.push(teinte);
    }
  }
  return trouvees.slice(0, 3);
}

export type LectureNote = {
  faits: Partial<Faits>;
  /** Rappel daté dit dans la note (« signe dans 2 semaines » → le 24/10). */
  rappel: { le: Date; motif: "COMME_CONVENU" | "RAPPEL"; libelle: string } | null;
  sensible: boolean;
};

/** Ce qu'une note de Lucas dit (sans IA) : teintes, décideur, budget, délai, hésitation, rappel daté. */
export function lireNote(texte: string, maintenant: Date): LectureNote {
  const t = sansAccent(texte);
  const faits: Partial<Faits> = {};
  const teintes = teintesDites(texte);
  if (teintes.length) faits.teintesEvoquees = teintes;
  const decideur = t.match(/\b(son|sa|avec son|avec sa) (mari|femme|epoux|epouse|conjoint|conjointe|compagnon|compagne|associe|associee|pere|mere|fils|fille)\b/);
  if (decideur) faits.decideur = `${decideur[1].replace("avec ", "")} ${decideur[2].replace("epoux", "époux").replace("epouse", "épouse").replace("associe", "associé").replace("mere", "mère").replace("pere", "père")}`;
  const budgetSerre = /\b(cher|budget|prix|moyens|serre)\b/.test(t);
  if (budgetSerre) faits.budget = "SENSIBLE";
  const hesite = /\b(hesit|reflechi|pas sur|pas sure|doute|compare|autres devis)/.test(t);
  if (hesite) faits.objections = ["hésite encore"];
  const signe = /\b(signe|signer|va signer|valide|accord)\b/.test(t);
  const date = dateDite(texte, maintenant);
  const rappel = date ? { le: date, motif: signe ? ("COMME_CONVENU" as const) : ("RAPPEL" as const), libelle: signe ? "va signer" : "rappel noté" } : null;
  if (/\b(chaud|tres interesse|presse|rapidement|vite)\b/.test(t) || signe) faits.temperature = "CHAUD";
  return { faits, rappel, sensible: budgetSerre || hesite };
}

/** Faits tirés d'un message du client (teintes, budget). */
export function faitsDuMessage(texte: string, classe: ClasseMessage): Partial<Faits> {
  const faits: Partial<Faits> = {};
  const teintes = teintesDites(texte);
  if (teintes.length) faits.teintesEvoquees = teintes;
  if (classe === "TROP_CHER") faits.budget = "SENSIBLE";
  if (classe === "MECONTENTEMENT") faits.temperature = "FROID";
  if (classe === "VISITE" || classe === "DISPONIBILITES") faits.temperature = "CHAUD";
  return faits;
}

/** Fusion de faits : les listes s'additionnent (sans doublon), le reste est remplacé quand il est dit. */
export function fusionnerFaits(base: Faits, ajout: Partial<Faits>): Faits {
  const union = (a: string[], b: string[] | undefined) => [...new Set([...(b ?? []), ...a])].slice(0, 6);
  return {
    ...base,
    ...Object.fromEntries(Object.entries(ajout).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))),
    pieces: union(base.pieces, ajout.pieces),
    teintesEvoquees: union(base.teintesEvoquees, ajout.teintesEvoquees),
    teintesFavorites: union(base.teintesFavorites, ajout.teintesFavorites),
    objections: union(base.objections, ajout.objections),
    sensible: base.sensible || Boolean(ajout.sensible),
  } as Faits;
}
