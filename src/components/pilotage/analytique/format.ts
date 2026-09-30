/**
 * Mission 17 (partie B) — formats de l'écran Analytique : nombres au format français (Intl fr-FR, espaces
 * insécables avant « € » et « % »), comparaison à la période précédente (flèche, pourcentage, couleur du sens
 * FAVORABLE de l'indicateur, jamais de rouge) et dates des axes. Pur : importable par les composants et les tests.
 */
import type { Evolution, Format } from "@/lib/analytique/types";

/** Espace insécable (avant « € », « % », « : »). */
export const INSECABLE = " ";

/** Couleurs des tons : favorable (vert), défavorable (ambre), neutre (gris). Aucun rouge dans l'Analytique. */
export const COULEURS_TON = { favorable: "#5DCAA5", defavorable: "#F5B454", neutre: "#9CA3AF" } as const;
export type Ton = keyof typeof COULEURS_TON;
/** Donnée absente (« — ») et textes discrets. */
export const GRIS_ABSENT = "#6B7280";

const formateurs = new Map<string, Intl.NumberFormat>();
function nombreFr(valeur: number, min: number, max: number): string {
  const cle = `${min}-${max}`;
  let formateur = formateurs.get(cle);
  if (!formateur) {
    formateur = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
    formateurs.set(cle, formateur);
  }
  // Intl sépare les milliers par une espace fine insécable (U+202F) : gardée, elle ne coupe jamais un nombre.
  return formateur.format(valeur);
}

/** Décimales d'un pourcentage : une sous 10 % (8,9 %), aucune au-delà (57 %). */
function decimalesPourcent(pourcent: number): number {
  return Math.abs(pourcent) < 10 ? 1 : 0;
}

/**
 * Une valeur d'indicateur, prête à afficher. `null` rend « — » (source non branchée : jamais un zéro trompeur).
 * - nombre : entier (1 234) ; euros : centimes sous 1 000 € si utiles (3,91 € ; 1 234,5 € reste à 1 234,5 €
 *   seulement sous 1 000 : 9 060 €) ; pourcent : RATIO 0..1 (0,089 → 8,9 %) ; position : une décimale (10,5) ;
 *   decimal : deux décimales au plus.
 */
export function formaterValeur(valeur: number | null | undefined, format: Format, options: { decimales?: number; approximatif?: boolean } = {}): string {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return "—";
  const prefixe = options.approximatif ? `≈${INSECABLE}` : "";
  switch (format) {
    case "euros": {
      const max = options.decimales ?? (Math.abs(valeur) >= 1000 ? 0 : 2);
      return `${prefixe}${nombreFr(valeur, 0, max)}${INSECABLE}€`;
    }
    case "pourcent": {
      const pourcent = valeur * 100;
      const max = options.decimales ?? decimalesPourcent(pourcent);
      return `${prefixe}${nombreFr(pourcent, 0, max)}${INSECABLE}%`;
    }
    case "position":
      return `${prefixe}${nombreFr(valeur, 1, options.decimales ?? 1)}`;
    case "decimal":
      return `${prefixe}${nombreFr(valeur, 0, options.decimales ?? 2)}`;
    case "nombre":
    default:
      return `${prefixe}${nombreFr(valeur, 0, options.decimales ?? 0)}`;
  }
}

/** Montant en euros (raccourci). */
export const euros = (valeur: number | null | undefined, options?: { decimales?: number; approximatif?: boolean }) => formaterValeur(valeur, "euros", options);
/** Ratio 0..1 en pourcentage (raccourci). */
export const pourcent = (valeur: number | null | undefined, decimales?: number) => formaterValeur(valeur, "pourcent", { decimales });

export type EvolutionAffichee = {
  /** « ▲ », « ▼ », « = » ou rien (pas de comparaison possible). */
  fleche: "▲" | "▼" | "=" | "";
  /** « ▲ 12 % », « ▼ 3,5 % », « ▲ nouveau », « = stable » ; "" si pas de base de comparaison. */
  texte: string;
  couleur: string;
  ton: Ton;
};

/**
 * La comparaison à la période précédente : la flèche suit le SENS de la variation, la couleur suit le sens
 * FAVORABLE (un coût par lead qui baisse est vert, des leads qui baissent sont ambre).
 */
export function evolutionAffichee(evolution: Evolution | null | undefined): EvolutionAffichee {
  const ton: Ton = evolution?.ton ?? "neutre";
  const couleur = COULEURS_TON[ton];
  if (!evolution || !evolution.sens) return { fleche: "", texte: "", couleur, ton };
  if (evolution.sens === "nouveau") return { fleche: "▲", texte: "▲ nouveau", couleur, ton };
  if (evolution.sens === "stable") return { fleche: "=", texte: "= stable", couleur, ton };
  const fleche = evolution.sens === "hausse" ? "▲" : "▼";
  if (evolution.variation === null || !Number.isFinite(evolution.variation)) return { fleche, texte: fleche, couleur, ton };
  const pourcentage = Math.abs(evolution.variation * 100);
  const decimales = pourcentage < 10 ? 1 : 0;
  return { fleche, texte: `${fleche} ${nombreFr(pourcentage, 0, decimales)}${INSECABLE}%`, couleur, ton };
}

/** Le texte d'aide de la comparaison : « période précédente : 32 ». */
export function titreEvolution(evolution: Evolution | null | undefined, format: Format): string | undefined {
  if (!evolution || evolution.precedente === null) return evolution?.sens === "nouveau" ? "Rien sur la période précédente" : undefined;
  return `Période précédente : ${formaterValeur(evolution.precedente, format)}`;
}

/* ── Dates ─────────────────────────────────────────────────────────── */

/** Une date seule AAAA-MM-JJ lue à midi UTC : le même jour dans tous les fuseaux. */
function midi(jour: string): Date {
  return new Date(`${jour}T12:00:00.000Z`);
}

/** « 25/09 » (axes). Un mois AAAA-MM rend « sept. 26 ». */
export function jourAxe(jour: string): string {
  if (/^\d{4}-\d{2}$/.test(jour)) return moisCourt(jour, true);
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;
}

/** « Vendredi 25 septembre » (infobulles) ; le jour de la semaine est calculé, jamais recopié. */
export function jourLongSemaine(jour: string): string {
  if (/^\d{4}-\d{2}$/.test(jour)) return moisLong(jour);
  const texte = midi(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** « sept. » ou « sept. 26 » pour un mois AAAA-MM. */
export function moisCourt(mois: string, avecAnnee = false): string {
  const date = midi(`${mois.slice(0, 7)}-15`);
  const texte = date.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
  return avecAnnee ? `${texte} ${mois.slice(2, 4)}` : texte;
}

/** « Septembre 2026 ». */
export function moisLong(mois: string): string {
  const texte = midi(`${mois.slice(0, 7)}-15`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** « Mercredi 30 septembre, 07:05 » (heure de Paris) : date du résumé du jour. */
export function dateHeureLongue(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const jourTexte = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  const heureTexte = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  return `${jourTexte.charAt(0).toUpperCase()}${jourTexte.slice(1)}, ${heureTexte}`;
}

/** « 07:02 » si c'est aujourd'hui (Paris), sinon « le 29/09 à 07:02 ». */
export function momentSynchro(instant: string, maintenant: Date = new Date()): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const jourDe = (d: Date) => d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const heureTexte = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  if (jourDe(date) === jourDe(maintenant)) return `à ${heureTexte}`;
  const jourTexte = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" });
  return `le ${jourTexte} à ${heureTexte}`;
}

/** Série « plate » (tout à zéro) : la tuile montre une piste vide plutôt qu'une ligne au sol. */
export function serieVide(serie: readonly number[]): boolean {
  return serie.length === 0 || serie.every((valeur) => !valeur);
}

/**
 * Les points d'une sparkline dans une boîte 160 × 28 (y petit = valeur haute), marges de 2 px en haut et en bas.
 * Une seule valeur donne un trait plat.
 */
export function pointsSparkline(serie: readonly number[], largeur = 160, hauteur = 28): string {
  if (serie.length === 0) return "";
  const min = Math.min(...serie);
  const max = Math.max(...serie);
  const etendue = max - min || 1;
  const pas = serie.length > 1 ? largeur / (serie.length - 1) : 0;
  return serie
    .map((valeur, index) => {
      const x = serie.length > 1 ? index * pas : largeur / 2;
      const y = max === min ? hauteur / 2 : 2 + (1 - (valeur - min) / etendue) * (hauteur - 4);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
}
