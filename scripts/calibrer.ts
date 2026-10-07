// Mission 23 (L4a) — la campagne de calibrage des teintes du simulateur, rejouable : les 25 cas figés hors du dépôt
// (~/coverswap-photos/calibrage/banc/cas.json), moteur V2, modèle gpt-image-2.5-sunburst passé explicitement, chaque
// appel noté dans GenerationImage (phase calibrage-23), plafond relu avant chaque appel (4,50 $ au plus). Lancé à la
// main, jamais par l'application ; ne change aucun réglage.
//
//   npm run simulateur:calibrer -- --phase P1 --estimer                (rien n'est appelé : le plan et le coût annoncé)
//   CALIBRAGE_23_PAYANT=1 npm run simulateur:calibrer -- --phase P1   (les rendus, la note et le bilan)
//   npm run simulateur:calibrer -- --bilan P1                          (le tableau, depuis les résultats écrits)
//   npm run simulateur:calibrer -- --aveugle P3 [--corrige]            (planches mélangées A, B, C… et cle.json à part)
//
// Options : --plafond D (≤ 4,50) ; --modele M (gpt-image-1 refusé) ; --variantes a,b (P3) ; --variante v (P4) ;
// --cas c01,c02 ; --dossier <calibrage> (défaut ~/coverswap-photos/calibrage, refusé dans le dépôt) ; --uploads <dir>.
// Méthode, garde de l'essai local et façon de rejouer : docs/CALIBRAGE-SIMULATEUR.md. Logique et tests :
// src/lib/simulateur/banc/calibrage.ts, calibrage.test.ts.
import { executerCalibrage } from "../src/lib/simulateur/banc/calibrage";
import prisma from "../src/lib/prisma";

executerCalibrage(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.arret || bilan.echecs > 0) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[calibrer]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
