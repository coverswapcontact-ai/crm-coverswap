import prisma from "@/lib/prisma";
import { configurationPublicite } from "@/lib/meta/config";
import { configurationCompteService, emailCompteService } from "@/lib/google/compte-service";
import { configurationSearchConsole } from "@/lib/google/search-console";
import { configurationFiche } from "@/lib/google/fiche";
import type { EtatSource, SourceDonnees } from "./types";
import { LIBELLES_SOURCE_SYNCHRONISEE, lireTousLesSuivis, type SourceSynchronisee, type Suivi } from "./suivi";

/**
 * Mission 17 (partie B) — l'ÉTAT de chaque source de données de l'Analytique (types.ts › EtatSource), sans aucun appel
 * réseau : variables d'environnement + suivi des synchronisations en base (`SourceAnalytique`). Jamais un zéro
 * trompeur : une source non branchée dit en une phrase ce qu'il faut faire (`aFaire`) ; une source en échec garde la
 * date de sa dernière réussite. Lu par l'écran /analytique, l'outil `analytique`, `sante_systeme` et le détecteur
 * SYSTEME des tâches (`pannesDeSynchro`).
 */

export const A_FAIRE = {
  META: "Poser META_AD_ACCOUNT_ID et META_ADS_TOKEN sur Railway (jeton utilisateur système avec le droit ads_read)",
  META_ECHEC: "Vérifier META_ADS_TOKEN sur Railway (jeton utilisateur système avec le droit ads_read sur le compte publicitaire), puis « Relancer »",
  GOOGLE_ADS: "Aucune campagne Google Ads : rien à brancher tant qu'aucune ne tourne (le connecteur s'écrira avec le compte Google Ads et son jeton développeur)",
  SEARCH_CONSOLE: "Poser GOOGLE_SERVICE_ACCOUNT_JSON et ajouter le compte de service comme utilisateur de la propriété Search Console",
  SEARCH_CONSOLE_ECHEC: "Vérifier la clé GOOGLE_SERVICE_ACCOUNT_JSON sur Railway (clé révoquée : en refaire une), puis « Relancer »",
  FICHE_GOOGLE: "Accès à l'API Business Profile demandé à Google : en attente ; ensuite poser GOOGLE_BUSINESS_LOCATION (et GOOGLE_BUSINESS_ACCOUNT pour les avis) sur Railway",
  FICHE_GOOGLE_ECHEC: "Vérifier GOOGLE_BUSINESS_LOCATION et GOOGLE_BUSINESS_ACCOUNT sur Railway, puis « Relancer »",
  PREMIERE: "Variables posées : la première synchronisation part au prochain passage (ou « Relancer » maintenant)",
} as const;

const LIBELLES_API: Record<SourceSynchronisee, string> = { META: "Marketing", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Google Search Console", FICHE_GOOGLE: "Business Profile Performance" };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** L'état d'une source branchée (variables présentes), d'après son suivi en base. */
function depuisSuivi(source: SourceSynchronisee, suivi: Suivi | undefined, aFaire: { echec: string; attente: string }): Omit<EtatSource, "source"> {
  const derniereReussite = iso(suivi?.derniereReussiteLe);
  const etat = suivi?.detail.etat;
  if (etat === "EN_ATTENTE_ACCES") {
    // Pas une panne : l'accès n'est pas encore accordé. Une API non activée se dit à part (autre geste, autre écran).
    const apiNonActivee = /API non activée/.test(suivi?.derniereErreur ?? "");
    return { branchee: false, etat: "EN_ATTENTE_ACCES", derniereReussite, erreur: null, aFaire: apiNonActivee ? `Activer l'API ${LIBELLES_API[source]} dans le projet Google Cloud du compte de service` : aFaire.attente };
  }
  if (etat === "EN_ECHEC" || (suivi?.derniereErreur && (!suivi.derniereReussiteLe || (suivi.dernierEssaiLe && suivi.dernierEssaiLe > suivi.derniereReussiteLe)))) {
    return { branchee: Boolean(derniereReussite), etat: "EN_ECHEC", derniereReussite, erreur: suivi?.derniereErreur ?? "Synchronisation en échec.", aFaire: aFaire.echec };
  }
  if (!derniereReussite) return { branchee: false, etat: "NON_BRANCHEE", derniereReussite: null, erreur: null, aFaire: A_FAIRE.PREMIERE };
  return { branchee: true, etat: "A_JOUR", derniereReussite, erreur: null, aFaire: null };
}

/** L'état des six sources (ordre de SOURCES_DONNEES), à l'instant `maintenant`. */
export async function etatDesSources(maintenant: Date = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<EtatSource[]> {
  const [suivis, dernierEvenement] = await Promise.all([lireTousLesSuivis(), prisma.evenementSite.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })]);
  const etats: EtatSource[] = [];

  // Le CRM se lit en direct.
  etats.push({ source: "CRM", branchee: true, etat: "A_JOUR", derniereReussite: maintenant.toISOString(), erreur: null, aFaire: null });

  // Le site : la mesure maison, toujours branchée ; la dernière réussite = le dernier événement reçu.
  etats.push({
    source: "SITE",
    branchee: true,
    etat: "A_JOUR",
    derniereReussite: iso(dernierEvenement?.createdAt),
    erreur: null,
    aFaire: dernierEvenement ? null : "Aucune visite reçue du site : vérifier NEXT_PUBLIC_SIMULATE_URL sur Vercel (le site envoie ses pages vues au CRM)",
  });

  // Meta : sans variables, l'écran garde le prorata du budget (estimation).
  if (!configurationPublicite(env)) {
    etats.push({ source: "META", branchee: false, etat: "NON_BRANCHEE", derniereReussite: iso(suivis.get("META")?.derniereReussiteLe), erreur: null, aFaire: A_FAIRE.META, estimation: true });
  } else {
    const e = depuisSuivi("META", suivis.get("META"), { echec: A_FAIRE.META_ECHEC, attente: A_FAIRE.META_ECHEC });
    etats.push({ source: "META", ...e, ...(e.derniereReussite ? {} : { estimation: true }) });
  }

  etats.push({ source: "GOOGLE_ADS", branchee: false, etat: "NON_BRANCHEE", derniereReussite: null, erreur: null, aFaire: A_FAIRE.GOOGLE_ADS });

  const sc = configurationSearchConsole(env);
  if (!sc.branchee) {
    etats.push({ source: "SEARCH_CONSOLE", branchee: false, etat: "NON_BRANCHEE", derniereReussite: iso(suivis.get("SEARCH_CONSOLE")?.derniereReussiteLe), erreur: sc.erreur, aFaire: A_FAIRE.SEARCH_CONSOLE });
  } else {
    const email = emailCompteService(env);
    etats.push({ source: "SEARCH_CONSOLE", ...depuisSuivi("SEARCH_CONSOLE", suivis.get("SEARCH_CONSOLE"), { echec: A_FAIRE.SEARCH_CONSOLE_ECHEC, attente: `Ajouter ${email ?? "le compte de service"} comme utilisateur de la propriété ${sc.site} dans Search Console` }) });
  }

  const fiche = configurationFiche(env);
  if (!fiche.branchee) {
    const compteIllisible = configurationCompteService(env).erreur;
    etats.push({ source: "FICHE_GOOGLE", branchee: false, etat: "EN_ATTENTE_ACCES", derniereReussite: iso(suivis.get("FICHE_GOOGLE")?.derniereReussiteLe), erreur: compteIllisible, aFaire: A_FAIRE.FICHE_GOOGLE });
  } else {
    etats.push({ source: "FICHE_GOOGLE", ...depuisSuivi("FICHE_GOOGLE", suivis.get("FICHE_GOOGLE"), { echec: A_FAIRE.FICHE_GOOGLE_ECHEC, attente: "Accès à l'API Business Profile demandé à Google : en attente" }) });
  }
  return etats;
}

export type PanneSynchro = { source: SourceSynchronisee; libelle: string; depuis: Date; heures: number; erreur: string; derniereReussite: Date | null; aFaire: string };

/** Les sources BRANCHÉES dont la synchronisation est en échec (pour la tâche système et sante_systeme). */
export async function pannesDeSynchro(maintenant: Date = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<PanneSynchro[]> {
  const etats = await etatDesSources(maintenant, env);
  const suivis = await lireTousLesSuivis();
  const pannes: PanneSynchro[] = [];
  for (const e of etats) {
    if (e.etat !== "EN_ECHEC") continue;
    const source = e.source as Exclude<SourceDonnees, "CRM" | "SITE">;
    const suivi = suivis.get(source);
    const depuis = suivi?.detail.echecDepuis ? new Date(suivi.detail.echecDepuis) : (suivi?.dernierEssaiLe ?? maintenant);
    pannes.push({
      source,
      libelle: LIBELLES_SOURCE_SYNCHRONISEE[source],
      depuis,
      heures: Math.max(0, Math.floor((maintenant.getTime() - depuis.getTime()) / 3_600_000)),
      erreur: e.erreur ?? "erreur inconnue",
      derniereReussite: suivi?.derniereReussiteLe ?? null,
      aFaire: e.aFaire ?? "",
    });
  }
  return pannes;
}
