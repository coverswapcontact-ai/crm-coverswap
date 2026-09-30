import prisma from "@/lib/prisma";

/**
 * Mission 17 (partie B) — le SUIVI des synchronisations de l'Analytique, une ligne `SourceAnalytique` par source
 * externe (META, GOOGLE_ADS, SEARCH_CONSOLE, FICHE_GOOGLE) : dernier essai, dernière réussite (gardée quand un essai
 * échoue ensuite), dernière erreur, échecs de suite, et un détail JSON (état, date du premier échec de la série,
 * période couverte, lignes écrites). Lu par `etat.ts` (écran, sante_systeme) et par le détecteur SYSTEME des tâches.
 *
 * Écrit par les connecteurs (meta/depense.ts, google/search-console.ts, google/fiche.ts) : une réussite, un échec, ou
 * une ATTENTE D'ACCÈS (l'accès n'est pas encore accordé par Google : état normal, jamais une erreur bruyante).
 */

export const SOURCES_SYNCHRONISEES = ["META", "GOOGLE_ADS", "SEARCH_CONSOLE", "FICHE_GOOGLE"] as const;
export type SourceSynchronisee = (typeof SOURCES_SYNCHRONISEES)[number];

export const LIBELLES_SOURCE_SYNCHRONISEE: Record<SourceSynchronisee, string> = {
  META: "Publicité Meta",
  GOOGLE_ADS: "Google Ads",
  SEARCH_CONSOLE: "Search Console",
  FICHE_GOOGLE: "Fiche Google",
};

export function estSourceSynchronisee(valeur: unknown): valeur is SourceSynchronisee {
  return typeof valeur === "string" && (SOURCES_SYNCHRONISEES as readonly string[]).includes(valeur);
}

/** L'accès n'est pas (encore) accordé par le fournisseur : la source est « en attente d'accès », pas en panne. */
export class AccesEnAttente extends Error {
  readonly accesEnAttente = true as const;
  constructor(message: string) {
    super(message);
    this.name = "AccesEnAttente";
  }
}

/** Reconnaissance structurelle (deux copies possibles du module dans le bundle Next, comme registre.ts). */
export function estAccesEnAttente(erreur: unknown): erreur is AccesEnAttente {
  return erreur instanceof AccesEnAttente || (typeof erreur === "object" && erreur !== null && (erreur as { accesEnAttente?: unknown }).accesEnAttente === true);
}

export type EtatSuivi = "A_JOUR" | "EN_ECHEC" | "EN_ATTENTE_ACCES" | "NON_BRANCHEE";

/** Ce que rend une synchronisation (résultat de la tâche ANALYTIQUE_SYNCHRO). */
export type BilanSynchro = {
  source: SourceSynchronisee;
  etat: EtatSuivi;
  du?: string;
  au?: string;
  /** Lignes écrites (upsert). */
  lignes: number;
  /** Appels faits au fournisseur (0 quand la source n'est pas branchée). */
  appels: number;
  message?: string;
};

export type DetailSuivi = {
  etat?: EtatSuivi;
  /** Premier échec de la série en cours (ISO), effacé à la réussite suivante. */
  echecDepuis?: string | null;
  du?: string;
  au?: string;
  lignes?: number;
  [cle: string]: unknown;
};

export type Suivi = {
  source: SourceSynchronisee;
  dernierEssaiLe: Date | null;
  derniereReussiteLe: Date | null;
  derniereErreur: string | null;
  echecsConsecutifs: number;
  detail: DetailSuivi;
};

function lireDetail(texte: string | null | undefined): DetailSuivi {
  if (!texte) return {};
  try {
    const d = JSON.parse(texte) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as DetailSuivi) : {};
  } catch {
    return {};
  }
}

export async function lireSuivi(source: SourceSynchronisee): Promise<Suivi | null> {
  const ligne = await prisma.sourceAnalytique.findUnique({ where: { source } });
  if (!ligne) return null;
  return { source, dernierEssaiLe: ligne.dernierEssaiLe, derniereReussiteLe: ligne.derniereReussiteLe, derniereErreur: ligne.derniereErreur, echecsConsecutifs: ligne.echecsConsecutifs, detail: lireDetail(ligne.detail) };
}

export async function lireTousLesSuivis(): Promise<Map<SourceSynchronisee, Suivi>> {
  const lignes = await prisma.sourceAnalytique.findMany();
  const suivis = new Map<SourceSynchronisee, Suivi>();
  for (const l of lignes) {
    if (!estSourceSynchronisee(l.source)) continue;
    suivis.set(l.source, { source: l.source, dernierEssaiLe: l.dernierEssaiLe, derniereReussiteLe: l.derniereReussiteLe, derniereErreur: l.derniereErreur, echecsConsecutifs: l.echecsConsecutifs, detail: lireDetail(l.detail) });
  }
  return suivis;
}

async function ecrire(source: SourceSynchronisee, donnees: { dernierEssaiLe: Date; derniereReussiteLe?: Date; derniereErreur: string | null; echecsConsecutifs: number; detail: DetailSuivi }): Promise<void> {
  const data = { ...donnees, detail: JSON.stringify(donnees.detail) };
  await prisma.sourceAnalytique.upsert({ where: { source }, create: { source, ...data }, update: data });
}

export async function noterReussite(source: SourceSynchronisee, detail: Omit<DetailSuivi, "etat" | "echecDepuis"> = {}, maintenant: Date = new Date()): Promise<void> {
  const avant = await lireSuivi(source);
  await ecrire(source, { dernierEssaiLe: maintenant, derniereReussiteLe: maintenant, derniereErreur: null, echecsConsecutifs: 0, detail: { ...avant?.detail, ...detail, etat: "A_JOUR", echecDepuis: null } });
}

/** Un échec : la dernière réussite est gardée, le premier échec de la série daté (pour « en échec depuis plus de 24 h »). */
export async function noterEchec(source: SourceSynchronisee, erreur: unknown, maintenant: Date = new Date()): Promise<void> {
  const avant = await lireSuivi(source);
  const message = (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500);
  const enSerie = avant?.detail.etat === "EN_ECHEC" && avant.detail.echecDepuis;
  await ecrire(source, {
    dernierEssaiLe: maintenant,
    derniereErreur: message,
    echecsConsecutifs: (avant?.echecsConsecutifs ?? 0) + 1,
    detail: { ...avant?.detail, etat: "EN_ECHEC", echecDepuis: enSerie ? avant.detail.echecDepuis : maintenant.toISOString() },
  });
}

/** Accès pas encore accordé (Google : API Business Profile en attente, compte de service pas encore ajouté…). */
export async function noterAttenteAcces(source: SourceSynchronisee, message: string, maintenant: Date = new Date()): Promise<void> {
  const avant = await lireSuivi(source);
  await ecrire(source, { dernierEssaiLe: maintenant, derniereErreur: message.slice(0, 500), echecsConsecutifs: 0, detail: { ...avant?.detail, etat: "EN_ATTENTE_ACCES", echecDepuis: null } });
}

/**
 * Enveloppe commune des connecteurs : exécute `faire`, note la réussite (avec la période et les lignes écrites),
 * l'attente d'accès (rendue comme un bilan, sans lever) ou l'échec (noté puis relevé : la tâche réessaie).
 */
export async function suivreSynchro(source: SourceSynchronisee, periode: { du?: string; au?: string }, faire: () => Promise<{ lignes: number; appels: number; detail?: Record<string, unknown> }>): Promise<BilanSynchro> {
  try {
    const { lignes, appels, detail } = await faire();
    await noterReussite(source, { ...detail, du: periode.du, au: periode.au, lignes });
    return { source, etat: "A_JOUR", ...periode, lignes, appels };
  } catch (erreur) {
    if (estAccesEnAttente(erreur)) {
      await noterAttenteAcces(source, erreur.message);
      return { source, etat: "EN_ATTENTE_ACCES", ...periode, lignes: 0, appels: 1, message: erreur.message };
    }
    await noterEchec(source, erreur);
    throw erreur;
  }
}

/** « 2026-09-30 » décalé de `n` jours (négatif : en arrière). */
export function jourDecale(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** « 2026-09-30 » décalé de `n` mois calendaires (jour ramené au dernier du mois si besoin). */
export function moisDecale(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + n, 1, 12));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0, 12)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}
