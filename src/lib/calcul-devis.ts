// Formule CoverSwap: (Prix HT × 1.20) + supplément TTC + 100€/ml + frais déplacement
// prixHT = prix total matière HT (prix unitaire × ml)
// Le supplément: <10ml: +4.80€/ml | ≥10ml: +2.40€/ml
export function calculerDevis(prixHTUnitaire: number, ml: number, fraisDeplacement = 0) {
  const mlArrondi = Math.ceil(ml);
  const prixMatiere = prixHTUnitaire * 1.20 * mlArrondi; // Coût matière TTC total
  const supplement = mlArrondi < 10 ? 4.80 * mlArrondi : 2.40 * mlArrondi;
  const prixVente = prixMatiere + supplement + (100 * mlArrondi) + fraisDeplacement;
  const margeNette = prixVente - prixMatiere;
  const acompte30 = Math.round(prixVente * 0.30 * 100) / 100;
  const solde70 = Math.round(prixVente * 0.70 * 100) / 100;
  return {
    mlArrondi,
    prixMatiere: Math.round(prixMatiere * 100) / 100,
    prixVente: Math.round(prixVente * 100) / 100,
    margeNette: Math.round(margeNette * 100) / 100,
    acompte30,
    solde70,
  };
}
