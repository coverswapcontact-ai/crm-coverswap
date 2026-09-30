/**
 * Mission 17 (partie B) — un jeu de données FICTIF de l'écran Analytique, au format du contrat
 * (src/lib/analytique/types.ts), cohérent avec la maquette validée du 30/09/2026 (38 leads Meta, 45 leads, 4 devis,
 * aucun signé, 6 devis en attente pour 9 060 €…). Sert aux tests de rendu de l'écran ; jamais lu en production.
 */
import type {
  Alerte,
  Courbe,
  EcranAnalytique,
  EcranArgent,
  EcranCommun,
  EcranEnsemble,
  EcranPublicite,
  EcranSeo,
  EcranSite,
  EtatSource,
  Evolution,
  Format,
  Indicateur,
  LignePublicite,
  LigneSeo,
  OngletAnalytique,
  Periode,
  SourceDonnees,
} from "@/lib/analytique/types";

const JOURS = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
/** Campagne lancée le 22/09 : neuf jours. */
const CAMPAGNE = JOURS.slice(21);
const avantCampagne = (valeurs: number[]) => [...Array(21).fill(0), ...valeurs];

export const PERIODE_ESSAI: Periode = { cle: "30j", du: "2026-09-01", au: "2026-09-30", jours: 30, libelle: "30 derniers jours", precedente: { du: "2026-08-02", au: "2026-08-31" } };
export const MAINTENANT_ESSAI = "2026-09-30T07:05:00.000Z";

export const SOURCES_ESSAI: EtatSource[] = [
  { source: "CRM", branchee: true, etat: "A_JOUR", derniereReussite: "2026-09-30T07:05:00.000Z", erreur: null, aFaire: null },
  { source: "SITE", branchee: true, etat: "A_JOUR", derniereReussite: "2026-09-30T07:04:00.000Z", erreur: null, aFaire: null },
  { source: "META", branchee: true, etat: "A_JOUR", derniereReussite: "2026-09-30T05:02:00.000Z", erreur: null, aFaire: null },
  {
    source: "GOOGLE_ADS",
    branchee: false,
    etat: "NON_BRANCHEE",
    derniereReussite: null,
    erreur: null,
    aFaire: "Aucun compte Google Ads relié : renseigner l'identifiant du compte et le jeton développeur, puis relancer.",
  },
  { source: "SEARCH_CONSOLE", branchee: true, etat: "A_JOUR", derniereReussite: "2026-09-30T04:40:00.000Z", erreur: null, aFaire: null },
  {
    source: "FICHE_GOOGLE",
    branchee: false,
    etat: "EN_ATTENTE_ACCES",
    derniereReussite: null,
    erreur: null,
    aFaire: "Google doit ouvrir l'accès à l'API Business Profile (demande envoyée) ; le compte de service doit être gestionnaire de la fiche.",
  },
];

const ALERTES: Alerte[] = [
  { cle: "www", gravite: "ATTENTION", texte: "www et sans www indexés tous les deux", lien: "/analytique?onglet=seo", source: "SEARCH_CONSOLE" },
  { cle: "requete-sans-clic", gravite: "ATTENTION", texte: "« covering meuble montpellier » : 160 affichages, 0 clic", lien: "/analytique?onglet=seo", source: "SEARCH_CONSOLE" },
  { cle: "meta-cle", gravite: "INFO", texte: "Clé secrète Meta absente (sans effet)", lien: null, source: "META" },
];

function commun<O extends OngletAnalytique>(onglet: O): EcranCommun & { onglet: O } {
  return { onglet, periode: PERIODE_ESSAI, genereLe: MAINTENANT_ESSAI, sources: SOURCES_ESSAI, alertes: ALERTES };
}

function evolution(precedente: number | null, valeur: number | null, ton: Evolution["ton"]): Evolution {
  if (valeur === null) return { precedente, variation: null, sens: null, ton: "neutre" };
  if (precedente === null) return { precedente, variation: null, sens: null, ton };
  if (precedente === 0) return { precedente, variation: null, sens: valeur > 0 ? "nouveau" : "stable", ton };
  const variation = (valeur - precedente) / precedente;
  return { precedente, variation, sens: Math.abs(variation) < 0.02 ? "stable" : variation > 0 ? "hausse" : "baisse", ton };
}

function indicateur(
  cle: string,
  libelle: string,
  valeur: number | null,
  format: Format,
  precedente: number | null,
  ton: Evolution["ton"],
  serie: number[],
  source: SourceDonnees,
  detail?: string
): Indicateur {
  return { cle, libelle, valeur, format, evolution: evolution(precedente, valeur, ton), detail: detail ?? null, serie, source };
}

/* ── Séries quotidiennes ──────────────────────────────────────────────── */

const LEADS_META = [3, 5, 4, 6, 4, 5, 3, 4, 4]; // 38
const LEADS_SITE = [0, 1, 0, 1, 0, 1, 1, 1, 1]; // 6
const LEADS_MAIL = [0, 0, 0, 0, 0, 0, 1, 0, 0]; // 1
const DEPENSE = [22.4, 22.1, 22.6, 22.3, 22.5, 22.2, 22.4, 22.1, 22.4]; // 201
const VISITES = [18, 21, 19, 17, 22, 16, 15, 20, 19, 18, 23, 21, 17, 16, 19, 22, 20, 18, 21, 24, 20, 38, 44, 41, 47, 39, 36, 33, 42, 41]; // 812
const SIMULATIONS = [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 3, 2, 4, 3, 2, 3, 2, 3]; // 30
const DEVIS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1]; // 4
const COUT_LEAD = [5.6, 4.9, 4.6, 4.3, 4.2, 4.1, 4.0, 3.96, 3.94];

export const ENSEMBLE_ESSAI: EcranEnsemble = {
  ...commun("ensemble"),
  filtreSource: null,
  resume: {
    genereLe: "2026-09-30T05:05:00.000Z",
    redaction: "REGLES",
    phrases: [
      { genre: "MONTE", amorce: "Ça monte.", texte: "Le prospect Meta coûte 3,94 €, bien sous tes 5 à 8 € de l'an dernier. Jour 9 sur 21 de la campagne.", sources: ["META", "CRM"] },
      { genre: "BAISSE", amorce: "Ça coince.", texte: "4 devis pour 45 leads, et aucun signé. 10 leads Meta n'ont jamais décroché.", sources: ["CRM"] },
      { genre: "A_FAIRE", amorce: "À faire.", texte: "Relancer les 6 devis en attente : 9 060 € en jeu.", sources: ["CRM"] },
    ],
  },
  indicateurs: [
    indicateur("visites", "Visites du site", 812, "nombre", 655, "favorable", VISITES, "SITE", "3,7 % lancent une simulation"),
    indicateur("simulations", "Simulations", 30, "nombre", 21, "favorable", SIMULATIONS, "SITE", "57 % laissent leurs coordonnées"),
    indicateur("leads", "Leads", 45, "nombre", 0, "favorable", avantCampagne(LEADS_META.map((v, i) => v + LEADS_SITE[i] + LEADS_MAIL[i])), "CRM"),
    indicateur("devis", "Devis envoyés", 4, "nombre", 4, "neutre", DEVIS, "CRM", "8,9 % des leads"),
    indicateur("signes", "Chantiers signés", 0, "nombre", 1, "defavorable", Array(30).fill(0), "CRM", "9 060 € en attente"),
    indicateur("coutParLead", "Coût par lead Meta", 3.94, "euros", null, "favorable", COUT_LEAD, "META", "réel Meta"),
  ],
  courbeLeads: {
    titre: "Leads par jour et par source",
    sousTitre: "Depuis le lancement de la campagne, le 22 septembre",
    series: [
      { cle: "meta", libelle: "Pub Meta", couleur: "#5DCAA5" },
      { cle: "site", libelle: "Site", couleur: "#7AA7FF" },
      { cle: "mail", libelle: "Mail", couleur: "#F5B454" },
    ],
    points: CAMPAGNE.map((jour, i) => ({ jour, valeurs: { meta: LEADS_META[i], site: LEADS_SITE[i], mail: LEADS_MAIL[i] } })),
  },
  tunnel: {
    etapes: [
      { cle: "visites", libelle: "Visites", valeur: 812, tauxPassage: null, source: "SITE" },
      { cle: "simulations", libelle: "Simulations", valeur: 30, tauxPassage: 30 / 812, source: "SITE" },
      { cle: "leads", libelle: "Leads", valeur: 45, tauxPassage: null, source: "CRM" },
      { cle: "appeles", libelle: "Appelés", valeur: 27, tauxPassage: 27 / 45, source: "CRM" },
      { cle: "joints", libelle: "Joints", valeur: 17, tauxPassage: 17 / 27, source: "CRM" },
      { cle: "devis", libelle: "Devis envoyés", valeur: 4, tauxPassage: 4 / 17, source: "CRM" },
      { cle: "signes", libelle: "Signés", valeur: 0, tauxPassage: 0, source: "CRM" },
      { cle: "encaisse", libelle: "Encaissés", valeur: 0, tauxPassage: null, source: "CRM" },
    ],
    perteMax: { de: "joints", vers: "devis", libelle: "joint → devis", perdus: 13 },
  },
  publicite: {
    jourCampagne: 9,
    dureeCampagne: 21,
    depense: 201,
    budget: 469,
    leads: 38,
    coutParLead: 3.94,
    coutParDevis: 100.5,
    publicites: [
      { nom: "Claquement de doigt", detail: "16 joints sur 26 appelés", verdict: "GARDER" },
      { nom: "Avant / après cuisine", detail: "3 joints sur 8 appelés", verdict: "SURVEILLER" },
    ],
    estimation: false,
  },
  seo: {
    clics: 106,
    impressions: 1770,
    position: 10.5,
    opportunites: [
      { requete: "covering meuble montpellier", impressions: 160, clics: 0 },
      { requete: "covering mobilier devis gratuit", impressions: 138, clics: 0 },
      { requete: "devis covering mobilier en ligne", impressions: 110, clics: 0 },
    ],
  },
  fiche: null,
  qualite: [
    { famille: "meta", libelle: "Pub Meta", leads: 38, joints: 16, devis: 2, signes: 0, tauxDevis: 2 / 38 },
    { famille: "seo", libelle: "Site : simulateur", leads: 6, joints: 1, devis: 2, signes: 0, tauxDevis: 2 / 6 },
    { famille: "direct", libelle: "Mail", leads: 1, joints: 0, devis: 0, signes: 0, tauxDevis: null },
    { famille: "ia", libelle: "ChatGPT", leads: 2, joints: 0, devis: 1, signes: 0, tauxDevis: null, horsTunnel: true, note: "simulations" },
  ],
  argent: { encaisse: 2010, devisEnAttente: 9060, depensePub: 201, ratioPub: 0.1, plafond: 0.2 },
};

/* ── Publicité ────────────────────────────────────────────────────────── */

function lignePub(p: Partial<LignePublicite> & Pick<LignePublicite, "niveau" | "id" | "nom" | "depense" | "leadsPlateforme" | "leadsCrm" | "devis">): LignePublicite {
  const impressions = p.impressions ?? Math.round(p.depense * 92);
  const clics = p.clics ?? Math.round(impressions * 0.033);
  return {
    plateforme: "META",
    parentNom: null,
    impressions,
    clics,
    ctr: impressions ? clics / impressions : null,
    cpm: impressions ? (p.depense / impressions) * 1000 : null,
    signes: 0,
    encaisse: 0,
    coutParLead: p.leadsPlateforme ? p.depense / p.leadsPlateforme : null,
    coutParDevis: p.devis ? p.depense / p.devis : null,
    coutParSigne: null,
    retourSurDepense: null,
    verdict: null,
    raisonVerdict: null,
    ...p,
  };
}

export const PUBLICITE_ESSAI: EcranPublicite = {
  ...commun("publicite"),
  campagne: { debut: "2026-09-22", jour: 9, duree: 21, budget: 469, regleDuJour: "Jours 8 à 14 : couper une publicité dont le coût par lead dépasse 2 × la meilleure, à partir de 5 leads." },
  estimation: false,
  indicateurs: [
    indicateur("depense", "Dépense", 201, "euros", 0, "neutre", avantCampagne(DEPENSE), "META", "sur 469 € de budget"),
    indicateur("impressions", "Impressions", 18450, "nombre", 0, "favorable", avantCampagne([1900, 2050, 2010, 2120, 2080, 2060, 2070, 2090, 2070]), "META"),
    indicateur("clics", "Clics", 612, "nombre", 0, "favorable", avantCampagne([58, 66, 70, 71, 69, 68, 70, 70, 70]), "META"),
    indicateur("ctr", "Taux de clic", 0.0332, "pourcent", null, "neutre", [], "META"),
    indicateur("cpm", "Coût pour 1 000", 10.89, "euros", null, "neutre", [], "META"),
    indicateur("leadsMeta", "Leads Meta", 38, "nombre", 0, "favorable", avantCampagne(LEADS_META), "CRM", "51 comptés par Meta"),
    indicateur("coutParLead", "Coût par lead", 3.94, "euros", null, "favorable", COUT_LEAD, "META", "réel Meta"),
    indicateur("coutParSigne", "Coût par chantier signé", null, "euros", null, "neutre", [], "CRM", "aucun chantier signé"),
  ],
  courbeDepense: {
    titre: "Dépense et leads par jour",
    series: [
      { cle: "depense", libelle: "Dépense", couleur: "#5DCAA5" },
      { cle: "leads", libelle: "Leads Meta", couleur: "#7AA7FF" },
    ],
    points: CAMPAGNE.map((jour, i) => ({ jour, valeurs: { depense: DEPENSE[i], leads: LEADS_META[i] } })),
  },
  lignes: [
    lignePub({ niveau: "CAMPAGNE", id: "c1", nom: "Covering mobilier — septembre", depense: 201, leadsPlateforme: 51, leadsCrm: 38, devis: 2, verdict: null }),
    lignePub({ niveau: "ENSEMBLE", id: "e1", nom: "Montpellier 25 km", parentNom: "Covering mobilier — septembre", depense: 134, leadsPlateforme: 36, leadsCrm: 27, devis: 2 }),
    lignePub({ niveau: "ENSEMBLE", id: "e2", nom: "Hérault, 35-65 ans", parentNom: "Covering mobilier — septembre", depense: 67, leadsPlateforme: 15, leadsCrm: 11, devis: 0 }),
    lignePub({
      niveau: "PUBLICITE",
      id: "p1",
      nom: "Claquement de doigt",
      parentNom: "Montpellier 25 km",
      depense: 118,
      leadsPlateforme: 34,
      leadsCrm: 26,
      devis: 2,
      verdict: "GARDER",
      raisonVerdict: "Meilleur coût par lead (3,47 €), 2 devis.",
    }),
    lignePub({
      niveau: "PUBLICITE",
      id: "p2",
      nom: "Avant / après cuisine",
      parentNom: "Hérault, 35-65 ans",
      depense: 61,
      leadsPlateforme: 12,
      leadsCrm: 8,
      devis: 0,
      verdict: "SURVEILLER",
      raisonVerdict: "5,08 € par lead : moins de 2 × la meilleure, à revoir au jour 14.",
    }),
    lignePub({
      niveau: "PUBLICITE",
      id: "p3",
      nom: "Carrousel réalisations",
      parentNom: "Montpellier 25 km",
      depense: 22,
      leadsPlateforme: 5,
      leadsCrm: 4,
      devis: 0,
      verdict: "ATTENDRE",
      raisonVerdict: "Moins de 5 leads : trop tôt pour juger.",
    }),
  ],
};

/* ── SEO et Google ────────────────────────────────────────────────────── */

const CLICS = [2, 3, 4, 3, 2, 4, 3, 3, 4, 3, 2, 4, 5, 3, 4, 3, 4, 3, 5, 4, 3, 4, 5, 4, 3, 4, 3, 4, 3, 2]; // 106
const IMPRESSIONS = [52, 55, 60, 58, 50, 62, 57, 59, 61, 60, 54, 63, 66, 58, 60, 57, 62, 59, 64, 61, 58, 60, 63, 60, 56, 59, 57, 61, 54, 43]; // 1770
const POSITIONS = [11.4, 11.3, 11.1, 11.2, 11, 10.9, 10.9, 10.8, 10.8, 10.7, 10.7, 10.6, 10.6, 10.5, 10.5, 10.5, 10.4, 10.4, 10.4, 10.3, 10.3, 10.3, 10.2, 10.2, 10.2, 10.1, 10.1, 10.1, 10, 10];

const seo = (cle: string, clics: number, impressions: number, position: number, evolutionClics: number | null = null): LigneSeo => ({
  cle,
  clics,
  impressions,
  ctr: impressions ? clics / impressions : null,
  position,
  evolutionClics,
});

export const SEO_ESSAI: EcranSeo = {
  ...commun("seo"),
  indicateurs: [
    indicateur("clics", "Clics", 106, "nombre", 88, "favorable", CLICS, "SEARCH_CONSOLE"),
    indicateur("impressions", "Affichages", 1770, "nombre", 1490, "favorable", IMPRESSIONS, "SEARCH_CONSOLE"),
    indicateur("ctr", "Taux de clic", 106 / 1770, "pourcent", 88 / 1490, "neutre", [], "SEARCH_CONSOLE"),
    indicateur("position", "Position moyenne", 10.5, "position", 11.6, "favorable", POSITIONS, "SEARCH_CONSOLE", "plus bas, c'est mieux"),
  ],
  courbe: {
    titre: "Clics et affichages par jour",
    sousTitre: "Search Console, avec 2 à 3 jours de retard",
    series: [
      { cle: "clics", libelle: "Clics", couleur: "#7AA7FF" },
      { cle: "impressions", libelle: "Affichages", couleur: "#93C5FD" },
      { cle: "position", libelle: "Position", couleur: "#C4A5FF" },
    ],
    points: JOURS.map((jour, i) => ({ jour, valeurs: { clics: CLICS[i], impressions: IMPRESSIONS[i], position: POSITIONS[i] } })),
  },
  requetes: [
    seo("coverswap", 38, 71, 1.2, 0.19),
    seo("covering cuisine montpellier", 17, 212, 6.8, 0.42),
    seo("renovation cuisine adhesif", 12, 305, 9.4, 0.2),
    seo("covering meuble", 9, 188, 8.1, -0.1),
    seo("film adhesif plan de travail", 7, 240, 12.3, 0.75),
    seo("covering meuble montpellier", 0, 160, 11.6, null),
    seo("covering mobilier devis gratuit", 0, 138, 14.2, null),
    seo("devis covering mobilier en ligne", 0, 110, 13.5, null),
  ],
  pages: [
    seo("/", 51, 540, 7.9, 0.13),
    seo("/covering-cuisine", 24, 486, 9.2, 0.33),
    seo("/simulateur", 14, 210, 10.4, 0.4),
    seo("/realisations", 9, 262, 12.1, -0.18),
    seo("/covering-meuble-montpellier", 5, 204, 11.3, null),
    seo("/avis", 3, 68, 8.7, 0),
  ],
  opportunites: {
    sansClic: [seo("covering meuble montpellier", 0, 160, 11.6), seo("covering mobilier devis gratuit", 0, 138, 14.2), seo("devis covering mobilier en ligne", 0, 110, 13.5)],
    presquePremierePage: [seo("covering meuble montpellier", 0, 160, 11.6), seo("film adhesif plan de travail", 7, 240, 12.3), seo("devis covering mobilier en ligne", 0, 110, 13.5)],
    enHausse: [seo("film adhesif plan de travail", 7, 240, 12.3, 0.75), seo("covering cuisine montpellier", 17, 212, 6.8, 0.42)],
  },
  doublonWww: { detecte: true, exemples: ["https://www.coverswap.fr/covering-cuisine", "https://coverswap.fr/covering-cuisine"] },
  fiche: null,
};

/* ── Site ─────────────────────────────────────────────────────────────── */

const parFamille = (i: number) => {
  const total = VISITES[i];
  const meta = i >= 21 ? Math.round(total * 0.42) : 0;
  const seoJour = Math.round((total - meta) * 0.55);
  const ia = i % 4 === 0 ? 2 : 1;
  const fiche = i % 3 === 0 ? 2 : 1;
  return { seo: seoJour, meta, ia, "fiche-google": fiche, direct: Math.max(0, total - meta - seoJour - ia - fiche) };
};

const courbeSite: Courbe = {
  titre: "Visites par jour et par source",
  series: [
    { cle: "seo", libelle: "SEO", couleur: "#7AA7FF" },
    { cle: "meta", libelle: "Pub Meta", couleur: "#5DCAA5" },
    { cle: "direct", libelle: "Direct", couleur: "#D1D5DB" },
    { cle: "ia", libelle: "ChatGPT et IA", couleur: "#C4A5FF" },
    { cle: "fiche-google", libelle: "Fiche Google", couleur: "#93C5FD" },
  ],
  points: JOURS.map((jour, i) => ({ jour, valeurs: parFamille(i) })),
};

// Contrat : dans l'écran Site, `sources` désigne les provenances du trafic (pas l'état des sources de données).
export const SITE_ESSAI: EcranSite = {
  ...commun("site"),
  indicateurs: [
    indicateur("visites", "Visites", 812, "nombre", 655, "favorable", VISITES, "SITE"),
    indicateur(
      "pagesVues",
      "Pages vues",
      2140,
      "nombre",
      1810,
      "favorable",
      VISITES.map((v) => Math.round(v * 2.6)),
      "SITE",
      "2,6 pages par visite"
    ),
    indicateur("tauxSimulation", "Visites → simulation", 30 / 812, "pourcent", 21 / 655, "favorable", [], "SITE"),
    indicateur("tauxSimulationLead", "Simulation → lead", 17 / 30, "pourcent", 10 / 21, "favorable", [], "SITE", "17 leads sur 30 simulations"),
  ],
  courbe: courbeSite,
  pagesEntree: [
    { page: "/", visites: 318, simulations: 9, leads: 5 },
    { page: "/simulateur", visites: 214, simulations: 16, leads: 9 },
    { page: "/covering-cuisine", visites: 131, simulations: 3, leads: 2 },
    { page: "/realisations", visites: 72, simulations: 1, leads: 1 },
    { page: "/covering-meuble-montpellier", visites: 49, simulations: 1, leads: 0 },
    { page: "/avis", visites: 28, simulations: 0, leads: 0 },
  ],
  pagesVues: [
    { page: "/", vues: 604 },
    { page: "/simulateur", vues: 522 },
    { page: "/realisations", vues: 388 },
    { page: "/covering-cuisine", vues: 301 },
    { page: "/avis", vues: 164 },
    { page: "/covering-meuble-montpellier", vues: 97 },
    { page: "/contact", vues: 64 },
  ],
  sources: [
    { famille: "seo", nom: "google.com", visites: 318, simulations: 9, leads: 4 },
    { famille: "meta", nom: "facebook.com (pub)", visites: 204, simulations: 12, leads: 8 },
    { famille: "direct", nom: "Direct", visites: 121, simulations: 3, leads: 2 },
    { famille: "meta", nom: "instagram.com (pub)", visites: 58, simulations: 3, leads: 2 },
    { famille: "fiche-google", nom: "business.google.com", visites: 41, simulations: 1, leads: 1 },
    { famille: "reseaux", nom: "instagram.com", visites: 22, simulations: 0, leads: 0 },
    { famille: "seo", nom: "bing.com", visites: 9, simulations: 0, leads: 0 },
    { famille: "ia", nom: "chatgpt.com", visites: 31, simulations: 2, leads: 0 },
    { famille: "ia", nom: "perplexity.ai", visites: 6, simulations: 0, leads: 0 },
    { famille: "ia", nom: "claude.ai", visites: 2, simulations: 0, leads: 0 },
  ] as unknown as EcranSite["sources"],
  appareils: [
    { appareil: "Téléphone", visites: 587 },
    { appareil: "Ordinateur", visites: 193 },
    { appareil: "Tablette", visites: 32 },
  ],
  pays: [
    { pays: "France", visites: 781 },
    { pays: "Belgique", visites: 11 },
    { pays: "Suisse", visites: 8 },
    { pays: "Espagne", visites: 5 },
    { pays: "Autres", visites: 7 },
  ],
  entonnoir: {
    etapes: [
      { cle: "visites", libelle: "Visites", valeur: 812, tauxPassage: null, source: "SITE" },
      { cle: "simulationLancee", libelle: "Simulation lancée", valeur: 48, tauxPassage: 48 / 812, source: "SITE" },
      { cle: "simulationTerminee", libelle: "Simulation terminée", valeur: 30, tauxPassage: 30 / 48, source: "SITE" },
      { cle: "lead", libelle: "Coordonnées laissées", valeur: 17, tauxPassage: 17 / 30, source: "CRM" },
    ],
    perteMax: { de: "visites", vers: "simulationLancee", libelle: "visite → simulation", perdus: 764 },
  },
};

/* ── Argent ───────────────────────────────────────────────────────────── */

const MOIS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const ENCAISSE = [1240, 2380, 890, 1520, 1980, 2640, 3150, 2210, 2890, 3380, 3150, 2010];
const SIGNE = [2100, 1650, 980, 2350, 2400, 3100, 2280, 2900, 3420, 2600, 2480, 0];
const PUB = [0, 420, 180, 0, 0, 0, 0, 0, 0, 0, 0, 201];
const CHANTIER = [410, 760, 320, 480, 690, 820, 1020, 690, 910, 1080, 980, 590];

export const ARGENT_ESSAI: EcranArgent = {
  ...commun("argent"),
  indicateurs: [
    indicateur("encaisse", "Encaissé", 2010, "euros", 3150, "defavorable", [0, 0, 480, 0, 0, 0, 0, 0, 0, 620, 0, 0, 0, 0, 0, 0, 0, 910, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "CRM", "3 encaissements"),
    indicateur("signe", "Signé", 0, "euros", 2480, "defavorable", Array(30).fill(0), "CRM", "aucun devis signé"),
    indicateur("marge", "Marge estimée", 1420, "euros", 2170, "defavorable", [], "CRM", "encaissé − dépenses de chantier"),
    indicateur("panierMoyen", "Panier moyen", 1510, "euros", 1380, "favorable", [], "CRM", "sur les signatures des 12 mois"),
    indicateur("depensePub", "Dépense pub", 201, "euros", 0, "neutre", avantCampagne(DEPENSE), "META", "10 % de l'encaissé"),
    indicateur("carnet", "Carnet de commandes", 9060, "euros", 6230, "favorable", [], "CRM", "6 devis envoyés, non signés"),
  ],
  mois: MOIS.map((mois, i) => ({ mois, encaisse: ENCAISSE[i], signe: SIGNE[i], depensesPub: PUB[i], depensesChantier: CHANTIER[i] })),
  regle20: MOIS.slice(1).map((mois, i) => {
    const encaissePrecedent = ENCAISSE[i];
    const depensePub = PUB[i + 1];
    const ratio = encaissePrecedent ? depensePub / encaissePrecedent : null;
    return { mois, encaissePrecedent, depensePub, ratio, plafond: 0.2, depasse: ratio !== null && ratio > 0.2 };
  }),
  carnet: [
    { dossierId: "d1", client: "Claire Vasseur", numero: "D-2026-041", montant: 2480, envoyeLe: "2026-09-12", relances: 1 },
    { dossierId: "d2", client: "Atelier Mazet", numero: "D-2026-043", montant: 1960, envoyeLe: "2026-09-18", relances: 0 },
    { dossierId: "d3", client: "Nadia Ferrand", numero: "D-2026-045", montant: 1540, envoyeLe: "2026-09-25", relances: 0 },
    { dossierId: "d4", client: "Julien Roux", numero: "D-2026-046", montant: 1180, envoyeLe: "2026-09-28", relances: 0 },
    { dossierId: "d5", client: "Sophie Garnier", numero: "D-2026-047", montant: 1020, envoyeLe: "2026-09-29", relances: 0 },
    { dossierId: "d6", client: "Marc Delorme", numero: "D-2026-048", montant: 880, envoyeLe: "2026-09-29", relances: 0 },
  ],
  fiscal: { franchiseTva: { plafond: 37500, atteint: 21480, ratio: 21480 / 37500 }, urssaf: { taux: 0.212, estime: 426 } },
};

export const ECRANS_ESSAI: Record<OngletAnalytique, EcranAnalytique> = {
  ensemble: ENSEMBLE_ESSAI,
  publicite: PUBLICITE_ESSAI,
  seo: SEO_ESSAI,
  site: SITE_ESSAI,
  argent: ARGENT_ESSAI,
};
