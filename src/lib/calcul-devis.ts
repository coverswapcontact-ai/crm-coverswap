// ============================================================================
// CALCUL DEVIS v2 — CoverSwap
// ============================================================================
// Base vente Essential = 10€/ml (prix historique, TVA non applicable art 293B)
// Coef ml          : ×10 (1-10ml) / ×8 (10-15ml) / ×7 (15+ml)
// Ratio gamme      : 1.00 (Essential) → 1.30 max (Cork) → tient +30% d'écart
// Complexité       : ×1.00 / ×1.10 / ×1.20 selon difficulté de pose
// Coût matière réel: prix HT Cover Styl' × 1.20 (TVA payée achat) + supplément
// Supplément Cover Styl': <10ml +4€/ml, ≥10ml +2€/ml (sur matière)
// ============================================================================

export type GammeCode =
  | "ESSENTIAL"
  | "SILK"
  | "SILK_PRESTIGE"
  | "WOOD_STONE_CONCRETE_STEEL"
  | "WOOD_PAINTED_PRESTIGE"
  | "PVC_FREE_WSC"
  | "GLITTER"
  | "TEXTILE_HIGH_RES"
  | "EXTERIOR"
  | "TEXTILE_PRESTIGE"
  | "CORK_BRUSHED_AURORA";

export interface Gamme {
  code: GammeCode;
  label: string;
  prixMatiereHT: number; // €/ml grille Cover Styl' 2025
  ratioVente: number;    // Multiplicateur sur prix Essential (1.00 → 1.30)
}

export const GAMMES: Gamme[] = [
  { code: "ESSENTIAL",                  label: "Color Essential",                   prixMatiereHT: 11.5, ratioVente: 1.00 },
  { code: "SILK",                       label: "Color Silk",                        prixMatiereHT: 13.5, ratioVente: 1.05 },
  { code: "SILK_PRESTIGE",              label: "Color Silk Prestige",               prixMatiereHT: 15.5, ratioVente: 1.10 },
  { code: "WOOD_STONE_CONCRETE_STEEL",  label: "Wood · Stone · Concrete · Steel",   prixMatiereHT: 18.5, ratioVente: 1.12 },
  { code: "WOOD_PAINTED_PRESTIGE",      label: "Wood Painted Prestige",             prixMatiereHT: 19.5, ratioVente: 1.15 },
  { code: "PVC_FREE_WSC",               label: "PVC-Free Wood · Stone · Concrete",  prixMatiereHT: 20.5, ratioVente: 1.18 },
  { code: "GLITTER",                    label: "Glitter",                           prixMatiereHT: 28.0, ratioVente: 1.20 },
  { code: "TEXTILE_HIGH_RES",           label: "Textile Natural · Leather · High-Resistant", prixMatiereHT: 30.0, ratioVente: 1.22 },
  { code: "EXTERIOR",                   label: "Exterior",                          prixMatiereHT: 35.0, ratioVente: 1.25 },
  { code: "TEXTILE_PRESTIGE",           label: "Textile Prestige",                  prixMatiereHT: 42.0, ratioVente: 1.28 },
  { code: "CORK_BRUSHED_AURORA",        label: "Cork · Brushed Prestige · Aurora",  prixMatiereHT: 50.0, ratioVente: 1.30 },
];

export const BASE_ESSENTIAL = 15; // €/ml — base Essential (10€ × 1.25 × 1.20 = 15€)

export function getGamme(code: string): Gamme {
  return GAMMES.find((g) => g.code === code) ?? GAMMES[0];
}

export function coefML(ml: number): number {
  if (ml <= 10) return 10;
  if (ml <= 15) return 8;
  return 7;
}

export function coefComplexite(c: number): number {
  if (c === 3) return 1.20;
  if (c === 2) return 1.10;
  return 1.00;
}

export function supplementCoverStyl(ml: number): number {
  return ml < 10 ? 4 * ml : 2 * ml;
}

export interface CalculDevisParams {
  gammeCode: GammeCode | string;
  ml: number;
  complexite?: number; // 1 | 2 | 3
  fraisDeplacement?: number;
}

export interface CalculDevisResult {
  mlArrondi: number;
  gamme: Gamme;
  coefMl: number;
  coefComplexite: number;
  prixVenteHTml: number;       // prix unitaire HT/ml affiché sur devis
  totalMatiereVente: number;   // prix vente matière total (hors déplacement)
  fraisDeplacement: number;
  prixVente: number;           // total TTC (= HT pour CoverSwap, 293B)
  coutMatiereTTC: number;      // coût matière réel (avec TVA payée)
  supplementCoverStyl: number; // supplément fournisseur <10/>10ml
  margeNette: number;          // prixVente - coutMatiereTTC - supplement
  margePct: number;            // marge nette / prixVente
  acompte30: number;
  solde70: number;
}

export function calculerDevis({
  gammeCode,
  ml,
  complexite = 1,
  fraisDeplacement = 0,
}: CalculDevisParams): CalculDevisResult {
  const mlArrondi = Math.max(1, Math.ceil(ml));
  const gamme = getGamme(gammeCode);
  const cMl = coefML(mlArrondi);
  const cCx = coefComplexite(complexite);

  // Prix de vente HT/ml = base × coef ml × ratio gamme × coef complexité
  const prixVenteHTml = BASE_ESSENTIAL * cMl * gamme.ratioVente * cCx;

  const totalMatiereVente = prixVenteHTml * mlArrondi;
  const prixVente = totalMatiereVente + fraisDeplacement;

  // Coût matière réel (TVA 20% absorbée par CoverSwap en franchise 293B)
  const coutMatiereTTC = gamme.prixMatiereHT * 1.20 * mlArrondi;
  const supplement = supplementCoverStyl(mlArrondi);

  const margeNette = prixVente - coutMatiereTTC - supplement - fraisDeplacement;
  const margePct = prixVente > 0 ? margeNette / prixVente : 0;

  const r = (n: number) => Math.round(n * 100) / 100;

  return {
    mlArrondi,
    gamme,
    coefMl: cMl,
    coefComplexite: cCx,
    prixVenteHTml: r(prixVenteHTml),
    totalMatiereVente: r(totalMatiereVente),
    fraisDeplacement: r(fraisDeplacement),
    prixVente: r(prixVente),
    coutMatiereTTC: r(coutMatiereTTC),
    supplementCoverStyl: r(supplement),
    margeNette: r(margeNette),
    margePct: Math.round(margePct * 1000) / 10,
    acompte30: r(prixVente * 0.30),
    solde70: r(prixVente * 0.70),
  };
}

// ============================================================================
// LIGNES ADDITIONNELLES (mode devis complet)
// ============================================================================

export type LigneAdditionnelleType =
  | "MAIN_OEUVRE_EXTRA"
  | "DEPLACEMENT"
  | "FOURNITURES"
  | "DEMONTAGE_REMONTAGE"
  | "REMISE"
  | "LIBRE";

export interface LigneAdditionnelle {
  id: string;
  type: LigneAdditionnelleType;
  designation: string;
  quantite: number;
  prixUnitaire: number; // négatif pour remise
  total: number;
}

export function totalLignesAdditionnelles(lignes: LigneAdditionnelle[]): number {
  return lignes.reduce((sum, l) => sum + l.total, 0);
}

export function totalDevisComplet(
  calcul: CalculDevisResult,
  lignes: LigneAdditionnelle[]
): { totalTTC: number; acompte30: number; solde70: number } {
  const totalTTC = calcul.prixVente + totalLignesAdditionnelles(lignes);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    totalTTC: r(totalTTC),
    acompte30: r(totalTTC * 0.30),
    solde70: r(totalTTC * 0.70),
  };
}
