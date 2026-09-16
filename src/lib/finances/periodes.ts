// Périodes de déclaration et jours calendaires (AAAA-MM-JJ, heure de Paris).
// Fonctions pures, sans dépendance serveur.

export type Periodicite = "MENSUELLE" | "TRIMESTRIELLE";

export type Periode = {
  /** Premier jour, inclus. */
  debut: string;
  /** Dernier jour, inclus. */
  fin: string;
  libelle: string;
  /** Date limite de la déclaration URSSAF : dernier jour du mois qui suit la période. */
  echeanceDeclaration: string;
};

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const deux = (nombre: number) => String(nombre).padStart(2, "0");

export function dernierJourDuMois(annee: number, mois: number): string {
  // Le jour 0 du mois suivant est le dernier jour du mois (calcul en UTC, sans fuseau).
  return `${annee}-${deux(mois)}-${deux(new Date(Date.UTC(annee, mois, 0)).getUTCDate())}`;
}

function moisSuivant(annee: number, mois: number): { annee: number; mois: number } {
  return mois === 12 ? { annee: annee + 1, mois: 1 } : { annee, mois: mois + 1 };
}

/** Période de déclaration qui contient ce jour. */
export function periodeDe(jour: string, periodicite: Periodicite): Periode {
  const annee = Number(jour.slice(0, 4));
  const mois = Number(jour.slice(5, 7));
  const premierMois = periodicite === "MENSUELLE" ? mois : Math.floor((mois - 1) / 3) * 3 + 1;
  const dernierMois = periodicite === "MENSUELLE" ? mois : premierMois + 2;
  const apres = moisSuivant(annee, dernierMois);
  return {
    debut: `${annee}-${deux(premierMois)}-01`,
    fin: dernierJourDuMois(annee, dernierMois),
    libelle:
      periodicite === "MENSUELLE"
        ? `${NOMS_MOIS[mois - 1]} ${annee}`
        : `${["1er", "2e", "3e", "4e"][(premierMois - 1) / 3]} trimestre ${annee}`,
    echeanceDeclaration: dernierJourDuMois(apres.annee, apres.mois),
  };
}

/** Période qui précède immédiatement celle-ci. */
export function periodePrecedente(periode: Periode, periodicite: Periodicite): Periode {
  const annee = Number(periode.debut.slice(0, 4));
  const mois = Number(periode.debut.slice(5, 7));
  const veille = mois === 1 ? dernierJourDuMois(annee - 1, 12) : dernierJourDuMois(annee, mois - 1);
  return periodeDe(veille, periodicite);
}

export function libelleMois(mois: number): string {
  return NOMS_MOIS[mois - 1];
}

/** Nombre de jours entre deux jours calendaires (b − a). */
export function ecartJours(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}
