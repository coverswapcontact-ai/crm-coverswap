import type { LigneDocument, LignePrestation, Unite } from "./constants";

// Calculs en centimes entiers : un total de devis ne doit jamais dépendre
// d'un arrondi flottant (4,35 ml × 110,50 € = 480,675 → 480,68 €).
//
// TVA : franchise en base (article 293 B du CGI). Le TTC est toujours égal
// au HT ; aucune TVA n'est jamais calculée.

/** Euros → centimes entiers, arrondi commercial sans dérive flottante. */
export function versCentimes(euros: number): number {
  return Math.round(Number((euros * 100).toFixed(4)));
}

export function totalLigneCentimes(ligne: Pick<LignePrestation, "quantite" | "prixUnitaire">): number {
  return versCentimes(ligne.quantite * ligne.prixUnitaire);
}

export type Montants = {
  totalHtCentimes: number;
  totalTtcCentimes: number;
  acompteCentimes: number;
  soldeCentimes: number;
};

export function calculerMontants(lignes: LigneDocument[], acomptePct: number | null): Montants {
  const totalHtCentimes = lignes.reduce(
    (somme, ligne) => (ligne.type === "PRESTATION" ? somme + totalLigneCentimes(ligne) : somme),
    0
  );
  const totalTtcCentimes = totalHtCentimes;
  const acompteCentimes = acomptePct ? Math.round((totalTtcCentimes * acomptePct) / 100) : 0;
  return {
    totalHtCentimes,
    totalTtcCentimes,
    acompteCentimes,
    soldeCentimes: totalTtcCentimes - acompteCentimes,
  };
}

/**
 * Montants d'un document tel qu'il est en base. Un document REPRIS (émis avant le
 * CRM) n'a pas de lignes : son montant est dans `totalHt`. Lire les lignes seules
 * donnait « 0 € » au client dans son espace (22/09/2026).
 */
export function montantsDocument(document: { lignes: LigneDocument[]; totalHt: number; acomptePct: number | null }): Montants {
  const depuisLignes = calculerMontants(document.lignes, document.acomptePct);
  if (depuisLignes.totalHtCentimes > 0 || !(document.totalHt > 0)) return depuisLignes;
  const totalHtCentimes = versCentimes(document.totalHt);
  const acompteCentimes = document.acomptePct ? Math.round((totalHtCentimes * document.acomptePct) / 100) : 0;
  return { totalHtCentimes, totalTtcCentimes: totalHtCentimes, acompteCentimes, soldeCentimes: totalHtCentimes - acompteCentimes };
}

/** « 3 460,00 € » : espace pour les milliers, virgule décimale, € suffixé. */
export function formatCentimes(centimes: number): string {
  const signe = centimes < 0 ? "-" : "";
  const absolu = Math.abs(centimes);
  const entiers = Math.floor(absolu / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const decimales = String(absolu % 100).padStart(2, "0");
  return `${signe}${entiers},${decimales} €`;
}

export function formatMontant(euros: number): string {
  return formatCentimes(versCentimes(euros));
}

/** « 4,5 » : virgule décimale, sans zéro inutile. */
export function formatQuantite(quantite: number): string {
  return String(Math.round(quantite * 100) / 100).replace(".", ",");
}

/** Colonne QTE du PDF : « 4,5 ml », « 2 jours », « 1 » pour un forfait. */
export function libelleQuantite(quantite: number, unite: Unite): string {
  const nombre = formatQuantite(quantite);
  if (unite === "ml") return `${nombre} ml`;
  if (unite === "jour") return `${nombre} ${quantite >= 2 ? "jours" : "jour"}`;
  return nombre;
}

/** Saisie française (« 4,5 », « 1 200 ») → nombre, ou null si illisible. */
export function lireNombre(saisie: string): number | null {
  const nettoye = saisie.replace(/[\s\u00A0\u202F€]/g, "").replace(",", ".");
  if (nettoye === "" || !/^-?\d*\.?\d+$/.test(nettoye)) return null;
  const nombre = Number(nettoye);
  return Number.isFinite(nombre) ? nombre : null;
}
