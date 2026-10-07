# Calibrage des teintes du simulateur (mission 23)

Ce document dit comment on mesure la fidélité des teintes du simulateur, comment on la corrige, et comment on rejoue le
banc payant le jour où un nouveau modèle d'image sort. Il ne contient aucune image ni aucune donnée de client : les
photos, les rendus et les notes restent sur le poste, sous `~/coverswap-photos/calibrage/`, jamais dans ce dépôt.

Les chiffres de la mission et le protocole payant écrit avant le premier appel sont dans `docs/REPRISE-MISSION.md`,
§ Mission 23.

## 1. La chaîne, de l'export au banc

| Étape | Outil | Coût |
|---|---|---|
| Exporter le jeu d'essai (N dernières simulations du site et des espaces, sans donnée de contact) | Paramètres › Simulateur › « Exporter le jeu d'essai », ou `agir_systeme` `EXPORTER_JEU_ESSAI` | 0 $ |
| Mesurer la production (masque de la surface changée, ΔE 2000, texture, respect de la pièce) | `npm run simulateur:mesurer-jeu -- <jeu dézippé> [--planches]` | 0 $ |
| Corriger les teintes et valider (70 % réglage, 30 % validation) | `npm run simulateur:corriger-jeu -- <jeu> [--planches] [--partie validation]` | 0 $ |
| Rejouer le banc payant (25 cas fixes, phases P1 à P4) | `npm run simulateur:calibrer -- --phase P1 [--estimer]` | plafond 4,50 $ |

Le jeu exporté se dézippe dans `~/coverswap-photos/calibrage/jeu/`. Les trois scripts refusent d'écrire dans le dépôt.

## 2. La mesure (`src/lib/simulations/mesure-rendu.ts`)

- La surface changée se trouve seule : différence avant / rendu en Lab (ΔE76 lissé), seuil 7, ouverture puis
  fermeture morphologiques, composantes de plus de 2 500 px à 1 024 px de grand côté, bord flouté.
- L'avant est d'abord ramené à l'exposition du rendu (le modèle rééclaire souvent toute la pièce).
- Balance des blancs automatique sur un blanc de la scène hors masque ; sans vrai blanc, la clarté n'est pas lue
  (« clarté incertaine ») et l'on se fie au ΔE à clarté égale.
- Pour chaque surface demandée : ΔE 2000 contre le hex du catalogue, ΔE à clarté égale (teinte et saturation seules),
  dérive en L*, a*, b*, C*, texture relative (un bois devenu aplat est « texture perdue »).
- Respect de la pièce : écart des contours hors masque, part de surface changée hors des zones demandées.
- Un masque douteux (scène redessinée, décalée, zoomée) n'est pas mesuré : son ΔE ne veut rien dire.

## 3. La correction (`src/lib/simulations/correction-teintes.ts`)

- Sur le masque de chaque surface : recalage de la médiane vers la cible du catalogue sous l'éclairage de la scène
  (décalage de a* et b*, L* multiplicatif borné, écart par pixel conservé, bord doux).
- Limites : masque douteux, surface trop petite ou introuvable, texture perdue, écart énorme, couleur partagée avec une
  autre surface → la surface n'est pas corrigée et la simulation est signalée « à régénérer ».
- Réglage `SIMULATEUR_CORRECTION_TEINTES` (Paramètres › Simulateur), **Non par défaut**. Sur Non, la production (site,
  espace, CRM) ne mesure ni ne corrige rien. Seuls le banc de l'écran `/simulateur/banc` et la campagne de calibrage
  mesurent toujours. Les images de catalogue (ambiances, séries) ne sont jamais corrigées.

## 4. Le banc de calibrage (`npm run simulateur:calibrer`)

Code : `src/lib/simulateur/banc/calibrage.ts` (logique), `aveugle.ts` (planches mélangées), `scripts/calibrer.ts`
(lanceur). Tests : `src/lib/simulateur/banc/calibrage.test.ts`, avec un générateur et une vision simulés (le lanceur de
tests ne lit que `src/`).

### Les cas, hors du dépôt

`~/coverswap-photos/calibrage/banc/cas.json` fige les cas d'un essai à l'autre :

- `jeu` : le jeu dézippé, relatif au dossier de calibrage ;
- `photos` : l'id opaque de chaque photo du jeu (le dossier `<jeu>/<id>/avant.*`), une description neutre, la pièce ;
- `teintes` : les références du banc, avec leur hex et leur Lab ;
- `cas` : pour chaque cas, la photo, la teinte du banc, les zones (celles que le client avait demandées pour cette
  photo, les façades portant la teinte du banc), `client` (la teinte que le client avait vraiment choisie) et `choix`
  (un rendu de la teinte du client quand elle n'est pas une des teintes du banc).

### Les phases

| Phase | Ce qui est rendu | Qualité |
|---|---|---|
| P1 | Tous les cas, prompt actuel (et les rendus « choix ») | medium |
| P2 | Les cas « teinte du client » | low |
| P3 | Les 8 pires cas de P1 (ΔE médian après correction), en `retouche` et deux autres variantes | medium |
| P4 | La meilleure variante de P3 sur tous les cas, seulement si elle gagne au moins 3 de ΔE médian après correction | medium |

- Les deux variantes de P3 à côté de `retouche` suivent une règle écrite avant P1 : si P1 dérive surtout en clarté
  (|ΔL*| médian ≥ ΔE médian à clarté égale), `planche-neutre` et `ordre` ; sinon `ordre` et `ordre-fin`.
- Les variantes sont des options du moteur, jamais une modification du prompt par défaut (un test fige les prompts) :
  - `retouche` : un prompt court en mode édition (« EDIT Image 1, do not create a new image »), la teinte en mots en
    plus du hex (`moteur/teinte-en-mots.ts`), les surfaces de la photo nommées une à une, ce qui reste identique, et
    pour finir un contrôle dans le sens de la dérive mesurée pour la famille de teinte ;
  - `planche-neutre` : vignettes plus grandes sur un gris neutre avec une mire blanche ;
  - `ordre` : la consigne de teinte du prompt actuel placée en tête ; `ordre-fin` : la même, répétée en fin.
- Le même cas rendu deux fois ne donne jamais la même image : moins de 2 de ΔE entre deux variantes n'est pas un
  résultat.

### Les garde-fous

- Modèle `gpt-image-2.5-sunburst` passé explicitement à chaque appel (`--modele` pour un autre ; `gpt-image-1` refusé).
- Moteur V2, une seule tentative par cas : le seuil de contrôle est mis à 0 pour la campagne, la seconde tentative du
  pipeline doublerait le coût et mélangerait deux images. Le contrôle vision du moteur est fait et compté.
- Chaque appel (génération, analyse de la photo, contrôle) est noté dans `GenerationImage` en phase `calibrage-23`.
- Le plafond est relu dans `GenerationImage` avant chaque appel, sur la somme de la phase `calibrage-23` :
  4,50 $ par défaut, `--plafond` ne peut que le baisser.
- Un rendu en échec est rejoué une fois au plus. Une panne de clé, de crédit ou de garde arrête tout.
- Un appel qui coûte plus du double de son estimation arrête tout.
- La base visée doit être le fichier SQLite du poste : Turso, Railway ou le volume `/data` sont refusés.
- Un rendu déjà fait (même cas, même variante, même qualité, même modèle) n'est jamais refait.

### Estimer, lancer, relire

```
npm run simulateur:calibrer -- --phase P1 --estimer     # le plan et le coût annoncés, aucun appel
npm run simulateur:calibrer -- --bilan P1               # le tableau des notes, depuis les résultats écrits
npm run simulateur:calibrer -- --aveugle P3 [--corrige] # planches A, B, C… mélangées, la clé à part (cle.json)
```

Sorties sous `~/coverswap-photos/calibrage/banc/` : `resultats.json` (une entrée par rendu : coût relu, contrôle,
note), `rendus/` (avant cadré, rendu, rendu corrigé), `aveugle/<phase>/` (planches et `cle.json`, à n'ouvrir qu'après
avoir noté).

### Lever la garde de l'essai local pour cette seule commande

Sur le poste, `CRM_ESSAI_LOCAL=1` (dans `.env.local`) coupe tout envoi sortant, OpenAI compris (mission 22). La
campagne ne lit ni ne modifie jamais `.env.local`. Elle lève la garde **pour sa propre commande seulement** :

- le lancement payant exige `CALIBRAGE_23_PAYANT=1` sur la ligne de commande (sinon : refus, rien n'est appelé) ;
- dans son processus, le script pose `CRM_ESSAI_LOCAL=1` (tous les canaux restent coupés : alertes, mails, SMS…) puis
  lève la garde pour OpenAI images et vision seulement ; il la rétablit à la fin ;
- la clé OpenAI vient de l'environnement de la commande (`OPENAI_API_KEY`), jamais affichée.

Git Bash (la variable ne vaut que pour cette commande) :

```
CALIBRAGE_23_PAYANT=1 npm run simulateur:calibrer -- --phase P1
```

PowerShell (même portée, par un sous-shell) :

```
cmd /c "set CALIBRAGE_23_PAYANT=1&& npm run simulateur:calibrer -- --phase P1"
```

## 5. Rejouer le banc quand un nouveau modèle sort

Une soirée, même budget (plafond 4,50 $), sans toucher au code sauf, au besoin, les tarifs :

1. Lire les tarifs du modèle et les ajouter à `PRIX` (`src/lib/simulations/prix.ts`) s'il n'y est pas ; s'il coûte
   plus que sunburst, relever `ESTIMATION_RENDU` (`calibrage.ts`), sinon la garde « plus du double » arrête au premier
   appel (c'est voulu).
2. `npm run simulateur:calibrer -- --phase P1 --modele <nouveau> --estimer`, puis le lancement payant.
3. `--bilan P1 --modele <nouveau>` et le bilan de P1 de sunburst côte à côte ; les planches à l'aveugle.
4. P2 si la qualité low est envisagée ; P3 et P4 seulement si P1 montre un écart qui vaut la dépense.
5. Basculer en production reste une décision du gérant : la variable `OPENAI_IMAGE_MODEL` sur Railway et les réglages
   de Paramètres › Simulateur (moteur, qualité, correction des teintes).
