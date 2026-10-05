# Reprise locale — à fusionner dans REPRISE-MISSION après la mission 17

## Mission 19 : les photos du site, refaites avec GPT Image 2.5 (30/09/2026)

Énoncé : 30 images (`scripts/photos-site-v2.json`, prompts de la direction artistique, non réécrits), direction
artistique copiée dans `coverswap/docs/direction-artistique-photos.md`. Travail en parallèle de la mission 17 (cloud) :
aucun fichier de sa branche touché.

**Script** (`scripts/generer-ambiances.ts`, `src/lib/simulations/{ambiances,generation,planches,prix}.ts`)
- Modèles vérifiés par `GET /v1/models` : `gpt-image-2.5-flare` (génération), `gpt-image-2.5-sunburst` (édition),
  réglables par `OPENAI_IMAGE_MODEL_GENERATION` / `OPENAI_IMAGE_MODEL_EDITION`. Tarifs : texte 5 $, image en entrée 8 $,
  sortie 30 $ par million de jetons.
- Liste v2 : `mode`, `source`, `format` (dont 1024x1536), `fond: "transparent"`, `etiquette`, `essais_par_image`.
  Sorties `<nom>-1.png`, `-2`, `-3` dans `~/coverswap-photos/`, planches dans `~/coverswap-photos/planches/`.
- Options : `--estimer`, `--phase 1|2`, `--choix nom=n`, `--planches`, `--plafond` (30 $ par défaut),
  `--fidelite-haute` (`input_fidelity: high`, non documenté pour 2.5 : repli sans si l'API refuse).
- Coûts comptés dans GenerationImage de la base locale ; un essai déjà sur disque n'est pas refait.
- L'estimation interne surestime (0,19 $ prévu, 0,04 $ réel pour une image 1536×1024 en qualité high).

**Phase 1** (24 générations × 3 essais = 72 images) : coût réel lu dans GenerationImage **3,57 $** (base d'essai, pas
la production). Pictos : coins à alpha 0, 60 à 80 % de pixels transparents sur les 27 essais.

**Choix 1** : reçu le 01/10 (voir le complément ci-dessous).

**Reste** : phase 2 (5 « avant » + `etape-photo`, 3 essais, planches avec contours superposés) → choix 2 → intégration
dans le site → Lighthouse avant/après → tests, lint, build, captures → commit et push des deux dépôts.

### Complément du 01/10/2026 (choix 1, teintes fidèles, étiquettes matière, Inspirations)

Choix 1 de Lucas (dans `~/coverswap-photos/choix-1.txt`) : mes recommandations, sauf pro-commerce=2, pro-bureaux=1,
picto-mobilier=1.

Phases, dans l'ordre (chaque ARRÊT attend Lucas) :
1. **Teintes fidèles** (avant la phase 2) : pour chaque surface des 15 photos, couleur médiane d'une zone bien
   éclairée après balance des blancs sur un blanc de la scène, ΔE 2000 contre le hex du catalogue
   (`coverswap/src/data/revetements.json`). Au-dessus de 12 : recalage par édition (sunburst, la photo + la vignette
   réelle du champ `image`), 3 essais ; sinon proposer la référence la plus proche de la même famille. Planche de
   teintes → ARRÊT.
2. **Phase 2** (les « avant ») à partir des « après » recalés → choix 2 → ARRÊT.
3. **Étiquettes matière** : couche HTML, une seule source `coverswap/src/data/ambiances.ts` (surfaces, référence, zone
   du simulateur, ancre x/y en %), alt tirés de là ; grandes photos = point 8 px + trait 1 px + étiquette (vignette
   ronde, « Sage Green · RM20 » en petites capitales), 3 au plus, dans les vides, en fondu ; cartes piece-* = pastilles
   qui se chevauchent, noms au survol ; téléphone = points numérotés + légende ; avant/après : côté après seulement ;
   clic = la matière ; « Essayer cette composition chez moi » = simulateur avec les références par zone (étendre
   `src/lib/simulateur/matiere-demandee.ts` à plusieurs zones) ; « Ambiance » + « teintes réelles du catalogue ».
4. **Inspirations** : page `/inspirations` filtrable par pièce et teinte (composition + lien simulateur), rangée sur
   l'accueil, « Vue dans » sur chaque matière de `/matieres`, plan du site + pied de page.
5. Planche des photos étiquetées à 1 440 et 390 px → ARRÊT. Puis seulement l'intégration du § 3 de la mission 19.

**Teintes fidèles — outil** (`scripts/teintes-ambiances.ts`, `src/lib/simulations/teintes.ts`, liste
`scripts/teintes-site-v2.json`, tests `src/lib/base/mission-19-teintes.test.ts`) :
- Méthode retenue après trois essais de mesure : le blanc de la scène est le quart le plus lumineux d'une zone sur un
  objet vraiment blanc et éclairé (cadre de fenêtre, vasque, linge…), ramené à #F2F2F2 (dominante ET exposition).
  Ne corriger que la dominante laissait toute teinte claire photographiée « trop sombre » (mur blanc à ΔE 17) ;
  ramener un blanc à l'ombre au blanc pur éclaircissait tout et masquait les écarts réels (chêne AG13 « fidèle »).
  `piece-pro` n'a pas de vrai blanc (mur crème) : `exposition: false`, dominante seulement.
- `forcer` : NH12 de l'étude meubles est recalée à la demande (ΔE mesuré 9,8, sous le seuil, mais relevé de Lucas).
- `gpt-image-2.5-sunburst` refuse `input_fidelity` (HTTP 400, non facturé) : l'appel est refait sans ; l'édition
  reçoit la photo puis une vignette (512 px) par surface à recaler.
- Recalage : 10 images × 3 essais, environ 0,06 $ l'édition. Sorties dans `~/coverswap-photos/teintes/`, planche
  `~/coverswap-photos/planches/teintes.jpg`.
- La phase 2 partira des « après » recalés : il faudra passer l'essai recalé retenu comme source (non encore câblé dans
  `generer-ambiances.ts`, qui lit `<nom>-<n>.png`).
- Fait le 01/10 : 30 éditions, 1,96 $ (mission 19 à 5,53 $ au total, base d'essai). Relevé et recommandations dans
  `~/coverswap-photos/planches/teintes-recommandations.md`. ARRÊT : en attente des choix de Lucas (essai recalé par
  image, sort de piece-meubles). Références choisies par la mesure : piece-cuisine plan et joue = AA14 Original Oak,
  pro-commerce façades blanches = NH27 White Fog.

### Choix des teintes (01/10/2026)

Lucas garde les photos d'origine (plus chaudes) et change les ÉTIQUETTES : pour chaque surface au-dessus du seuil, la
référence la plus proche de la même famille dont la vignette colle aussi en texture (grain, veinage, mat). Seule
exception : etape-pose prend l'essai recalé 2 (`"fichier": "teintes/etape-pose-teinte-2.png"`). Choix bruts dans
`~/coverswap-photos/choix-teintes.txt`, planche des candidats dans `~/coverswap-photos/planches/candidats-texture.jpg`.
Table de composition à jour dans `scripts/teintes-site-v2.json` (`prevue` = la référence de la direction artistique) :
I14 Legno (ouverture, hauts), K4 Khaki (étude SdB, tiroirs), NH12 (étude meubles, façades : W7 Red Brick est un motif
de briques), AA17 Beige Line Oak (étude meubles, dessus), B4 Weathered Oak (piece-salle-de-bain, tiroirs : AF05 est en
lames de teintes inégales), NH24 Deep Ocean (piece-meubles, portes), RM29 Onyx (piece-pro, dessus), NE55 Caffe Latte
(hôtel, placards), NE68 Freijo Laurel (boutique, bois), AL26 Beige Brown Ash (bureaux, bois), AA14 Original Oak
(piece-cuisine, plan et joue), NH27 White Fog (boutique, façades blanches). Toutes les surfaces sont désormais
≤ 12. Planche `~/coverswap-photos/planches/compositions.jpg`. À reporter dans `coverswap/src/data/ambiances.ts`
et en note de la direction artistique (sans toucher aux prompts).

Phase 2 lancée le 01/10 depuis les originaux. etape-photo part de l'« avant » de l'ouverture que je recommande ; si
Lucas en choisit un autre, il faut la refaire (≈ 0,15 $).

**Phase 2 faite le 01/10** : 15 « avant » + 3 etape-photo (depuis ouverture-cuisine-avant-1), 0,98 $ ; mission à
6,51 $. Contrôle : contours + fondu 50/50, rien n'a bougé. Recos : ouverture-avant 1, étude SdB 1, étude meubles 1,
dressing 1, restaurant 2, etape-photo 2. Envoi : `~/coverswap-photos/planches/choix-2-recommandations.md` + planches
+ `compositions.jpg`. ARRÊT : en attente du choix 2. Ensuite : étiquettes matière + /inspirations (§ 3-4 du
complément), planche des photos étiquetées 1 440 / 390 → ARRÊT → intégration.

### Étiquettes matière et Inspirations (01/10/2026, site, non commité)

Choix 2 de Lucas : `~/coverswap-photos/choix-2.txt` (mes recommandations) ; piece-meubles étiqueté RM23 Royal Blue.
- Photos retenues copiées en JPEG q90 dans `coverswap/public/images/sources/` (nouveaux emplacements :
  etude-salle-de-bain-avant/apres, etude-meubles-avant/apres, meubles-dressing-avant, pro-restaurant-avant ;
  meubles-armoire = l'après du dressing, pro-restaurant = l'après du bar), `npm run images` fait (23 images).
- Source unique `coverswap/src/data/ambiances.ts` (15 ambiances, 29 surfaces : référence, nom vérifié contre le
  catalogue, `prevue`, zone du simulateur, ancre et étiquette en %) ; `src/lib/ambiances.ts` (alt, lien de
  composition, teintes, « Vue dans ») ; composants `src/components/ambiances/` (CalqueMatieres, LegendeMatieres,
  PhotoAmbiance, PastillesMatieres) ; `AvantApres` prend `matieres` (étiquette visible si son point est à droite du
  curseur) ; `Photo` prend `calque`.
- `?ref=zone:REF,…` (composition) lu par `lib/simulateur/matiere-demandee.ts` et posé par `useMatiereDemandee` ;
  `Simulateur.tsx` et `tunnel.test.ts` (branche de la mission 17) non touchés, comportement de `?ref=K1` inchangé.
- /inspirations : 14 ambiances, filtres pièce × teinte SANS JavaScript (radios + règles `:has()` générées) — parce que
  `src/lib/perf.test.ts` (mission 17) tient une liste blanche des composants client et un `globals.css` ≤ 200 lignes.
- Accueil : ouverture étiquetée « Ambiance » (plus « Simulation »), étiquettes côté après, légende après le bouton sur
  téléphone ; rangée « Inspirations » (9e section) ; pastilles sur les cartes de pièces ; /matieres : « Vue dans » ;
  pied de page + sitemap. Tests site 259/259, tsc, eslint propres.
- Planches : `~/coverswap-photos/planches/planche-etiquettes-1440.jpg` et `-390.jpg`. ARRÊT : Lucas les montre.
- Captures locales : config `coverswap-planche` ajoutée à `Code coverswap/.claude/launch.json` (port 3005,
  `NEXT_PUBLIC_SIMULATE_URL` = CRM de prod pour les vignettes) ; scripts `scratchpad/m19/capturer.mjs`, `elements.mjs`
  (Playwright avec Edge : pas de Chromium Playwright installé).
- Reste après l'arrêt (intégration § 3 de la mission 19) : études de l'accueil en paires avec étiquettes (ancres côté
  droit à revoir pour le curseur), paire du restaurant sur /pro + hôtel/commerce/bureaux étiquetés, dressing sur
  Prestations › Meubles, pictos à la place de DessinFamille/PlanCuisine, alt restants, Lighthouse, retrait des images
  inutilisées (ouverture-provisoire ?), captures 390/1440, commit + push des deux dépôts.

### Fin de l'intégration de la mission 19 (01/10/2026)

Lucas a validé la planche des étiquettes (titres descriptifs, Statuary White ramené sur la crédence). Intégration faite et
poussée : site 522889a, 7deb2a9, 6c11dee ; CRM 5ab25e9.
- Études de l'accueil en paires avant / après étiquetées ; /pro : la paire du bar (« Ambiance · avant / après ») puis
  l'hôtel, la boutique et les bureaux, sans lien vers le simulateur (le test /pro de la mission 17 l'interdit et compte
  trois « Ambiance ») ; Prestations › Meubles : le dressing ; ouverture des pages par pièce étiquetée.
- Pictos : `public/images/pictos/` (`npm run pictos`, AVIF + WebP 128 / 256 px), `DessinFamille` et `PlanCuisine` à
  64 px au moins ; dans l'estimation du simulateur, `enSvg` (un test de la mission 17 compte des `<svg>`).
- Retirée : `ouverture-provisoire` (plus référencée). Les fonds du blog et des prestations servent tous.
- Lighthouse mobile en production (meilleur de 3 passages ; les passages suivants varient de 10 à 20 points sur ce poste,
  y compris sur des pages non touchées) : accueil 90 / 100 / 100 / 100, LCP 3,1 s (mission 16 : 93, 2,8 s) ; simulateur
  93 (94) ; matières 96 (97) ; réalisations 90 (97) ; comment ça marche 95 (96) ; pro 94 (98) ; inspirations 91, LCP 2,3 s ;
  prestations/meubles 95. CLS 0 partout. Corrigés en route : cibles tactiles de la légende (accessibilité 97 → 100),
  premières photos de /inspirations différées (LCP 4,8 s → 2,3 s).
- Coût de la mission 19 relu dans GenerationImage : 6,51 $ (base d'essai, pas la production).
- Pièges : CRLF de la copie de travail après un rebase (les tests qui lisent le source échouent localement, pas en CI) ;
  `perf.test.ts` et `tunnel.test.ts` appartiennent à la mission 17.

## Photos, série 2 : des intérieurs comme chez les gens (01/10/2026)

Énoncé : `~/coverswap-photos/serie-2/prompt-photos-serie-2.md` ; liste `scripts/photos-serie-2.json` (122 images, 256
essais, prompts non réécrits) ; direction artistique copiée dans `coverswap/docs/direction-artistique-serie-2.md`.
Bibliothèque seulement : rien ne va sur le site.

- Script : celui de la mission 19, plus `essais` par entrée, `echantillons` (vignettes réelles jointes après la source,
  `src/lib/simulations/vignettes.ts`), sortie `~/coverswap-photos/serie-2/<sous-série>/`, phases `serie-2` /
  `serie-2-edition` et plafond de la série (20 $) compté à part (`depenseDeLaSerie`). Tests :
  `src/lib/base/mission-19-serie-2.test.ts`.
- Estimation recalée sur le coût réel de la mission 19 (1 372 jetons de sortie en 1536x1024 high, 1 756 en 1024x1024 ;
  source 1 536 jetons, 1 024 par échantillon) : l'ancienne grille (gpt-image-1) surestimait d'environ 4 fois.
- **`--estimer` : 15,03 $** (phase 1 : 124 appels, 5,83 $ ; phase 2 : 132 éditions, 9,20 $), au-dessus du seuil de 12 $
  fixé par l'énoncé : **ARRÊT avant toute génération**, décision de Lucas. Rien n'a été dépensé pour la série 2.
- Pour lancer ensuite (lanceur `scratchpad/m19/lancer.cjs`, clé du site, base d'essai) :
  `--liste scripts/photos-serie-2.json --phase 1`, choix des avants (`--planches --phase 1`), puis `--phase 2 --choix …`.

### Série 2, version 2 : budget strict de 10 $ (01/10/2026)

Liste remplacée par la v2 de Lucas (70 images, 140 essais, champ `priorite`, plafond 10 $) ; direction artistique v2
copiée dans `coverswap/docs/direction-artistique-serie-2.md`. `--priorite N` filtre une priorité.
- `--estimer` : 8,29 $ (≤ 9 $) → lancé sans attendre, dans l'ordre 1 (18 avants × 2 puis 36 après × 2), 2 (6 photos
  utiles + 2 ambiances), 3 (8 pictos). **Coût réel relu dans GenerationImage : 8,10 $ pour 140 appels, aucun échec**
  (serie-2 : 68 générations, 3,07 $ ; serie-2-edition : 72 éditions, 5,03 $). Aucune nouvelle tentative : aucun
  avant raté.
- Bibliothèque : `node --import tsx scripts/bibliotheque-serie-2.ts` (aucun appel payant). Logique dans
  `src/lib/simulations/bibliotheque.ts`, zones et choix à l'œil dans `scripts/zones-serie-2.json`. Sorties :
  `~/coverswap-photos/serie-2/bibliotheque.json` (70 lignes) et `planches/` (une par pièce, `serie-enrichissement`,
  `serie-ambiances`, `serie-pictos` avec les 9 pictos de la série 1 en référence). Les `*-avant.jpg` du même dossier
  sont les planches de choix des avants (`--planches --phase 1`).
- Mesure des teintes : `exposition: false` par défaut (dominance seule) : les blancs de ces scènes (caissons de volet,
  frigos) sont à l'ombre, la normalisation complète surexposait tout. Contrepartie : une surface claire à l'ombre
  lit plus foncée. Exceptions : `amb-cuisine-familiale` et `pose-mains`, où le blanc (frigo, porte) est en pleine
  lumière → `exposition: true` (le plan Statuary White passait sinon pour un gris). Zones déplacées sur des parties
  éclairées : dessus du comptoir pro (le chant à l'ombre faisait réétiqueter le marbre blanc en gris), hauts de la
  cuisine ouverte (la colonne à l'ombre tirait l'olive vers le brun).
- Calage : seuil 15 sur `ecartContours` ; 4 après au-dessus (blanche-jaunie couleur, u-pavillon neutre, portes-couloir
  bois et couleur) vérifiés en fondu à 50 % : rien n'a bougé, l'écart vient du changement de teinte → `calages_vus`.
- Défaut des prompts, signalé sans les réécrire : le style commun des avants demande « a kettle, a tea towel, a fruit
  bowl » → bouilloires en salle de bain, chambre, couloir et accueil pro. Essais choisis pour le limiter.

### Série 2 : retouches après relecture (03/10/2026)

Six retouches demandées par Lucas dans le reste du plafond (1,90 $). Script `scripts/retouches-serie-2.ts`
(logique `src/lib/simulations/retouches.ts`, liste `scripts/retouches-serie-2.json`), relancé sans risque : une
retouche faite a son original dans `~/coverswap-photos/serie-2/originaux/` et n'est pas refaite.
- **Bouilloires** : édition de l'image entière puis recollage de la seule zone (bord adouci) ; garde
  `ecartAutourDeLaZone` > 8 = raccord visible, rien n'est recollé (éditions calées 2-5, ratées 9-83). Corrigées :
  sdb-double-vasque, sdb-baignoire, placard (avant + zone recopiée dans les deux après), pro-comptoir (3 images),
  buffet avant et après couleur. Restent : sdb-petit-meuble-vasque (le modèle enlève aussi la coupe de fruits et
  décale le sèche-serviettes) et buffet après neutre (le torchon bouge, le recollage le couperait).
- **ERREUR, 0,50 à 0,75 $ perdus** : la première version passait un masque SANS passer le modèle → `gpt-image-1`
  (modèle par défaut du simulateur, 6 208 jetons de sortie, 0,25 $ l'appel) ; il a rendu une autre photo. Un appel
  interrompu n'est pas noté dans GenerationImage mais compté en réserve (`--hors-base 0,25`). Garde ajoutée : un
  appel qui coûte plus du double de l'estimation arrête tout. Le masque a été retiré du code (non essayé avec
  gpt-image-2.5-sunburst).
- **Brillance** : les 6 après des cuisines brillantes refaits en essai 3 avec la phrase de finition mate ; essais 1-2
  rejetés à l'œil (`rejets` de `zones-serie-2.json`). Bordeaux neutre : façades blanc cassé mates lues NE56 → K6 Light
  Grey (blanc à l'ombre, mesure sans exposition), même avec des zones éclairées ajoutées.
- **Îlot couleur** : essais 1-2 rejetés (crédence changée) ; essais 3-4 gardent la crédence mais aussi le plan granit
  côté mur (seul le dessus de l'îlot change) → à refaire.
- **Bordeaux couleur, plan** : zones déplacées sur le plan éclairé (l'ancienne mêlait chant et carrelage, écart-type
  67) → AG13 Pale Oak fidèle (ΔE 9,9), plus de Winter Breeze.
- **Plafond atteint** (9,73 $ dans GenerationImage + 0,25 $ hors base) : mesure-visite et picto-plan-parallele non
  lancés (≈ 0,20 $ pour leurs 4 essais), variantes prêtes dans `retouches-serie-2.json`.
- **Complément accordé par Lucas (0,40 $, plafond 10,40 $, `--plafond 10,40`)** : 7 appels, 0,38 $. Bouilloires
  restantes reprises avec une consigne (`ajout` : garder la coupe de fruits et le sèche-serviettes ; garder le
  torchon et la tasse) → les 10 sont corrigées. Îlot couleur essai 5 (« All the worktops change, including the run
  along the wall ») : crédence brune gardée, plan mural changé ; essais 3-4 rejetés. mesure-visite essais 3-4 (porte
  plane), essai 3 retenu ; picto-plan-parallele essais 3-4 (base carrée de la série 1), essai 4 retenu. Les variantes
  faites portent `faite` dans `retouches-serie-2.json` (le script ne les relance pas).
- **Coût final de la série 2 : 10,10 $ dans GenerationImage (167 appels, aucun échec) + 0,25 $ d'appel interrompu
  = 10,35 $** sur 10,40 $.

# Mission 21 (03/10/2026) — la mission 18 d'abord (phase A), puis le site 3.0 « La Revue » (phases B à G)

Énoncé : message de Lucas du 03/10, copie dans `~/coverswap-photos/missions/prompt-mission-21-site-3-0.md` ; maquette
`~/coverswap-photos/missions/maquette-11/`. Travail local sur les deux dépôts, fusion dans `main` et push par l'agent
(pas de PR) ; aucun arrêt ; décisions simples notées ici. Branche `mission-18` (les deux dépôts) fusionnée à la fin
de la phase A, CRM d'abord ; puis branche `site-3-0` (site) fusionnée à la fin de la phase G.

## Phase A, étape 1 : ce qui existait (03/10)

- `git status` : rien hors fins de ligne CRLF (10 fichiers du CRM, 1 du site) et la garde locale `src/proxy.ts`
  (jamais commitée). `git stash list` vide dans les deux dépôts.
- Branches : `main` et la branche cloud `origin/claude/beautiful-goldberg-lu7keb`, **entièrement contenue dans `main`**
  (mission 17 fusionnée ; aucun commit de la branche absent de `main`, dans les deux dépôts).
- REPRISE-MISSION : « Mission 18 — à démarrer » ; aucun commit, aucune note de la mission 18 → **départ de zéro**.
- Base de départ : CRM 1 283 tests verts, site 284 tests verts, lint propre.
- Plan d'implémentation (cartographie par 8 lecteurs + synthèse) : lots A1-A6, B0-B13, mise en route ; décisions
  « solution la plus simple » listées en fin de phase.

### Mission 18, A1 — l'onglet Espaces devient une colonne et un filtre de Dossiers

Livré (03/10, branche `mission-18`, pas de push) :
- **Colonne « Espace »** dans la liste de Dossiers (bureau), une ligne de plus sur le téléphone, une icône teintée
  par le signal sur la carte du kanban (le détail en infobulle) : étape de l'espace, lien envoyé ou dernière visite
  (avec le nombre de visites), photos, simulations, devis relu (ou accord), le signal rouge ou ambre s'il y en a un.
  Calculée par `espace/suivi.ts › espacesDesDossiers` (la même lecture que l'ancien onglet, vue des tâches
  comprise), pour la page seulement ; textes communs dans `espace/colonne-espace.ts` (écran et assistant).
- **Filtre « Espaces »** (bouton dans la barre de Dossiers) : pastilles À moi, Chez le client, Signaux, Tous,
  Désactivés avec leurs compteurs, et l'étape de l'espace. `pageDossiers({ espace, etapeEspace })` calcule TOUS les
  espaces (recherche comprise), filtre et trie en mémoire (à moi d'abord, puis dernière activité), puis découpe la
  page : les compteurs et les signaux sont exacts au-delà de 50 (l'ancien onglet ne filtrait que la page chargée).
  `/api/dossiers?espace=&etapeEspace=`, `/dossiers?espace=` lu par la page et gardé dans l'adresse.
- `/espaces` redirige vers `/dossiers?espace=TOUS` (`next.config.ts`) ; l'écran `src/app/(pilotage)/espaces/` est
  supprimé, l'onglet retiré de la navigation (12 onglets en attendant A3-A6). Gardés : `/api/espaces/*`, `suivi.ts`,
  `suivi-types.ts`, `NouveauLien`, `LienParMail`, le bloc Espace du panneau et le résumé de la fiche client.
- En passant : `/dossiers?archives=1` (lien de l'assistant) ouvre les dossiers archivés.
- Liens : tâche « projet de plus demandé » (et « nouveau projet » sans projet trouvé) → fiche du client, où vit
  « Permettre un projet de plus » ; assistant (`manager_clients`, `lister` ESPACES et MESSAGES_ESPACE,
  `espaces_clients`, `geste_espace` sans dossier) → `/dossiers?espace=TOUS` (constante `ADRESSE_ESPACES`).
- MCP : `lister` DOSSIERS gagne `filtres.espace` et `filtres.etape_espace` (imbriqués : empreinte inchangée,
  `040d6c7aa53c`, 53 outils) et l'état de l'espace sur chaque ligne ; `lister` ESPACES (par client) est gardé pour
  l'assistant. `docs/MCP-COUVERTURE.md` : E1–E4 en 2.3, E5–E20 renvoyés vers le panneau et la fiche client (2.5),
  C27–C30 ajoutés (boutons du lien de la fiche client), N1, N3, bilan (427 actions, 391 couvertes, 36 sans objet).

Décisions prises seul (solution la plus simple) :
- Dates de la colonne = celles du PROJET (`EspaceClient`) ; « Désactivé » = lien du client révoqué ; les signaux du
  client (projet de plus demandé, nouveau projet, téléphone à confirmer) et « à moi : accorder un projet de plus »
  vont à son projet le plus récent.
- Sous le filtre « Espaces », la vue (« Tous / À faire »), « Perdus et en pause » et les inactifs ne jouent plus
  (masqués) : tous les dossiers qui ont un espace, perdus, en pause et terminés compris, comme l'ancien onglet. Les
  compteurs des pastilles suivent la recherche et l'étape choisies. Le tri de l'ancien onglet (activité, lien récent)
  n'est pas repris : l'ordre du serveur (à moi d'abord) découpe les pages, le tri local de la liste s'applique dessus.
- Redirection en 307 (`permanent: false`) comme toutes les anciennes adresses : le test « rien de figé dans le
  navigateur » l'exige, et une 308 resterait en cache si l'adresse devait encore changer en A6.
- `public/sw.js` non touché : les écrans sont servis réseau d'abord ; le changement de `VERSION` est prévu en A6.

Tests : 1 283 → 1 294 verts (nouveau `src/lib/dossiers/espaces-colonne.test.ts` : colonne, signaux du client,
filtre exact sur 56 espaces, ordre, vue par défaut inchangée, route, règles pures, redirection, aucun lien vers
`/espaces` dans le code ; jumeau MCP dans `mcp-lister-etat.test.ts` ; lien de `manager_clients` dans
`mcp-analytique.test.ts`). Aucun test existant à adapter. `tsc`, `eslint` sur les fichiers touchés, `npm run build` :
propres. Vérifié à l'œil sur une base d'essai jetable (port 3007) : redirection, colonne, pastilles, téléphone.

Reste : mettre à jour `docs/ARCHITECTURE-PILOTAGE.md` (§4, §21 : navigation) et `docs/COHERENCE.md` (tableau §1)
avec la navigation finale en A6 ; reconnecter le connecteur MCP après la mise en ligne (descriptions de `lister` et
`geste_espace` changées).

### Mission 18, A2 — le dossier s'ouvre tout seul (photos, simulation, demande de devis)

Livré (03/10, branche `mission-18`, pas de push) :
- **`dossiers/depuis-lead.ts › ouvrirDossierAutomatique(leadId, { demande })`** (remplace `assurerDossierDeSimulation`) :
  un contact qui envoie des photos, fait une simulation ou demande un devis sur le site a son dossier ouvert tout
  seul, en Qualification, avec « Appeler : simulation faite sur le site » ou « Appeler : demande de devis » pour
  aujourd'hui (« Rappeler » à l'heure demandée s'il a demandé un rappel), la note de reprise du bouton, ses images et
  ses photos rangées. S'il a déjà un dossier vivant (le sien ou celui de son client), tout y est rangé — photos de
  toute source désormais, plus seulement celles du simulateur. Appelée par le webhook du site (simulation, photos, ou
  `estDemandeDeDevis` : /devis, /pro, /contact avec un projet), par la fin d'une simulation du site
  (`simulations/travaux.ts`), par la correction de cohérence `SIMULATIONS_HORS_DOSSIER` et par le filet de 15 min.
  Aucun mail ni SMS de plus (seul l'accusé de réception habituel d'un nouveau contact).
- **Webhook** : l'ouverture passe avant le tunnel du simulateur (comme le rangement d'avant) ; `contactNeuf` est lu
  AVANT elle et passé à `ouvrirEspaceALEnvoi({ neuf })`, sinon le lien de l'espace ne s'afficherait plus au contact
  neuf (le dossier qu'on vient d'ouvrir le rendait « connu »). Le lien « Voir dans le CRM » du mail et du push mène au
  dossier.
- **Filet** `rattraperSimulationsSansDossier` (libellé de la tâche de fond mis à jour) : en plus du rangement dans le
  dossier vivant, il ouvre le dossier d'un contact qui n'en a JAMAIS eu (archivés compris : un dossier archivé par
  Lucas ne se rouvre pas seul), dont le client n'en a pas de vivant, ni perdu, ni après devis, ni hors zone, avec un
  fait du site de moins de deux jours et postérieur à `DEBUT_OUVERTURE_AUTO` (03/10/2026 0 h, Paris).
- **Tâches** : « Appeler · Nom » (type RAPPELER, niveau 2, raison « demande de devis, prévu le jj/mm ») sur le dossier
  remplace « Appeler » du lead (détecteur DOSSIERS : une action « Appeler : … » est un premier appel). Un appel noté
  « Intéressé » efface l'action automatique (`commercial/appels.ts`, `estActionOuvertureAuto`) et la tâche est cochée
  « appel noté » ; une action écrite par Lucas ne bouge pas. La coche « dossier ouvert » ne vaut plus pour une tâche
  du dossier lui-même (`a-faire/achevement.ts`) : ouvrir n'est pas appeler.
- **Leads** : un lead du site (simulateur, simulation, demande de devis) dont le dossier s'est ouvert reste dans
  « À appeler » et dans la file des appels jusqu'au premier appel (règle de la mission 17, `siteNonAppele`, étendue
  des simulations aux demandes de devis).
- « Ouvrir un dossier » (fiche du lead) : infobulle « Pour un contact qualifié au téléphone… » ; description de
  `creer` (MCP) : DOSSIER depuis un lead = lead qualifié au téléphone. Paramètres inchangés, empreinte
  `040d6c7aa53c` (53 outils).
- Docs : `MCP-COUVERTURE.md` (en-tête, L12, LF4, §4.4), `COHERENCE.md` §4, `TACHES.md` §3,
  `ARCHITECTURE-PILOTAGE.md` (simulation → dossier, lead du simulateur). Audit des connexions : textes du maillon
  « simulation → dossier » mis à jour.

Décisions prises seul (solution la plus simple) :
- `DEBUT_OUVERTURE_AUTO` = 03/10/2026 (jour du lot), la date du déploiement n'étant pas connue ; comme le filet ne
  regarde que deux jours, la mise en ligne n'ouvre jamais le stock, seulement les contacts du site des deux derniers
  jours (ceux qu'une ouverture au webhook aurait eus).
- Hors zone (« À écarter ») : pas d'ouverture automatique, il reste « Classer · Nom (hors zone) » dans Leads (le bouton
  reste). Le tunnel du simulateur n'a pas changé (il ouvrait déjà l'espace, donc le dossier, même hors zone).
- Lead Meta : rien ne s'ouvre tant qu'il ne fait rien sur le site ; s'il y fait ensuite une simulation, c'est un fait
  du site : son dossier s'ouvre.
- Espace client : rien à changer — tout s'y passe déjà dans un dossier (un projet créé par le client ouvre le sien,
  mission 5 ; photos, simulations et demande de devis vont au dossier du projet).
- Contact dont le dossier est clos (perdu ou encaissé) : un nouveau fait du site ouvre un nouveau dossier, comme le
  bouton. Des photos seules (sans demande) : motif « demande de devis » (elles arrivent avec un formulaire) ; la photo
  d'une génération échouée (lead du simulateur) : motif « simulation ».
- Statut du lead : inchangé ici (NOUVEAU → CONTACTE comme toute ouverture, DEVIS_DEMANDE gardé) ; la table complète
  vient en B12.
- Date réelle d'un dossier rangé après coup : celle de la simulation la plus récente (et plus la première), et seulement
  s'il y en a une — un contact revenu simuler aujourd'hui n'ouvre pas un dossier daté de sa première visite.
- Un rappel demandé passe avant « Appeler : … » (texte « Rappeler », pour que `rappelALOuverture` le pose à l'heure
  exacte ; avant, une simulation avec rappel gardait « Appeler : simulation… » et perdait l'heure).

Tests : 1 294 → 1 303 verts. Nouveau `src/lib/base/mission-18-a2.test.ts` (webhook : demande de devis sans photo,
tâche « Appeler · Nom » sur le dossier puis cochée par l'appel, simulation sans tunnel, photos jointes, rappel à l'heure,
tunnel avec lien affiché au contact neuf, rien pour un lead Meta, un simple message ou un ancien lead). Réécrits :
`dossiers/depuis-lead.test.ts` (« une simulation seule n'ouvre plus de dossier » → ouverture automatique, demande de
devis, rien de nouveau → rien, filet : fenêtre, stock, dossier archivé) et `prospects/doublons.test.ts` (le doublon
ouvre un second dossier, que la fusion archive). `tsc`, `eslint` sur les fichiers touchés, `npm run build` : propres.

Reste :
- Reconnecter le connecteur MCP après la mise en ligne (description de `creer`).
- B12 : statut du lead d'un dossier ouvert tout seul (CONTACTE), et l'alignement complet lead ↔ étape.
- L'audit des connexions ne signale pas une simulation récente restée sans dossier : le filet la rattrape en 15 min.

### Mission 18, A3 — Dépenses passe dans Finances

Livré (03/10, branche `mission-18`, pas de push) :
- **Section « Dépenses » de Finances** : `finances/page.tsx` charge aussi `listerDepenses(annee)` et
  `suggestionsSaisie()` pour la même année que le reste de l'écran ; `ListeDepenses` (déplacée de
  `depenses/_components` vers `finances/_components`) devient une section `id="depenses"` placée entre « À corriger » et
  « Livre des recettes ». On y retrouve le total, « Nouvelle dépense », la file hors ligne, les compteurs « à rattacher »
  et « sans justificatif », la liste par mois et la fiche d'une dépense (modifier, justificatif, retirer), inchangée.
  L'année se change par la navigation d'année de Finances, dont les liens gardent `section`.
- `/depenses` redirige vers `/finances?section=depenses` (`next.config.ts`, 307 comme les autres ; la requête suit,
  `?annee=` compris) ; la page descend alors à la section. L'écran `depenses/page.tsx` est supprimé.
- **Gardés** : la saisie `/depenses/nouvelle` (raccourci du manifeste, file IndexedDB), dont les liens « Dépenses » et
  « Voir les dépenses » mènent à la section ; les routes `/api/depenses*` ; le bloc Dépenses du panneau du dossier
  (`DepensesDossier`, même composant, « + Dépense » vers la saisie).
- Navigation : l'entrée Dépenses disparaît (11 onglets en attendant A5-A6) ; Finances s'allume aussi sur
  `/depenses/nouvelle` (nouveau champ `aussi` des entrées).
- Liens : `ADRESSE_DEPENSES` et `adresseDepenses(annee)` (`depenses/constantes.ts`) servent à l'Analytique (carte
  « Dépenses par catégorie »), à la saisie et à l'assistant (`lister` DEPENSES et sa période, `creer`, `modifier` et
  `archiver` DEPENSE, `ajouter_fichier` sur une dépense). Aucun outil, paramètre ni description ne change : empreinte
  `040d6c7aa53c` (53 outils), rien à reconnecter pour ce lot.
- Docs : `MCP-COUVERTURE.md` (en-tête ; X1–X10 en 2.10 sous « Section Dépenses » ; 2.11 renvoie à 2.10 ; N1, N3 ;
  bilan inchangé, 427 actions, 391 couvertes, 36 sans objet ; piège 3.23-1) et `ARCHITECTURE-PILOTAGE.md` §12.

Décisions prises seul (solution la plus simple) :
- « Le panneau du dossier garde ses dépenses, même composant » : `DepensesDossier` n'est pas touché (lecture, marge,
  ajout par la saisie). On modifie une dépense depuis la fiche de la section de Finances, comme avant depuis l'écran
  Dépenses.
- La section passe avant le livre des recettes : le travail à faire vient avant l'archive de l'année. L'écran n'a
  qu'une navigation d'année.
- La redirection passe par `?section=`, pas par un fragment, en 307 (le test « rien de figé dans le navigateur »
  l'exige). Seule la valeur `depenses` est reconnue ; toute autre valeur ouvre l'écran en haut.
- `/depenses/nouvelle` n'est pas redirigée : elle sert au raccourci de l'application installée, au « + Dépense » du
  panneau et aux suggestions de `lister` DEPENSES.
- `public/sw.js` n'est pas touché : la `VERSION` change en A6, comme convenu en A1.

Tests : 1 303 → 1 311 verts.
- Nouveau `src/lib/base/mission-18-a3.test.ts`. Il couvre :
  - la page Finances rendue comme Next la rend : dépenses de l'année demandée égales à `listerDepenses`, chantiers de
    la fiche, `?section=`, année illisible ;
  - la route de rechargement et le panneau du dossier ;
  - les adresses, la redirection (sans chaîne, saisie non touchée), l'écran retiré, le manifeste et la navigation ;
  - l'absence de tout lien vers `/depenses` dans `src` et `public`.
- Jumeaux MCP, liens vers la section :
  - `mcp-lister-etat` : DEPENSES de l'année, retirées, période ; les suggestions mènent à la saisie ;
  - `mcp-partie-c` : `creer` DEPENSE ;
  - `mcp-fichiers` : `ajouter_fichier` sur une dépense ;
  - `mcp-analytique` : aucun lien vers `/depenses`.
- Adapté : `relecture-b.test.ts`. Le lien de `creer` DEPENSE y devient `ADRESSE_DEPENSES`, même intention.
- `tsc` (après suppression de `.next`, qui gardait les types de la page retirée), `eslint` sur les fichiers touchés et
  `npm run build` : propres. Les 40 avertissements NFT de `next.config.ts` (via `simulateur/banc`) existaient déjà.
- Vérifié à l'œil sur une base d'essai jetable (port 3007, aucun canal sortant) :
  - `/depenses?annee=2025` mène à `/finances?annee=2025&section=depenses` ;
  - la page descend à la section, sur bureau et à 390 px ;
  - l'année −1 / +1 garde la section ; la fiche d'une dépense s'ouvre ;
  - le menu « Plus » n'a plus Dépenses et Finances y est actif ; la saisie ramène à la section.

Reste :
- A6 : `ARCHITECTURE-PILOTAGE.md` §4 et §21 (navigation finale) et la `VERSION` de `public/sw.js`.

### Mission 18, A4 — un seul système de relance

Livré (03/10, branche `mission-18`, pas de push) :
- **Séquences de mails retirées du code** : `src/lib/mail/sequences.ts` est supprimé, avec les quatre interrupteurs
  `SEQUENCE_*` (`automatismes/interrupteurs.ts` : un code `SEQUENCE_…` répond « Automatisme inconnu », et lister les
  automatismes ne crée plus de lignes `SequenceMail`), le travail périodique `sequences-mail` (`mail/taches.ts`), les
  champs `sequences*` de `manager_operations` et le paramètre `MAIL_EXPEDITEUR` (définition et branche d'`envoi-crm`).
  Les modèles `SequenceMail`, `EtapeSequence`, `InscriptionSequence` et `Desinscription` sont gardés, lignes comprises
  (`db push` au démarrage) ; `"SEQUENCE"` reste dans `NATURES_ENVOI` pour relire d'anciens envois ; le RGPD est
  inchangé.
- **Désinscription gardée** dans `mail/desinscription.ts` (`jetonDesinscription`, `lienDesinscription`, `desinscrire`,
  signatures inchangées, sans l'arrêt des inscriptions) ; la route `api/site/desinscription` (appelée par le site) n'a
  changé que d'import.
- **Demande d'avis après chantier** (`relances/avis.ts`) : dossier Facturé ou Encaissé non archivé, espace actif, sans
  avis ; le délai `DELAI_RELANCE_AVIS` (nouveau paramètre, Suivi commercial, 7 jours par défaut) court depuis le mail
  « Projet terminé » parti, sinon depuis le passage en Facturé (ou Encaissé) depuis une étape en cours. SMS
  `DEMANDE_AVIS` (groupe Relances) avec le lien de l'espace `#apres`, une seule fois, jamais en STOP.
- **Réactivation à 6 mois** (`relances/reactivation.ts`) : lead sans suite depuis 180 jours, d'après `Lead.perteLe`
  ou le `perteLe` de son dossier perdu (jamais `updatedAt`). Conditions : dernière déclaration `ACCORDE`, aucune
  adresse désinscrite (`relances/accord-commercial.ts`, règle partagée par la liste, la proposition et la copie), ni
  dossier vivant ni autre contact actif pour le client. Un client, une réactivation. SMS `REACTIVATION` sans lien, avec
  « STOP pour ne plus en recevoir », une fois. La copie se trace toujours sur le lead (« SMS REACTIVATION copié : … »),
  même s'il garde un dossier perdu.
- `relancesProposables` rend `{ devis, photos, avis, reactivations, total }` (la fiche d'un dossier n'a pas de
  réactivation). L'utilisent `GET /api/relances`, la ligne du jour, le point du jour, `manager_operations` (avis et
  réactivations dus) et le détecteur de tâches RELANCES. Ce dernier ajoute les types `RELANCER_AVIS` « Demander un
  avis · Nom » et `REACTIVER` « Reprendre contact · Nom » (sur le lead), niveau 3, 1 min, groupe SMS.
- SMS : actions `RELANCE_AVIS` et `REACTIVATION`, vrais discriminants (`estRelanceDevis`, `estRelanceAvis`,
  `estRelanceReactivation`) à la place du « sinon c'est un devis » de `copie.ts` et `proposition.ts` ;
  `schemaRelanceSms` garde `rang ≤ 2`. La coche des tâches lit le type de la relance (un SMS d'avis ne coche ni
  `RELANCER_DEVIS` ni `RELANCER_PHOTOS`) ; un contact sans suite n'est pas un « sujet disparu » pour `REACTIVER`. Le
  pré-filtre des relances photos lit `"type":"PHOTOS"`.
- Écran : `FeuilleRelances` a une section par type (devis, photos, demandes d'avis, réactivations) ; la rubrique de
  la fiche du dossier montre aussi la demande d'avis.
- MCP : `lister` RELANCES rend les blocs avis et réactivation, y compris dans le retour « Aucun devis en attente ».
  `noter_sms` compte `DEMANDE_AVIS` et `REACTIVATION` quand la liste les propose. `taches` prépare le texte de la
  réactivation. Les descriptions de `voir_parametres`, `etat_crm` et `AUTOMATISME` ne citent plus les séquences ;
  `manager_clients` parle de la relance d'avis. Aucun outil ni paramètre ne change : empreinte `040d6c7aa53c`
  (53 outils). Les descriptions changent : **reconnecter le connecteur**.
- Textes : consignes par défaut (sections mission 11 et 14 ; la version de Lucas en base n'est pas réécrite),
  `routes-publiques.ts`, `ReglagesMail.tsx`, `envoi.ts`, `mime.ts`. `JOURS_REACTIVATION` n'existe plus qu'à un seul
  endroit (`relances/reactivation.ts`, réexporté par `analyses/clients.ts`).
- Docs : `MCP-COUVERTURE.md` (en-tête, L21, L22, DP7, PA2, AUTOMATISME en 4.3, RELANCES en 4.6, `noter_sms` en 4.9,
  bilan inchangé à 427 actions, 391 couvertes, 36 sans objet), `ARCHITECTURE-PILOTAGE.md` §25 et `TACHES.md` (§ 3 et § 5).

Décisions prises seul (solution la plus simple) :
- Avis et réactivation sont des **SMS à copier**, comme les autres relances : pas de nouveau motif de mail, rien ne
  part seul. Le mail « Projet terminé » reste l'automatisme existant (avec son interrupteur) ; le SMS le rappelle une
  seule fois, et pas au-delà de 60 jours (la fenêtre de l'ancienne séquence).
- Réactivation = la règle de la séquence (lead perdu avec accord), pas `aReactiver` de `manager_clients` (clients
  terminés), qui reste une lecture d'analyse. Sans date de perte connue, pas de réactivation. Le lead a bien un
  `perteLe` : la carte disait le contraire.
- La copie d'une réactivation est refusée sans accord ou après une désinscription (comme la proposition) : c'est une
  prospection.
- La réactivation n'apparaît pas dans la fiche d'un dossier (elle porte sur un contact) ; la tâche est sur le lead.
- `desinscrire` n'arrête plus d'inscriptions (aucune ne peut plus être active) ; la preuve devient « Lien de
  désinscription d'un mail commercial ».
- La ligne `Planification` « sequences-mail » et d'éventuels paramètres `MAIL_EXPEDITEUR` restent en base, ignorés
  (vérifié : `parametresPourEcran` ne lit que les clés définies).

Tests : 1 311 → 1 320 verts (3 tests de séquences retirés de `mail.test.ts`, 12 ajoutés).
- Nouveau `src/lib/base/mission-18-a4.test.ts`. Il couvre :
  - plus de séquences : automatismes, aucune ligne créée, code `SEQUENCE_` inconnu, plus de travail, aucun appel
    restant dans `src`, modèles gardés ;
  - `MAIL_EXPEDITEUR` ignoré en base et la route de désinscription ;
  - l'avis : délai, fenêtre, lien `#apres`, copie comptée une fois, origine mail puis passage, reprise et ouverture
    exclues, avis donné, STOP, espace désactivé ;
  - la tâche d'avis et la coche par type (un SMS d'avis ne coche ni devis ni photos) ;
  - la réactivation : accord (proposition et copie refusées sans lui), retrait, désinscription, STOP, date de la perte
    (lead, dossier, jamais `updatedAt`), client revenu, un par client ;
  - la tâche « Reprendre contact » : tracée sur le lead, cochée « faite » ;
  - `relancesProposables`, `GET /api/relances` et le point du jour ;
  - les jumeaux MCP : `lister` RELANCES (et par dossier), `noter_sms` DEMANDE_AVIS et REACTIVATION, `etat_crm`
    PARAMETRES, `manager_operations`, le délai paramétré.
- Adaptés, même intention : `mail.test.ts` (désinscription par le nouveau module, sans inscription de séquence) et
  `mission-14-partie-8.test.ts` (le catalogue SMS compte 16 codes).
- `tsc`, `eslint` sur les fichiers touchés et `npm run build` : propres.

Reste :
- Rappeler à Lucas de reconnecter le connecteur (descriptions changées).
- Les consignes de Lucas en base peuvent encore citer les séquences : à lui de les relire (non réécrites, règle de la
  mission 17).

### Mission 18, A5 — Tâches de fond dans Paramètres › Système, un seul compteur

Livré (03/10, branche `mission-18`, pas de push) :
- **Onglet « Système » de Paramètres** (sixième onglet, après Assistant) : la file des tâches de fond et les travaux
  périodiques, le contrôle de cohérence, l'audit des connexions et les sessions de l'assistant, dans l'ordre de
  l'ancien écran. `SectionSysteme.tsx` lit chaque bloc à l'ouverture de l'onglet par la route de son bouton
  (`/api/taches`, `/api/coherence`, `/api/audit/connexions`, `/api/assistant/sessions`) : la page Paramètres ne lance
  ni le contrôle de cohérence ni l'audit, et un bloc en panne affiche « Réessayer » sans gêner les autres.
- Les quatre composants passent de `taches-de-fond/_components` à `parametres/_components` (renommés dans git).
  `EtatTaches` devient un bloc : plus d'en-tête de page ni d'enfants, un titre de section avec « Actualiser ». Chaque
  bloc a son ancre (`#taches-de-fond`, `#coherence`, `#audit`, `#sessions`).
- `parametres/page.tsx` lit `?section=` et le passe à `OngletsParametres`. L'ordre de priorité est : l'ancre, puis la
  section, puis l'onglet mémorisé. La table `ANCRES` gagne `systeme`, `taches-de-fond`, `coherence`, `audit` et
  `sessions`. La recherche se fait sur les propriétés propres (`ongletDe`), donc `#toString` n'ouvre rien. Sur
  téléphone, l'onglet ouvert reste visible dans la liste qui défile.
- `/taches-de-fond` redirige vers `/parametres?section=systeme` (`next.config.ts`, 307 comme les autres, la requête
  suit). L'écran `src/app/(pilotage)/taches-de-fond/` est supprimé.
- **Un seul compteur** : l'entrée « Tâches de fond » et son badge rouge `tachesEnEchec` sortent de la navigation (le
  type `Compteurs` et `tonDe` aussi, l'icône `Workflow` n'est plus importée). Un échec remonte déjà comme tâche système
  « Relancer N tâches de fond en échec » (niveau 4, comptée dans l'onglet Tâches). La route `/api/pilotage/compteurs`
  garde la clé, pour les réponses servies par le cache hors ligne et pour `ecran.test.ts`.
- Adresse unique `ADRESSE_SYSTEME` dans `src/lib/parametres/sections.ts`. Elle sert au raccourci des tâches système
  (`a-faire/detecteurs/systeme.ts`, clé `SYSTEME:taches-de-fond` inchangée, donc rien n'est recréé), aux alertes
  (`synthese/alertes.ts`, `analytique/alertes.ts`, alerte de plafond de `assistant/execution.ts`, alerte quotidienne
  de `coherence/controle.ts`), et aux liens des outils (`etat_crm` vue générale, TACHES_DE_FOND, COHERENCE, AUDIT,
  SESSIONS et SANTE via `lecture.ts` ; `agir_systeme` ; `manager_operations`). Les textes qui disaient « Tâches de
  fond → Assistant » disent « Paramètres › Système → Sessions de l'assistant ».
- MCP : aucun outil, paramètre ni description ne change. L'empreinte reste `040d6c7aa53c` (53 outils) et il n'y a rien
  à reconnecter pour ce lot.
- Docs : `MCP-COUVERTURE.md` (en-tête, B1–B7 en 2.13 sous « Système », 2.15 qui renvoie à 2.13, PA1, N1, N2, N3,
  ligne « Paramètres › Système » du bilan, total inchangé à 427 actions dont 391 couvertes et 36 sans objet),
  `ARCHITECTURE-PILOTAGE.md` (§4 et mentions de l'écran) et `TACHES.md` (§0).

Décisions prises seul (solution la plus simple) :
- Une requête `?section=systeme` plutôt qu'une ancre : le fragment n'est pas garanti à travers une redirection du
  serveur (même choix que Finances en A3).
- Redirection en 307 comme toutes les anciennes adresses : `analytique.test.ts` exige `permanent: false`, et rien
  n'est mis en cache par le navigateur.
- Le badge disparaît mais la clé `tachesEnEchec` reste dans la route. Les alertes « N tâches de fond en échec » de
  l'Analytique et du point du jour restent : ce sont des alertes, pas des compteurs de la barre, et elles mènent à
  l'onglet.
- Seul l'onglet Système est ajouté. Tarifs viendra avec A6, pour ne pas laisser un onglet vide.
- `public/sw.js` n'est pas changé : le changement de `VERSION` est prévu en A6, avec la navigation à 10 onglets.

Tests : 1 320 → 1 331 verts (11 ajoutés).
- Nouveau `src/lib/base/mission-18-a5.test.ts`. Il couvre :
  - l'adresse de l'onglet ;
  - la page qui passe `?section=` sans lancer le contrôle ;
  - l'onglet et ses ancres ;
  - les routes des blocs et leurs réponses ;
  - la redirection (307, sans chaîne) ;
  - l'écran retiré, la navigation sans onglet ni badge, plus aucune adresse `/taches-de-fond` dans `src` et `public` ;
  - la tâche système comptée dans Tâches avec son raccourci vers l'onglet, et la clé gardée dans la route ;
  - l'alerte `TACHES_EN_ECHEC` ;
  - les liens de `etat_crm` (six parties), `agir_systeme` et `manager_operations`.
- Adaptés, même intention : `systeme.test.ts` (le raccourci mène à l'onglet), `mcp-gestes.test.ts` (lien de
  RELANCER_TACHE), `mcp-analytique.test.ts` (plus de lien `/taches-de-fond`, `manager_operations` mène à l'onglet).
- `tsc`, `eslint` sur les fichiers touchés et `npm run build` : propres (le dossier `.next` a été supprimé avant, à
  cause de la page retirée).
- Vérifié à l'œil sur une base d'essai jetable (port 3007, canaux sortants vidés, tâches de fond coupées) :
  - `/taches-de-fond?x=1` donne une 307 vers `/parametres?x=1&section=systeme` ;
  - les quatre blocs se lisent à l'ouverture ;
  - à 390 px, pas de défilement horizontal et l'onglet Système reste en vue ;
  - le menu Plus n'a plus Tâches de fond.

Reste :
- A6 : l'onglet Tarifs, la navigation à 10 onglets et `VERSION` de `sw.js`.
- Rien à reconnecter pour ce lot. Le rappel général de reconnexion des lots A1, A2 et A4 tient toujours.

### Mission 18, A6 — les tarifs dans Paramètres › Tarifs, navigation à 10 onglets

Livré (03/10, branche `mission-18`, pas de push) :
- **Onglet « Tarifs » de Paramètres** (septième onglet, après Facturation ; `/parametres?section=tarifs`, ancre
  `#tarifs`) : les tarifs des devis (presets : désignation, unité, prix HT, ajout, retrait) et « Tarif de chaque
  prestation ». `GestionTarifs.tsx` passe de `dossiers/_components` à `parametres/_components` (renommé dans git) ;
  plus de bouton « Retour au document » (`onRetour` retiré), une section titrée « Tarifs des devis ».
- `parametres/page.tsx` lit les presets actifs (`listerPresets`) avec les autres réglages ; `OngletsParametres` les
  garde dans son état (comme les paramètres) : revenir sur l'onglet ne perd pas ce qui vient d'être changé.
- **Générateur de documents** : plus de sous-mode des tarifs. Il garde la liste « Ajouter depuis un tarif… » ; « Gérer
  les tarifs » devient un lien vers l'onglet, ouvert dans un autre onglet du navigateur pour ne pas perdre le document
  en cours, et la liste des tarifs se relit au retour sur la fenêtre (`focus`, sans message d'erreur à ce moment-là).
- Adresse unique `ADRESSE_TARIFS` (`src/lib/parametres/sections.ts`), utilisée par le générateur et par les liens de
  l'assistant : outil des tarifs (`reglages.ts`, donc `lister` TARIFS), `creer` TARIF, chemin des entités TARIF et
  SOUS_PARTIE (`modifier`, `archiver`). Les commentaires « Dossiers → Tarifs » de `prestations/` sont corrigés.
- **Navigation à 10 onglets** (`Navigation.tsx`) : principaux Tâches, Leads, Dossiers, Mail, Clients, Analytique ;
  secondaires Simulateur, Site, Finances (allumé aussi par `/depenses/nouvelle`), Paramètres. Barre du bas inchangée :
  Tâches, Leads, Dossiers, Mail, Analytique, puis « Plus » (Clients, Simulateur, Site, Finances, Paramètres).
  `PRINCIPALES`, `SECONDAIRES` et `DANS_LE_MENU` sont exportés pour le test. Les icônes `Smartphone`, `Workflow`,
  `Receipt` et le type des compteurs étaient déjà retirés par A1, A3 et A5.
- **Anciennes adresses** : `/espaces`, `/depenses`, `/taches-de-fond` (déjà dans `next.config.ts`) sont vérifiées
  ensemble : 307, sans chaîne, vers un écran qui existe, écran d'origine retiré ; les raccourcis du manifeste mènent à
  des écrans. `public/sw.js` passe en `VERSION = "v12"` : les écrans retirés ne restent pas servis hors ligne.
- MCP : aucun outil, paramètre ni description ne change (seuls les liens rendus changent). L'empreinte reste
  `040d6c7aa53c` (53 outils) : rien à reconnecter pour ce lot.
- Docs : `MCP-COUVERTURE.md` (en-tête, note en 2.4, DP64 et DP70–DP73 en 2.13 › Tarifs avec le nouveau test, PA1,
  N1, N3, bilan : panneau 92 actions, ligne « Paramètres › Tarifs » de 5 actions, total inchangé à 427 dont 391
  couvertes et 36 sans objet), `ARCHITECTURE-PILOTAGE.md` (§4 réécrit : 10 onglets, barre du bas, puce Tarifs ; note
  en tête de §21, qui décrivait l'état du 21/09), `COHERENCE.md` (§1 : colonne Espace au lieu d'Espaces clients).
  `TACHES.md` §0 était déjà à jour (A5).

Décisions prises seul (solution la plus simple) :
- Tarifs placé juste après Facturation (l'argent ensemble), pas en fin de liste.
- Presets lus par le serveur avec la page, comme les autres onglets (pas de « Chargement… ») : `listerPresets` est
  une petite lecture ; seul l'onglet Système reste lu à la demande.
- « Gérer les tarifs » ouvre un autre onglet du navigateur plutôt que de quitter la modale : un devis à moitié saisi
  ne se perd pas. La liste du générateur se relit au retour.
- Pas de nouvelle redirection : les tarifs n'avaient pas d'adresse (sous-mode d'une modale). Les redirections restent
  en 307 (`analytique.test.ts` exige `permanent: false`), comme en A1, A3 et A5.
- DP64 (lire les tarifs) suit DP70–DP73 dans l'onglet, comme le prévoyait le plan : le générateur ne fait plus que les
  proposer (DP67 reste dans le panneau).

Tests : 1 331 → 1 341 verts (10 ajoutés).
- Nouveau `src/lib/base/mission-18-a6.test.ts`. Il couvre :
  - l'adresse de l'onglet, la page qui lit les tarifs actifs et passe `?section=tarifs` ;
  - l'ordre des sept onglets, l'ancre `#tarifs`, les tarifs gardés par les onglets ;
  - `GestionTarifs` déplacé sans « Retour », le générateur sans sous-mode, avec sa liste et son lien ;
  - les gestes de l'onglet (POST, PATCH, attribution, DELETE) et les outils jumeaux (`creer`, `modifier`, `modifier`
    SOUS_PARTIE, `archiver`) : même état en base, tarif archivé jamais effacé, liens vers l'onglet ;
  - les liens de `lister` TARIFS, de l'outil des tarifs et le chemin des entités TARIF et SOUS_PARTIE ;
  - la navigation à 10 onglets (chaque onglet mène à un écran existant), la barre du bas et le menu « Plus » ;
  - les trois anciennes adresses, les raccourcis du manifeste et la version du service worker.
- Aucun test existant n'a eu à changer (`mission-18-a3.test.ts` lit toujours l'entrée Finances telle quelle).
- `tsc`, `eslint` sur les fichiers touchés (2 avertissements anciens de `sw.js`, hors de mes lignes) et
  `npm run build` : propres.

Reste :
- Partie A terminée (A1 à A6). Rien à reconnecter pour ce lot ; le rappel de reconnexion des lots A1, A2 et A4 tient
  toujours.

### Mission 18, partie A — corrections de la relecture

Deux relecteurs ont relu A1 à A6 (`f77a149..c8357f6`) : dix constats, tous vérifiés dans le code, tous réels et tous
corrigés (le n° 4 par des requêtes groupées, sans cache). Aucun n'est faux.

Livré (03/10, branche `mission-18`, pas de push), constat par constat :
1. **Une photo déposée par Lucas ouvrait le dossier** (important, réel). Une PhotoLead d'origine `DEPOT_CRM` (lien de
   dépôt, `ajouter_fichier`) n'ouvre plus rien. Elle n'est comptée ni par `faitsDuSite` pour le motif
   (`seulementDuContact`), ni par la branche « sans dossier » du filet (`PHOTO_DU_CONTACT`). Elle se range toujours
   dans le dossier vivant, comme le dit le message du dépôt.
2. **Le filtre « Espaces » avait perdu son tri** (mineur, réel). Le tri revient : « À moi d'abord », « Dernière
   activité », « Lien le plus récent » (`TRIS_ESPACE`, `comparerEspaces` dans `espace/suivi-types.ts`). Le serveur
   le fait (`FiltresDossiers.triEspace`, `GET /api/dossiers?triEspace=`), car c'est lui qui découpe les pages. Le
   sélecteur est dans `FiltreEspaces`.
3. **Des textes renvoyaient à l'écran « Espaces clients » retiré** (mineur, réel). Corrigés :
   - la notification « projet de plus » renvoie à la fiche client, seul endroit où ce geste existe ;
   - la notification « autres simulations » et l'aide du paramètre renvoient au bloc Espace du dossier ;
   - la confirmation d'archivage dit « sort de Dossiers (filtre « Espaces » compris) » ;
   - en plus des trois textes signalés, les liens de l'assistant s'intitulent « Dossiers › Espaces » (même adresse).
4. **Coût du filtre « Espaces »** (important, réel). Les requêtes sont groupées :
   - les rendus rangés dans les photos se lisent en une seule requête pour toute la liste (`rendusDesDossiers`), au
     lieu d'une par dossier ; `photosDuClient` reçoit le résultat ;
   - `liensEnvoyes` accepte une liste de motifs : `listerEspaces` ne lit que les envois des espaces chargés
     (`/e/<code>-` du client et du projet). Au-delà de 120 motifs, il reprend le motif commun `/e/`, moins cher
     qu'une longue suite de OU. La liste par défaut (50 dossiers) ne parcourt donc plus tout l'historique ;
   - sous le filtre, la recherche attend 600 ms après la dernière frappe (250 ms ailleurs).
5. **La demande d'avis pouvait ouvrir un espace** (mineur, réel). `RELANCE_AVIS` lit l'espace existant du dossier.
   S'il est absent, archivé, désactivé ou sans lien, l'action renvoie un refus 409 et rien n'est écrit. Cela vaut
   aussi pour « noter_sms » DEMANDE_AVIS, qui passe par `proposerSms`. Le commentaire est maintenant exact.
6. **Un dossier archivé par Lucas se rouvrait sur un fait ancien** (mineur, réel). Sans dossier vivant,
   `ouvrirDossierAutomatique` ne compte que les faits postérieurs au dernier archivage du lead
   (`max(DEBUT_OUVERTURE_AUTO, archiveLe)`). Une nouvelle simulation ou une nouvelle demande rouvre le dossier ; un
   fait déjà connu, non.
7. **Une photo introuvable revenait toutes les 15 minutes** (mineur, réel). Comme une simulation sans images, une
   photo absente du volume (ou vide) est marquée « tentée » : `rangeeLe` est posé, sans dossier. Le filet et
   `rangerImagesDuLead` l'ignorent ensuite (`PHOTO_A_RANGER`). Une erreur d'écriture (volume plein) n'est pas
   marquée : elle est reprise au passage suivant, ce qui est voulu.
8. **Ordre affiché ≠ ordre des pages** (mineur, réel ; même cause que le n° 2). Sous le filtre, la liste ne retrie
   plus. `VueListe` reçoit `tri={null}` : les en-têtes deviennent de simples titres et le « Trier par » du téléphone
   est masqué. Le kanban garde aussi l'ordre du serveur dans chaque colonne (`ordreServeur`).
9. **Accessibilité** (mineur, réel). Les pastilles du filtre sont des boutons `aria-pressed` dans un
   `role="group"`, et non plus des onglets sans panneau. L'icône de l'espace a maintenant un `libelle` :
   - « aucun » (`aria-hidden`) dans la ligne courte des cartes et du téléphone, où le texte visible suffit ;
   - « court » (« Espace : signal ou étape ») sur la carte compacte, où l'icône est seule ;
   - « detaille » dans la cellule du tableau.
10. **Course entre deux ouvertures** (mineur, réel, reproduit). Sur l'ancien code, quatre appels simultanés ouvraient
    quatre dossiers. Une file de promesses par contact (`unParContact`) sérialise maintenant `ouvrirDossierDuLead`
    et toute la décision d'`ouvrirDossierAutomatique` : un seul processus sert le CRM, la file suffit. Le contrôle
    `LEAD_A_PLUSIEURS_DOSSIERS` reste en filet.

Décisions prises seul (solution la plus simple) :
- « Lien le plus récent » trie par date d'ouverture du projet dans l'espace (`creeLe`). L'ancien onglet triait les
  clients par `lienEmisLe` ; la colonne travaille par dossier.
- Le tri des espaces n'entre pas dans l'adresse (`?espace=` seulement). Il revient à « À moi d'abord » à chaque
  ouverture, comme dans l'ancien onglet.
- Pas de cache du calcul des espaces : les requêtes groupées et le délai de saisie suffisent pour le volume actuel. Un
  cache de quelques secondes reste possible si l'écran rame.
- L'outil MCP `lister` ne reçoit pas le tri : sa description et son schéma ne changent pas, et son empreinte non
  plus. Rien à reconnecter.
- Une photo introuvable est seulement journalisée (`console.warn`), sans événement sur le dossier : la photo n'en a
  jamais fait partie.

Tests : 1 341 → 1 353 verts (12 ajoutés).
- `dossiers/depuis-lead.test.ts`, 4 tests ajoutés : photo DEPOT_CRM sur un lead Meta (ni webhook ni filet, puis
  rangée dans le dossier vivant), dossier archivé (fait connu / fait nouveau), photo introuvable tentée une fois,
  quatre ouvertures simultanées. Les quatre échouent sur l'ancien code (vérifié ; la course y ouvrait 4 dossiers).
- Nouveau `src/lib/base/mission-18-relecture-a.test.ts`, 8 tests : demande d'avis sans espace ou désactivée (refus,
  rien d'écrit), trois tris du serveur et de l'API, ordre du serveur gardé par l'écran, `liensEnvoyes` borné,
  `rendusDesDossiers` équivalent à l'ancienne lecture, textes sans « Espaces clients », boutons `aria-pressed`.
- Aucun test existant n'a eu à changer.
- `tsc`, `eslint` sur les fichiers touchés et `npm run build` : propres.

Reste :
- Rien pour Lucas sur ce lot.
- Si le filtre « Espaces » rame un jour avec beaucoup d'espaces, poser un cache court sur `espacesDesDossiers`.

### Mission 18, B0 — le point d'entrée unique et docs/SYNCHRO.md

Livré (03/10, branche `mission-18`, pas de push) :
- **`src/lib/dossiers/synchro.ts`** : union `EvenementDossier` (13 événements : photos reçues, projet validé ou
  dévalidé, choix validé ou dévalidé, autre proposition demandée ou retirée, accord donné ou retiré, simulation
  publiée, devis généré, devis déposé, acompte rejeté), `prochaineActionDe` (la matrice des prochaines actions, textes
  et conditions d'avant à l'identique), `appliquerEvenementDossier(tx, …)` (prochaine action, puis la main écrite en
  dernier, dans la transaction de l'appelant), `suitesEvenementDossier` (effets des changements d'étape, agenda si la
  prochaine action a changé, signal des tâches ; jamais bloquant), `evenementDossier` (les deux, transaction propre).
- **`src/lib/dossiers/prochaine-action-auto.ts › ecrireProchaineActionAuto`** : une prochaine action posée à la main
  (trio `prochaineActionManuelle*`, texte inchangé) n'est jamais écrasée ni effacée ; une tâche MANUELLE de clé
  `MANUELLE:synchro:<dossierId>:<code>` est rangée à la place (« ‹ texte › · ‹ client › », raison « ta prochaine
  action « … » est gardée »). Rejouée : la même tâche ; répondue puis nouvel événement : elle revient ; « Plus tard » et
  archivée : pas touchée.
- **Branchés** (écritures automatiques de prochaine action, désormais dans une transaction interactive avec l'écriture
  du geste) : `espace/service.ts` (`deposerPhotos`, `choisir`, `demanderProposition`, `accepterDevis`),
  `espace/validations.ts` (`validerProjet`, `devaliderProjet`, `devaliderChoix`, `retirerDemandeProposition`,
  `retirerAccord`), `simulations/dossier.ts › publierSimulations`, `documents.ts › emettre`,
  `documents-existants.ts › rattacherDocumentExistant` (après l'événement `DOCUMENT_REPRIS`, pour que la main le lise),
  `encaissements/service.ts › terminerEncaissement`. Les gestes de Lucas (appel, rappel, planifier, modifier le
  dossier) restent tels quels.
- **La main dans la transaction** : `main.ts` gagne `lireFaitsMain(id, client)`, `calculerMain(id, client)` et
  `ecrireMain(tx, id)` (sans signal) ; `recalculerMain` reste pour les appels hors module.
- **`changerEtapeDansTransaction`** écrit la main et le statut du lead dans sa transaction (nouveau
  `dossiers/statut-lead.ts`, la table d'avant déplacée) ; `effetsDuChangementEtape` ne refait alors ni l'un ni l'autre
  (un `WeakSet` des changements synchronisés : la forme du changement rendu ne change pas, une copie retombe sur le
  chemin complet). Les autres chemins (`appliquerChangementEtape` seul) gardent le recalcul d'après.
- **Helper d'essai `src/test/etat-dossier.ts › etatDesDeuxCotes`** : étape, main écrite et calculée, prochaine action
  et action manuelle en place, statut du lead, étape de l'espace (`chargerProjet` + `etapeEspace`), relances
  proposables et à venir, tâches ouvertes du dossier après une passe complète de réconciliation.
- **`docs/SYNCHRO.md`** : principe, règle des actions manuelles, matrice des 13 événements (fonction d'origine, étape,
  main, prochaine action, espace, relances, tâches, historique, lead, effets externes ; ce qui reste écrit hors de la
  transaction est marqué avec son lot), tableau des écarts B1-B13 pas encore branchés, ce qui ne passe pas par le module.

Décisions prises seul (solution la plus simple) :
- L'étape ne passe pas encore par le module : les gestes l'écrivent comme avant (`deplacerDossier`, `changerEtape`,
  `appliquerChangementEtape`) ; chaque lot B1-B13 la rapatrie avec son écart (livraison progressive).
- La condition d'une écriture automatique (« si vide ou « attendre les photos » »…) est relue dans la transaction, et
  plus sur la lecture faite avant : même résultat, sans course.
- Une action posée à la main que l'événement voudrait effacer, ou qui dit déjà le même texte : rien n'est rangé.
- Niveau de la tâche rangée : 2 (geste du client), 1 pour l'argent (accord donné ou retiré, chèque rejeté), 3 pour la
  production (simulation publiée, devis émis ou déposé) ; durée : celle de départ des tâches MANUELLE (5 min).
- Une tâche répondue (Fait, Pas à faire) revient à faire au prochain événement du même code : c'est un nouveau besoin.
- `accepterDevis` pose sa prochaine action par `evenementDossier` (troisième transaction, comme avant) : B8 réunira
  accord, étape et prochaine action.
- Outils MCP : aucun changement (mêmes fonctions de service) ; empreinte de la liste inchangée (`040d6c7aa53c`,
  53 outils) ; `docs/MCP-COUVERTURE.md` inchangé.

Tests : 1 353 → 1 360 verts. Nouveau `src/lib/dossiers/synchro.test.ts` (7 essais, état des deux côtés) : photos sans
action manuelle (texte écrit, main à moi, espace qui avance) ; action manuelle puis photos deux fois (texte gardé, une
seule tâche, revenue après « Fait » et de nouvelles photos) ; devis émis sur « Préparer le devis » posé par l'espace
(remplacé) ou à la main (gardé, tâche « Attendre l'accord… ») ; règles fines (condition, effacement, même texte, « Plus
tard », archivée) ; main et statut du lead lus DANS la transaction d'un changement d'étape ; `evenementDossier` ; chaque
événement présent dans `docs/SYNCHRO.md`. Aucun test existant à adapter (les cas « vigueur levée par une écriture
automatique » annoncés par le plan n'existent pas dans `moteur.test.ts` : la vigueur y tombe par un geste du client).
`tsc`, `eslint` sur les fichiers touchés, `npm run build` : propres.

Reste : B1-B13 (étape, notification, relances et statut du lead par le module, écart par écart) ; rien pour Lucas.

### Mission 18, B1 — générer un devis n'est pas l'envoyer (écart 1)

Livré (03/10, branche `mission-18`, pas de push, site non touché) :
- **La règle** (`dossiers/devis-envoye.ts › envoiALaGeneration`, pure) : à la génération, un devis est ANNONCÉ — donc
  envoyé : étape Q, S, Relance → Devis envoyé, main au client, relances — s'il part avec le mail « Devis disponible »
  (notifier demandé, adresse valide, espace ouvert), ou si l'interrupteur du modèle est coupé dans Paramètres et que
  l'espace est ouvert (la mise en ligne vaut envoi). Sinon, en Qualification ou Simulation, il est créé MASQUÉ
  (`visibleEspace: false`), l'étape ne bouge pas. Après Simulation (Devis envoyé, Relance, Signé…), il reste visible ;
  une variante silencieuse (`notifier: false`) dans un espace ouvert vaut mise en ligne (le cas de la mission 11 : le
  premier devis annoncé, les variantes à côté), sinon il n'est pas envoyé.
- **`notifications.ts › peutNotifier`** : les conditions de `notifierClient` (modèle, dossier, adresse, espace ouvert),
  lues sans rien programmer, AVANT la transaction de `emettre` ; `notifierClient` partage la même lecture. Le mail ne
  part qu'après la transaction et seulement pour un devis annoncé.
- **`emettre`** : `visibleEspace` posé à la création, l'événement `DEVIS_GENERE` porte `envoye` et `visibleEspace`,
  le changement d'étape seulement si envoyé, l'événement `DEVIS_GENERE { envoye }` du point d'entrée. Rend `envoi`
  (`{ visible, envoye, mail }`) à l'écran et à l'outil.
- **Point d'entrée** (`synchro.ts`) : `DEVIS_GENERE` envoyé → « Attendre l'accord du client sur le devis » ; pas
  envoyé → « Envoyer le devis au client » (`PROCHAINE_ACTION_ENVOYER_DEVIS`), à la place de « Préparer le devis… »
  seulement. Une action posée à la main reste, SANS tâche rangée à la place (option `tache: false` de
  `ecrireProchaineActionAuto`) : la tâche ENVOYER_DEVIS couvre ce besoin. « Envoyer le devis au client » est remplacé
  par « Attendre l'accord » au prochain devis envoyé ou déposé.
- **La main** (`main.ts`) : `DEVIS_GENERE` marqué `envoye: false` me la donne, « Devis prêt, pas encore envoyé (n°) :
  à lui envoyer » (`motifDevisAEnvoyer`, `estMotifDevisAEnvoyer`), tant que le devis est « Généré », non archivé et pas
  mis en ligne depuis (un `DEVIS_ENVOYE` qui le porte). Les événements d'avant n'ont pas la marque : ils passent
  toujours la main au client, aucune migration.
- **Tâche `ENVOYER_DEVIS`** « Envoyer le devis · X » (niveau 2, 2 min) : lecture propre du détecteur DOSSIERS
  (`devis-envoye.ts › devisAEnvoyer` : marque `"envoye":false`, devis « Généré », pas de `DEVIS_ENVOYE` qui le porte,
  dossier vivant), une par dossier (« devis A, B prêts, pas encore envoyés »), occurrence = les devis. Raccourci :
  le dossier, rubrique devis (rendre visible, ou « Envoyer par mail »). Jamais écartée par une action posée à la main
  (`moteur.ts › TYPES_HORS_VIGUEUR`) : c'est mon geste resté en route. Coche par le CRM (`achevement.ts`) : envoyé par
  mail ou accepté, mis en ligne, annulé ou remplacé. /commercial : groupe DEVIS, action = le motif (plus « Préparer la
  simulation » sur un dossier dont le devis attend d'être envoyé) ; le cas DEVIS du détecteur s'efface devant elle.
- **Outil `generer_document`** : l'aperçu dit d'avance ce qui se passera (même règle), le résultat aussi
  (`donnees.envoye`, `donnees.visibleEspace`) ; descriptions mises à jour (outil et paramètre `notifier`). Écran : la
  case « Prévenir le client par mail » l'explique.
- **Docs** : `docs/SYNCHRO.md` (deux lignes `DEVIS_GENERE`, envoyé ou non ; B1 retiré du tableau 4), `docs/TACHES.md`
  (type, coche, exception à la vigueur), `docs/MCP-COUVERTURE.md` (entrée B1).

Décisions prises seul (solution la plus simple) :
- « Envoyé » se décide AVANT la transaction (`peutNotifier`), pas d'après le résultat de `notifierClient` : l'étape
  avance dans la transaction ; un échec rare de la mise en file du mail n'annule pas l'envoi.
- Pas d'événement `DEVIS_ENVOYE` en plus à la génération (le plan le proposait) : la marque `envoye` de
  `DEVIS_GENERE` suffit et n'écrit pas deux lignes dans l'historique ; la date d'envoi d'un devis annoncé à la
  génération est son émission (B5 lira le `DEVIS_ENVOYE` d'une mise en ligne ultérieure).
- Variante silencieuse après Simulation dans un espace ouvert = mise en ligne (pas de tâche) ; sans espace ouvert ou
  sans adresse pour l'annoncer = pas envoyé (tâche), même visible.
- Le raccourci de la tâche ouvre la rubrique devis du dossier (gestes existants) plutôt qu'un `&devis=envoyer`
  nouveau : B2 (mail) et B5 (mise en ligne annoncée) corrigent les effets de ces deux gestes.
- Niveau 2 (chaud) pour ENVOYER_DEVIS : un devis prêt qui n'est pas parti.
- La conversion Meta DEVIS_ENVOYE suit le vrai passage d'étape (décalée à l'envoi), comme prévu.

Tests : 1 360 → 1 366 (`npm test` : 1 364 verts ; les 2 échecs, `mission-14-partie-8` « ouvert il y a 4 jours » et `mcp-mail` « lundi 9 h », tombent aussi sur ac1b274 sans B1 : ils dépendent de la date du jour, le 05/10, un lundi). Nouveau `src/lib/dossiers/generer-envoyer.test.ts` (6 essais, état des deux
côtés) : la règle pure ; Qualification + `notifier: false` → Qualification, main à moi (« Devis prêt… »), espace
inchangé, aucune relance, tâche « Envoyer le devis · X », aucun mail, /commercial DEVIS, puis rendu visible → Devis
envoyé, main au client, relance n°1, tâche cochée « mis en ligne à hh:mm » ; annoncé → Devis envoyé, « Attendre
l'accord », espace DEVIS, relance à venir, un seul mail programmé ; « Préparer le devis » → « Envoyer le devis au
client », action posée à la main gardée sans tâche de remplacement et ENVOYER_DEVIS malgré la vigueur ; interrupteur
coupé → envoyé sans mail ; deux devis → une tâche, annulés → cochée ; devis d'avant (sans marque) jamais « à
envoyer ». Adaptés (comportement changé volontairement, intention gardée) : `documents.test.ts` (sans espace : reste en
Qualification, masqué), `main.test.ts` (contact avec adresse : le devis annoncé passe la main), `synchro.test.ts`
(devis annoncés pour le cas « Attendre l'accord »), `mission-14-partie-1.test.ts` (aide `devisEnvoye` : émis puis
rendu visible ; le cas « seul devis masqué » commence masqué et non envoyé), `devis-multiples.test.ts` (premier devis
annoncé, variantes silencieuses) ; `mcp-v3.test.ts` passe sans changement (l'aperçu dit toujours « aucun mail ne
partira »). `tsc`, `eslint` sur les
fichiers touchés, `npm run build` : propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils) ; descriptions de
`generer_document` changées : reconnecter le connecteur.

Reste : B2 (envoi par mail : visibilité, étape, main, double validation), B5 (mise en ligne annoncée, relance datée de
la mise en ligne), B13 (règle de cohérence de l'écart 1, réparation des devis déjà « envoyés » sans l'avoir été) ; rien
pour Lucas, sauf reconnecter le connecteur.

### Mission 18, B2 — devis envoyé par mail depuis le CRM (écart 2)

Livré (05/10, branche `mission-18`, pas de push, site non touché) :
- **Mêmes effets qu'un devis rendu visible** (`mail/propositions.ts › effetsDeLEnvoi`, `enregistrerDevisEnvoye`) : à
  l'exécution d'un mail ENVOI_DEVIS (bouton « Envoyer par mail » du dossier ou outil `envoyer_document`), dans UNE
  transaction après la trace `MAIL_ENVOYE` : devis « Envoyé » et visible dans l'espace, événement `DEVIS_ENVOYE`
  (`documentId`, `canal: "MAIL"`, `propositionId`) qui date l'envoi et passe la main au client, Q, S, Relance → Devis
  envoyé (`passerEnDevisEnvoye`), puis le point d'entrée (nouvel événement `DEVIS_ENVOYE` de `synchro.ts`) : « Envoyer
  le devis au client » ou « Préparer le devis… » → « Attendre l'accord du client sur le devis » (une action posée à la
  main n'est jamais écrasée), main écrite dans la transaction. Après : effets du changement d'étape (lead, Meta),
  agenda, signal des tâches ; la tâche ENVOYER_DEVIS se coche (« envoyé par mail »). Les autres mails (facture,
  relance, réponse) recalculent maintenant la main après l'envoi (elle ne l'était pas sans changement d'étape).
- **Relances datées de l'envoi** (`relances/service.ts › referenceDuDevis`) : la référence est la plus tardive de
  l'émission, du dépôt et du dernier `DEVIS_ENVOYE` du devis (chargé avec le dossier, sans nouvelle colonne).
- **Un seul mail** : `envoyer_document` ne revalide plus la proposition (l'ancienne 2e validation rendait 409, et la
  nouvelle tentative envoyait un second mail) ; `envoyerDocumentParMail` pose la clé
  `envoi-document:<document>:<empreinte destinataire|objet|texte>` et rend `{ proposition, deja }` : le même envoi
  refait (double clic, outil relancé) rend la proposition déjà décidée sans rien revalider ni renvoyer ; écarté
  (rejeté, annulé, expiré) ou parti depuis plus de 30 min, il peut être refait (l'ancienne proposition garde sa trace
  sous une clé close `…:<id>`). La route renvoie `deja` ; l'outil le dit (« nouvelle tentative sans effet, aucun
  second mail ») avec `donnees.deja` et `donnees.statut`.
- **Rien ne part pour un devis devenu caduc** : `executerPropositionValidee` relit `pertinente` avant d'exécuter ; un
  devis annulé ou remplacé entre la validation et l'envoi → proposition ANNULEE (« Sans objet au moment de
  l'exécution : … »), aucun mail, rien ne bouge.
- **Tâche rejouée** : déjà envoyée (trace `MAIL_ENVOYE`) mais sans les effets du devis (coupure juste après l'envoi) →
  les effets sont écrits, le mail ne repart pas ; rejouée encore → rien.
- **Écran** : la modale d'envoi relit le dossier tout de suite puis 8 s plus tard (le mail part par la file) ; message
  « Déjà envoyé » si `deja`. `PanneauDossier` passe `onRecharger` à `DocumentsDossier`.
- **Docs** : `docs/SYNCHRO.md` (ligne `DEVIS_ENVOYE`, règle « un seul mail par envoi », B2 retiré du tableau 4),
  `docs/MCP-COUVERTURE.md` (entrée B2, défaut 11 corrigé, test de DP60).

Décisions prises seul (solution la plus simple) :
- Le mail vaut l'annonce : pas de « Devis disponible » en plus (aucun nouvel envoi au client).
- Un `DEVIS_ENVOYE` par devis joint, écrit après `MAIL_ENVOYE` : l'historique dit « Devis … envoyé par mail à … » et la
  main lit « Devis envoyé : en attente de sa réponse ».
- La référence des relances lit déjà tous les `DEVIS_ENVOYE` (aussi ceux d'une mise en ligne) : la partie « relance
  depuis la mise en ligne » de B5 est donc faite ; B5 garde la notification « Devis disponible » à la mise en ligne.
- Fenêtre de 30 min pour l'idempotence d'un envoi déjà parti : une nouvelle tentative arrive dans les minutes ; un
  renvoi volontaire identique plus tard (« je ne l'ai pas reçu ») reste possible.
- Relecture de la pertinence à l'exécution pour toutes les propositions en file (mail, SMS, cartes) : même règle qu'à
  la validation.
- Un envoi par mail en Relance ramène le dossier en Devis envoyé (comme une mise en ligne).

Tests : 1 366 → 1 371 (`npm test` : 1 369 verts ; les 2 échecs sont ceux connus depuis B1, qui dépendent de la date
du jour : `mission-14-partie-8` « ouvert il y a 4 jours » et `mcp-mail` « lundi 9 h »). Nouveau `src/lib/dossiers/envoyer-par-mail.test.ts` (5 essais, état des deux
côtés, envoyeur d'essai en mémoire, rien ne sort du poste) : bouton → Devis envoyé, main au client, « Attendre
l'accord », lead DEVIS_ENVOYE, espace DEVIS, relance n°1 datée de l'envoi (décalée avec lui), ENVOYER_DEVIS cochée,
aucun « Devis disponible », double clic, tâche rejouée et même envoi refait sans effet (un mail, un `MAIL_ENVOYE`, un
`DEVIS_ENVOYE`, une proposition, état identique) ; outil confirmé puis relancé deux fois → une validation, un mail,
action posée à la main gardée ; devis annulé entre validation et envoi → rien ne part ; coupure après l'envoi → effets
écrits sans renvoi ; envoi écarté ou ancien → refaisable. Aucun test existant à adapter. `tsc`, `eslint` sur les
fichiers touchés, `npm run build` : propres.
Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils) ; description de `envoyer_document` changée : reconnecter le
connecteur.

Reste : B3-B13 ; B5 n'a plus que la notification à la mise en ligne ; rien pour Lucas, sauf reconnecter le connecteur.

### Mission 18, B3 — devis envoyé depuis Gmail (écart 3)

Livré (05/10, branche `mission-18`, pas de push, site non touché) :
- **Les PDF sortants sont gardés** (`mail/rattachement.ts › suitesDuTri`) : un mail SORTANT parti de la boîte (pas par
  le CRM), non automatique, rangé dans le dossier d'un client, met ses PDF en file (`MAIL_PDF_SORTANTS` →
  `conserverPdfSortants` → `messages/stockage.ts › conserverPieces(…, { seulementPdf: true })`, puis signal des tâches).
  Les photos de ce mail ne sont ni téléchargées ni rangées.
- **La tâche** `ENREGISTRER_DEVIS` « Enregistrer comme devis envoyé · X » (niveau 2, 2 min, une par PDF, clé
  `ENREGISTRER_DEVIS:dossier:<id>:<pièce>`, jamais écartée par une action posée à la main) : lecture du détecteur des
  dossiers, `dossiers/devis-gmail.ts › devisGmailNonEnregistres` — PDF conservé d'un tel mail, de moins de 30 jours,
  dossier vivant, nom qui évoque un devis (« devis », ou un numéro « 2026-012 » ; jamais une facture « F2026-… » ni une
  date), ni envoi du CRM (identifiant « crm: », `EnvoiMail` programmé ou `MAIL_ENVOYE` de proposition de même objet et
  même destinataire), ni déjà dans le CRM (devis de ce numéro déjà envoyé ou ailleurs, devis déposé depuis cette pièce,
  ou — sans numéro lisible — devis entré dans le dossier après le mail). Coche : « devis N enregistré comme envoyé depuis
  Gmail à hh:mm » (ou « déposé » / « envoyé » s'il est entré autrement).
- **Le geste en une fois** : raccourci `&devis=gmail&piece=<id>` (écran Tâches : la demande d'ouverture du panneau
  porte `devis: "gmail"`, `piece`) → la modale de dépôt (`ModaleDocumentExistant`, prop `pieceGmail`) préremplie par
  `GET /api/dossiers/[id]/devis-gmail` : numéro lu dans le nom du fichier (ou celui du registre), date du mail, montant
  du registre s'il y est, PDF du mail ; un clic si tout est connu. `POST` → `depot-document.ts › deposerDocument` avec
  la pièce du mail — la même fonction que l'outil `ajouter_fichier` (source `piece_mail`, désormais passée telle quelle
  par `enregistrerFichierRecu`, option `pieceMail`) — qui délègue à `devis-gmail.ts › enregistrerDevisGmail` :
  PDF vérifié (vide, 9 Mo, `%PDF-`) AVANT toute écriture, puis UNE transaction : devis repris « Envoyé », visible, PDF
  du mail écrit et rattaché (`enregistrerPdf` dans la transaction, fichier seul), événement `DEVIS_ENVOYE`
  (`canal: "GMAIL"`, `messageId`, `pieceId`, `envoyeLe` = date du mail), Q, S, Relance → Devis envoyé, point d'entrée
  (`DEVIS_ENVOYE` canal GMAIL : « Attendre l'accord », main). Effets externes après (lead, Meta, agenda, tâches).
  Rejoué pour la même pièce : `deja`, rien n'est écrit.
- **Devis du CRM envoyé depuis Gmail** : si un devis du CRM porte ce numéro et attend d'être envoyé (B1), le geste le
  passe « Envoyé » et visible (son PDF reste le sien), sans second dépôt ni montant à saisir ; ENVOYER_DEVIS se coche.
- **Relances depuis le mail** (`relances/service.ts › envoiDuDevis`, `referenceDuDevis`) : un envoi Gmail prend
  l'heure du mail, pas celle de l'enregistrement ; une émission datée au jour (midi) le même jour ne la repousse pas.
- **Docs** : `docs/SYNCHRO.md` (ligne `DEVIS_ENVOYE` canal GMAIL, paragraphe B3, B3 retiré du tableau 4),
  `docs/TACHES.md` (type, coche, exception à la vigueur), `docs/MCP-COUVERTURE.md` (entrée B3, ligne DP98).

Décisions prises seul (solution la plus simple) :
- Pas de lecture du texte du PDF (aucune bibliothèque) : montant saisi, ou repris du registre.
- Seuls les PDF du mail sortant sont conservés (pas les photos) ; seuls les PDF CONSERVÉS font une tâche (le geste a
  besoin du fichier) ; les mails relevés avant ce lot ne sont pas rattrapés (B13 / mise en route s'il le faut).
- Une tâche par PDF (et non par dossier) : chaque pièce a son geste et sa coche.
- L'événement `DEVIS_ENVOYE` est écrit maintenant (main au client « Devis envoyé : en attente de sa réponse ») et porte
  la date du mail dans `envoyeLe` (lue par les relances), plutôt qu'antidaté.
- Aucun mail ne part (le client a déjà le devis) ; le devis déposé est toujours visible et « Envoyé ».
- Constante de file dans `mail/rattachement.ts` (à côté de `MAIL_PIECES_DOSSIER`).

Tests : 1 371 → 1 376 (`npm test` : 1 374 verts ; les 2 échecs sont ceux connus depuis B1, qui dépendent de la date du jour : `mission-14-partie-8` et `mcp-mail`). Nouveau `src/lib/dossiers/devis-gmail.test.ts` (5 essais, état des deux côtés, rien ne sort du
poste) : noms de fichiers ; mail parti → file des PDF (pas pour un mail reçu), tâche une fois conservé, modale
préremplie, dépôt → Devis envoyé, main au client, « Attendre l'accord », lead DEVIS_ENVOYE, espace DEVIS, relance n°1
datée du mail (pas du dépôt), tâche cochée, aucun mail, rejoué sans effet ; devis du CRM masqué envoyé par Gmail →
« Envoyé » sans second dépôt, ENVOYER_DEVIS et ENREGISTRER_DEVIS cochées, action posée à la main gardée ; exclusions
(envoi « crm: », `EnvoiMail` et `MAIL_ENVOYE` de même objet et destinataire, plus de 30 jours, facture, devis déposé
après le mail, pièce d'un mail reçu = dépôt ordinaire) et faux PDF refusé avant toute écriture (aucun numéro inscrit,
étape inchangée) ; outil `ajouter_fichier` avec `pieceMail` → même enregistrement. Aucun test existant à adapter.
`tsc`, `eslint` sur les fichiers touchés, `npm run build` : propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53
outils) ; description de `ajouter_fichier` changée : reconnecter le connecteur.

Reste : B4-B13 (B13 : règle de cohérence `DEVIS_GMAIL_NON_ENREGISTRE` s'appuiera sur `devisGmailNonEnregistres`) ;
pour Lucas : l'agent mail doit être actif pour que les PDF sortants soient gardés ; reconnecter le connecteur.

### Mission 18, B4 — dépôt d'un bloc, devis déposé « accepté » = signé (écart 4)

Livré (05/10, branche `mission-18`, pas de push, site non touché) :
- **PDF vérifié avant toute écriture** (`documents-existants.ts › verifierPdf` : vide, 9 Mo, `%PDF-` ; la même
  vérification sert à l'import d'un PDF et au dépôt Gmail de B3) : `depot-document.ts › deposerDocument` (outil
  `ajouter_fichier`) la fait avant d'inscrire quoi que ce soit. Un faux PDF ne consomme aucun numéro, aucun document
  n'est créé, l'étape ne bouge pas : on peut réessayer avec le même numéro.
- **Un bloc** : `enregistrerDocumentExistant(dossierId, entree, { pdf })` écrit document, PDF (sous le numéro du
  registre, dans la transaction, fichier seul : `rattacherDocumentExistant` option `pdf`, comme `emettre`), étape,
  prochaine action et main dans UNE transaction ; si elle échoue, le PDF écrit quitte sa place (archives,
  « depot-annule »). B3 (`devis-gmail.ts`) passe par la même option : plus de fichier orphelin. Les suites passent par
  `suitesEvenementDossier` (agenda si la prochaine action a changé).
- **L'écran** : la modale « Enregistrer un document existant » envoie le PDF dans la même requête (formulaire
  `donnees` JSON + `pdf` ; `POST /api/dossiers/[id]/documents/existant` accepte aussi le JSON seul) ; l'ancienne route
  du PDF reste pour importer ou remplacer le PDF d'un document déjà repris (« Corriger »).
- **Devis déposé « accepté » sur un dossier pas encore signé → « Signé »** (nouveau `dossiers/devis-signe.ts ›
  signerParDevisAccepte`, `retenirDevis`) : depuis Qualification, Simulation, Devis envoyé ou Relance
  (`ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE`, constants.ts), dans la transaction du dépôt : les autres devis émis ou envoyés
  « non retenus », puis `changerEtapeDansTransaction(vers SIGNE, devisAccepteId, BON_POUR_ACCORD)` (main et statut du
  lead dans la transaction ; nouvelle option `raison` : « devis N déposé « accepté » (signé hors ligne) ; non retenu :
  … »), puis le point d'entrée avec `DEVIS_ACCEPTE` (« Appeler le client : fixer la date du chantier, suivre
  l'acompte » ; une action posée à la main reste, tâche `accord` à la place). L'historique du dépôt le dit (« …,
  accepté (signé hors ligne) »). Après : Meta SIGNE, agenda, tâches (ENVOYER_DEVIS d'un devis devenu non retenu se coche).
- **Même règle** pour un devis repris corrigé en « accepté » (`modifierDocumentExistant` : écran « Corriger », outil
  `modifier` DOCUMENT) et pour la correction du contrôle `DEVIS_ACCEPTE_AVANT_SIGNE` (elle signe au lieu de remettre
  le devis « émis » ; constat et correction réécrits, `COHERENCE_CORRIGEE` écrit dans la même transaction).
- **Déposé « accepté » ailleurs** (dossier déjà signé, en pause, perdu) : l'étape ne bouge pas, et plus de « Attendre
  l'accord » (événement `DEVIS_DEPOSE` avec `accepte`). La reprise d'un dossier entier ne signe jamais.
- **Ce que l'assistant et l'écran disent d'avance** : aperçu de `ajouter_fichier` (« Accepté (signé hors ligne) : le
  dossier passera de X à « Signé »… »), note et annulation partielle de `modifier` DOCUMENT, aide sous « Où en est ce
  devis » dans la modale, message après dépôt ; description du paramètre `statut` de `ajouter_fichier`.
- **Docs** : `docs/SYNCHRO.md` (lignes `DEVIS_ACCEPTE` et `DEVIS_DEPOSE`, paragraphe B4, B4 retiré du tableau 4),
  `docs/MCP-COUVERTURE.md` (entrée B4, DP57, ligne `ajouter_fichier`), `docs/COHERENCE.md` (`DEVIS_ACCEPTE_AVANT_SIGNE`).

Décisions prises seul (solution la plus simple) :
- Le PDF s'écrit DANS la transaction (une fois le numéro du registre connu), comme `emettre` et B3, plutôt qu'avant :
  le chemin dépend du numéro normalisé ; archivé si la transaction échoue.
- Étapes qui signent : les étapes actives d'avant « Signé » seulement (celles du contrôle de cohérence). En pause, l'étape
  d'avant la sortie peut être après « Signé » (avenant) ; un dossier perdu se reprend d'abord.
- `retenirDevis` sert ici seulement ; `changerEtapeDansTransaction` (passage « Signé » à l'écran) n'écarte toujours pas
  les autres variantes : B10 l'y branchera avec le paiement (comportement inchangé pour les autres chemins).
- Main après un dépôt « accepté » : celle de l'étape « Signé » (le client, pour l'acompte) ; la prochaine action dit à
  Lucas de fixer la date et de suivre l'acompte. Pas d'alerte « DEVIS SIGNÉ » : c'est Lucas qui l'enregistre.
- Correction de cohérence `DEVIS_ACCEPTE_AVANT_SIGNE` : elle signe (un devis noté « accepté » par Lucas vaut signature
  hors ligne) ; elle reste dans les corrections sensibles (elle change l'étape).
- La réponse de la route `existant` porte aussi `suites` (lecture seule, sans effet).

Tests : 1 376 → 1 383 (`npm test` : 1 381 verts ; les 2 échecs sont ceux connus depuis B1, qui dépendent de la date
du jour : `mission-14-partie-8` et `mcp-mail`). Nouveau `src/lib/dossiers/depot-atomique.test.ts` (7 essais, état
des deux côtés, rien ne sort du poste) : faux PDF et PDF tronqué refusés avant toute écriture (aucun numéro, aucun
document, aucun fichier, état identique des deux côtés), puis le bon PDF → Devis envoyé, main au client, « Attendre
l'accord », espace DEVIS, relance n°1, PDF rattaché ; transaction qui échoue après l'écriture du PDF → rien en base, PDF
retiré, état inchangé ; devis déposé « accepté » en Simulation avec un devis du CRM pas envoyé → Signé, lead SIGNE, main
de l'étape, prochaine action d'accord, espace ACOMPTE, plus de relance, l'autre devis NON_RETENU, ENVOYER_DEVIS
fermée, historique ; action posée à la main gardée + tâche `accord`, second devis « accepté » sur dossier signé sans
effet ; devis repris corrigé en « accepté » → Signé (une seule fois) ; route de la modale en formulaire (415 sans rien
écrire, puis 201 et Signé ; JSON seul accepté) ; contrôle de cohérence → la correction signe, l'incohérence disparaît.
Aucun test existant à adapter (les essais annoncés par le plan restent verts : le dossier « accepté » de
`documents-existants.test` est déjà signé, la reprise ne signe pas). `tsc`, `eslint` sur les fichiers touchés,
`npm run build` : propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils) ; description du paramètre `statut` de
`ajouter_fichier` changée : reconnecter le connecteur.

Reste : B5-B13 (B10 : brancher `retenirDevis` dans le passage « Signé » de l'écran et dans `suivreAcompteDossier`) ;
rien pour Lucas, sauf reconnecter le connecteur.

### Mission 18, B5 — devis rendu visible : mis en ligne et annoncé (écart 5)

Livré (05/10, branche `mission-18`, pas de push, site non touché) :
- **La mise en ligne d'un bloc** (`devis-envoye.ts › mettreEnLigneDevis`, à la place de `devisRenduVisible`, retiré) :
  un devis masqué (« Généré » ou « Envoyé ») rendu visible écrit, dans UNE transaction, la visibilité, l'événement
  `DEVIS_ENVOYE` (`canal: "ESPACE"`, « Devis N : visible dans l'espace client ») qui date l'envoi, le passage Q, S,
  Relance → Devis envoyé (« devis N rendu visible dans son espace »), puis le point d'entrée (nouveau canal `ESPACE` de
  l'événement `DEVIS_ENVOYE` de `synchro.ts` : « Attendre l'accord » à la place de « Préparer / Envoyer le devis »,
  action posée à la main gardée avec la tâche `devis` à la place, main écrite). Après : `suitesEvenementDossier` (lead,
  Meta, agenda, tâches : ENVOYER_DEVIS se coche « mis en ligne »). Deux appelants : `presentation-devis.ts ›
  modifierPresentationDevis` (interrupteur du bloc Espace, PATCH `…/documents/[documentId]`, outil `modifier` DOCUMENT)
  et `documents-existants.ts › modifierDocumentExistant` (devis repris corrigé visible, désormais dans la transaction
  de la correction).
- **L'annonce** (`devis-envoye.ts › annoncerDevisEnLigne`, après la transaction) : l'automatisme existant « Devis
  disponible » (`notifierClient`, clé `notif:DEVIS_DISPONIBLE:<devis>` : une fois par devis, masqué puis remis en ligne =
  pas de second mail ; interrupteur du modèle gardé) pour un devis du CRM encore « Généré ». Aucun mail pour un devis
  repris (fait ailleurs, déjà chez le client) ni pour un devis « Envoyé » (mail du CRM, Gmail). `modifierPresentationDevis`
  rend `annonce` (`{ mail, raison }`) ; la route la renvoie (avec la phrase dans `avertissements`) ; l'écran dit « Devis en
  ligne : le client est prévenu par mail », ou « Devis visible dans son espace. Aucun mail « Devis disponible » : … ».
- **Relance comptée depuis la mise en ligne, et dite ainsi** : la référence lisait déjà le dernier `DEVIS_ENVOYE` (B2) ;
  les textes datent maintenant l'envoi, plus l'émission (`relances/service.ts › dateDEnvoiDuDevis` : dernier envoi —
  mail, Gmail, mise en ligne — sinon l'émission ; le dépôt n'est pas un envoi). `DevisARelancer` gagne `envoyeLe` et
  `joursDepuisEnvoi` (`emisLe`, `joursDepuisEmission` gardés) : « envoyé il y a N jours » de la feuille Relances et de
  `lister` RELANCES, « devis N envoyé le jj/mm » de la tâche RELANCER_DEVIS, « que je vous ai adressé le … » du mail de
  relance n°1 et le résumé de sa proposition. `valableJusquau` ne bouge pas.
- **Outil `modifier` DOCUMENT** : la note de l'aperçu dit que la relance compte depuis la mise en ligne et si le mail
  « Devis disponible » partira (`peutNotifier`), ou pourquoi pas (devis fait ailleurs, déjà envoyé par mail, interrupteur,
  adresse, espace) ; le résultat dit s'il est parti ; l'annulation partielle dit que le mail parti ne se reprend pas.
- **Docs** : `docs/SYNCHRO.md` (ligne `DEVIS_ENVOYE` canal ESPACE, paragraphe B5, B5 retiré du tableau 4),
  `docs/MCP-COUVERTURE.md` (entrée B5, DP48, ligne DOCUMENT).

Décisions prises seul (solution la plus simple) :
- La mise en ligne par Lucas vaut envoi même quand le mail ne peut pas partir (pas d'adresse, espace fermé, interrupteur
  coupé) : c'est son geste explicite (mission 14, R1), il a pu prévenir le client autrement ; l'écran et l'outil disent
  pourquoi aucun mail n'est parti. (La règle de B1, « pas annoncé = pas envoyé », reste celle de la génération.)
- Pas de « Devis disponible » pour un devis repris ou déjà « Envoyé » : même raison que « un dépôt visible ne notifie
  pas » et « le mail vaut notification » (aucun envoi en plus au client).
- Remasqué puis remis en ligne : nouvel événement `DEVIS_ENVOYE` (la relance repart de la dernière mise en ligne), jamais
  un second mail (clé par devis).
- Le masquage garde son comportement (main relue, pas de retour d'étape) : c'est B6.
- « adressé le » (relance n°1) prend la date d'envoi ; « devis du … » (relance n°2) garde la date du devis.

Tests : 1 383 → 1 387 (`npm test` : 1 385 verts ; les 2 échecs sont ceux connus depuis B1, qui dépendent de la date du jour : `mission-14-partie-8` et `mcp-mail`). Nouveau `src/lib/dossiers/mise-en-ligne.test.ts` (4 essais, état
des deux côtés, réseau coupé, rien ne sort du poste) : Simulation, devis masqué rendu visible → Devis envoyé, main au
client, « Attendre l'accord », lead DEVIS_ENVOYE, espace DEVIS, ENVOYER_DEVIS cochée, historique (canal ESPACE,
passage), un « Devis disponible » programmé vers `#devis`, relance datée de la mise en ligne et décalée avec elle,
`envoyeLe`/`joursDepuisEnvoi`, « adressé le » de la date d'envoi, délai pas écoulé depuis la mise en ligne ; remasqué
puis remis en ligne → pas de second mail ; action posée à la main gardée + tâche `devis`, interrupteur coupé → en ligne
sans mail ; sans adresse → en ligne, raison dite ; devis repris masqué rendu visible par l'interrupteur et par la
correction → en ligne d'un bloc, aucun mail, relance depuis la mise en ligne ; outil `modifier` DOCUMENT → l'aperçu
annonce le mail, le résultat le dit, un seul mail. Aucun test existant à adapter. `tsc`, `eslint` sur les fichiers
touchés, `npm run build` : propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils), aucune description changée :
rien à reconnecter pour ce lot.

Reste : B6-B13 (B13 : règle de cohérence de l'écart 5, un devis visible « Généré » sans `DEVIS_ENVOYE` ni annonce) ;
rien pour Lucas.

### Mission 18, B6 — devis annulé ou masqué sans autre devis actif (écart 6)

Livré (05/10, branche `mission-18`, pas de push, site non touché) :
- **Le point d'entrée du retrait** (`devis-retire.ts › retirerDevis`, nouvel événement `DEVIS_RETIRE` de `synchro.ts`),
  dans la transaction du geste : `documents.ts › annulerDevis` (désormais une transaction interactive, garde contre le
  double clic), `presentation-devis.ts › modifierPresentationDevis` masqué (interrupteur, PATCH, outil `modifier`
  DOCUMENT, annulation de « rendre visible ») et `documents-existants.ts › modifierDocumentExistant` (devis repris
  corrigé masqué). S'il ne reste aucun autre devis en attente (visible « Généré », « Envoyé » ou « Non retenu », ou un
  devis accepté) et que le dossier est en Devis envoyé ou Relance :
  - retour RETOUR vers le `de` du dernier passage en « Devis envoyé » (Q ou S), sinon Simulation s'il y a une simulation
    publiée ou choisie, sinon Qualification ; statut du lead (CONTACTE) écrit dans la transaction, changement marqué
    synchronisé (`transitions.ts › marquerSynchronise`) ; pas de Meta ;
  - main à Lucas « Devis N annulé (masqué) : refaire le devis » : le CHANGEMENT_ETAPE porte `devisRetire` et
    `main.ts › passageDeMain` en fait un geste (aucun type d'événement nouveau) ;
  - prochaine action « Refaire le devis » (`PROCHAINE_ACTION_REFAIRE_DEVIS`, date du jour), action posée à la main
    gardée avec la tâche MANUELLE `devis-a-refaire` ; un nouveau devis la remplace (« Attendre l'accord » / « Envoyer
    le devis au client » : `devisAPreparerOuAEnvoyer` la reconnaît) ;
  - mails de relance EN_ATTENTE ou en ECHEC annulés (`relances/etape.ts › prefixeRelance`) : ceux du devis retiré, au
    retour ceux de tous les devis du dossier ; les relances calculées s'arrêtent d'elles-mêmes ;
  - tâche DEVIS « Refaire le devis · X » : `commercial/pilotage.ts` met ce motif en groupe DEVIS, le détecteur titre
    « Refaire le devis » (raison « devis N annulé le jj/mm ») sur ce motif ou quand un devis annulé existe dans le
    dossier ; cochée par le prochain devis visible.
  Avec un autre devis en attente : rien ne recule, seuls ses mails de relance sont annulés, main relue.
- **Écrans et outils** : la route d'annulation et le PATCH rendent la phrase du retour dans `avertissements`, les toasts
  la montrent ; `annuler_document` l'annonce à l'aperçu et la dit au résultat ; note de `modifier` DOCUMENT au masquage,
  annulation partielle de « rendre visible » réécrite.
- **Docs** : `docs/SYNCHRO.md` (ligne `DEVIS_RETIRE`, paragraphe B6, B6 retiré du tableau 4), `docs/COHERENCE.md`,
  `docs/MCP-COUVERTURE.md` (entrée B6, DP48, DP63).

Décisions prises seul (solution la plus simple) :
- Un devis « Non retenu » visible ou un devis accepté comptent comme en attente : le retour avant « Signé » les ferait
  revivre (`appliquerChangementEtape`) ; dans ce cas l'étape ne bouge pas.
- Devis annulé en Qualification ou Simulation (pas encore envoyé, B1) sans autre devis « Généré »/« Envoyé » : pas de
  retour, mais « Envoyer le devis » / « Attendre l'accord » (ou vide) devient « Refaire le devis » ; la main suit la
  règle (rien ne la force). Un masquage sans retour ne touche pas à la prochaine action.
- Au retour, « Refaire le devis » remplace toute prochaine action automatique (tout ce qui concernait le devis est
  dépassé) ; une action posée à la main reste toujours.
- Les mails de relance déjà validés (VALIDEE) ne sont pas touchés : l'exécution relit la pertinence (B2).
- La tâche « Refaire le devis » est la tâche DEVIS du détecteur (pas de type nouveau) ; elle est écartée, comme toutes,
  par une action posée à la main en vigueur, d'où la tâche MANUELLE à côté.

Tests : 1 387 → 1 394. Nouveau `src/lib/dossiers/devis-retire.test.ts` (7 essais, état des deux côtés, réseau coupé) :
annulé en Devis envoyé → Simulation, main, « Refaire le devis », lead CONTACTE, espace hors DEVIS, relances arrêtées,
mail de relance annulé, historique, rejoué refusé, nouveau devis qui repart et coche la tâche ; Relance → masqué →
Qualification puis remis en ligne ; autre devis en attente (rien ne recule, relance de l'autre gardée, puis le dernier
masqué → retour) ; action posée à la main gardée + une seule tâche ; devis pas encore envoyé annulé en Simulation ;
devis repris masqué par la correction ; outil `annuler_document`. Adaptés (comportement voulu) : `mission-14-partie-1`
(masqué/annulé : retour en Qualification, main « refaire le devis »), `mise-en-ligne` (remasqué → Simulation, remis →
Devis envoyé), `mcp-relecture-c` (texte de l'annulation partielle, étape revenue). `devis-multiples` vert sans
changement. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils), aucune description changée : rien à reconnecter.

Reste : B7-B13 (B13 : règle de cohérence de l'écart 6 — devis envoyé sans devis en attente, « Attendre l'accord » sans
devis) ; rien pour Lucas.

### Mission 18, B0, B1, B2, B3, B4, B5, B6 — corrections de la relecture

Livré (05/10, branche `mission-18`, pas de push, site non touché). Les 14 constats des trois relecteurs, et leur sort :
1. **B6 pas commité** (important) — réglé hors de ce commit : B6 est commité (`6f0eeec`) ; relu de nouveau ici, rien à
   reprendre sauf l'effet de la règle 2 (un devis visible pas encore envoyé compte comme « en attente » : l'étape ne
   recule pas, la tâche « Envoyer le devis » reste).
2. **Variante silencieuse tenue pour envoyée** (important, écart 1) — corrigé : `devis-envoye.ts › envoiALaGeneration`,
   une variante `notifier: false` après Simulation est visible mais PAS envoyée (pas d'étape, tâche ENVOYER_DEVIS) ;
   une variante en Relance ne repasse plus en Devis envoyé.
3. **Statut du lead après la transaction** (important) — corrigé : `passerEnDevisEnvoye` (génération annoncée hors
   `emettre`, mail, Gmail, dépôt, mise en ligne) et `emettre` écrivent le statut du lead dans la transaction et marquent
   le changement synchronisé (main écrite par le point d'entrée) ; `emettre` passe ses suites par
   `suitesEvenementDossier` (agenda, tâches). Essai : statut lu DANS la transaction.
4. **En pause non signé par un devis « accepté »** (mineur, écart 4) — corrigé : en pause depuis Q, S, Devis envoyé ou
   Relance → Signé (sortie de pause) ; perdu, ou en pause après la signature : rien (`devis-signe.ts ›
   estSigneeParDevisAccepte`, `constants.ts › signeParDevisAccepte` pour la modale ; aperçu de `ajouter_fichier`).
5. **Ancienneté des relances depuis l'émission** (mineur) — corrigé : `manager_operations` (`joursDepuis` depuis
   l'envoi, `envoyeLe` ajouté) et le tri de `listerRelances`.
6. **Suite `npm test` rouge (dates)** (mineur) — corrigé hors de ce commit (`49069e7`, `7765057`) ; le premier avait
   cassé « dates dictées » de `assistant.test` (« mardi » dit le mardi à l'heure visée tombait la semaine suivante) :
   `agenda.ts`, `<` au lieu de `<=` (à l'heure même : aujourd'hui). Suite verte.
7. **« Rappeler » d'un appel noté écrasé** (important) — corrigé : `prochaine-action-auto.ts › estRappelAVenir`, un
   « Rappeler… » daté d'aujourd'hui ou plus tard est gardé comme une action posée à la main (tâche à la place, raison
   « ton rappel « Rappeler » du jj/mm est gardé », agenda intact) ; passé d'un jour ou sans date, il ne tient plus.
   Choisi plutôt que de marquer les appels « manuels » : la vigueur et la main n'en sont pas changées.
8. **Case « visible » sans avertissement** (mineur) — corrigé : le libellé d'un devis du CRM « Généré » masqué dit que
   le rendre visible l'envoie, et l'écran demande confirmation (`window.confirm`, l'adresse du dossier) avant.
9. **`pertinente` avant la trace du mail** (mineur) et 12. **relecture pour tous les types FILE** (mineur) — corrigés
   ensemble : nouveau `dejaExecutee` des définitions (ENVOI_MAIL : trace `MAIL_ENVOYE` de la proposition ; ENVOI_SMS :
   SMS de clé `proposition:<id>`) ; un message déjà parti n'est plus relu, la proposition est notée EXÉCUTÉE, jamais
   « sans objet ». La relecture reste pour tous les types avant le départ (B6 compte dessus pour les relances validées).
10. **Deux règles de l'envoi** (important) — corrigé : une seule (`devis-envoye.ts › annonceAboutit`) pour la
    génération et la mise en ligne. Un devis du CRM jamais parti (`devisDejaParti` : ni « Envoyé », ni repris, ni déjà
    mis en ligne) rendu visible sans espace ouvert, ou sans adresse avec le modèle actif, est visible SANS être envoyé
    (`rendreVisibleSansEnvoi` : note, main relue, ni étape ni relance, ENVOYER_DEVIS reste) ; l'écran, le PATCH et
    l'outil le disent (`nonEnvoye`). Interrupteur coupé et espace ouvert : envoyé (décision 7).
11. **Relances sur un devis pas envoyé** (important) — corrigé : `chargerDossiersARelancer` écarte les devis de
    `devisAEnvoyer`, `sms/copie.ts › devisARelancer` les refuse.
13. **`ajouter_fichier` piece_mail sans montant** (mineur) — corrigé : avec le numéro, la pièce d'un mail parti de Gmail
    passe par `deposerDocument` (montant exigé seulement sans devis du CRM, comme l'écran) ; l'outil la tient pour
    sensible (aperçu, confirmation).
14. **Tâche « Attendre … » rangée pour Lucas** (mineur) — corrigé : `tache: false` pour SIMULATION_PUBLIEE et les
    « Attendre l'accord » (DEVIS_GENERE envoyé, DEVIS_DEPOSE, DEVIS_ENVOYE) ; les gestes du client gardent leur tâche.

Décisions prises seul (solution la plus simple) :
- Pas de bouton « Annoncer » pour un devis visible pas encore envoyé : il s'envoie par mail (`envoyer_document`, bouton
  du dossier), ou se remasque puis se remet en ligne une fois l'espace ouvert et l'adresse connue.
- Pas de numéro deviné du nom du fichier dans `ajouter_fichier` : l'aperçu ne le verrait pas (étape changée sans
  confirmation) ; le numéro reste à donner.
- Le statut du lead des autres changements écrits par `appliquerChangementEtape` (facture, relance, paiements) reste
  après la transaction : B12.

Tests : 1 397 → 1 406. Nouveau `src/lib/dossiers/relecture-b.test.ts` (7 essais, état des deux côtés, réseau coupé :
variante silencieuse en Relance, relances mail et SMS ; espace fermé puis rouvert ; lead dans la transaction ; en pause
→ Signé, et pas après la signature ; rappel gardé puis échu ; attente sans tâche ; ancienneté depuis la mise en ligne),
plus un essai dans `envoyer-par-mail.test.ts` (coupure puis devis annulé : EXÉCUTÉE, rien ne repart) et un dans
`devis-gmail.test.ts` (pièce du mail sans montant). Adaptés (comportement voulu) : `generer-envoyer` (règle),
`mise-en-ligne` (sans adresse : pas envoyé ; pas de tâche « Attendre »), `synchro` (pas de tâche « Attendre »),
`devis-retire` (seconde variante annoncée), `mcp-v3` (texte de la variante silencieuse), `mission-14-partie-1` (le
dossier reçoit une adresse avant la mise en ligne). Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils), aucune
description changée : rien à reconnecter.

Reste : B7-B13 ; rien pour Lucas.

### Mission 18, B9 — « Publier » depuis le bloc Espace (écart 9)

Livré (05/10, branche `mission-18`, pas de push, site non touché). B7 et B8 n'ont rien laissé dans la copie de travail
(agents morts avant d'écrire) : B9 part de `7c1d8a2`, B7 et B8 restent à faire.
- **Publier depuis le bloc Espace = le bouton « Publier ».** `simulations/dossier.ts › publierDansLEspace`, une
  fonction pour les deux : statut, événement `ESPACE_SIMULATION_DEPOSEE` (« republiée » pour une simulation masquée
  remise), point d'entrée SIMULATION_PUBLIEE dans UNE transaction ; puis les suites (agenda, tâches) et le mail
  automatique, même clé qu'avant (jamais deux mails pour la même simulation). `changerStatutSimulation(…, "afficher")`
  (interrupteur du bloc, PATCH `…/simulations/[sid]`, outil `publier` `reafficher`) y passe ; le SMS reste au bouton.
  Avant : ni étape, ni prochaine action, ni agenda, et la main seulement à la première publication.
- **Retirer une simulation choisie annule le choix.** Masquer, repasser en brouillon ou retirer une simulation du choix
  (la validée en mode UNE, ou celle de n'importe quelle zone d'un mélange : `validations.ts › simulationDansLeChoix`,
  en plus de `choisieLe`) dévalide le choix dans la MÊME transaction que le geste
  (`validations.ts › devaliderChoixDansTransaction`, extrait de `devaliderChoix`, raison dans l'historique : « (simulation
  masquée : titre) »). L'ancien retrait `espace/service.ts › retirerSimulation` (POST `…/espace/simulations/[sid]`)
  passe par `changerStatutSimulation(…, "retirer")` : il dévalide aussi (avant : archivait sans rien dire).
- **Qualification → Simulation porté par le point d'entrée.** `synchro.ts › raisonDuPassageEnSimulation` +
  `passerEnSimulation` : changement AUTOMATIQUE avec sa raison, statut du lead dans la transaction, marqué synchronisé,
  main écrite après par le point d'entrée. Événements : SIMULATION_PUBLIEE, CHOIX_VALIDE (`choisir`), PROJET_VALIDE
  (`validerProjet` : n'appelle plus `deplacerDossier` après coup ; la raison « projet validé dans l'espace client » est
  gardée, définie dans `synchro.ts` et réexportée par `validations.ts`, `devaliderProjet` et la cohérence la relisent),
  et le nouvel événement SIMULATION_DU_CLIENT : simulation créée par le client dans son espace
  (`preparation.ts › publierSimulationDuClient`, PUBLIEE seulement — gardée en brouillon pour relecture, elle suivra sa
  publication par Lucas) ou faite sur le site et rangée dans son espace (`synchroniserSimulationsSite` : décision du
  plan, la lecture qui écrit reste mais émet l'événement ; lectures avant la transaction, créations et point d'entrée
  dedans).
- `docs/SYNCHRO.md` : lignes PROJET_VALIDE, CHOIX_VALIDE, CHOIX_DEVALIDE, SIMULATION_PUBLIEE mises à jour, ligne
  SIMULATION_DU_CLIENT ajoutée, B9 retiré du tableau 4, paragraphe « Publier depuis le bloc Espace (B9) ».
  `docs/MCP-COUVERTURE.md` : DP44, DP45.

Décisions prises seul (solution la plus simple) :
- Republier une simulation masquée refait tout ce que fait une publication (événement, « Attendre le retour du client
  sur la simulation », main au client) ; seul le mail ne repart pas (même clé).
- Masquer la dernière simulation publiée ne fait PAS revenir le dossier en Qualification (rien ne le demande ; le
  retour du projet dévalidé garde sa règle).
- Un mélange dont une zone disparaît est dévalidé en entier (pas de choix partiel).
- Le passage en Simulation est AUTOMATIQUE avec raison, plus le changement « avancé » de `changerEtape` qu'utilisait
  `publierSimulations` : texte « Qualification → Simulation : simulation publiée dans son espace ».

Tests : 1 406 → 1 413. Nouveau `src/lib/dossiers/publier-espace.test.ts` (7 essais, état des deux côtés, réseau coupé :
bloc Espace contre bouton, même état ; masquée puis republiée, un seul mail et un seul passage ; action posée à la main
gardée sans tâche ; choix UNE masqué ; mélange dont une zone est retirée par l'ancien retrait ; `simulationDansLeChoix` ;
simulation du site rangée à la lecture → Simulation, lead CONTACTE, rejouée sans effet ; choix validé sur un dossier
revenu en Qualification). `mission-15-partie-5` complété (simulation du client publiée → Simulation, main au client ;
gardée en brouillon → Qualification ; publiée par Lucas → Simulation). Aucun essai existant cassé
(`espace.test`, `mcp-gestes` verts sans changement). Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils), aucune
description d'outil changée : rien à reconnecter.

Reste : B7, B8 (agents morts), B10-B13 ; rien pour Lucas.

### Mission 18, B10 — paiement par carte (Stripe), variantes retenues, « Mes documents » (écart 10)

Livré (05/10, branche `mission-18`, pas de push, site non touché : `EtapePaiement.tsx` appelait déjà `/paiement-carte`
avec `?projet=` et suit `paiementCarte`). La copie de travail n'avait aucun reste d'un agent précédent sur ce lot.
- **`src/lib/paiement/stripe.ts`** (aucune dépendance npm) : `stripeActif()` exige `STRIPE_SECRET_KEY` ET
  `STRIPE_WEBHOOK_SECRET` ; `corpsSession` (pure) et `creerSessionCheckout` (`fetch` REST, `Idempotency-Key`, 10 s) :
  `mode=payment`, `locale=fr`, montant en centimes, `metadata` (dossier, espace, nature, document) recopiées sur le
  paiement, retour `lienPourLeProjet()#paiement`, expiration 60 min, AUCUN `payment_method_types` (Klarna, Alma
  s'activent dans le tableau de bord Stripe, sans code) ; `verifierSignatureStripe` (pure : `t` + `v1` multiples,
  HMAC-SHA256 de `t.corps brut`, temps constant, 300 s, refus sans secret), `signerCommeStripe` (essais) ;
  `lireSessionPayee` (pure : `checkout.session.completed` payée ou `async_payment_succeeded`, euros seulement).
- **`src/lib/paiement/carte.ts`** : `aReglerParCarte` (le serveur seul : acompte du devis signé moins le reçu, sinon,
  chantier Facturé ou Encaissé, `faitsPaiements().resteCentimes` des factures) ; `preparerPaiementCarte` (409
  `carte-fermee`, `rien-a-regler`, `lien-revoque`) ; `enregistrerPaiementStripe` : sous `EXTERNE:stripe`,
  `enregistrerEncaissement` (moyen CARTE, origine STRIPE — type élargi —, `cleReprise: stripe:<session>`, référence
  `pi_…`, imputation sur le devis de la session s'il est en vigueur, sinon automatique), rejeu → DEJA (lecture de la clé,
  puis P2002), dossier inconnu → ignoré et journalisé ; puis alerte « Paiement par carte reçu » à Lucas (`prevenir`).
- **Routes** : branche `POST /api/espace/<jeton>/paiement-carte` (avant `projetDe(acces, true)` : un projet facturé paie
  son solde ; aperçu 403 ; 10 essais par IP) ; webhook `src/app/api/webhook/stripe/route.ts` (corps brut, 401 / 503
  sans secret, 400 corps illisible, 200 pour l'ignoré et le rejeu, 500 si l'écriture échoue : Stripe rejoue) ; entrée
  dans `routes-publiques.ts`. `service.ts` : `paiementCarte: stripeActif()`.
- **Point d'entrée `PAIEMENT_RECU`** (synchro.ts) : `enregistrerEncaissement` (écran, `saisir_encaissement`, Stripe)
  écrit encaissement, étape, statut du lead (changement marqué synchronisé), prochaine action et main dans UNE
  transaction ; après : effets du changement (Meta, « projet terminé », agenda), tâches, puis le mail « paiement reçu »
  existant. Signé par l'acompte : « Appeler le client : fixer la date du chantier (acompte reçu) »
  (`PROCHAINE_ACTION_ACOMPTE_RECU`, tâche `acompte-recu` niveau 1 sous une action posée à la main) ; autre paiement :
  efface seulement « réclamer un nouveau paiement ».
- **Variantes retenues** : `retenirDevis` déplacé dans `dossiers/devis-retenu.ts` (réexporté par `devis-signe.ts`, pour
  éviter l'import circulaire avec les transitions) ; `suivreAcompteDossier(…, devisId?)` signe sur le devis que règle
  l'acompte (`devisDesAcomptes` : imputations du paiement, à défaut celles du dossier, puis le plus récent), les autres
  NON_RETENU, raison « acompte encaissé ; non retenu : … » (le recul relit le préfixe) ; `changerEtapeDansTransaction`
  (écran, `changer_etape`, paiement à la signature) au passage « Signé » ; correction `PAIEMENT_AVANT_SIGNATURE` /
  `ACCORD_SANS_SIGNATURE` d'un bloc (devis des acomptes ou de l'accord). `piecesDuDossier` : un devis n'est actif
  qu'émis, envoyé ou accepté (`DEVIS_EN_VIGUEUR`) : l'imputation automatique ne vise plus un non retenu ou annulé.
- **« Mes documents »** (`compte.ts › statutFacture`, pure) : Annulée, puis d'après le registre « Réglée » / « Reste X € »
  / « À régler », repli sur l'étape ENCAISSE pour une facture reprise sans ligne au registre (corrige « Réglée » pour
  une facture annulée d'un dossier encaissé).
- Docs : `SYNCHRO.md` (ligne `PAIEMENT_RECU`, paragraphe B10, B10 retiré du tableau 4), `MCP-COUVERTURE.md` (entrée
  B10), `COHERENCE.md` (deux corrections), `ARCHITECTURE-PILOTAGE.md` (paiement par carte fait).

Décisions prises seul (solution la plus simple) :
- Le paiement par carte ne s'ouvre qu'après l'accord (onglet Paiement du site) : acompte seulement si un accord existe.
- Klarna et Alma restent enregistrés en « CARTE » (pas d'appel supplémentaire pour lire le moyen exact).
- Clé d'idempotence par dossier, nature, montant, nombre de paiements valides et fenêtre de 10 minutes : un double
  clic rend la même session, une session abandonnée n'est pas resservie expirée.
- `changerEtapeAvecPaiement` (signature avec acompte à l'écran) garde son chemin : il retient désormais les variantes
  (par `changerEtapeDansTransaction`) mais n'émet pas `PAIEMENT_RECU` (la prochaine action reste celle de l'écran).
- Pas de trace dans l'historique à l'ouverture de la page de paiement : seul le paiement reçu compte.

Tests : 1 413 → 1 426 (`npm test` : 1 426 verts). Nouveau `src/lib/paiement/paiement-carte.test.ts` (13 essais, état
des deux côtés, Stripe simulé, rien hors du poste) : signature (valide, mal signée, corps modifié, trop ancienne, secret
ou en-tête absents, rotation) ; lecture des événements ; corps de session (pas de moyen imposé) ; bouton masqué avec la
clé seule, 409 avant l'accord, aperçu 403, montant du serveur, retour `#paiement` ; webhook refusé sans rien écrire,
puis encaissé (CARTE, STRIPE, imputé sur le devis, espace CHANTIER, un mail), rejoué sans effet ; moyen différé ;
acompte Stripe sur la variante B d'un devis envoyé (Signé, A non retenu, lead SIGNE, prochaine action, main relue, plus
de relance) puis annulé (retour, A et B au choix) ; action posée à la main gardée avec la tâche ; « Signé » à l'écran
sur B ; correction de cohérence ; `statutFacture` ; solde par carte d'un chantier facturé → Encaissé, facture « Réglée ».
Aucun test existant à adapter. `tsc`, `eslint` sur les fichiers touchés, `npm run build` : propres. Empreinte MCP
inchangée (`040d6c7aa53c`, 53 outils), aucune description changée : rien à reconnecter.

Reste à Lucas : poser `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` sur Railway ; déclarer le webhook
`https://<crm>/api/webhook/stripe` (événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`) ;
activer Klarna et Alma dans Stripe s'il le souhaite ; laisser les reçus automatiques de Stripe DÉSACTIVÉS (sinon un
second mail au client) ; frais Stripe à saisir en dépense ; remboursement ou litige : annuler l'encaissement à la main.
Reste de la partie B : B7, B8, B11-B13.

### Mission 18, B11 — états en double : lectures du devis, teintes (écart 11)

Livré (05/10, branche `mission-18`, pas de push, site non touché). La copie de travail n'avait aucun reste d'un agent
précédent sur ce lot (seuls `src/proxy.ts` et les fichiers qui ne diffèrent que par CRLF).
- **Lectures du devis : le devis seul.** `espace/service.ts › noterConsultationDevis` n'écrit plus la copie de l'espace
  (`EspaceClient.devisConsultations`, `devisConsulteId`, `devisConsulteLe` : colonnes gardées, plus aucun lecteur) ;
  une première lecture (après une remise à zéro comprise) ouvre une nouvelle ligne `ESPACE_DEVIS_CONSULTE` au lieu de
  réécrire l'ancienne. `assistant/analyses/commercial.ts › devisEnAttente` (`manager_commercial`) lit
  `Document.consultations` de chaque devis (avant : la copie de l'espace, seul le dernier devis lu comptait).
  « Réinitialiser » l'étape Devis (`vue-crm.ts › gesteDeLucas`, écran et `geste_espace`) remet à zéro, dans une
  transaction, `consultations` et `consulteLe` de chaque devis du dossier (le déclencheur d'immuabilité les autorise),
  l'ancienne copie de l'espace et écrit sa ligne d'historique (`devisRemisAZero`) : le signal « relu sans signer » tombe,
  la lecture suivante repart de 1 et sonne de nouveau.
- **Teintes.** Nouveau `src/lib/espace/teintes-choix.ts` : `lireChoixEspace` (lecture unique du choix), `teinteDe`
  (déplacé de `devis-propose.ts`), `teintesParSousPartie` (pure : sous-parties cochées, sinon celles des surfaces,
  comme le devis proposé ; une sous-partie à deux zones les nomme toutes deux, 80 caractères), `zonesDuChoix`,
  `reporterTeintesDuChoix(tx, …, { remplacer })`. `choisir` (client, Lucas, `geste_espace` VALIDER_SIMULATION) reporte
  dans la transaction du choix les teintes sur les sous-parties qu'elles habillent ; les autres clés restent.
  `devaliderChoix` ne touche pas aux teintes. `suivi.ts` lit le choix comme `service.ts` (`choixLe` ET choix lisible).
- **Migration `etats-en-double-18`** (en fin de liste) : lectures, le devis prend le plus grand des deux compteurs
  (jamais abaissé) ; teintes d'un choix déjà validé, seulement pour les sous-parties sans teinte (rien de Lucas remplacé).
- Docs : `SYNCHRO.md` (ligne CHOIX_VALIDE, paragraphe B11, B11 retiré du tableau 4), `MCP-COUVERTURE.md` (entrée B11).

Décisions prises seul (solution la plus simple) :
- Un choix validé REMPLACE la teinte des sous-parties qu'il habille, même notée par Lucas avant (le choix est plus
  récent) ; une sous-partie dont le choix ne couvre qu'une zone (l'îlot avec le plan seul) prend la teinte de cette zone.
- La migration s'appelle `etats-en-double-18` (et non `consultations-devis-18` du plan) : elle reprend aussi les teintes.
  Sur la base, la copie de l'espace n'a jamais dépassé le devis depuis la mission 13 : la partie lectures ne devrait
  rien trouver.
- La remise à zéro vise tous les devis émis du dossier (l'étape Devis entière), pas seulement le dernier lu.

Constaté, laissé (règle voulue de `main.ts`, pas de ce lot) : quand Lucas valide une simulation à la place du client,
la main reste au client alors que la prochaine action est « Préparer le devis (simulation choisie) » ; à trancher en
B13 si besoin.

Tests : 1 426 → 1 433 (`npm test` : 1 433 verts). Nouveau `src/lib/espace/etats-en-double.test.ts` (7 essais, état des
deux côtés, réseau coupé) : lu deux fois → compté sur le devis seul, `manager_commercial` (par l'exécuteur MCP) et la
vue CRM le lisent, tâche « relu 2 fois sans signer » ; REINITIALISER DEVIS par `geste_espace` (aperçu, rien sans
jeton, puis le geste) → compteur à zéro, dossier et espace comme avant la lecture, tâche tombée, lecture suivante = 1
et nouvelle ligne d'historique ; migration des lectures ; choix du client (projet coché, îlot = façades basses + plan,
crédence gardée, teinte de Lucas remplacée), dévalidé (teintes gardées), mélange ensuite ; validé par Lucas (rien de
coché : surfaces) ; choix illisible lu pareil des deux côtés ; fonctions pures ; migration des teintes. Adaptés en
gardant leur intention : `mission-13-lot-5` (l'espace n'a plus de copie : `[null, 0]`), `espace-v2` (compte lu sur le
devis), `mission-17-partie-a` (sa migration n'est plus la dernière : après celles de la mission 15). `tsc`, `eslint`
sur les fichiers touchés, `npm run build` : propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils), aucune
description changée : rien à reconnecter.

Reste de la partie B : B7, B8 (agents morts), B12, B13.

### Mission 18, B13 — cohérence : les écarts de la partie B, d'un clic

Livré (05/10, branche `mission-18`, pas de push, site non touché). La copie de travail n'avait aucun reste d'un agent
précédent sur ce lot (seuls `src/proxy.ts` et les fichiers qui ne diffèrent que par CRLF).
- **Huit règles nouvelles** dans `coherence/controle.ts` (codes dans `CODES_INCOHERENCE`, tableau constant d'où vient le
  type) :
  - `DEVIS_ENVOYE_SANS_ENVOI` (écart 1) : Devis envoyé ou Relance, des devis, mais aucun n'a atteint le client (ni
    repris, ni « Envoyé »/accepté/non retenu, ni `DEVIS_ENVOYE`, ni `DEVIS_GENERE` marqué `envoye: true`, ni « Devis
    disponible » programmé ou parti, ni mail en cours d'envoi) et aucun visible dans un espace ouvert → retour d'avant
    le devis (RETOUR, `etapeAvantLeDevis` de B6), « Envoyer le devis au client » ;
  - `DEVIS_ENVOYE_SANS_DEVIS_ACTIF` (écart 6) : Devis envoyé ou Relance sans aucun devis émis, envoyé, non retenu ni
    accepté → retour, main « Devis N annulé : refaire le devis » (quand un devis annulé existe : `devisRetire`),
    « Refaire le devis » ;
  - `DEVIS_VISIBLE_NON_NOTIFIE` (écart 5) : visible dans un espace ouvert, jamais annoncé → mise en ligne datée
    d'aujourd'hui (`mettreEnLigneDevis` de B5 : relances depuis, Relance → Devis envoyé) puis « Devis disponible »
    (`annoncerDevisEnLigne`, une fois par devis) ; interrupteur coupé : rien à signaler (décision 7) ; sans adresse ou
    annonce en échec : correction à la main ;
  - `DEVIS_GMAIL_NON_ENREGISTRE` (écart 3) : `devisGmailNonEnregistres` de B3, clé par pièce ; correction =
    `enregistrerDevisGmail` (la fonction de la tâche) quand le devis du CRM ou le registre donne le montant, sinon à la
    main (la tâche) ; écarté du détecteur COHERENCE (`CODES_ECARTES`) : la tâche ENREGISTRER_DEVIS existe déjà ;
  - `AVENANT_NON_PROPOSE` (écart 7) : Signé → Facturé, devis « Généré » émis après l'accepté, ni mail en cours, ni
    « à envoyer » (B1, qui a sa tâche) → `envoyerDocumentParMail` avec le texte type (`brouillonEnvoiDocument`, le
    bouton « Envoyer par mail ») ; sans adresse : à la main ;
  - `ATTENTE_ACCORD_SANS_DEVIS` : « Attendre l'accord… » (pas posée à la main) sans devis émis ou envoyé → effacée ;
  - `DATE_CHANTIER_EN_SIGNE` : Signé avec une date de chantier → Planifié (AUTOMATIQUE, lead CHANTIER_PLANIFIE dans la
    transaction), « … fixer la date du chantier … » effacée ;
  - `ESPACE_ACTIF_DOSSIER_CLOS` (remplace `ESPACE_ACTIF_DOSSIER_ARCHIVE`, qui ne voyait que les archivés sans espace
    permanent) : projet d'un dossier archivé resté ouvert (fermé comme l'archivage), ou lien actif alors que TOUS les
    projets de l'espace sont perdus ou archivés (`desactiverLien`, rien n'est effacé). Sujet de la tâche : le lead.
- **Point d'entrée** : nouvel événement `CORRECTION_COHERENCE { code }` (`synchro.ts`) pour les écarts 1 et 6,
  « Attendre l'accord » et la date du chantier (prochaine action ; une action posée à la main n'est jamais écrasée :
  tâche `devis-a-refaire` / `devis-a-envoyer` à côté). Écarts 5 et 3 : `DEVIS_ENVOYE` (canaux ESPACE, GMAIL) par leurs
  fonctions ; écart 7 : l'envoi par mail de B2.
- **`appliquerCorrection(incoherence)`** extraite (la correction d'une incohérence déjà lue, sans rejouer le contrôle ;
  chacune relit ce qu'elle touche et refuse en 409 si le dossier a bougé) ; `corrigerIncoherence` rejoue puis l'appelle.
  **`controlerCoherence({ etendu: true })`** lit aussi perdus et archivés (`AVEC_ARCHIVES`) : statut du lead, doublons
  et main jamais sur un archivé ; un perdu n'impose « PERDU » au lead que sans autre dossier vivant ; règles des devis
  sur les dossiers vivants seulement. Prêts pour la mise en route.
- **`COHERENCE_CORRIGEE` pour tous les codes** (helper `tracer`, dans la transaction quand il y en a une).
- **Sensibles** : `CORRECTIONS_SENSIBLES` vit maintenant dans `controle.ts` (gestes.ts l'importe) = toutes les
  corrections qui changent l'étape (`CORRECTIONS_QUI_CHANGENT_L_ETAPE`, figée par un essai) + `SIGNE_SANS_DEVIS_ACCEPTE`
  + `AVENANT_NON_PROPOSE` (mail). `devis-retire.ts › annulerRelancesEnAttente` extraite de `retirerDevis` (même code).
- Docs : `COHERENCE.md` § 5 (tous les codes, colonne « S », les 4 qui manquaient), `SYNCHRO.md` (ligne
  `CORRECTION_COHERENCE`, paragraphe B13, B13 retiré du tableau 4, § 5), `MCP-COUVERTURE.md` (entrée B13, ligne
  CORRIGER_INCOHERENCE).

Décisions prises seul (solution la plus simple) :
- Écart 7 « en un clic » = l'envoyer par mail (texte type), seule façon de le proposer tant que le site ne montre pas
  les avenants (B7, pas fait) ; quand B7 sera là, la règle devra tenir « visible dans un espace ouvert » pour proposé.
- Écart 3 en un clic seulement si tout est connu (devis du CRM ou montant du registre), sinon la tâche de B3.
- `PROJET_VALIDE_INCOMPLET` devient sensible : dévalider peut faire revenir Simulation → Qualification (le trou que le
  plan signalait). `SIMULATIONS_HORS_DOSSIER` ne change pas l'étape lui-même (le rangement dans l'espace se fait à la
  lecture) : non sensible.
- Un projet perdu dans un espace qui a d'autres projets vivants n'est PAS une incohérence (« non réalisé », par
  conception) ; un espace dont un projet est encaissé garde son lien (révocation à 90 jours). Pour un perdu, seul le
  lien du client est coupé (le projet reste, il réapparaît si le lien est régénéré) ; un archivé ferme aussi son projet.
- Ancienne tâche « Corriger » d'un `ESPACE_ACTIF_DOSSIER_ARCHIVE` : cochée « incohérence corrigée » au passage suivant,
  la nouvelle clé la remplace.
- Une proposition d'envoi par mail validée et pas encore exécutée vaut « parti » (pas d'écart 1 ou 5 pendant l'envoi).
- Constaté en B11, laissé : la main reste au client quand Lucas valide une simulation à sa place (règle voulue de
  `main.ts`, aucune règle de cohérence ne la contredit).

Tests : 1 433 → 1 443 (`npm test` : 1 443 verts). Nouveau `src/lib/coherence/coherence-b13.test.ts` (10 essais, état des deux
côtés, réseau coupé, rien hors du poste) : écart 6 (retour en Simulation, main « refaire », « Refaire le devis », lead
CONTACTE, espace hors DEVIS, relances arrêtées et mail de relance annulé, tâche DEVIS « Refaire le devis », trace,
corrigé une seule fois) ; écart 1 (action posée à la main gardée, tâche « Envoyer le devis au client » à côté) ; écart 5
(un seul « Devis disponible », Devis envoyé, « Attendre l'accord », espace DEVIS, relance repartie d'aujourd'hui ;
interrupteur coupé : rien ; sans adresse : à la main) ; écart 3 (un clic : Devis envoyé, tâches ENREGISTRER_DEVIS et
ENVOYER_DEVIS cochées, aucun mail, pas de seconde tâche « Corriger » ; sans montant : à la main) ; écart 7 (proposition
d'envoi validée, étape et espace inchangés, variante silencieuse gardée à sa tâche) ; « Attendre l'accord » sans devis
(effacée ; posée à la main : jamais signalée) ; date du chantier (Planifié, lead, espace CHANTIER) ; espaces clos (perdu
seul : lien coupé, projet gardé, aucun envoi ; perdu à côté d'un vivant : rien ; archivé : projet et lien) ; contrôle
étendu + `appliquerCorrection` ; liste figée des corrections qui changent l'étape, toutes sensibles, chaque code dans
`COHERENCE.md`. Aucun test existant à adapter (`coherence.test`, `mission-14-partie-1`, `migrations/mission-13`,
`systeme.test`, `main.test` verts sans changement). `tsc`, `eslint` sur les fichiers touchés, `npm run build` :
propres. Empreinte MCP inchangée (`040d6c7aa53c`, 53 outils) ; description de `agir_systeme` changée : reconnecter le
connecteur.

Reste : B7, B8, B12 (agents morts), puis la mise en route (migration `mise-en-route-18` : `controlerCoherence({ etendu:
true })` une fois, `appliquerCorrection` pour les codes hors `CORRECTIONS_SENSIBLES`, tâches pour le reste) ; rien pour
Lucas, sauf reconnecter le connecteur.

### Mission 18, MR — mise en route : contrôle étendu, réparations sûres, le reste en tâches

Livré (05/10, branche `mission-18`, pas de push, site non touché). La copie de travail n'avait aucun reste d'un agent
précédent sur ce lot (seuls `src/proxy.ts` et les fichiers qui ne diffèrent que par CRLF).
- **Migration `mise-en-route-18`** (`src/lib/base/migrations/mission-18-mise-en-route.ts`, dernière de
  `MIGRATIONS_DONNEES`, après `etats-en-double-18`). Elle tournera au démarrage qui suit le push de `main`, après la
  sauvegarde automatique d'avant migration (`executerMigrationsDonnees`). Base vide : rien. Sinon : UN
  `controlerCoherence({ etendu: true })` (perdus et archivés compris) ; `appliquerCorrection` (la fonction du bouton
  « Corriger », sans rejouer le contrôle) pour chaque code qui a une correction hors `CORRECTIONS_SENSIBLES` ; le reste
  au détecteur COHERENCE s'il le voit (un contrôle ordinaire le dit), sinon (dossier perdu ou archivé) une tâche à moi
  `MANUELLE:coherence-18-<clé>`, lot « coherence-18 », constat + correction proposée « à décider : jamais appliquée
  d'office » (P2002 ignoré) ; puis `invaliderCoherence` et signal des tâches. Ne lève jamais (échec compté, le démarrage
  continue).
- **Lisible après le déploiement** : journal de démarrage (`[migration mise-en-route-18] N dossiers contrôlés (perdus et
  archivés compris) : … écarts trouvés, … réparés, … tâches à moi, … au détecteur, … échec`, puis une ligne par règle ;
  clients en initiales) et `etat_crm` SANTE (nouvelle ligne « Dernières migrations » : les trois dernières ; pour
  celle-ci, par règle « CODE n trouvés, m réparés, k en tâche, j au détecteur » ; `lecture.ts › texteMigration`).
  Résumé en base : `dossiersControles`, `trouves`, `repares`, `taches`, `detecteur`, `echecs`, et `<compteur>.<CODE>`
  non nuls.
- Docs : `SYNCHRO.md` § 7 (nouveau), `COHERENCE.md` § 5 (paragraphe), `MCP-COUVERTURE.md` (entrée mise en route).

Décisions prises seul (solution la plus simple) :
- Réparations appliquées d'office = les codes non sensibles qui ont une correction (`ATTENTE_ACCORD_SANS_DEVIS`,
  `ESPACE_ACTIF_DOSSIER_CLOS`, `STATUT_DU_LEAD`, `MAIN_DECALEE`, `PROCHAINE_ACTION_PERIMEE`, `CHOIX_SANS_SIMULATION`,
  `PROJETS_AU_DELA_DE_LA_LIMITE`). Aucune ne change l'étape : la consigne « nature REPRISE quand une étape bouge » n'a
  donc pas à jouer (aucune correction sensible n'est appliquée, aucune conversion Meta ne peut partir).
- `SIMULATIONS_HORS_DOSSIER` n'est pas appliqué par la migration : le filet des 15 minutes (`rattraperSimulationsSansDossier`)
  fait la même chose et range aussi dans l'espace (avec une alerte à Lucas et un miroir Drive : pas au démarrage).
- « Le reste » sur un dossier vivant n'écrit rien (le détecteur le remonte en « Corriger · Nom ») ; « vu du détecteur »
  se décide par un second contrôle, ordinaire, après les réparations (et non par une liste de codes, fragile).
- Tâches de la mise en route : sujet DOSSIER, raccourci « Ouvrir le dossier », niveau 5 ; une tâche MANUELLE ne se
  coche jamais par absence (Lucas y répond ou « Tout classer » le lot).
- SANTE : la ligne « Dernières migrations » est ajoutée sans changer ni paramètre ni description : empreinte inchangée.

Tests : 1 443 → 1 446 (`npm test` : 1 446 verts). Nouveau `src/lib/base/mission-18-mise-en-route.test.ts` (3 essais,
réseau coupé, Meta « configuré » avec des valeurs factices pendant la migration) : base vide (passée au démarrage,
résumé à zéro, dernière de la liste, après `etats-en-double-18`, aucune tâche) ; un cas par règle — « Attendre
l'accord » sans devis effacée (et posée à la main : gardée, jamais signalée), prochaine action périmée effacée, main
décalée remise « à moi » (message du client sans réponse), choix d'une simulation invisible dévalidé (espace revenu
aux photos), Signé avec date de chantier laissé (sensible) et remonté par le détecteur avec le lead aligné « SIGNE »,
perdu (lead PERDU, lien coupé, projet gardé), archivé en « Signé » sans devis accepté (projet et lien fermés, devis
intact, tâche à moi en lot, pas cochée par une passe) — avec le résumé exact, aucun CHANGEMENT_ETAPE, aucun mail,
aucune conversion Meta mise en file, une trace COHERENCE_CORRIGEE par réparation, état des deux côtés ; rejouée : 0
réparation, 0 tâche ; ligne SANTE lue par l'outil ; texte d'une migration, initiales, codes laissés au filet. Aucun
test existant à adapter. `tsc`, `eslint` sur les fichiers touchés, `npm run build` : propres. Empreinte MCP inchangée
(`040d6c7aa53c`, 53 outils), aucune description changée : rien à reconnecter pour ce lot.

Reste : B7, B8, B12 (agents morts). En production : avant de déployer, lire « [sauvegarde] Volume » (volume plein =
CRM qui ne démarre pas) ; après, lire la ligne de la migration au journal ou `etat_crm` SANTE, puis le lot
« coherence-18 » dans Tâches.
