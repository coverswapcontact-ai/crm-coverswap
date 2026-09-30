/**
 * Mission 17 (partie B) — l'Analytique : le contrat commun entre les calculs (src/lib/analytique/*), l'écran
 * /analytique et l'outil MCP `analytique`. Pur : importable par les écrans. Conception : docs/ANALYTIQUE.md.
 * Chaque écran est un JSON sérialisable, calculé pour une période et comparé à la période précédente.
 */

export const ONGLETS_ANALYTIQUE = ["ensemble", "publicite", "seo", "site", "argent"] as const;
export type OngletAnalytique = (typeof ONGLETS_ANALYTIQUE)[number];
export const LIBELLES_ONGLET: Record<OngletAnalytique, string> = { ensemble: "Vue d'ensemble", publicite: "Publicité", seo: "SEO et Google", site: "Site", argent: "Argent" };

export const PERIODES_ANALYTIQUE = ["7j", "30j", "90j", "mois", "12m", "libre"] as const;
export type ClePeriode = (typeof PERIODES_ANALYTIQUE)[number];
export const LIBELLES_PERIODE: Record<ClePeriode, string> = { "7j": "7 jours", "30j": "30 jours", "90j": "90 jours", mois: "Mois en cours", "12m": "12 mois", libre: "Dates" };

/** Jours au format AAAA-MM-JJ, heure de Paris, bornes incluses. */
export type Periode = { cle: ClePeriode; du: string; au: string; jours: number; libelle: string; precedente: { du: string; au: string } };

/** Familles de source (docs/ANALYTIQUE.md § 2), une seule définition : src/lib/analytique/sources.ts. */
export const FAMILLES = ["meta", "google-ads", "seo", "fiche-google", "ia", "reseaux", "direct", "autre"] as const;
export type Famille = (typeof FAMILLES)[number];
export const LIBELLES_FAMILLE: Record<Famille, string> = {
  meta: "Pub Meta",
  "google-ads": "Google Ads",
  seo: "SEO",
  "fiche-google": "Fiche Google",
  ia: "ChatGPT et IA",
  reseaux: "Réseaux sociaux",
  direct: "Direct",
  autre: "Autres",
};
/** Couleurs des séries (maquette : Meta vert, site bleu, mail ambre, IA violet). */
export const COULEURS_FAMILLE: Record<Famille, string> = {
  meta: "#5DCAA5",
  "google-ads": "#8FE0C3",
  seo: "#7AA7FF",
  "fiche-google": "#93C5FD",
  ia: "#C4A5FF",
  reseaux: "#F5B454",
  direct: "#D1D5DB",
  autre: "#8B919C",
};

/** Les sources de données, chacune avec son état (jamais un zéro trompeur). */
export const SOURCES_DONNEES = ["CRM", "SITE", "META", "GOOGLE_ADS", "SEARCH_CONSOLE", "FICHE_GOOGLE"] as const;
export type SourceDonnees = (typeof SOURCES_DONNEES)[number];

export type EtatSource = {
  source: SourceDonnees;
  /** Branchée : identifiants présents et au moins une synchronisation réussie (CRM et SITE : toujours). */
  branchee: boolean;
  /** « en attente d'accès », « non branchée », « à jour », « en échec » */
  etat: "A_JOUR" | "EN_ECHEC" | "NON_BRANCHEE" | "EN_ATTENTE_ACCES";
  derniereReussite: string | null;
  erreur: string | null;
  /** Ce qu'il faut faire pour la brancher, en une ou deux phrases (état vide). */
  aFaire: string | null;
  /** Chiffres estimés (prorata du budget Meta sans jeton) : affichés comme tels. */
  estimation?: boolean;
};

export type Format = "nombre" | "euros" | "pourcent" | "position" | "decimal";

/** La comparaison à la période précédente. `ton` suit le sens FAVORABLE de l'indicateur (vert, ambre, gris). */
export type Evolution = {
  precedente: number | null;
  /** (valeur − précédente) / précédente ; null si pas de base. */
  variation: number | null;
  sens: "hausse" | "baisse" | "stable" | "nouveau" | null;
  ton: "favorable" | "defavorable" | "neutre";
};

export type Indicateur = {
  cle: string;
  libelle: string;
  valeur: number | null;
  format: Format;
  evolution: Evolution;
  /** Phrase courte sous la valeur (« 57 % laissent leurs coordonnées », « 9 060 € en attente »). */
  detail?: string | null;
  /** Une valeur par jour de la période (sparkline) ; vide si la source n'est pas branchée. */
  serie: number[];
  source: SourceDonnees;
};

/** Un point de courbe : le jour et une valeur par série. */
export type PointJour = { jour: string; valeurs: Record<string, number> };
export type Serie = { cle: string; libelle: string; couleur: string };
export type Courbe = { titre: string; sousTitre?: string; series: Serie[]; points: PointJour[] };

export type EtapeTunnel = { cle: string; libelle: string; valeur: number | null; tauxPassage: number | null; source: SourceDonnees };
export type Tunnel = { etapes: EtapeTunnel[]; perteMax: { de: string; vers: string; libelle: string; perdus: number } | null };

export type Alerte = { cle: string; gravite: "ATTENTION" | "INFO"; texte: string; lien?: string | null; source: SourceDonnees };

/** Résumé du jour : trois phrases composées par des règles, chaque chiffre avec sa source. */
export type ResumeDuJour = {
  genereLe: string;
  phrases: { genre: "MONTE" | "BAISSE" | "A_FAIRE"; amorce: string; texte: string; sources: SourceDonnees[] }[];
  /** Rédigé par un modèle (IA_CRM actif) ou par des règles. */
  redaction: "REGLES" | "IA";
};

export type LigneSource = { famille: Famille; libelle: string; leads: number; joints: number; devis: number; signes: number; tauxDevis: number | null; horsTunnel?: boolean; note?: string | null };

export type EcranCommun = { onglet: OngletAnalytique; periode: Periode; genereLe: string; sources: EtatSource[]; alertes: Alerte[] };

export type EcranEnsemble = EcranCommun & {
  onglet: "ensemble";
  filtreSource: Famille | null;
  resume: ResumeDuJour | null;
  indicateurs: Indicateur[]; // 6 tuiles : visites, simulations, leads, devis, signés, coût par chantier signé (ou par lead Meta)
  courbeLeads: Courbe; // leads par jour, par source
  courbeDevis: Courbe; // devis par jour, par source (relecture B : les devis découpés par source)
  tunnel: Tunnel; // visites → simulations → leads → appelés → joints → devis → signés → encaissé
  publicite: { jourCampagne: number | null; dureeCampagne: number | null; depense: number | null; budget: number | null; leads: number; coutParLead: number | null; coutParDevis: number | null; publicites: { nom: string; detail: string; verdict: Verdict }[]; estimation: boolean } | null;
  seo: { clics: number | null; impressions: number | null; position: number | null; opportunites: { requete: string; impressions: number; clics: number }[] } | null;
  fiche: { vues: number | null; interactions: number | null; avis: number | null; note: number | null; mois: { mois: string; vues: number }[] } | null;
  qualite: LigneSource[];
  argent: { encaisse: number; devisEnAttente: number; depensePub: number | null; ratioPub: number | null; plafond: number };
};

export type Verdict = "GARDER" | "SURVEILLER" | "COUPER" | "ATTENDRE";
export const LIBELLES_VERDICT: Record<Verdict, string> = { GARDER: "Garder", SURVEILLER: "Surveiller", COUPER: "Couper", ATTENDRE: "Trop tôt" };

export type LignePublicite = {
  niveau: "CAMPAGNE" | "ENSEMBLE" | "PUBLICITE";
  plateforme: "META" | "GOOGLE_ADS";
  id: string;
  nom: string;
  parentNom?: string | null;
  depense: number;
  impressions: number;
  clics: number;
  ctr: number | null;
  cpm: number | null;
  leadsPlateforme: number;
  leadsCrm: number;
  devis: number;
  signes: number;
  encaisse: number;
  coutParLead: number | null;
  coutParDevis: number | null;
  coutParSigne: number | null;
  retourSurDepense: number | null;
  verdict: Verdict | null;
  raisonVerdict: string | null;
};

export type EcranPublicite = EcranCommun & {
  onglet: "publicite";
  campagne: { debut: string | null; jour: number | null; duree: number | null; budget: number | null; regleDuJour: string | null } | null;
  indicateurs: Indicateur[]; // dépense, impressions, clics, CTR, CPM, leads Meta, coût par lead, coût par chantier signé
  courbeDepense: Courbe; // dépense et leads par jour
  lignes: LignePublicite[]; // campagnes, ensembles, publicités (Meta), puis Google Ads (vide tant que non branché)
  estimation: boolean;
};

export type LigneSeo = { cle: string; clics: number; impressions: number; ctr: number | null; position: number | null; evolutionClics: number | null };

export type EcranSeo = EcranCommun & {
  onglet: "seo";
  indicateurs: Indicateur[]; // clics, impressions, CTR, position moyenne
  courbe: Courbe; // clics et impressions par jour
  requetes: LigneSeo[];
  pages: LigneSeo[];
  opportunites: { sansClic: LigneSeo[]; presquePremierePage: LigneSeo[]; enHausse: LigneSeo[] };
  doublonWww: { detecte: boolean; exemples: string[] } | null;
  /** Relecture B : dernier jour livré par Google quand la période a été coupée à ce jour (« données jusqu'au … »), sinon null. */
  donneesJusquau?: { seo: string | null; fiche: string | null };
  /** null : fiche non branchée ou en attente d'accès (l'écran affiche `aFaire` de la source et « Relancer »). */
  fiche: { indicateurs: Indicateur[]; courbe: Courbe; avis: { nombre: number | null; note: number | null } } | null;
};

export type EcranSite = EcranCommun & {
  onglet: "site";
  indicateurs: Indicateur[]; // visites, pages vues, taux simulation, taux simulation → lead
  courbe: Courbe; // visites par jour et par famille
  pagesEntree: { page: string; visites: number; simulations: number; leads: number }[];
  pagesVues: { page: string; vues: number }[];
  provenances: { famille: Famille; nom: string; visites: number; simulations: number; leads: number }[];
  appareils: { appareil: string; visites: number }[];
  pays: { pays: string; visites: number }[];
  entonnoir: Tunnel; // visite → simulation lancée → terminée → lead
  /** L'entonnoir du simulateur en sept étapes (pièce → photo → génération → résultat → estimation → contact), avec
   * abandons, par famille (repris de l'ancien bloc « Sur le site cette semaine » de Leads). */
  simulateur: { famille: Famille | "toutes"; etapes: { cle: string; libelle: string; parcours: number; abandons: number | null; facultative?: boolean }[] }[];
};

export type MoisArgent = { mois: string; encaisse: number; signe: number; depensesPub: number; depensesChantier: number };

export type EcranArgent = EcranCommun & {
  onglet: "argent";
  indicateurs: Indicateur[]; // encaissé, signé, marge estimée, panier moyen, dépense pub, carnet de commandes
  mois: MoisArgent[]; // 12 mois glissants
  regle20: { mois: string; encaissePrecedent: number; depensePub: number; ratio: number | null; plafond: number; depasse: boolean }[];
  carnet: { dossierId: string; client: string; numero: string | null; montant: number; envoyeLe: string | null; relances: number }[];
  fiscal: {
    /** Seuils de l'année : franchise de TVA, franchise majorée, plafond micro-entreprise, avec la projection au 31/12. */
    seuils: { cle: string; libelle: string; plafond: number | null; atteint: number; projection: number | null; ratio: number | null }[];
    /** URSSAF : période en cours et période à déclarer, avec l'échéance et le détail. */
    urssaf: { enCours: { libelle: string; base: number; montant: number | null } | null; aDeclarer: { libelle: string; base: number; montant: number | null; echeance: string | null; detail: { libelle: string; montant: number }[] } | null } | null;
    /** Paramètres manquants pour ces calculs (boutons « Renseigner »). */
    parametresManquants: string[];
    // Compatibilité : anciens champs.
    franchiseTva?: { plafond: number | null; atteint: number; ratio: number | null } | null;
  } | null;
  /** Dépenses de la période par catégorie (repris de l'écran Dépenses). */
  depensesParCategorie: { categorie: string; libelle: string; montant: number; nombre: number }[];
  /** D'où viennent les clients (repris de l'écran Clients) : clients, signés et montant signé par source. */
  clientsParSource: { source: string; libelle: string; clients: number; signes: number; montantSigne: number }[];
};

export type EcranAnalytique = EcranEnsemble | EcranPublicite | EcranSeo | EcranSite | EcranArgent;
