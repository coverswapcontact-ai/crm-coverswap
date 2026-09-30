import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { lireParametres } from "@/lib/parametres/service";
import { etatsDesSources } from "./appuis";
import { construireEcranEnsemble } from "./ecrans/ensemble";
import { resoudrePeriode } from "./periode";
import { LIBELLES_FAMILLE, type EcranEnsemble, type Indicateur, type ResumeDuJour, type SourceDonnees } from "./types";

/**
 * Mission 17 (partie B) — le résumé du jour (docs/ANALYTIQUE.md § 5) : trois phrases composées par des RÈGLES à partir
 * de la Vue d'ensemble des 30 derniers jours — ce qui monte, ce qui baisse, la chose à faire —, chaque chiffre repris
 * tel quel de l'écran (aucun chiffre inventé) et suivi de sa source, en tutoyant Lucas, espaces insécables avant « € »,
 * « % », « : » et entre les milliers. Aucun modèle n'est appelé : l'outil MCP `analytique` le rend pour que Claude le
 * reformule.
 *
 * Point d'extension (IA) : si un jour le paramètre IA_CRM_ACTIVE vaut « ACTIVE », un modèle pourrait reformuler ces
 * trois phrases (mêmes chiffres, mêmes sources) et `redaction` vaudrait « IA ». Ce n'est PAS branché : `iaActive` est
 * lu et rendu dans les données, rien d'autre (interrupteur en pause, décision de la mission 17).
 */

export const NBSP = " ";
const CLE_RESUME = (jour: string) => `resume:${jour}`;

const NOMS_SOURCE: Record<SourceDonnees, string> = { CRM: "CRM", SITE: "site", META: "Meta", GOOGLE_ADS: "Google Ads", SEARCH_CONSOLE: "Search Console", FICHE_GOOGLE: "fiche Google" };

/** « 1 234,5 », avec une espace insécable entre les milliers. */
export function nombreFr(v: number, decimales = 2): string {
  const arrondi = Math.round(v * 10 ** decimales) / 10 ** decimales;
  return arrondi.toLocaleString("fr-FR", { maximumFractionDigits: decimales }).replace(/[\s ]/g, NBSP);
}
export const eurosFr = (v: number) => `${nombreFr(v)}${NBSP}€`;
export const pourcentFr = (ratio: number) => `${nombreFr(ratio * 100, 1)}${NBSP}%`;

function valeurFr(i: Pick<Indicateur, "format">, v: number): string {
  if (i.format === "euros") return eurosFr(v);
  if (i.format === "pourcent") return pourcentFr(v);
  if (i.format === "position") return nombreFr(v, 1);
  return nombreFr(v);
}

const NOMS: Record<string, { nom: string; pluriel: boolean }> = {
  visites: { nom: "les visites du site", pluriel: true },
  simulations: { nom: "les simulations lancées", pluriel: true },
  leads: { nom: "les leads", pluriel: true },
  devis: { nom: "les devis envoyés", pluriel: true },
  signes: { nom: "les chantiers signés", pluriel: true },
  coutParSigne: { nom: "le coût par chantier signé", pluriel: false },
  coutParLeadMeta: { nom: "le coût par lead Meta", pluriel: false },
};

/**
 * « Sur les 30 derniers jours, les leads montent : 18 contre 12 sur la période d'avant, +50 % (CRM). » — relecture B
 * (point 6) : chaque phrase nomme sa période (et le filtre par source), pour ne jamais être lue sous une autre.
 */
function phraseEvolution(i: Indicateur, cadre: string): string {
  const n = NOMS[i.cle] ?? { nom: i.libelle.toLowerCase(), pluriel: false };
  const e = i.evolution;
  const verbe = e.sens === "baisse" ? (n.pluriel ? "baissent" : "baisse") : n.pluriel ? "montent" : "monte";
  const source = `(${NOMS_SOURCE[i.source]})`;
  if (e.sens === "nouveau" || e.precedente === null || e.precedente === 0) return `${cadre}, ${n.nom}${NBSP}: ${valeurFr(i, i.valeur ?? 0)}, contre aucun sur la période d'avant ${source}.`;
  const variation = e.variation === null ? "" : `, ${e.variation > 0 ? "+" : "−"}${pourcentFr(Math.abs(e.variation))}`;
  return `${cadre}, ${n.nom} ${verbe}${NBSP}: ${valeurFr(i, i.valeur ?? 0)} contre ${valeurFr(i, e.precedente)} sur la période d'avant${variation} ${source}.`;
}

/** « Sur les 30 derniers jours » ; « Sur les 7 derniers jours (source Pub Meta) ». */
export const cadreDuResume = (ecran: Pick<EcranEnsemble, "periode"> & Partial<Pick<EcranEnsemble, "filtreSource">>) => `Sur ${ecran.periode.libelle}${ecran.filtreSource ? ` (source ${LIBELLES_FAMILLE[ecran.filtreSource]})` : ""}`;

/** Le plus fort mouvement d'un ton donné (les « nouveau » passent après une vraie variation). */
function plusFort(indicateurs: readonly Indicateur[], ton: "favorable" | "defavorable"): Indicateur | null {
  const candidats = indicateurs.filter((i) => i.valeur !== null && i.evolution.ton === ton);
  return candidats.sort((a, b) => Math.abs(b.evolution.variation ?? 0) - Math.abs(a.evolution.variation ?? 0))[0] ?? null;
}

/** Les trois phrases (pur) : chaque chiffre vient de l'écran. */
export function composerResume(ecran: Pick<EcranEnsemble, "indicateurs" | "tunnel" | "publicite" | "argent" | "periode"> & Partial<Pick<EcranEnsemble, "filtreSource">>, maintenant: Date): ResumeDuJour {
  const phrases: ResumeDuJour["phrases"] = [];
  const cadre = cadreDuResume(ecran);
  const pub = ecran.publicite;
  const campagneEnCours = pub && pub.jourCampagne !== null && pub.dureeCampagne !== null && pub.jourCampagne >= 1 && pub.jourCampagne <= pub.dureeCampagne;
  const suffixeCampagne = campagneEnCours ? ` Jour ${pub!.jourCampagne} sur ${pub!.dureeCampagne} de la campagne.` : "";

  const monte = plusFort(ecran.indicateurs, "favorable");
  phrases.push(
    monte
      ? { genre: "MONTE", amorce: "Ça monte.", texte: `${phraseEvolution(monte, cadre)}${suffixeCampagne}`, sources: [monte.source] }
      : { genre: "MONTE", amorce: "Ça monte.", texte: `${cadre}, rien ne monte nettement.${suffixeCampagne}`, sources: ["CRM"] },
  );

  const baisse = plusFort(ecran.indicateurs, "defavorable");
  const perte = ecran.tunnel.perteMax;
  const phrasePerte = perte && perte.perdus > 0 ? `L'étape qui perd le plus${NBSP}: ${perte.libelle}, ${nombreFr(perte.perdus)} ${perte.perdus > 1 ? "personnes perdues" : "personne perdue"} (CRM).` : "";
  phrases.push(
    baisse
      ? { genre: "BAISSE", amorce: "Ça coince.", texte: [phraseEvolution(baisse, cadre), phrasePerte].filter(Boolean).join(" "), sources: [...new Set<SourceDonnees>([baisse.source, ...(phrasePerte ? ["CRM" as const] : [])])] }
      : phrasePerte
        ? { genre: "BAISSE", amorce: "Ça coince.", texte: phrasePerte, sources: ["CRM"] }
        : { genre: "BAISSE", amorce: "Ça coince.", texte: `${cadre}, rien ne baisse nettement.`, sources: ["CRM"] },
  );

  const aCouper = pub?.publicites.find((p) => p.verdict === "COUPER");
  const signes = ecran.indicateurs.find((i) => i.cle === "signes");
  const carnet = /\((\d+) devis\)/.exec(signes?.detail ?? "");
  const leads = ecran.tunnel.etapes.find((e) => e.cle === "leads")?.valeur ?? null;
  const appeles = ecran.tunnel.etapes.find((e) => e.cle === "appeles")?.valeur ?? null;
  const jamaisAppeles = leads !== null && appeles !== null ? leads - appeles : 0;
  if (aCouper) phrases.push({ genre: "A_FAIRE", amorce: "À faire.", texte: `Coupe la publicité «${NBSP}${aCouper.nom}${NBSP}»${NBSP}: le protocole de campagne le demande (Meta).`, sources: ["META"] });
  else if (ecran.argent.ratioPub !== null && ecran.argent.ratioPub > ecran.argent.plafond) phrases.push({ genre: "A_FAIRE", amorce: "À faire.", texte: `Baisse la pub${NBSP}: elle représente ${pourcentFr(ecran.argent.ratioPub)} de l'encaissé du mois dernier, pour un plafond de ${pourcentFr(ecran.argent.plafond)} (CRM).`, sources: ["CRM"] });
  else if (ecran.argent.devisEnAttente > 0 && carnet) phrases.push({ genre: "A_FAIRE", amorce: "À faire.", texte: `${carnet[1] === "1" ? "Relance le devis en attente" : `Relance les ${carnet[1]} devis en attente`}${NBSP}: ${eurosFr(ecran.argent.devisEnAttente)} en jeu (CRM).`, sources: ["CRM"] });
  else if (jamaisAppeles > 0) phrases.push({ genre: "A_FAIRE", amorce: "À faire.", texte: jamaisAppeles === 1 ? "Appelle le lead jamais appelé (CRM)." : `Appelle les ${nombreFr(jamaisAppeles)} leads jamais appelés (CRM).`, sources: ["CRM"] });
  else phrases.push({ genre: "A_FAIRE", amorce: "À faire.", texte: "Rien d'urgent dans les chiffres : garde le rythme.".replace(" :", `${NBSP}:`), sources: ["CRM"] });

  return { genereLe: maintenant.toISOString(), phrases, redaction: "REGLES", periode: ecran.periode.libelle, filtreSource: ecran.filtreSource ?? null };
}

/** Le résumé du jour, calculé maintenant (Vue d'ensemble des 30 derniers jours). */
export async function resumeDuJour(maintenant: Date = new Date()): Promise<ResumeDuJour> {
  const etats = await etatsDesSources(maintenant);
  const ecran = await construireEcranEnsemble(resoudrePeriode({ p: "30j" }, maintenant), { etats }, maintenant);
  // Point d'extension IA (voir l'en-tête) : non branché, la rédaction reste par règles.
  return composerResume(ecran, maintenant);
}

/** L'interrupteur de l'IA du CRM, lu pour information (point d'extension, jamais appelé ici). */
export async function iaActive(maintenant: Date = new Date()): Promise<boolean> {
  const v = await lireParametres(["IA_CRM_ACTIVE"], maintenant);
  return v.IA_CRM_ACTIVE === "ACTIVE";
}

/** Le résumé enregistré ce jour-là (pré-calcul de 7 h), sinon calculé et enregistré. */
export async function resumeEnregistre(maintenant: Date = new Date(), options: { recalculer?: boolean } = {}): Promise<ResumeDuJour> {
  const cle = CLE_RESUME(jourParis(maintenant));
  if (!options.recalculer) {
    const existant = await prisma.instantaneAnalytique.findUnique({ where: { cle } });
    if (existant) {
      try {
        return JSON.parse(existant.contenu) as ResumeDuJour;
      } catch {
        // contenu illisible : recalculé ci-dessous
      }
    }
  }
  const resume = await resumeDuJour(maintenant);
  const contenu = JSON.stringify(resume);
  await prisma.instantaneAnalytique.upsert({ where: { cle }, create: { cle, calculeLe: maintenant, contenu }, update: { calculeLe: maintenant, contenu } });
  return resume;
}
