# Calibrage de gpt-image-2.5-sunburst pour le simulateur — mission 24 (07/10/2026)

Branche `mission-24-sunburst` (worktree séparé), menée en parallèle de la mission 23 sans la gêner : rien n'a été modifié
dans le simulateur en production, ni dans les réglages du CRM, ni dans `docs/REPRISE-MISSION.md`, et **aucune ligne n'a
été écrite en base** (`GenerationImage` n'a pas été touchée ; le plafond de la mission 23 s'y lit). Rien n'a été publié,
envoyé ni déposé dans un dossier. Les photos et les rendus restent sur le poste, hors de tout dépôt
(`~/coverswap-photos/sunburst-24/`). Ce rapport ne cite aucun client : les photos portent des identifiants anonymes
(p01 à p12, v01 à v04).

**Conclusion.** Sunburst est prêt pour le simulateur sur les **sombres mat**, les **complexes / sourds** et les **bois
foncés**, et sur les **blancs** avec la correction de couleur après rendu. Il ne l'est pas encore sur les **beiges /
taupes** ni sur les **bois clairs**, qui sortent trop froids et que ni le prompt ni la correction ne recalent de façon
stable. Deux conditions s'appliquent dans tous les cas : le prompt C1 et un masque de zone troué (C3). Or le simulateur
n'a aujourd'hui aucun masque de zone (voir § 6.2).

## 1. Ce qui a été fait, en bref

| Étape | Rendus | Coût réel | Enveloppe |
|---|---|---|---|
| 0 — Préparation (lot, teintes, score) | 0 | 0 $ | — |
| 1 — Exploration | 12 | 0,5058 $ | 0,575 $ (25 %) |
| 2 — Correction | 25 | 1,0611 $ | 1,150 $ (50 %) |
| 3 — Validation | 8 | 0,3385 $ | 0,460 $ (20 %) |
| Réserve | 0 | 0 $ | 0,115 $ (5 %) |
| **Total** | **45** | **1,9054 $** | **2,30 $** |

- Coût par rendu, calculé à partir des jetons facturés dans chaque réponse et des prix de `prix.ts` : 5 $ (texte),
  8 $ (image) et 30 $ (sortie) par million de jetons. Un rendu coûte 0,0420 à 0,0431 $ (≈ 1 850 jetons de texte,
  2 828 d'image et 343 de sortie, en qualité medium). Le premier rendu, lancé seul, a coûté 0,0421 $, sous le seuil
  d'arrêt de 0,15 $.
- Le cumul était affiché après chaque rendu. Le plafond de chaque phase et celui de 2,30 $ étaient relus avant chaque
  appel (`rendre.ts`). Il reste 0,39 $ non dépensés.
- Aucun rendu raté n'a été relancé. Aucun appel n'a échoué.

## 2. Préparation (étape 0, gratuite)

**Le lot.** Les photos viennent de l'export du jeu d'essai de la mission 23 (113 simulations, 42 photos « avant »
distinctes après dédoublonnage par empreinte), complété par deux photos lues dans le CRM par le connecteur MCP, en
lecture seule : la version pleine résolution d'une photo en contre-jour, et une capture d'écran de téléphone qui n'était
pas dans l'export. Les trois clients nommés dans la consigne ont été retrouvés. Deux images ont été écartées après
vérification à l'œil : une « photo » qui était en réalité une image d'ambiance générée, et une seconde vue d'une cuisine
déjà présente dans le lot.

| Id | Rôle | Ce qui la rend difficile |
|---|---|---|
| p01 | exploration | contre-jour fort, voile, cuisine en U crème |
| p02 | exploration | capture d'écran de téléphone (photo d'annonce dans l'écran, bandes blanches) |
| p03 | exploration | îlot et péninsule gris brillant, reflets |
| p04 | exploration | cuisine noire mate, îlot, suspensions (lumière mixte) |
| p05 | exploration | petite cuisine encombrée, grand-angle |
| p06 | exploration | grande cuisine linéaire, lumière froide |
| p07 | exploration | lumière chaude du soir, ampoule nue |
| p08 | exploration | portes à cadres laquées blanches, boutons noirs |
| p09 | exploration | U blanc et bois, encombré, poubelle accrochée |
| p10 | exploration | bois clair, portrait, grandes barres de poignée |
| p11 | exploration | bas blancs à cadres, voilages en contre-jour léger |
| p12 | exploration | L bleu nuit à panneaux, deux fenêtres |
| v01 | validation | capture d'écran (photo réduite dans l'écran, filigrane) |
| v02 | validation | contre-jour fort (plafonnier), hauts blancs brillants |
| v03 | validation | soirée, lumière chaude, îlot-table encombré |
| v04 | validation | grande cuisine noire brillante, réfrigérateur américain |

Les quatre photos de validation n'ont été ouvertes qu'à l'étape 3, pour y dessiner leurs masques.

**Les teintes difficiles**, choisies par famille d'après les échecs mesurés en production par la mission 23 (AA17
« texture perdue », RM30 trop vert, unis clairs jaunis, sourds sursaturés…). RM30 existe bien au catalogue (Pastel Olive
Green, #A4A38F).

| Famille | Références |
|---|---|
| Bois veinés | AA17 Beige Line Oak #B1946F · AA14 Original Oak #6B5138 · AA05 Honey Oak #362318 |
| Sombres mat | K1 Black Mat #232220 · M9 Midnight Blue #2B2E37 · NF13 Deep Green #23342E |
| Blancs laqués | J4 Lacquered White #F4F3F1 · N3 Porcelain #F1E4D3 · J3 Ultra White #FFFFFF |
| Taupes / beiges | K4 Khaki #97876D · NE55 Caffe Latte #B59C7E · M7 Sand Beach #C2B7A3 |
| Complexes / sourds | RM30 Pastel Olive Green #A4A38F · RM21 Army Green #4D583A · NE24 Raw Grey #A9A49E |

Vérification faite, l'image d'échantillon de la planche a exactement le hex du catalogue (ΔE 0 à 0,6). La dérive de
couleur vient donc du modèle, pas de la planche (`echantillons.ts`).

**Les masques.** Un polygone par façade a été dessiné à la main sur une grille de 5 % de la photo, telle que le pipeline
la cadre (`cadrerPourGeneration`, mode rogner), puis vérifié à l'œil en surimpression. Après l'exploration, ces masques
ont été élargis à toute la zone que le prompt désigne (colonnes, îlot) : Sunburst suit la zone du prompt plus que le
masque (§ 3).

**Le score automatique** (`score.ts`, sur 100), recalculé sur tous les rendus à chaque changement de méthode
(`rescorer.ts`) :
- **couleur, 45 pts** : ΔE 2000 entre la médiane Lab du rendu dans le masque (érodé, poignées et joints exclus) et le
  hex du catalogue, après balance des blancs automatique prise hors de la zone (règles de `mesure-rendu.ts`). 45 pts
  pour ΔE ≤ 1, 0 pour ΔE ≥ 10. Le ΔE « à clarté égale » et la dérive (L, a, b, C) sont relevés à côté ;
- **fidélité hors masque, 25 pts** : écart des contours hors de la zone dilatée (cartes de bords de `planches.ts`) et
  dérive de couleur par blocs de 24 px (une pièce rééclairée ressort ; un décalage d'un pixel sur un carrelage, non) ;
- **structure, 15 pts** : part des bords francs de la photo *dans* la zone (poignées, joints, cadres) absents du rendu.
  Ce critère a été ajouté après l'essai C3, quand il est apparu que le score ne voyait pas les façades redessinées.
  Les seuils sont pris dans la zone, image par image ;
- **finition, 15 pts** : la texture (écart-type local de L*) doit correspondre à la classe (un uni reste lisse, un bois
  garde son fil), et la part de reflets francs doit correspondre au profil (un film mat en a peu, un laqué en a).

Contrôle gratuit avant toute dépense : la photo dont la zone est peinte au hex exact, sous la lumière de la scène,
obtient ΔE 0,2 à 1,0 et une fidélité de 30 / 30 (`essai-score.ts`). Chaque rendu a en plus été regardé à l'œil, à côté
de l'avant.

**Limites du score**, à garder en tête en lisant les chiffres :
- le ΔE total d'une scène sombre ou du soir (p07, v03) est dominé par la clarté, qui se mesure contre un « blanc de
  scène » incertain. La mission 23 avait fait le même constat. Le ΔE à clarté égale est plus fiable ;
- le masque de p07 englobe le four et des chaises : ses mesures de couleur sont tenues hors des statistiques ;
- le critère structure compte comme perdus les fils d'un bois remplacé par un uni.

## 3. Exploration (étape 1) — les défauts récurrents, par famille

Les 12 rendus ont utilisé le pipeline tel quel : prompt V2 du moteur, planche étiquetée avec description de la teinte,
masque, qualité medium, une paire photo / teinte différente à chaque rendu.

| Défaut | Fréquence | Familles touchées |
|---|---|---|
| **D1 — façades redessinées** : poignées supprimées, cadres et moulures effacés (portes lisses), nombre de tiroirs changé, électroménager ou objet ajouté / retiré | 9 rendus sur 12 | toutes (unis surtout) |
| **D2 — photo rééclairée** : contre-jour, voile et soirée « corrigés » en photo de jour | 4 sur 12 (p01, p07, p11, p12) | toutes |
| **D3 — couleur** : les beiges sortent plus gris et plus froids (NE55 C* −9, b −8,6 ; K4 b −4,7), les blancs un peu bleutés (J4 b −4,3), le chêne foncé refroidi (AA14 b −6,3) ; les sombres mat sont justes (ΔE à clarté égale 3 à 4) ; les sourds gardent la bonne teinte mais sortent plus foncés (RM30 L −8,6) | systématique, de 2 à 9 en C* | beiges, blancs, bois foncés |
| **D4 — masque non strict** : le modèle change toute la zone du prompt (colonnes, îlot) même hors masque | 4 sur 12 | toutes |

Ce que Sunburst fait bien d'emblée : le cadrage est conservé au pixel près, sans décalage ni zoom (la mission 23 avait
relevé 69 % de masques douteux avec gpt-image-1, aucun ici). Le veinage des bois est crédible et à l'échelle, et une
capture d'écran est traitée proprement : les bandes de l'écran sont gardées.

Le jugement à l'œil de chaque rendu d'exploration :
- n°1 (p06, RM30) : cadrage exact, teinte juste mais un peu sombre ; poignées des tiroirs supprimées ; colonne haute
  hors masque changée aussi (zone du prompt).
- n°2 (p01, K4) : pièce entièrement rééclairée (contre-jour effacé, fenêtre redessinée) ; K4 sort beige clair crème au
  lieu d'un kaki brun-gris ; poignées gardées.
- n°3 (p02, J4) : capture d'écran gérée ; blanc laqué propre mais bleuté ; poignées supprimées, 4 tiroirs devenus 2.
- n°4 (p03, AA17) : très bon (chêne veiné crédible) ; colonnes et meubles du fond changés aussi ; pièce un peu
  rééclairée.
- n°5 (p04, NE55) : beau rendu ; NE55 trop gris et trop froid ; étagères inventées sur le mur.
- n°6 (p05, AA14) : bon, veinage juste, un peu plus froid que l'échantillon.
- n°7 (p07, N3) : scène du soir rééclairée en jour ; colonnes redessinées (four déplacé).
- n°8 (p08, M9) : bleu nuit juste ; portes à cadres devenues lisses, boutons supprimés, meuble haut agrandi.
- n°9 (p09, NF13) : vert profond excellent ; cadres, poignées et poubelle supprimés, tiroirs fusionnés.
- n°10 (p10, RM21) : kaki armée juste et mat ; toutes les poignées supprimées, 3 tiroirs devenus 2.
- n°11 (p11, AA05) : couleur parfaite (ΔE 0,8) ; portes à cadres devenues lisses, poignées supprimées.
- n°12 (p12, M7) : contre-jour effacé ; portes à panneaux devenues lisses, poignées changées.

## 4. Correction (étape 2) — un changement à la fois

Chaque changement a été testé sur 2 photos différentes d'une même famille, en tournant dans le lot, contre la version
en vigueur, et gardé seulement s'il améliorait le score sur les deux (scores ci-dessous recalculés avec le score
final).

| Essai | Ce qui change (une seule chose) | Cible | Photo A | Photo B | Décision |
|---|---|---|---|---|---|
| **C1** — formulation : lumière | Le ROLE ne demande plus une photo « de professionnel » ; le bloc PHOTOGRAPHIC QUALITY (exposition équilibrée, balance neutre, retouches globales autorisées) est remplacé par LIGHT AND EXPOSURE OF THE PHOTO (garder l'exposition, la balance, le voile, le contre-jour tels quels ; ne rien éclaircir ni embellir) | D2 | p01 K4 : 25,1 → 27,3 | p12 M7 : 29,3 → 34,1 | **gardé** (à l'œil : contre-jour et voile conservés) |
| **C2** — formulation : façades | « one clean, monolithic surface » retiré ; règle « RE-SKIN, NOT A NEW KITCHEN » (contours, cadres, moulures, poignées, nombre de façades gardés) | D1 | p06 RM30 : 57,6 → 66,9 | p10 RM21 : 69,7 → 69,5 | **rejeté** : poignées toujours supprimées, et un réfrigérateur pelliculé |
| **C3** — masque troué | Les détails de la photo dans la zone (pixels qui s'écartent de plus de 14 de la clarté locale, poignées, boutons, joints, rainures, au moins 40 px, dilatés de 2 px) restent opaques dans le masque : le modèle ne les repeint pas | D1 (et D4) | p06 RM30 : 57,6 → 74,8 | p10 RM21 : 69,7 → 80,6 | **gardé** : toutes les poignées, le nombre de tiroirs, la poubelle, le torchon reviennent ; plus d'étagère inventée ; contours perdus 25 → 7 % |
| **T1 beiges** — description de teinte | Phrase « Colour check » qui corrige la dérive de la famille (beige chaud, ni gris ni taupe) | D3 | p04 NE55 : 69,1 → 65,5 | p09 K4 : 64,2 → 72,4 | **rejeté** |
| **T1 bois** — description de teinte | « Brun chaud, sous-ton miel, ni grisé ni refroidi ni assombri » | D3 | p05 AA14 : 66,0 → 81,0 | p03 AA17 : 63,5 → 61,0 | **rejeté** (la saturation s'améliore sur les deux photos, C* −7,7 → −3 et −3 → −1,1, mais AA17 sort plus foncé) |
| **T1 blancs** — description de teinte | « Blanc net, aussi clair que l'échantillon, jamais gris ni bleuté ni crème » | D3 | p09 J3 : 61,9 → 66,2 | p02 J4 : 66,3 → 55,7 | **rejeté** |

Sur la diagonale, la cause de D1 était **le masque lui-même** : tout ce qui est transparent est repeint de zéro,
poignées et moulures comprises, et aucun mot du prompt n'y change rien (C2). Les mots de teinte (T1) déplacent la
couleur, mais sans régularité d'une photo à l'autre : aucune description de teinte n'a été retenue.

L'essai de C2 est confondu avec C1 : C1+C2 a été comparé à la base, faute de version « C1 seul » sur ces deux photos.
Le rejet vaut quand même, puisque C1+C2 ne bat pas la base sur p10 et qu'à l'œil le défaut visé reste entier.

Prompt retenu : **C1 + C3**. Il a ensuite été rendu sur une teinte de plus par famille (n°31 à 35), pour nourrir la
correction de couleur. Il tient à l'œil sur toutes les familles : M9 garde les portes à cadres et les boutons noirs, K1
garde poignées, torchon et lumière, NF13 sur la capture d'écran obtient 92,6.

### Correction de couleur après rendu, par famille (gratuite)

Méthode (`correction.ts`) :
- **mesure** : dans le masque troué, sous la balance des blancs de la scène, médiane Lab du rendu comparée à la cible ;
- **correction de famille** : médiane, sur les rendus de la famille, du rapport de clarté kL et des écarts da et db ;
- **application** : pixel à pixel, L × kL, a − da, b − db. L'écart de chaque pixel à la médiane est conservé (ombres,
  veinage, reflets), le bord est adouci (σ 3 px), puis l'image revient sous la lumière de la scène ;
- **évaluation** : en laissant chaque rendu de côté, chaque rendu est corrigé avec la correction calculée sans lui.

| Famille | Appris sur | Correction complète, évaluée sans le rendu | Teinte seule (kL = 1) | Retenu |
|---|---|---|---|---|
| Blancs | 2 rendus | ΔE 6,6 → 3,2 et 7,4 → 2,2 (2 sur 2) | 6,6 → 6,1 ; 7,4 → 6,4 | **complète** : L × 1,106 ; a − 0,86 ; b + 4,12 |
| Beiges / taupes | 3 rendus | NE55 7,1 → 4,3 ; K4 7,1 → 2,0 ; M7 3,9 → 5,3 (2 sur 3) | 2 sur 3, gains faibles | **complète** : L × 1,124 ; a − 0,36 ; b + 5,18 |
| Bois | 3 rendus | AA14 5,9 → 5,4 ; AA17 5,8 → **10,2** ; AA05 3,0 → 2,3 | AA14 5,9 → 5,1 ; AA17 5,8 → 6,2 ; AA05 3,0 → 2,6 | **teinte seule** : a + 2,10 ; b + 3,52 |
| Sombres mat | 3 rendus | dégrade 3 sur 3 | dégrade 2 sur 3 | **aucune** |
| Complexes / sourds | 3 rendus | 1 sur 3 | 1 sur 3 | **aucune** |

(da et db sont les écarts mesurés : « a − 0,86 » retire 0,86 en a ; « b + 4,12 » réchauffe de 4,12 en b.)

La clarté est la composante la moins sûre : elle dépend de la lumière de chaque scène, qui varie trop pour qu'une
moyenne de famille s'applique partout. La mission 23 était arrivée à la même conclusion.

## 5. Validation (étape 3) — 4 photos jamais vues

Huit rendus avec le prompt C1+C3, soit deux teintes de familles différentes par photo, puis la correction de couleur de
leur famille.

| n° | Photo | Teinte | Famille | Score brut → corrigé | ΔE brut → corrigé | ΔE à clarté égale | À l'œil |
|---|---|---|---|---|---|---|---|
| 38 | v01 | K4 | beiges | 47,8 → 47,9 | 16,8 → 11,5 | 6,6 → 5,7 | photo minuscule dans la capture : changement peu lisible, teinte incertaine |
| 39 | v01 | AA17 | bois | 45,5 → 45,6 | 15,2 → 16,3 | 6,9 → 8,4 | idem ; veinage à peine visible à cette taille |
| 40 | v02 | J4 | blancs | 68,6 → 76,5 | 6,0 → 4,4 | 1,3 → 4,4 | laqué blanc crédible, reflet du plafonnier gardé |
| 41 | v02 | NF13 | sombres | 79,7 | 4,5 | 3,4 | excellent, contre-jour et objets intacts |
| 42 | v03 | RM30 | complexes | 50,8 | 16,7 | 4,7 | sauge pâle plausible, lumière du soir et poignées noires gardées |
| 43 | v03 | NE55 | beiges | 50,8 → 50,8 | 17,0 → 11,4 | 0,6 → 2,9 | beige juste à l'œil ; le ΔE total vient de la clarté du soir |
| 44 | v04 | J3 | blancs | 65,2 → 82,8 | 6,2 → 2,6 | 5,1 → 2,6 | poignées gardées ; la grande colonne passe en blanc (zone du prompt) |
| 45 | v04 | AA05 | bois | 72,2 → 73,5 | 3,9 → 3,6 | 2,0 → 1,3 | excellent |

| Groupe | Rendus | Score moyen | ΔE médian | ΔE à clarté égale (médiane) | Contours perdus (médiane) |
|---|---|---|---|---|---|
| Exploration (pipeline actuel) | 11 | 58,3 | 5,2 | 3,6 | 43 % |
| Correction, prompt C1+C3 | 14 | 69,5 | 5,8 | 3,3 | 25 % |
| Validation brute (C1+C3) | 8 | 60,1 | 15,2 | 4,7 | 21 % |
| Validation corrigée (C1+C3 + couleur) | 8 | 63,5 | 11,4 | 4,4 | 21 % |

Ce qui tient sur des photos jamais vues :
- **la structure** : poignées, boutons, cadres, nombre de façades et objets sont gardés (contours perdus 21 % contre 43 %
  avec le pipeline actuel) ;
- **la lumière de la photo** : contre-jour, plafonnier et soirée sont conservés ;
- **la correction des blancs** (J3 : ΔE 6,2 → 2,6 ; J4 : 6,0 → 4,4) ;
- **les sombres et les bois foncés**, justes sans correction.

Ce qui ne tient pas, franchement :
- **la couleur dans l'ensemble** : le gain du score moyen fond de moitié (69,5 sur les photos de la correction, 60,1
  sur les nouvelles, contre 58,3 au départ), et le ΔE à clarté égale passe de 3,3 à 4,7 ;
- **la correction des beiges** recale surtout la clarté (ΔE total 17 → 11), pas la teinte : NE55 à clarté égale passe de
  0,6 à 2,9 ;
- **la correction des bois** dégrade AA17 en validation comme en évaluation (bois clair) : elle ne vaut que pour les bois
  foncés ;
- **la capture d'écran de petite taille** (v01) reste un cas perdu : la cuisine occupe un quart de l'image. Il faudrait
  recadrer la capture avant le rendu, pas corriger après.

Avec 2 ou 3 rendus d'apprentissage par famille, les valeurs de correction sont **provisoires** : à recalculer sur plus de
rendus avant de les figer.

Page avant / après de la validation : `~/coverswap-photos/sunburst-24/planche-validation.jpg`, en local seulement. Chaque
ligne montre la photo, le rendu Sunburst et le rendu corrigé, avec la pastille du hex du catalogue.

## 6. À intégrer après la mission 23 (non intégré ici)

### 6.1 Le prompt final : C1 sur le prompt V2 du moteur

Deux changements dans `src/lib/simulateur/moteur` (code exact dans `scripts/sunburst-24/variantes.ts`, étape `c1`).

1. Bloc ROLE : remplacer « The client must recognise the room instantly and see it as a finished job photographed by a
   professional. » par :
   > The client must recognise the room instantly: it is the same phone photo, taken the same moment, with only the
   > covered surfaces changed.
2. Bloc PHOTOGRAPHIC QUALITY, remplacé en entier par :
   > LIGHT AND EXPOSURE OF THE PHOTO
   > - Keep the photo exactly as it was taken: same exposure, same brightness, same contrast, same white balance, same
   >   haze, glare, backlight and dark corners, same noise and sharpness.
   > - Do not brighten a dark or backlit photo, do not recover a burnt window, do not 'fix' or beautify the picture: this
   >   is not a retouch, only the covered surfaces change.
   > - The new film receives exactly the light that fell on the old surface at that place in Image 1 (a front in shadow
   >   stays in shadow, a backlit front stays backlit).

Ces deux changements entrent en contradiction avec AVOID et FINAL CHECK sur un point : « looks like a real,
professionally photographed room ». Le texte a été testé tel quel, avec cette phrase. La retirer serait un changement
de plus, non testé.

Un exemple complet du prompt final (p06 × RM30) est en local : `~/coverswap-photos/sunburst-24/prompt-final-exemple.txt`.

### 6.2 Le masque troué (C3), le changement qui compte le plus

L'appel `/images/edits` reçoit `mask` : un PNG RGBA à la taille de la photo cadrée, transparent sur la zone à pelliculer
**sauf sur ses détails**. Algorithme dans `masques.ts › masqueTroue` :
- clarté de la photo comparée à sa version floutée (σ 8) ;
- dans la zone, les pixels qui s'en écartent de plus de 14 forment des composantes ; celles d'au moins 40 px sont
  gardées et dilatées de 2 px ;
- ces pixels restent opaques : ils ne sont pas repeints.

**Condition préalable** : il faut un masque de zone. Le simulateur n'en produit aucun aujourd'hui, et les masques de
cette mission ont été dessinés à la main. Pour intégrer C3, il faut une source automatique : segmentation des façades
par un appel vision, ou masque de la zone dessiné par le client dans l'écran du simulateur. C'est une décision de Lucas,
et le prochain chantier à mesurer.

Effet de bord connu : les chants des portes, dont le contraste est fort, gardent parfois leur couleur d'origine sur un
liseré de 1 à 2 px.

### 6.3 Les descriptions de teintes

**Aucune description corrigée n'est retenue** : les trois phrases T1 testées (beiges, bois, blancs) ont été rejetées
(§ 4). Il faut garder la description actuelle du moteur (`decrireFilm` : nom, couleur en mots et hex, finition). Les
phrases essayées sont dans `variantes.ts › MOTS_TEINTE`, pour mémoire.

### 6.4 Les corrections de couleur par famille

À appliquer après le rendu, dans le masque, sous la balance des blancs de la scène (`correction.ts › appliquer`) :

| Famille | kL | a | b | Statut |
|---|---|---|---|---|
| Blancs | × 1,106 | − 0,86 | + 4,12 | validé (2 sur 2 en validation) |
| Beiges / taupes | × 1,124 | − 0,36 | + 5,18 | partiel : clarté recalée, teinte non |
| Bois | × 1 | + 2,10 | + 3,52 | bois foncés seulement (dégrade AA17, bois clair) |
| Sombres mat | — | — | — | aucune (inutile) |
| Complexes / sourds | — | — | — | aucune (instable) |

Les valeurs reposent sur 2 ou 3 rendus par famille : elles sont provisoires. La correction de la mission 23
(`correction-teintes.ts`, recalage vers le hex propre à chaque image) est sans doute plus robuste qu'une moyenne de
famille, puisqu'elle connaît sa cible. À comparer sur ces mêmes rendus, une fois la mission 23 livrée.

## 7. Familles : où en est Sunburst

| Famille | Prêt ? | Pourquoi |
|---|---|---|
| Sombres mat (K1, M9, NF13) | **oui** | ΔE à clarté égale 1,5 à 3,4 sans correction, structure gardée avec C3 |
| Complexes / sourds (RM30, RM21, NE24) | **oui, avec réserve** | bonne teinte (ΔE à clarté égale 1,3 à 4,8), RM30 un peu foncé ; pas de correction stable |
| Bois foncés (AA14, AA05) | **oui** | veinage crédible ; AA05 juste (ΔE 1,3 à 3,6), AA14 un peu froid, recalé en teinte |
| Blancs (J4, J3, N3) | **oui, avec la correction** | bleutés à la sortie ; correction validée sur photos jamais vues |
| Beiges / taupes (K4, NE55, M7) | **pas encore** | systématiquement trop froids et trop gris ; ni le prompt ni la correction ne recalent la teinte de façon stable |
| Bois clairs (AA17) | **pas encore** | correct à la sortie en exploration, mais la correction de famille le dégrade et la validation est faible |

Dans tous les cas : prompt C1 et masque de zone troué, et pas de petite capture d'écran sans recadrage préalable.

## 8. Fichiers

Dans le dépôt (code seulement, aucune image, aucun nom) : `scripts/sunburst-24/`.

| Fichier | Rôle |
|---|---|
| `commun.ts` | chemins, budget, enveloppes |
| `dedoublonner.mjs`, `lot.mjs`, `cadrer.ts` | lot anonyme, cadrage, grilles |
| `masques.ts`, `voir-troue.ts` | masques dessinés, masque troué (C3), contrôles |
| `rendre.ts`, `lancer.sh` | un rendu Sunburst avec plafond, coût réel par jetons, cumul |
| `variantes.ts` | C1, C2, C3, T1 |
| `score.ts`, `essai-score.ts`, `rescorer.ts` | score automatique et son contrôle |
| `echantillons.ts` | hex du catalogue contre image de l'échantillon |
| `correction.ts`, `valider.ts` | correction de couleur par famille, validation |
| `comparer.ts`, `mosaique.ts`, `planche-validation.ts` | planches pour l'œil |

Hors dépôt, `~/coverswap-photos/sunburst-24/` :
- `lot/`, `cadre/`, `masques.json`, `masques/` : photos anonymes, cadrages et masques ;
- `rendus/` (45), `corriges/`, `planches/` : rendus, rendus corrigés, planches ;
- `journal.json` : chaque appel, avec jetons, coût, cumul, score et regard ;
- `corrections*.json`, `validation.json` ;
- `planche-validation.jpg`, `prompt-final-exemple.txt`.

Lancement d'un rendu : la clé est lue dans l'environnement local du site, comme en mission 16, et jamais affichée.

```
node --import tsx scripts/sunburst-24/rendre.ts --photo p06 --ref RM30 --phase correction --variante c1+c3 --cle-depuis ../coverswap/.env.local
```

## 9. Tous les essais

Coût réel par jetons, cumul après chaque rendu, score final recalculé. « Données » : rendu du prompt retenu servant à
la correction de couleur. « Référence » : version en vigueur, contre laquelle un essai T1 est comparé.

| n° | Phase | Photo | Teinte | Changement | Coût | Cumul | Score | ΔE | ΔE à clarté égale | Contours perdus | Décision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | exploration | p06 | RM30 | aucun (pipeline actuel) | 0.0421 $ | 0.0421 $ | 57.6 | 7.5 | 1.6 | 36.9 % | exploration |
| 2 | exploration | p01 | K4 | aucun (pipeline actuel) | 0.0421 $ | 0.0842 $ | 25.1 | 8.5 | 3.6 | 66.2 % | exploration |
| 3 | exploration | p02 | J4 | aucun (pipeline actuel) | 0.0423 $ | 0.1265 $ | 61.1 | 6.4 | 4.6 | 33.8 % | exploration |
| 4 | exploration | p03 | AA17 | aucun (pipeline actuel) | 0.0422 $ | 0.1687 $ | 70.8 | 3.3 | 1.9 | 24 % | exploration |
| 5 | exploration | p04 | NE55 | aucun (pipeline actuel) | 0.0421 $ | 0.2108 $ | 57.6 | 7.3 | 6.2 | 39.2 % | exploration |
| 6 | exploration | p05 | AA14 | aucun (pipeline actuel) | 0.0422 $ | 0.2530 $ | 68.2 | 5 | 3.8 | 38.5 % | exploration |
| 7 | exploration | p07 | N3 | aucun (pipeline actuel) | 0.0421 $ | 0.2951 $ | 40.9 | 17.7 | 4.6 | 22.2 % | exploration |
| 8 | exploration | p08 | M9 | aucun (pipeline actuel) | 0.0420 $ | 0.3371 $ | 62.1 | 5.2 | 3.3 | 76.4 % | exploration |
| 9 | exploration | p09 | NF13 | aucun (pipeline actuel) | 0.0421 $ | 0.3792 $ | 68.4 | 4 | 3.9 | 69.2 % | exploration |
| 10 | exploration | p10 | RM21 | aucun (pipeline actuel) | 0.0423 $ | 0.4215 $ | 69.7 | 3.9 | 3.4 | 61.9 % | exploration |
| 11 | exploration | p11 | AA05 | aucun (pipeline actuel) | 0.0422 $ | 0.4637 $ | 71.5 | 0.8 | 0.8 | 43.3 % | exploration |
| 12 | exploration | p12 | M7 | aucun (pipeline actuel) | 0.0421 $ | 0.5058 $ | 29.3 | 12.4 | 3.9 | 75 % | exploration |
| 13 | correction | p01 | K4 | C1 lumière | 0.0423 $ | 0.5481 $ | 27.3 | 15.4 | 3.2 | 64.6 % | gardé (C1) |
| 14 | correction | p12 | M7 | C1 lumière | 0.0423 $ | 0.5904 $ | 34.1 | 15.4 | 4.3 | 73.2 % | gardé (C1) |
| 15 | correction | p06 | RM30 | C1 + C2 façades (texte) | 0.0429 $ | 0.6333 $ | 66.9 | 5.1 | 1.3 | 49.1 % | rejeté (C2) |
| 16 | correction | p10 | RM21 | C1 + C2 façades (texte) | 0.0431 $ | 0.6764 $ | 69.5 | 4.1 | 3.8 | 57.3 % | rejeté (C2) |
| 17 | correction | p06 | RM30 | C1 + C3 masque troué | 0.0423 $ | 0.7187 $ | 74.8 | 5.1 | 1.7 | 24.9 % | gardé (C3) |
| 18 | correction | p10 | RM21 | C1 + C3 masque troué | 0.0425 $ | 0.7612 $ | 80.6 | 4.8 | 4.8 | 6.6 % | gardé (C3) |
| 19 | correction | p04 | NE55 | C1 + C3 masque troué | 0.0423 $ | 0.8035 $ | 69.1 | 7.1 | 3.7 | 4.2 % | référence T1 beiges |
| 20 | correction | p09 | K4 | C1 + C3 masque troué | 0.0423 $ | 0.8458 $ | 64.2 | 7.1 | 3.4 | 26.1 % | référence T1 beiges |
| 21 | correction | p04 | NE55 | C1 + C3 + T1 teinte | 0.0425 $ | 0.8883 $ | 65.5 | 7.8 | 3.5 | 4.5 % | rejeté (T1 beiges) |
| 22 | correction | p09 | K4 | C1 + C3 + T1 teinte | 0.0425 $ | 0.9308 $ | 72.4 | 5.5 | 1.8 | 25.8 % | rejeté (T1 beiges) |
| 23 | correction | p02 | J4 | C1 + C3 masque troué | 0.0425 $ | 0.9733 $ | 66.3 | 6.6 | 3.9 | 15.4 % | référence T1 blancs |
| 24 | correction | p07 | N3 | C1 + C3 masque troué | 0.0423 $ | 1.0156 $ | 41.6 | 31.1 | 6.8 | 27.7 % | données (correction de couleur) ; masque peu fiable, hors statistiques |
| 25 | correction | p05 | AA14 | C1 + C3 masque troué | 0.0424 $ | 1.0580 $ | 66 | 5.9 | 4.7 | 39.5 % | référence T1 bois |
| 26 | correction | p03 | AA17 | C1 + C3 masque troué | 0.0424 $ | 1.1004 $ | 63.5 | 5.8 | 3.3 | 20.7 % | référence T1 bois |
| 27 | correction | p08 | M9 | C1 + C3 masque troué | 0.0422 $ | 1.1426 $ | 71.5 | 5.4 | 2.7 | 30.4 % | données (correction de couleur) |
| 28 | correction | p11 | K1 | C1 + C3 masque troué | 0.0423 $ | 1.1849 $ | 77.9 | 3.2 | 1.5 | 18.2 % | données (correction de couleur) |
| 29 | correction | p05 | AA14 | C1 + C3 + T1 teinte | 0.0426 $ | 1.2275 $ | 81 | 3.3 | 2 | 33.7 % | rejeté (T1 bois) |
| 30 | correction | p03 | AA17 | C1 + C3 + T1 teinte | 0.0426 $ | 1.2701 $ | 61 | 6.9 | 2.5 | 23.9 % | rejeté (T1 bois) |
| 31 | correction | p12 | NE24 | C1 + C3 masque troué | 0.0422 $ | 1.3123 $ | 43.2 | 14.5 | 2.3 | 27.6 % | données (correction de couleur) |
| 32 | correction | p06 | M7 | C1 + C3 masque troué | 0.0423 $ | 1.3546 $ | 80.8 | 3.9 | 2.5 | 25.4 % | données (correction de couleur) |
| 33 | correction | p09 | J3 | C1 + C3 masque troué | 0.0423 $ | 1.3969 $ | 61.9 | 7.4 | 4.8 | 26.3 % | référence T1 blancs |
| 34 | correction | p01 | AA05 | C1 + C3 masque troué | 0.0424 $ | 1.4393 $ | 60.7 | 3 | 2.9 | 37.6 % | données (correction de couleur) |
| 35 | correction | p02 | NF13 | C1 + C3 masque troué | 0.0425 $ | 1.4818 $ | 92.6 | 1.9 | 1.8 | 15.7 % | données (correction de couleur) |
| 36 | correction | p09 | J3 | C1 + C3 + T1 teinte | 0.0424 $ | 1.5242 $ | 66.2 | 6.5 | 3.3 | 27.7 % | rejeté (T1 blancs) |
| 37 | correction | p02 | J4 | C1 + C3 + T1 teinte | 0.0427 $ | 1.5669 $ | 55.7 | 8.5 | 5.4 | 19 % | rejeté (T1 blancs) |
| 38 | validation | v01 | K4 | C1 + C3 masque troué | 0.0423 $ | 1.6092 $ | 47.8 | 16.8 | 6.6 | 30.9 % | validation |
| 39 | validation | v01 | AA17 | C1 + C3 masque troué | 0.0424 $ | 1.6516 $ | 45.5 | 15.2 | 6.9 | 35.7 % | validation |
| 40 | validation | v02 | J4 | C1 + C3 masque troué | 0.0423 $ | 1.6939 $ | 68.6 | 6 | 1.3 | 9 % | validation |
| 41 | validation | v02 | NF13 | C1 + C3 masque troué | 0.0422 $ | 1.7361 $ | 79.7 | 4.5 | 3.4 | 9.8 % | validation |
| 42 | validation | v03 | RM30 | C1 + C3 masque troué | 0.0423 $ | 1.7784 $ | 50.8 | 16.7 | 4.7 | 10.4 % | validation |
| 43 | validation | v03 | NE55 | C1 + C3 masque troué | 0.0423 $ | 1.8207 $ | 50.8 | 17 | 0.6 | 16.8 % | validation |
| 44 | validation | v04 | J3 | C1 + C3 masque troué | 0.0423 $ | 1.8630 $ | 65.2 | 6.2 | 5.1 | 26.4 % | validation |
| 45 | validation | v04 | AA05 | C1 + C3 masque troué | 0.0424 $ | 1.9054 $ | 72.2 | 3.9 | 2 | 20.6 % | validation |
