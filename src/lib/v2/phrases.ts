import { LIBELLES_RAISON_PAS_A_FAIRE, LIBELLES_RAISON_PLUS_TARD } from "@/lib/a-faire/types";
import { LIBELLES_ETAPE, LIBELLES_TYPE_DOCUMENT, LIBELLES_TYPE_EVENEMENT } from "@/lib/dossiers/constants";
import { LIBELLES_TYPE_ECHANGE } from "@/lib/prospects/constantes";
import { dateRelative, jourRelatif } from "./dates";

/**
 * Mission 22 (correctifs du 07/10, É12) — `phraseV2(texte, maintenant)` : une phrase écrite pour la v1 (les raisons et
 * titres des tâches, les lignes « fait à 10:12 », les libellés de propositions) relue pour la v2 (règle 4 : des
 * phrases, pas des codes), sans toucher à la v1 :
 *  - les dates « 28/09 », « 28/09/2026 », « 28/09 à 14 h », « 28/09 à 14 h 30 », « 28/09 à 14:30 » deviennent relatives
 *    (« il y a 3 jours », « hier 14 h », « lundi 9 h ») ; une date qui précède « le » ou « du » garde l'article tant
 *    qu'il reste lisible (« le 28/09 » → « hier ») ;
 *  - les codes en capitales (« NOTE », « DEVIS_ENVOYE », « ATTEND_CLIENT ») prennent leur libellé, en minuscule
 *    initiale ; un sigle d'usage (« SMS », « CRM », « PDF », « URSSAF ») reste ;
 *  - une heure « 10:12 » s'écrit « 10 h 12 », « 10:00 » s'écrit « 10 h ».
 * Les dates seules (sans année) sont lues dans l'année en cours à Paris, ou l'année d'avant si la date est à venir de
 * plus de 60 jours (une tâche née en décembre, relue en janvier).
 */
const PARIS = "Europe/Paris";

/** Les codes connus, lus dans les libellés déjà écrits par la v1 (jamais un libellé inventé ici). */
const LIBELLES_CODES: Record<string, string> = {
  ...LIBELLES_TYPE_EVENEMENT,
  ...LIBELLES_TYPE_DOCUMENT,
  ...LIBELLES_TYPE_ECHANGE,
  ...LIBELLES_ETAPE,
  ...LIBELLES_RAISON_PLUS_TARD,
  ...LIBELLES_RAISON_PAS_A_FAIRE,
};

/** Les sigles qu'on écrit ainsi : ils ne sont pas des codes. */
const SIGLES = new Set(["SMS", "CRM", "PDF", "URSSAF", "TVA", "HT", "TTC", "IA", "CSV", "RIB", "IBAN", "SIRET", "CP", "ID", "OK", "URL", "API", "MCP", "STOP"]);

const MOTIF_DATE = /\b(?:(le|du|au)\s+)?(\d{1,2})\/(\d{2})(?:\/(\d{4}))?(?:\s+à\s+(\d{1,2})(?:\s*h\s*(\d{2})?|:(\d{2})))?/g;
const MOTIF_HEURE = /\b(\d{1,2}):(\d{2})\b/g;
const MOTIF_CODE = /\b([A-Z][A-Z_]{2,})\b/g;

function anneeParis(maintenant: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: PARIS, year: "numeric" }).format(maintenant));
}

/** L'instant d'une date de la phrase, en heure de Paris (décalage lu par l'horloge elle-même). */
function instantParis(annee: number, mois: number, jour: number, heure: number, minute: number): Date | null {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || heure > 23 || minute > 59) return null;
  const approche = Date.UTC(annee, mois - 1, jour, heure, minute);
  const parties = new Intl.DateTimeFormat("en-US", { timeZone: PARIS, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(approche));
  const lu = Object.fromEntries(parties.map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(lu.year), Number(lu.month) - 1, Number(lu.day), Number(lu.hour) % 24, Number(lu.minute));
  const date = new Date(approche - (local - approche));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** « 10:12 » → « 10 h 12 », « 10:00 » → « 10 h ». */
export function heureEnPhrase(texte: string): string {
  return texte.replace(MOTIF_HEURE, (tout, h: string, m: string) => (Number(h) > 23 || Number(m) > 59 ? tout : m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`));
}

/** Les dates « jj/mm(/aaaa)( à h h mm | à hh:mm) » en dates relatives. */
export function datesEnPhrase(texte: string, maintenant: Date): string {
  const anneeCourante = anneeParis(maintenant);
  return texte.replace(MOTIF_DATE, (tout, article: string | undefined, j: string, m: string, a: string | undefined, h: string | undefined, min1: string | undefined, min2: string | undefined) => {
    const avecHeure = h !== undefined;
    const minute = Number(min1 ?? min2 ?? 0);
    let annee = a ? Number(a) : anneeCourante;
    let date = instantParis(annee, Number(m), Number(j), avecHeure ? Number(h) : 12, avecHeure ? minute : 0);
    if (!date) return tout;
    if (!a && date.getTime() - maintenant.getTime() > 60 * 86_400_000) {
      annee -= 1;
      date = instantParis(annee, Number(m), Number(j), avecHeure ? Number(h) : 12, avecHeure ? minute : 0) ?? date;
    }
    const relative = avecHeure ? dateRelative(date, maintenant) : jourRelatif(date, maintenant);
    // « reçu le 28/09 » → « reçu le 28 sept. » (la phrase relative porte déjà son article) ; « reçu le 06/10 » → « reçu hier ».
    if (article === "du" || article === "au") return `${article} ${relative.replace(/^le /, "")}`;
    return relative;
  });
}

/** « NOTE » → « note », « DEVIS_ENVOYE » → « devis envoyé » ; un sigle d'usage ou un code inconnu reste tel quel. */
export function codesEnPhrase(texte: string): string {
  return texte.replace(MOTIF_CODE, (code: string) => {
    if (SIGLES.has(code)) return code;
    const libelle = LIBELLES_CODES[code];
    if (!libelle) return code;
    return libelle.charAt(0).toLowerCase() + libelle.slice(1);
  });
}

/**
 * La phrase v1 relue pour la v2 : dates relatives, codes en libellés, heures en « 10 h 12 », et le point médian de la
 * v1 (« « Question » · reçu hier ») devient une virgule (règle 4 : pas de point médian en chaîne). Une phrase vide reste vide.
 */
export function phraseV2(texte: string | null | undefined, maintenant: Date = new Date()): string {
  if (!texte) return "";
  return heureEnPhrase(codesEnPhrase(datesEnPhrase(texte, maintenant))).replace(/\s+·\s+/g, ", ");
}

/** Un titre de tâche de la v1 (« Appeler · Nom ») relu pour la v2 : « Appeler — Nom » ; mêmes dates, codes et heures. */
export function titreV2(titre: string | null | undefined, maintenant: Date = new Date()): string {
  if (!titre) return "";
  return heureEnPhrase(codesEnPhrase(datesEnPhrase(titre, maintenant))).replace(/\s+·\s+/g, " — ");
}
