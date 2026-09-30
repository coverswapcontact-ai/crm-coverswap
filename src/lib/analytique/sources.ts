import type { Famille } from "./types";

/**
 * Mission 17 (partie B) — la FAMILLE d'une provenance, une seule définition pour tout le CRM (docs/ANALYTIQUE.md § 2) :
 * visites du site (calculée à la réception, `EvenementSite.famille`), leads (`familleDuLead`), écrans de l'Analytique,
 * entonnoir historique du site (`site/familles-source.ts` s'y appuie). Module PUR, sans base : importable par un
 * composant client.
 *
 * Ordre des règles (le premier qui décide gagne) :
 *  1. rien du tout (ni utm, ni référent, ni gclid) → `direct` ; un référent du site lui-même → navigation interne ;
 *  2. `ia` : l'hôte COMPLET du référent ou de `utm_source` est un assistant (chatgpt.com, perplexity.ai, claude.ai,
 *     gemini.google.com, meta.ai…) — testé AVANT meta et seo (sinon `meta.ai` tomberait en Meta, `gemini.google.com`
 *     en SEO) ;
 *  3. `google-ads` : un gclid, ou `utm_source` Google avec un medium payant (cpc, ppc, paid…) ;
 *  4. `fiche-google` : `utm_source=gbp|google-business…`, ou référent `business.google.com`, `maps.google.*` ;
 *  5. `meta` : `utm_source` Meta (meta, fb, facebook, ig, instagram, msg, an) avec un medium payant, ou sans medium
 *     mais avec une campagne (les liens des publicités portent `utm_campaign`) ;
 *  6. `reseaux` : Facebook, Instagram, LinkedIn, TikTok, Pinterest, YouTube, X (t.co), Snapchat, Threads… sans
 *     marqueur payant (un lien partagé, `l.facebook.com` sans utm) ;
 *  7. `seo` : un moteur de recherche (google, bing, duckduckgo, qwant, ecosia, yahoo, brave…) sans marqueur payant ;
 *  8. `autre` : tout le reste (newsletter, sites tiers, publicité payante d'un autre réseau…).
 *
 * Les mots se comparent en entier (« metamorphose.fr », « googleads.g.doubleclick.net » ne sont ni Meta ni Google).
 */

export type EntreeFamille = {
  /** `utm_source` ; ou l'ancienne « source courte » du site (`utm_source[/utm_medium]`, ou l'hôte référent). */
  source?: string | null;
  medium?: string | null;
  campagne?: string | null;
  /** Hôte (ou adresse) du site d'où vient la visite. */
  referent?: string | null;
  /** La visite porte un `gclid` (clic sur une annonce Google Ads). */
  gclid?: boolean | null;
  /** `Lead.source` (« META_ADS »…) : pour un lead, voir `familleDuLead`. */
  leadSource?: string | null;
  /** `Lead.canal` : même forme que l'ancienne source courte (« meta/paid », « l.facebook.com »). */
  canal?: string | null;
};

/** Assistants conversationnels : hôte exact ou sous-domaine (`www.perplexity.ai`). */
export const HOTES_IA = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "meta.ai",
  "chat.mistral.ai",
  "chat.deepseek.com",
  "grok.com",
  "x.ai",
  "you.com",
  "phind.com",
] as const;
/** `utm_source` sans point que les assistants posent (« chatgpt », « perplexity »). */
const MOTS_IA = new Set(["chatgpt", "openai", "perplexity", "claude", "gemini", "copilot", "mistral", "lechat", "deepseek", "grok", "phind"]);

const MOTS_META = new Set(["meta", "fb", "facebook", "ig", "instagram", "msg", "messenger", "an"]);
const MOTS_RESEAUX = new Set([
  "facebook", "fb", "instagram", "ig", "messenger", "msg", "linkedin", "lnkd", "tiktok", "pinterest", "pin", "youtube", "youtu",
  "twitter", "snapchat", "threads", "reddit", "whatsapp", "telegram",
]);
/** Hôtes courts de réseaux qu'un découpage en mots ne reconnaît pas. */
const HOTES_RESEAUX = new Set(["t.co", "x.com", "lnkd.in", "pin.it", "youtu.be", "fb.me", "m.me", "wa.me"]);
const MOTS_RECHERCHE = new Set(["google", "bing", "duckduckgo", "qwant", "ecosia", "yahoo", "yandex", "baidu", "brave", "startpage", "lilo", "search", "googlequicksearchbox"]);
/** Services Google qui ne sont pas la recherche (un lien depuis Gmail n'est pas du SEO). */
const SOUS_DOMAINES_GOOGLE_HORS_RECHERCHE = new Set(["mail", "docs", "drive", "calendar", "accounts", "sites", "classroom", "meet", "photos", "news"]);
const MOTS_FICHE = new Set(["gbp", "gmb", "google-business", "google_business", "googlebusiness", "google-my-business", "google_my_business", "googlemybusiness", "business-profile", "fiche-google"]);
/** Medium d'une visite payée (Meta, Google, autres). */
const MEDIUMS_PAYANTS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid-social", "paid_social", "cpm", "cpa", "cpv", "ads", "ad", "sponsored", "display", "paid-search", "paid_search", "sem", "retargeting"]);
const HOTES_DU_SITE = ["coverswap.fr"];

const net = (valeur: string | null | undefined) => (valeur ?? "").trim().toLowerCase();

/** L'hôte d'une adresse ou d'un hôte déjà nu, sans `www.` ni port ; vide si ce n'est pas un hôte. */
export function hoteDe(valeur: string | null | undefined): string {
  let v = net(valeur);
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].split("@").pop()!.replace(/:\d+$/, "");
  v = v.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(v) && v.includes(".") ? v : "";
}

const hoteDans = (hote: string, liste: Iterable<string>) => {
  for (const h of liste) if (hote === h || hote.endsWith(`.${h}`)) return true;
  return false;
};
const mots = (valeur: string) => valeur.split(/[^a-z0-9]+/).filter(Boolean);

export function estHoteIa(valeur: string | null | undefined): boolean {
  const hote = hoteDe(valeur);
  return Boolean(hote) && hoteDans(hote, HOTES_IA);
}

export function estHoteDuSite(valeur: string | null | undefined): boolean {
  const hote = hoteDe(valeur);
  return Boolean(hote) && hoteDans(hote, HOTES_DU_SITE);
}

/** Un medium payant : liste connue, ou qui contient « paid ». */
export function estMediumPayant(medium: string | null | undefined): boolean {
  const m = net(medium);
  return Boolean(m) && (MEDIUMS_PAYANTS.has(m) || /paid|cpc|ppc/.test(m));
}

function estGoogleRecherche(hote: string, liste: string[]): boolean {
  if (!liste.includes("google") && !liste.includes("googlequicksearchbox")) return false;
  const premier = hote.split(".")[0];
  return !(hote && SOUS_DOMAINES_GOOGLE_HORS_RECHERCHE.has(premier));
}

function estFicheGoogle(source: string, hote: string): boolean {
  if (MOTS_FICHE.has(source)) return true;
  if (!hote) return false;
  return hote === "business.google.com" || hote === "maps.app.goo.gl" || hote === "g.page" || /^maps\.google\.[a-z.]+$/.test(hote);
}

/** Découpe l'ancienne « source courte » du site (`utm_source/utm_medium`) ; une adresse garde ses « / ». */
export function decouperSourceCourte(valeur: string | null | undefined): { source: string; medium: string } {
  const v = net(valeur);
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//.test(v)) return { source: v, medium: "" };
  const [source, ...reste] = v.split("/");
  return { source: source.trim(), medium: reste.join("/").trim() };
}

/** La famille d'une provenance (visite ou demande). Voir l'ordre des règles en tête du module. */
export function familleDe(entree: EntreeFamille): Famille {
  if (net(entree.leadSource) === "meta_ads") return "meta";
  const courte = decouperSourceCourte(entree.source ?? entree.canal);
  // « direct » et le site lui-même ne sont pas des provenances.
  const source = courte.source === "direct" || courte.source === "(direct)" || courte.source === "(none)" || estHoteDuSite(courte.source) ? "" : courte.source;
  const medium = net(entree.medium) || courte.medium;
  const campagne = net(entree.campagne);
  const hoteSource = hoteDe(source);
  const hoteReferent = estHoteDuSite(entree.referent) ? "" : hoteDe(entree.referent);
  const payant = estMediumPayant(medium);

  if (!source && !hoteReferent && !entree.gclid) return "direct";

  // 2. Assistants : hôte complet, avant tout le reste.
  if (estHoteIa(hoteSource) || estHoteIa(hoteReferent) || MOTS_IA.has(source)) return "ia";

  const motsSource = mots(source);
  const motsReferent = mots(hoteReferent);
  // 3. Google Ads.
  if (entree.gclid) return "google-ads";
  if ((motsSource.includes("google") || motsSource.includes("adwords") || source === "google-ads" || source === "googleads") && (payant || source === "adwords" || source === "google-ads")) return "google-ads";
  // 4. Fiche Google.
  if (estFicheGoogle(source, hoteReferent) || (hoteSource && estFicheGoogle("", hoteSource))) return "fiche-google";
  // 5. Publicité Meta : source Meta avec un medium payant (ou une campagne sans medium).
  if (motsSource.some((m) => MOTS_META.has(m)) && (payant || (!medium && Boolean(campagne)))) return "meta";
  // 6. Réseaux sociaux sans marqueur payant.
  const reseau = (hote: string, liste: string[]) => (hote && HOTES_RESEAUX.has(hote)) || liste.some((m) => MOTS_RESEAUX.has(m));
  if (!payant && (reseau(hoteSource, motsSource) || (!source && reseau(hoteReferent, motsReferent)))) return "reseaux";
  // 7. Moteurs de recherche sans marqueur payant.
  const recherche = (hote: string, liste: string[]) => estGoogleRecherche(hote, liste) || liste.some((m) => m !== "google" && MOTS_RECHERCHE.has(m));
  if (!payant && (recherche(hoteSource, motsSource) || (!source && recherche(hoteReferent, motsReferent)))) return "seo";
  // Une utm_source inconnue mais un référent parlant : le référent décide (sauf visite payée).
  if (source && hoteReferent && !payant) {
    if (reseau(hoteReferent, motsReferent)) return "reseaux";
    if (recherche(hoteReferent, motsReferent)) return "seo";
  }
  return "autre";
}

/** Le nom lisible de la provenance (« chatgpt.com », « meta/paid », « l.facebook.com »), vide pour le direct. */
export function nomDeProvenance(entree: EntreeFamille): string {
  const brut = (entree.source ?? entree.canal ?? "").trim();
  if (brut && brut.toLowerCase() !== "direct") return entree.medium && !brut.includes("/") ? `${brut}/${entree.medium.trim()}` : brut;
  const hote = estHoteDuSite(entree.referent) ? "" : hoteDe(entree.referent);
  return hote || (entree.gclid ? "google/cpc" : "");
}

/** Lead.source → famille quand ni le canal ni le parcours ne disent rien. */
const FAMILLE_PAR_SOURCE_LEAD: Record<string, Famille> = {
  META_ADS: "meta",
  INSTAGRAM: "reseaux",
  TIKTOK: "reseaux",
  ORGANIQUE: "autre",
  REFERENCE: "autre",
  MAIL: "autre",
  AUTRE: "autre",
};

export type LeadPourFamille = {
  source?: string | null;
  canal?: string | null;
  campagne?: string | null;
  /** La première visite connue du parcours (famille déjà calculée à la réception, ou ses éléments). */
  parcours?: (EntreeFamille & { famille?: string | null }) | null;
};

/**
 * La famille d'un lead : `Lead.source` META_ADS → meta ; puis son canal (utm ou référent de la première visite,
 * envoyé par le formulaire) ; puis le parcours du site ; puis la source du lead (Instagram, TikTok → réseaux ;
 * recommandation, mail, autre → autre) ; un lead du site sans aucune trace de provenance → direct. `sourceParcours` :
 * la source brute du parcours, quand on n'a qu'elle (équivaut à `parcours: { source }`).
 */
export function familleDuLead(lead: LeadPourFamille, sourceParcours?: string | null): Famille {
  if (lead.source === "META_ADS") return "meta";
  // Raccourci : la source brute du parcours (ancienne source courte du site) donnée à part.
  if (!lead.parcours && sourceParcours) lead = { ...lead, parcours: { source: sourceParcours } };
  if (lead.canal?.trim()) {
    const f = familleDe({ source: lead.canal, campagne: lead.campagne });
    if (f !== "direct") return f;
  }
  if (lead.parcours) {
    const connue = lead.parcours.famille as Famille | null | undefined;
    const f = connue && connue !== "direct" ? connue : familleDe(lead.parcours);
    if (f !== "direct") return f;
  }
  const parSource = lead.source ? FAMILLE_PAR_SOURCE_LEAD[lead.source] : undefined;
  return parSource ?? "direct";
}
