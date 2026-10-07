// Mission 23 (L2a) — mesure automatique d'un jeu d'essai du simulateur (le zip exporté de Paramètres › Simulateur,
// dézippé hors du dépôt, par exemple dans ~/coverswap-photos/calibrage/jeu/) : pour chaque simulation, le masque de la
// surface changée, le ΔE 2000 par surface contre le hex du catalogue (après balance des blancs sur un blanc de la
// scène), la dérive en L, a, b et C*, la texture et le respect de la pièce ; puis l'analyse par famille de teinte.
// Aucun appel réseau, aucune base. Lancé à la main :
//
//   npm run simulateur:mesurer-jeu -- <dossier-du-jeu-dezippe> [--sortie mesures.json] [--planches]
//
// Options : --sortie (défaut : mesures.json à côté du dossier du jeu ; refusée dans le dépôt) ; --planches (une
// planche par cas dans planches/ à côté de la sortie) ; --catalogue (défaut ../coverswap/src/data/revetements.json) ;
// --seuil ΔE76 du masque (défaut 7). Logique et tests : src/lib/simulations/mesure-rendu.ts, mesure-jeu.ts.
import { executerMesureJeu } from "../src/lib/simulations/mesure-jeu";

executerMesureJeu(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.erreurs > 0) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[mesurer-jeu]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  });
