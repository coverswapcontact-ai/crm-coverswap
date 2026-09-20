/**
 * Le texte d'un SMS : combien il coûte, s'il demande l'arrêt, ce qu'on y remplace.
 * Fonctions pures, partagées par l'écran (compteur de la zone de saisie) et le serveur.
 *
 * Un SMS tient 160 caractères de l'alphabet GSM-7, ou 70 dès qu'un seul caractère
 * en sort (ê, ç, œ, guillemets français, apostrophe courbe, tiret long…). Un message
 * long se découpe en parties de 153 (ou 67) caractères, chacune facturée.
 */

const GSM_BASE = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Caractères GSM « étendus » : ils comptent double. */
const GSM_ETENDU = "^{}\\[~]|€";

export function caracteresHorsGsm(texte: string): string[] {
  const hors = new Set<string>();
  for (const c of texte) if (!GSM_BASE.includes(c) && !GSM_ETENDU.includes(c)) hors.add(c);
  return [...hors];
}

export type MesureSms = {
  /** Vrai si tout le texte tient dans l'alphabet GSM-7 (160 caractères par SMS). */
  gsm: boolean;
  /** Longueur comptée (les caractères étendus comptent double en GSM-7). */
  longueur: number;
  /** Nombre de SMS facturés. */
  segments: number;
  /** Caractères qui font basculer le message en Unicode (70 par SMS). */
  horsGsm: string[];
};

export function mesurerSms(texte: string): MesureSms {
  const horsGsm = caracteresHorsGsm(texte);
  const gsm = horsGsm.length === 0;
  const longueur = gsm ? [...texte].reduce((n, c) => n + (GSM_ETENDU.includes(c) ? 2 : 1), 0) : texte.length;
  const [seul, partie] = gsm ? [160, 153] : [70, 67];
  const segments = longueur === 0 ? 0 : longueur <= seul ? 1 : Math.ceil(longueur / partie);
  return { gsm, longueur, segments, horsGsm };
}

const REMPLACEMENTS_GSM: [RegExp, string][] = [
  [/[\u2018\u2019\u02bc]/g, "'"],
  [/«[\s\u00a0\u202f]*/g, '"'],
  [/[\s\u00a0\u202f]*»/g, '"'],
  [/[\u201c\u201d]/g, '"'],
  [/[\u2013\u2014]/g, "-"],
  [/\u2026/g, "..."],
  [/\u00a0|\u202f/g, " "],
  [/[êë]/g, "e"],
  [/[ÊË]/g, "E"],
  [/[âá]/g, "a"],
  [/[îï]/g, "i"],
  [/[ôó]/g, "o"],
  [/[ûú]/g, "u"],
  [/ç/g, "c"],
  [/œ/g, "oe"],
  [/Œ/g, "OE"],
  [/À/g, "A"],
  [/[ÈÊ]/g, "E"],
];

/** Ramène un texte à l'alphabet GSM-7 sans toucher à é, è, à, ù (qui y sont) : un SMS au lieu de trois. */
export function simplifierPourGsm(texte: string): string {
  let sortie = texte;
  for (const [motif, remplacement] of REMPLACEMENTS_GSM) sortie = sortie.replace(motif, remplacement);
  // Ce qui reste hors alphabet (émojis…) est retiré : le choix de simplifier est explicite.
  return [...sortie].filter((c) => GSM_BASE.includes(c) || GSM_ETENDU.includes(c)).join("").replace(/ {2,}/g, " ");
}

/**
 * Le message demande-t-il l'arrêt des SMS ? « STOP », « Stop svp », « STOP SMS »,
 * « arrêt », « désabonner »… Un message qui contient « stop » au milieu d'une
 * phrase (« on stoppe les travaux ») n'en est pas un : seul un message court
 * qui COMMENCE par le mot compte.
 */
export function estDemandeArret(texte: string): boolean {
  const t = texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 40) return false;
  return /^(stop|arret|arreter|desabonner|desabonnement|desinscription|desinscrire|unsubscribe)\b/.test(t);
}

/** Mention d'arrêt ajoutée au premier SMS d'une conversation, si le texte n'en parle pas déjà. */
export const MENTION_STOP = "STOP pour ne plus recevoir nos SMS.";

export function avecMentionStop(texte: string): string {
  return /\bstop\b/i.test(texte) ? texte : `${texte.trimEnd()} ${MENTION_STOP}`;
}

/** Remplit un message type : {prenom}, {lien}… Une variable inconnue ou vide est retirée proprement. */
export function remplirModele(modele: string, variables: Record<string, string | null | undefined>): string {
  return modele
    .replace(/\{(\w+)\}/g, (_tout, nom: string) => (variables[nom] ?? "").toString().trim())
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.;:!?])/g, (tout, ponctuation: string) => (/[;:!?]/.test(ponctuation) ? tout : ponctuation))
    .replace(/^Bonjour ,/, "Bonjour,")
    .trim();
}

/** Le numéro est-il un mobile français joignable par SMS (06 ou 07) ? Attend le format international. */
export function estMobileFrancais(numeroInternational: string | null | undefined): boolean {
  return /^\+33[67]\d{8}$/.test(numeroInternational ?? "");
}
