// Mission 23 (L3) — correction des teintes sur un jeu d'essai du simulateur (le zip exporté de Paramètres › Simulateur,
// dézippé hors du dépôt, par exemple dans ~/coverswap-photos/calibrage/jeu/) : pour chaque simulation, la correction
// de `correction-teintes.ts` (recalage médian en Lab sous l'éclairage de la scène), puis les chiffres avant / après par
// partie (70 % réglage, 30 % validation, par le hash de l'id). Aucun appel réseau, aucune base. Lancé à la main :
//
//   npm run simulateur:corriger-jeu -- <jeu> [<autre jeu>…] [--planches] [--difficiles id,id] [--amplitude-l 0.5]
//                                       [--partie reglage|validation|tout] [--cas id,id] [--sortie corrections.json]
//
// Sorties à côté du premier jeu (refusées dans le dépôt) : corrections.json, planches-correction/, planche-difficiles.jpg.
// Logique et tests : src/lib/simulations/correction-jeu.ts, correction-teintes.ts.
import { executerCorrectionJeu } from "../src/lib/simulations/correction-jeu";

executerCorrectionJeu(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.erreurs > 0) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[corriger-jeu]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  });
