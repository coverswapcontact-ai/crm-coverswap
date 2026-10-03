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
