// Les teintes fidèles des photos du site — mission 19, complément du 01/10/2026. Mesure chaque surface des photos
// choisies (scripts/teintes-site-v2.json) contre le hex de sa référence du catalogue du site (ΔE 2000, après balance
// des blancs sur un blanc de la scène) ; au-dessus du seuil (12), recalage par édition (gpt-image-2.5-sunburst, la
// photo + la vignette réelle de la référence), 3 essais. Lancé à la main par l'orchestrateur, jamais par l'application :
//
//   node --import tsx scripts/teintes-ambiances.ts --choix ~/coverswap-photos/choix-1.txt            (mesure + planche, gratuit)
//   node --import tsx scripts/teintes-ambiances.ts --choix ~/coverswap-photos/choix-1.txt --estimer  (+ coût du recalage)
//   node --import tsx scripts/teintes-ambiances.ts --choix ~/coverswap-photos/choix-1.txt --recaler  (les éditions)
//
// Options : --choix <fichier ou nom=n,…> (obligatoire) ; --recaler ; --estimer ; --essais N ; --qualite q ; --seuil ΔE ;
// --plafond D (30 $ pour toute la mission : déjà compté dans GenerationImage depuis --depuis + chaque appel) ;
// --depuis <ISO> (défaut : début de la mission 19) ; --seulement a,b ; --liste ; --catalogue (défaut
// ../coverswap/src/data/revetements.json) ; --sortie (défaut ~/coverswap-photos) ; --essai (aucune requête OpenAI).
// Sorties : <sortie>/teintes/<nom>-teinte-<k>.png, <sortie>/teintes/mesures.json, <sortie>/planches/teintes.jpg,
// <sortie>/vignettes/<id>.jpg. Clé OPENAI_API_KEY de l'environnement, jamais affichée ; coûts dans GenerationImage
// (phase ambiance-edition) de la base de DATABASE_URL. Logique et tests : src/lib/simulations/teintes.ts,
// src/lib/base/mission-19-teintes.test.ts.
import { executerTeintes } from "../src/lib/simulations/teintes";
import prisma from "../src/lib/prisma";

executerTeintes(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.echecs.length > 0 || bilan.plafondAtteint) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[teintes]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
