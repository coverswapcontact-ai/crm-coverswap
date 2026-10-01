// Série 2 (01/10/2026, liste scripts/photos-serie-2.json, avec --liste) : essais par entrée, échantillons (vignettes
// réelles jointes après la source, dans l'ordre ; --catalogue, --vignettes), sortie ~/coverswap-photos/serie-2/<sous-série>/,
// coûts notés serie-2 / serie-2-edition dans GenerationImage, plafond de la série (20 $) compté à part.
//
// Les photos du site coverswap.fr — mission 19 : refaites avec GPT Image 2.5 (liste scripts/photos-site-v2.json :
// générations par gpt-image-2.5-flare, éditions par gpt-image-2.5-sunburst, trois essais par image) ; les options de la
// mission 16 (ancienne liste scripts/ambiances.json, --rendu) restent. Lancé à la main par l'orchestrateur — jamais par
// l'application ni par les tests (hors --essai) :
//
//   node --import tsx scripts/generer-ambiances.ts --estimer --phase 1          (plan et coût prévu, rien d'autre)
//   node --import tsx scripts/generer-ambiances.ts --phase 1                    (les générations : <nom>-1/-2/-3.png)
//   node --import tsx scripts/generer-ambiances.ts --planches --phase 1         (planches de choix, aucun appel payant)
//   node --import tsx scripts/generer-ambiances.ts --estimer --phase 2 --choix ouverture-cuisine-apres=2,...
//   node --import tsx scripts/generer-ambiances.ts --phase 2 --choix ouverture-cuisine-apres=2,etude-salle-de-bain-apres=1,\
//     etude-meubles-apres=3,meubles-dressing-apres=1,pro-restaurant-apres=2        (les éditions, depuis l'essai choisi)
//   node --import tsx scripts/generer-ambiances.ts --planches --phase 2 --choix ouverture-cuisine-apres=2,...
//                                          (planches des éditions, source en premier, + <nom>-contours.jpg et écarts)
//   node --import tsx scripts/generer-ambiances.ts --phase 2 --choix ouverture-cuisine-avant=1 --seulement etape-photo
//                                          (etape-photo s'édite depuis un « avant » : le choisir après sa planche)
//
// Options :
//   --phase 1|2            obligatoire avec la liste v2 : 1 = générations (sans source), 2 = éditions (« avant » d'abord,
//                          puis les éditions d'une édition) ;
//   --choix nom=n,…        l'essai retenu de chaque SOURCE ; une édition dont la source n'est pas choisie n'est pas lancée ;
//   --essais N             essais par image (défaut : essais_par_image de la liste, 3) ;
//   --qualite q            low | medium | high | xhigh | max (défaut high) ;
//   --plafond D            dépense maximale du lancement en dollars (défaut 30) : avant chaque appel, dépensé + estimation
//                          de l'appel > plafond → arrêt net ;
//   --planches             planches JPEG dans <sortie>/planches (essais numérotés 1-2-3, damier pour les pictos
//                          transparents ; pour une paire avant/après, <nom>-contours.jpg et un écart par essai, plus
//                          petit = mieux) — sans clé, sans appel ;
//   --fidelite-haute       envoie input_fidelity=high aux éditions (non documenté pour 2.5 ; un 400 → refait sans) ;
//   --estimer              le plan et le coût prévu (avec ses hypothèses), ni appel, ni fichier, ni ligne ;
//   --liste <fichier>      défaut scripts/photos-site-v2.json (l'ancienne scripts/ambiances.json reste lisible) ;
//   --sortie <dossier>     défaut ~/coverswap-photos (hors dépôt) ; une image déjà présente n'est jamais refaite ;
//   --seulement a,b / --sauf a,b ; --max N (simple limite d'appels) ; --essai (images unies, aucune requête OpenAI) ;
//   --rendu <photo> --piece <pièce> --zones zone:REF,…  (mission 16 : un rendu du moteur V2).
// Modèles : OPENAI_IMAGE_MODEL_GENERATION (défaut gpt-image-2.5-flare) et OPENAI_IMAGE_MODEL_EDITION (défaut
// gpt-image-2.5-sunburst), pour ce script seulement. À lancer depuis la racine du CRM. Clé : OPENAI_API_KEY de
// l'environnement (jamais affichée). Coûts comptés dans GenerationImage (origine CRM, phase `ambiance` en génération,
// `ambiance-edition` en édition ; `rendu`, `analyse`, `controle` pour --rendu) de la base de DATABASE_URL — `--essai`
// y écrit aussi ses lignes (modèle `essai`, 0 $) : l'essayer sur une base locale, jamais sur celle de la prod.
// Le coût RÉEL : la dernière ligne, « Coût réel relu dans GenerationImage … », par phase (c'est le chiffre du rapport ;
// l'outil MCP `depenses` lit les dépenses de chantier, pas ces lignes). Lancé sur le poste, DATABASE_URL est la base
// locale : les lignes n'y sont que là, et le compteur de crédit de la prod ne les voit pas — noter ensuite le solde
// relevé chez OpenAI (Paramètres → Crédit OpenAI) pour qu'il reparte juste.
// Logique et tests : src/lib/simulations/ambiances.ts, src/lib/simulations/planches.ts,
// src/lib/base/mission-19-photos.test.ts, src/lib/base/mission-16-partie-2.test.ts.
import { executerAmbiances } from "../src/lib/simulations/ambiances";
import prisma from "../src/lib/prisma";

executerAmbiances(process.argv.slice(2))
  .then((bilan) => {
    if (bilan.echecs.length > 0 || bilan.plafondAtteint) process.exitCode = 1;
  })
  .catch((erreur) => {
    console.error("[ambiances]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
