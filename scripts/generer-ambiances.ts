// Mission 16 (partie 2) : les images d'ambiance du site coverswap.fr (≤ 12) et le rendu « après » de son ouverture.
// Lancé UNE fois, à la main, par l'orchestrateur — jamais par l'application ni par les tests (hors --essai) :
//
//   node --import tsx scripts/generer-ambiances.ts --estimer                        (plan et coût, rien d'autre)
//   node --import tsx scripts/generer-ambiances.ts --sortie <dossier>                (les ambiances hors réserve)
//   node --import tsx scripts/generer-ambiances.ts --sortie <dossier> --seulement ouverture-salle-de-bain-avant
//   node --import tsx scripts/generer-ambiances.ts --sortie <dossier> --rendu <dossier>/ouverture-cuisine-avant.png \
//     --piece cuisine --zones meubles-hauts:K1,meubles-bas:K1,plan-de-travail:MK15
//
// Options : --liste <ambiances.json> (défaut scripts/ambiances.json), --max N (1 à 12, défaut 12), --seulement a,b,
// --sauf a,b, --essai (images unies, aucune requête vers OpenAI). À lancer depuis la racine du CRM. Clé :
// OPENAI_API_KEY de l'environnement (jamais affichée). Coûts comptés dans GenerationImage (origine CRM, phase
// `ambiance` ; `rendu`, `analyse`, `controle` pour --rendu) de la base de DATABASE_URL — `--essai` y écrit aussi ses
// lignes (modèle `essai`, 0 $) : l'essayer sur une base locale, jamais sur celle de la prod. Une image déjà présente
// dans la sortie n'est pas refaite ; un rendu déjà écrit n'est jamais écrasé (`-apres-2`…).
// Le coût RÉEL : la dernière ligne, « Coût réel relu dans GenerationImage … », par phase (c'est le chiffre du rapport ;
// l'outil MCP `depenses` lit les dépenses de chantier, pas ces lignes). Lancé sur le poste, DATABASE_URL est la base
// locale : les lignes n'y sont que là, et le compteur de crédit de la prod ne les voit pas — noter ensuite le solde
// relevé chez OpenAI (Paramètres → Crédit OpenAI) pour qu'il reparte juste.
// Logique et tests : src/lib/simulations/ambiances.ts, src/lib/base/mission-16-partie-2.test.ts.
import { executerAmbiances } from "../src/lib/simulations/ambiances";
import prisma from "../src/lib/prisma";

executerAmbiances(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.echecs.length > 0) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[ambiances]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
