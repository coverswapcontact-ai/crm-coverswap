import { jourParis } from "@/lib/dossiers/dates";
import { doublonDesPages, etatsDesSources, visitesDuSite } from "./appuis";
import { decalerJour, periodePrecedente, resoudrePeriode } from "./periode";
import { calculerPublicite, campagneAnalytique } from "./ecrans/publicite";
import { chiffresSeo } from "./ecrans/seo";
import { chiffresDisponibles, etatDe } from "./ecrans/commun";
import { memoiser } from "./memoire";
import { LEADS_MINIMUM, meilleurCoutParLead, MULTIPLE_COUPE } from "./verdicts";
import type { Alerte, EtatSource, SourceDonnees } from "./types";

/**
 * Mission 17 (partie B) — les alertes de l'Analytique (docs/ANALYTIQUE.md § 5), calculées par des règles :
 * - PUBLICITE_CPL : une publicité au coût par lead > 2 × la meilleure, sur au moins 5 leads (campagne en cours, sinon
 *   30 derniers jours ; seulement avec la dépense réelle par publicité : sans synchronisation, rien à comparer) ;
 * - TRAFIC_CHUTE : visites des 7 derniers jours inférieures de plus de 40 % aux 7 précédents (au moins 20 visites avant) ;
 * - SEO_DECOLLE : une requête qui décolle (au moins 20 affichages sur 7 jours, au moins le double des 7 précédents) ;
 * - SYNCHRO_<SOURCE> : jeton expiré ou synchronisation en échec (la date de la dernière réussite) ;
 * - WWW_DOUBLON : les adresses www et sans www indexées toutes les deux (28 derniers jours).
 * Rendues dans l'écran, dans `sante_systeme` (`alertesAnalytique`) et par l'outil `analytique`.
 */

export const SEUILS_ALERTES = { chuteTrafic: 0.4, visitesMinimum: 20 } as const;

const NOMS: Record<SourceDonnees, string> = { CRM: "CRM", SITE: "site", META: "Meta", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Search Console", FICHE_GOOGLE: "fiche Google" };
const LIEN = (onglet: string) => `/analytique?onglet=${onglet}`;
const nb = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/\s/g, " ");
const eur = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString("fr-FR").replace(/\s/g, " ")} €`;

/** Alertes de synchronisation (pur) : jeton expiré ou synchro en échec. */
export function alertesDesSources(etats: readonly EtatSource[]): Alerte[] {
  return etats
    .filter((e) => e.etat === "EN_ECHEC")
    .map((e) => {
      const jeton = /jeton|token|expir|190|oauth/i.test(e.erreur ?? "");
      const depuis = e.derniereReussite ? ` ; dernière synchronisation réussie le ${jourParis(e.derniereReussite).split("-").reverse().join("/")}` : "";
      return { cle: `SYNCHRO_${e.source}`, gravite: "ATTENTION" as const, texte: jeton ? `Jeton ${NOMS[e.source]} expiré ou refusé : à renouveler${depuis}` : `Synchronisation ${NOMS[e.source]} en échec${e.erreur ? ` (${e.erreur})` : ""}${depuis}`, lien: "/taches-de-fond", source: e.source };
    });
}

/** Chute de trafic (pur). */
export function alerteTrafic(visites: number | null, avant: number | null): Alerte | null {
  if (visites === null || avant === null || avant < SEUILS_ALERTES.visitesMinimum) return null;
  const baisse = (avant - visites) / avant;
  return baisse > SEUILS_ALERTES.chuteTrafic ? { cle: "TRAFIC_CHUTE", gravite: "ATTENTION", texte: `Trafic du site en chute : ${nb(visites)} visites sur 7 jours contre ${nb(avant)} les 7 précédents (−${Math.round(baisse * 100)} %)`, lien: LIEN("site"), source: "SITE" } : null;
}

/** Publicités au coût par lead > 2 × la meilleure, sur au moins 5 leads (pur). */
export function alertesCoutParLead(pubs: readonly { id: string; nom: string; depense: number | null; leads: number }[]): Alerte[] {
  // Seulement les publicités à dépense positive (relecture B, point 2) : une ligne sans dépense rattachée ne fait pas la « meilleure ».
  const payees = pubs.filter((p) => p.depense !== null && p.depense > 0);
  const meilleur = meilleurCoutParLead(payees);
  if (meilleur === null) return [];
  return payees
    .filter((p) => p.leads >= LEADS_MINIMUM && p.depense! / p.leads > MULTIPLE_COUPE * meilleur)
    .map((p) => ({ cle: `PUBLICITE_CPL:${p.id}`, gravite: "ATTENTION" as const, texte: `« ${p.nom} » : ${eur(p.depense! / p.leads)} par lead, plus de 2 × la meilleure (${eur(meilleur)}), sur ${p.leads} leads`, lien: LIEN("publicite"), source: "META" as const }));
}

async function calculer(maintenant: Date, etatsFournis?: EtatSource[]): Promise<Alerte[]> {
  const etats = etatsFournis ?? (await etatsDesSources(maintenant));
  const alertes: Alerte[] = [...alertesDesSources(etats)];
  const sept = resoudrePeriode({ p: "7j" }, maintenant);
  const [visites, visitesAvant] = await Promise.all([visitesDuSite(sept), visitesDuSite(periodePrecedente(sept))]);
  const trafic = alerteTrafic(visites?.visites ?? null, visitesAvant?.visites ?? null);
  if (trafic) alertes.push(trafic);

  if (chiffresDisponibles(etatDe(etats, "META"))) {
    const campagne = await campagneAnalytique(maintenant);
    const fenetre = campagne.enCours && campagne.fenetre ? campagne.fenetre : resoudrePeriode({ p: "30j" }, maintenant);
    const calcul = await calculerPublicite(fenetre, maintenant, true);
    alertes.push(...alertesCoutParLead(calcul.lignes.filter((l) => l.niveau === "PUBLICITE" && l.plateforme === "META").map((l) => ({ id: l.id, nom: l.nom, depense: l.depense, leads: l.leadsCrm }))));
  }

  if (chiffresDisponibles(etatDe(etats, "SEARCH_CONSOLE"))) {
    // Les données Google arrivent avec 2 à 3 jours de retard : la semaine se lit jusqu'à J−3.
    const fin = decalerJour(jourParis(maintenant), -3);
    const semaine = { ...sept, du: decalerJour(fin, -6), au: fin, precedente: { du: decalerJour(fin, -13), au: decalerJour(fin, -7) } };
    const [seo, mois] = await Promise.all([chiffresSeo(semaine), chiffresSeo({ ...sept, du: decalerJour(fin, -27), au: fin, jours: 28, precedente: { du: decalerJour(fin, -55), au: decalerJour(fin, -28) } })]);
    for (const r of seo.actuel.opportunites.enHausse.slice(0, 2)) {
      const avant = seo.actuel.avantRequetes.get(r.cle)?.impressions ?? 0;
      alertes.push({ cle: `SEO_DECOLLE:${r.cle}`, gravite: "INFO", texte: `« ${r.cle} » décolle : ${nb(r.impressions)} affichages sur 7 jours${avant ? ` contre ${nb(avant)}` : ", nouvelle"}`, lien: LIEN("seo"), source: "SEARCH_CONSOLE" });
    }
    const doublon = doublonDesPages(mois.actuel.pages.map((p) => ({ page: p.cle, impressions: p.impressions, clics: p.clics })));
    if (doublon.detecte) alertes.push({ cle: "WWW_DOUBLON", gravite: "ATTENTION", texte: "www et sans www indexés tous les deux", lien: LIEN("seo"), source: "SEARCH_CONSOLE" });
  }
  return alertes.sort((a, b) => (a.gravite === b.gravite ? 0 : a.gravite === "ATTENTION" ? -1 : 1));
}

/** Les alertes de l'Analytique (cache 5 minutes). `etats` : déjà lus par l'appelant. */
export function alertesAnalytique(maintenant: Date = new Date(), etats?: EtatSource[]): Promise<Alerte[]> {
  return memoiser(`alertes:${jourParis(maintenant)}`, () => calculer(maintenant, etats));
}
