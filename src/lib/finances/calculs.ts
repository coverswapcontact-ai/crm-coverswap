import { dateDepuisJour } from "@/lib/dossiers/dates";
import { versCentimes } from "@/lib/dossiers/montants";
import { DEFINITIONS_PARAMETRES, type CleParametre, type ValeurParametre } from "@/lib/parametres/definitions";
import type { LigneLivre } from "./livre";
import { ecartJours, estBissextile, type Periode } from "./periodes";

/**
 * Calculs purs sur le livre des recettes : URSSAF d'une période et seuils de
 * l'année. Les taux et seuils sont lus à leur date (paramètres datés) ; un
 * paramètre absent n'est jamais remplacé par une valeur supposée : il est
 * rendu dans `manquants`.
 */

export const CLES_SEUILS = ["SEUIL_FRANCHISE_TVA", "SEUIL_FRANCHISE_TVA_MAJORE", "PLAFOND_MICRO_ENTREPRISE"] as const;
export type CleSeuil = (typeof CLES_SEUILS)[number];

/** Paramètres lus par ces calculs. */
export const CLES_CALCULS = [
  "PERIODICITE_DECLARATION",
  "TAUX_COTISATIONS_SOCIALES",
  "TAUX_CFP",
  "VERSEMENT_LIBERATOIRE",
  "TAUX_VERSEMENT_LIBERATOIRE",
  ...CLES_SEUILS,
] as const satisfies readonly CleParametre[];

export type Lecteur = (cle: (typeof CLES_CALCULS)[number], date: Date) => ValeurParametre | null;

export type Urssaf = {
  periode: Periode;
  chiffreAffaires: number;
  cotisations: number;
  cfp: number;
  /** null : pas d'option pour le versement libératoire. */
  versementLiberatoire: number | null;
  total: number;
  /** Taux en vigueur au dernier jour de la période, pour l'affichage. */
  taux: { cotisations: number | null; cfp: number | null; versementLiberatoire: number | null };
};

export function calculerUrssaf(lignes: LigneLivre[], periode: Periode, lire: Lecteur): { urssaf: Urssaf | null; manquants: CleParametre[] } {
  const dansPeriode = lignes.filter((ligne) => ligne.jour >= periode.debut && ligne.jour <= periode.fin);
  const manquants = new Set<CleParametre>();
  // Montants groupés par jeu de taux : un arrondi par jeu, pas par ligne.
  const parTaux = new Map<string, { centimes: number; cotisations: number; cfp: number; vl: number | null }>();

  for (const ligne of dansPeriode) {
    const date = dateDepuisJour(ligne.jour);
    const cotisations = lire("TAUX_COTISATIONS_SOCIALES", date);
    const cfp = lire("TAUX_CFP", date);
    const option = lire("VERSEMENT_LIBERATOIRE", date);
    const vl = option === "OUI" ? lire("TAUX_VERSEMENT_LIBERATOIRE", date) : null;
    if (cotisations === null) manquants.add("TAUX_COTISATIONS_SOCIALES");
    if (cfp === null) manquants.add("TAUX_CFP");
    if (option === null) manquants.add("VERSEMENT_LIBERATOIRE");
    if (option === "OUI" && vl === null) manquants.add("TAUX_VERSEMENT_LIBERATOIRE");
    if (cotisations === null || cfp === null || option === null || (option === "OUI" && vl === null)) continue;
    const cle = `${cotisations}|${cfp}|${vl}`;
    const groupe = parTaux.get(cle) ?? { centimes: 0, cotisations: Number(cotisations), cfp: Number(cfp), vl: vl === null ? null : Number(vl) };
    groupe.centimes += versCentimes(ligne.montant);
    parTaux.set(cle, groupe);
  }
  if (manquants.size > 0) return { urssaf: null, manquants: [...manquants] };

  let chiffreAffaires = 0;
  let cotisations = 0;
  let cfp = 0;
  let versementLiberatoire: number | null = null;
  for (const groupe of parTaux.values()) {
    chiffreAffaires += groupe.centimes;
    cotisations += Math.round((groupe.centimes * groupe.cotisations) / 100);
    cfp += Math.round((groupe.centimes * groupe.cfp) / 100);
    if (groupe.vl !== null) versementLiberatoire = (versementLiberatoire ?? 0) + Math.round((groupe.centimes * groupe.vl) / 100);
  }
  const fin = dateDepuisJour(periode.fin);
  const nombre = (valeur: ValeurParametre | null) => (valeur === null ? null : Number(valeur));
  return {
    manquants: [],
    urssaf: {
      periode,
      chiffreAffaires: chiffreAffaires / 100,
      cotisations: cotisations / 100,
      cfp: cfp / 100,
      versementLiberatoire: versementLiberatoire === null ? null : versementLiberatoire / 100,
      total: (cotisations + cfp + (versementLiberatoire ?? 0)) / 100,
      taux: {
        cotisations: nombre(lire("TAUX_COTISATIONS_SOCIALES", fin)),
        cfp: nombre(lire("TAUX_CFP", fin)),
        versementLiberatoire: lire("VERSEMENT_LIBERATOIRE", fin) === "OUI" ? nombre(lire("TAUX_VERSEMENT_LIBERATOIRE", fin)) : null,
      },
    },
  };
}

export type Seuil = {
  cle: CleSeuil;
  libelle: string;
  seuil: number;
  chiffreAffaires: number;
  pourcentage: number;
  /** Année en cours : chiffre d'affaires projeté au 31 décembre au rythme actuel. */
  projection: number | null;
};

/**
 * Progression vers les seuils de l'année : chiffre d'affaires encaissé du
 * 1er janvier à aujourd'hui (ou à la fin de l'année si elle est passée).
 */
export function calculerSeuils(
  entree: { annee: number; aujourdhui: string; chiffreAffaires: number },
  lire: Lecteur
): { seuils: Seuil[]; manquants: CleParametre[] } {
  const enCours = entree.aujourdhui.startsWith(`${entree.annee}-`);
  const reference = dateDepuisJour(enCours ? entree.aujourdhui : `${entree.annee}-12-31`);
  const manquants = CLES_SEUILS.filter((cle) => lire(cle, reference) === null);
  if (manquants.length > 0) return { seuils: [], manquants };

  const joursAnnee = estBissextile(entree.annee) ? 366 : 365;
  const joursEcoules = ecartJours(`${entree.annee}-01-01`, entree.aujourdhui) + 1;
  const projection = enCours && joursEcoules >= 30 ? Math.round((entree.chiffreAffaires * joursAnnee * 100) / joursEcoules) / 100 : null;

  return {
    manquants: [],
    seuils: CLES_SEUILS.map((cle) => {
      const seuil = Number(lire(cle, reference));
      return {
        cle,
        libelle: DEFINITIONS_PARAMETRES[cle].libelle,
        seuil,
        chiffreAffaires: entree.chiffreAffaires,
        pourcentage: seuil > 0 ? Math.round((entree.chiffreAffaires / seuil) * 1000) / 10 : 0,
        projection,
      };
    }),
  };
}

export const TRANCHES_RETARD = ["NON_ECHUE", "J30", "J60", "J90", "PLUS_90", "INCONNUE"] as const;
export type TrancheRetard = (typeof TRANCHES_RETARD)[number];

export const LIBELLES_TRANCHE: Record<TrancheRetard, string> = {
  NON_ECHUE: "Pas encore échue",
  J30: "1 à 30 jours de retard",
  J60: "31 à 60 jours",
  J90: "61 à 90 jours",
  PLUS_90: "Plus de 90 jours",
  INCONNUE: "Échéance inconnue",
};

export function trancheRetard(echeance: string | null, aujourdhui: string): { tranche: TrancheRetard; joursRetard: number | null } {
  if (!echeance) return { tranche: "INCONNUE", joursRetard: null };
  const retard = ecartJours(echeance, aujourdhui);
  if (retard <= 0) return { tranche: "NON_ECHUE", joursRetard: 0 };
  return { tranche: retard <= 30 ? "J30" : retard <= 60 ? "J60" : retard <= 90 ? "J90" : "PLUS_90", joursRetard: retard };
}
