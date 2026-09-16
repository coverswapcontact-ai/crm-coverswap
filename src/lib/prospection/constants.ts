// ─────────────────────────────────────────────
// Module Prospection — constantes partagées
// SQLite ne supporte pas les enums Prisma : les valeurs autorisées
// des champs `String` du schéma sont définies ici (source de vérité côté code).
// ─────────────────────────────────────────────

export const EMAIL_TYPES = ["GENERIQUE", "NOMINATIF", "INCONNU"] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const STATUTS_PROSPECT = [
  "SOURCE",
  "QUALIFIE",
  "ECARTE",
  "CONTACTE",
  "RELANCE",
  "REPONDU",
  "RDV",
  "CLIENT",
  "OPT_OUT",
] as const;
export type StatutProspect = (typeof STATUTS_PROSPECT)[number];

export const STATUTS_EMAIL_DRAFT = [
  "BROUILLON",
  "VALIDE",
  "EDITE",
  "REJETE",
  "ENVOYE",
] as const;
export type StatutEmailDraft = (typeof STATUTS_EMAIL_DRAFT)[number];

export const TYPES_ACTIVITE = [
  "SOURCING",
  "SCORING",
  "DRAFT_CREE",
  "VALIDATION",
  "EDITION",
  "ENVOI",
  "OUVERTURE",
  "REPONSE",
  "OPT_OUT",
  "NOTE",
] as const;
export type TypeActivite = (typeof TYPES_ACTIVITE)[number];

export const AGENT_SLUGS = ["hotels", "restaurants"] as const;
export type AgentSlug = (typeof AGENT_SLUGS)[number];

// Plages de qualification du sourcing (clé "filtres" de la config agent)
export type FiltresQualification = {
  minAvis: number;
  maxAvis: number | null; // null = pas de plafond
  minNote: number;
  maxNote: number;
};

// Valeurs par défaut des filtres — utilisées par le seed et en fallback
// quand la clé "filtres" manque dans une config déjà en base.
export const FILTRES_DEFAUT: Record<AgentSlug, FiltresQualification> = {
  hotels: { minAvis: 15, maxAvis: 400, minNote: 3.0, maxNote: 4.5 },
  // Resserrés le 11/06/2026 : les institutions à 4,5+/milliers d'avis n'ont
  // pas de besoin covering — on cible les salles vieillissantes.
  restaurants: { minAvis: 20, maxAvis: 800, minNote: 3.2, maxNote: 4.4 },
};

// Structure du champ JSON AgentProfile.config
export type AgentProfileConfig = {
  typesGooglePlaces: string[]; // types de l'API Google Places à sourcer
  motsClesSignaux: string[]; // mots-clés repérés dans les avis (signaux de vétusté)
  blacklistMarques: string[]; // chaînes/franchises à exclure du sourcing
  angleVente: string; // angle commercial CoverSwap pour ce profil
  quotaJournalier: number; // nb max de prospects sourcés par jour
  zone: string; // zone géographique ciblée
  filtres: FiltresQualification; // plages de qualification du sourcing
};

// Structure du champ JSON Prospect.scoreDetails
export type ScoreDetails = {
  signaux: { label: string; points: number; source?: string }[];
  total: number;
};

// Structure du champ JSON Prospect.avisBruts (avis Google compactés :
// on garde note, texte et dates — pas les données d'auteur, inutiles au scoring)
export type AvisBrut = {
  note: number;
  texte: string;
  datePublication?: string; // ISO 8601
  dateRelative?: string; // ex. "il y a 2 mois"
  langue?: string;
};

// Motifs de rejet du sourcing (clés de motifsRejet, ordre = ordre des filtres)
export const MOTIFS_REJET = [
  "nonOperationnel",
  "horsHerault",
  "franchiseBlacklist",
  "nbAvisHorsPlage",
  "noteHorsPlage",
] as const;
export type MotifRejet = (typeof MOTIFS_REJET)[number];

// ─────────────────────────────────────────────
// Lexique de vétusté pour le scoring (étape 3)
// Les motifs matchent du texte NORMALISÉ : minuscules, accents retirés,
// apostrophes typographiques converties en ' (voir scoring.ts).
// ─────────────────────────────────────────────
export type EntreeLexique = { motif: RegExp; label: string; poids: 1 | 2 | 3 };

export const LEXIQUE_VETUSTE: EntreeLexique[] = [
  // Poids 3 — vétusté explicite
  { motif: /vieillot(?:te)?s?\b/, label: "vieillot", poids: 3 },
  // "daté" masculin = trop ambigu seul ("date") : exigé précédé d'un adverbe/verbe
  { motif: /\bdatees?\b|(?<=(?:est|fait|peu|tres|trop|assez|plutot) )dates?\b/, label: "daté", poids: 3 },
  { motif: /defraichi(?:e)?s?\b/, label: "défraîchi", poids: 3 },
  { motif: /a rafraichir\b/, label: "à rafraîchir", poids: 3 },
  { motif: /a renover\b/, label: "à rénover", poids: 3 },
  { motif: /d'un autre (?:temps|age)\b/, label: "d'un autre temps/âge", poids: 3 },
  { motif: /annees (?:19)?[6789]0\b/, label: "années 60-90", poids: 3 },
  { motif: /vetustes?\b/, label: "vétuste", poids: 3 },
  { motif: /decrepit(?:e)?s?\b/, label: "décrépit", poids: 3 },
  // Poids 2 — usure, besoin de rafraîchissement
  // garde-fou personnes : "je suis/nous étions/on était fatigué(s)" ignoré
  { motif: /(?<!je suis |j'etais |nous etions |on etait )fatigue(?:e)?s?\b/, label: "fatigué", poids: 2 },
  { motif: /\busee?s?\b/, label: "usé", poids: 2 },
  { motif: /coup de jeune\b/, label: "coup de jeune", poids: 2 },
  { motif: /coup de peinture\b/, label: "coup de peinture", poids: 2 },
  { motif: /aurait (?:bien )?besoin\b/, label: "aurait besoin", poids: 2 },
  { motif: /vieillissant(?:e)?s?\b/, label: "vieillissant", poids: 2 },
  { motif: /se fait (?:vieux|vieille)\b/, label: "se fait vieux", poids: 2 },
  { motif: /(?:pas|jamais) ete renovee?s?\b/, label: "pas été rénové", poids: 2 },
  { motif: /meriterait\b/, label: "mériterait", poids: 2 },
  // Poids 1 — faibles, soumis au garde-fou charme/caractère
  { motif: /\bvieux\b|\bvieilles?\b/, label: "vieux/vieille", poids: 1 },
  { motif: /\banciens?\b|\banciennes?\b/, label: "ancien", poids: 1 },
  { motif: /\bsimples?\b/, label: "simple", poids: 1 },
  { motif: /\bbasiques?\b/, label: "basique", poids: 1 },
  { motif: /\bspartiates?\b/, label: "spartiate", poids: 1 },
];

// Si l'un de ces mots entoure un match de poids 1 (~15 car. avant, ~30 après),
// le match est ignoré : lieux et patrimoine, pas l'établissement
// ("vieille ville", "pont vieux", "vieille pierre", "ancien plein de charme"…)
export const GARDE_FOU_CHARME =
  /charmes?|caracteres?|authentiques?|pierres?|villes?|villages?|ponts?|quartiers?|ruelles?/;

// Contexte nourriture : un match adjacent à ces mots est ignoré
// ("vieux pain", "cuisine simple", "plats basiques"…)
export const EXCLUSIONS_NOURRITURE =
  /\b(?:pain|plats?|fromages?|vins?|cafes?|desserts?|viandes?|poissons?|cuisine|carte|menu)\b/;
