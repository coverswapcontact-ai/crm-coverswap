# CRM v2 « clair » — règles, jetons, correspondance, contrôle

Mission 22 (06/10/2026). La v2 est une nouvelle lecture du même CRM : mêmes adresses, même moteur (Prisma, `/api`,
outils MCP, automatismes), même v1 servie par défaut tant que le drapeau `CRM_INTERFACE` n'est pas posé. Ce document
dit ce que la v2 doit réussir, comment chaque règle se vérifie, d'où viennent les couleurs, et où en est chaque écran.

## Pourquoi

L'utilisateur travaille seul, souvent sur la route, interrompu sans arrêt ; il passe d'un sujet à l'autre et se perd
dans un CRM qui a grossi mission après mission. Le test de réussite, à faire passer à chaque écran : en 5 secondes, sur
un téléphone, dehors, il sait quoi faire maintenant et ce qui s'est passé depuis sa dernière visite, sans chercher ni
lire deux fois. Tous les usages et toutes les fonctionnalités restent.

## Les dix règles de clarté

| # | Règle | Comment on le vérifie |
|---|---|---|
| 1 | **Une seule chose en haut.** Chaque écran commence par l'unique information ou action qui compte (Aujourd'hui : la prochaine tâche ; un dossier : sa situation en trois lignes ; Argent : ce qu'il reste à encaisser). Jamais une barre de filtres, une recherche ou une liste de vues en premier. | Capture à 390 × 660 : le premier bloc sous la barre du haut est l'information ou l'action, pas un outil. Lecture du composant d'écran : le premier enfant rendu. |
| 2 | **Deux niveaux, pas plus.** L'essentiel visible, le reste derrière « Plus » ou une rubrique fermée. Une liste montre au plus 5 lignes avant « Voir les N autres ». Un écran ne montre jamais plus de 7 blocs. | Test sur les composants de liste de la v2 (constante de troncature = 5, présence de « Voir les N autres »). Capture : compter les blocs. |
| 3 | **Un seul bouton principal par écran** (le vert `action`). Les autres gestes sont secondaires (contour) ou dans un menu. Le rouge ne sert qu'à l'argent en retard et au perdu ; pas d'orange décoratif. | Test (`src/app/lisibilite.test.ts`) : les jetons d'étape n'ont plus d'orange ; `retard` reste réservé par arbitrage (ci-dessous). Lecture : une seule `variante="primaire"` par écran v2. |
| 4 | **Des phrases, pas des codes.** « Chez le client depuis 3 jours », pas « MAIN : CLIENT · 3 j ». Dates relatives avec la date exacte au survol ou à l'appui long. Pas de sigle, pas de capitales espacées, pas de point médian en chaîne. | Test : aucune classe `tracking-wide uppercase` dans `src/components/v2/`. Lecture des libellés (dates relatives via une seule fonction). |
| 5 | **Même chose, même place.** La situation d'un dossier (étape · qui a la main · prochaine action) a un seul format, réutilisé partout : liste, carte, panneau, journal, recherche, tâche. | Lecture : un seul composant de situation importé par tous les écrans v2 (lot A3). Test sur ses trois lignes. |
| 6 | **Chaque geste répond.** Une ligne écrite après chaque action, avec « Annuler » pendant 5 s. Rien ne change en silence. | Test du mécanisme généralisé (lot A2) ; parcours réel en local : chaque geste affiche sa ligne. |
| 7 | **Le retour est gratuit.** À l'arrivée : « Reprendre » et « Depuis ta dernière visite ». | Test du journal et de `JOURNAL_VU_LE` (lot A1) ; capture d'Aujourd'hui. |
| 8 | **Compter seulement ce qui se fait.** Un seul compteur, sur Aujourd'hui. Aucun badge ailleurs. | Lecture : aucun compteur dans la barre du bas ni dans « Plus » ; test sur la coque v2. |
| 9 | **Lisible dehors, sur un téléphone.** Contraste ≥ 4,5:1 pour tout texte ; texte courant 16 px ordinateur / 17 px téléphone ; deux tailles par carte au plus ; zones tactiles ≥ 44 px ; bouton principal visible sans défiler à 390 × 660. | Test : contraste de chaque couple de jetons déclaré ; aucune taille `text-[N px]` < 14 px dans `src/components/v2/` ; échelle `text-corps` / `text-corps-tel` / `text-petit` / `text-titre` / `text-grand`. Capture à 390 × 660. |
| 10 | **Rien ne bouge tout seul.** Pas d'animation décorative, pas de compteur qui clignote. Un seul mouvement : la réponse à un geste. `prefers-reduced-motion` respecté. | Lecture : aucun `animate-*` décoratif dans `src/components/v2/` (les `animate-spin` d'attente restent) ; `motion-reduce:` sur ce qui bouge. |

## Jetons de couleur

Seule source : le bloc `@theme {` de `src/app/globals.css` (pas le bloc `@theme inline` des jetons shadcn, qui
pointent dessus). Tailwind v4 en fait les classes (`bg-surface`, `text-texte-3`, `border-trait/40`,
`placeholder:text-texte-3`…) et les variables `var(--color-…)` pour les styles en ligne, les SVG et recharts (objet
`JETONS` et fonction `teinte()` de `src/components/pilotage/ui.tsx`).

| Jeton | Hex | Usage | Contraste |
|---|---|---|---|
| `fond` | #16181D | fond de page, champs | — |
| `surface` | #1C1F25 | cartes, modales, feuilles | — |
| `surface-2` | #22262D | survol, ligne relevée, squelette | — |
| `trait` | #2A2D34 | bordures des cartes et des champs | — |
| `trait-2` | #3A3E47 | bordure au survol, curseur de graphique | — |
| `texte` | #F2F3F5 | texte principal (en fond : le bouton inversé) | 15,99 sur fond |
| `texte-2` | #D1D5DB | texte de second rang | 12,05 sur fond |
| `texte-3` | #9CA3AF | aide, libellés, texte discret, gris hors parcours | 6,99 / 6,50 / 5,98 sur fond / surface / surface-2 |
| `texte-inverse` | #0B0D10 | texte sur `texte` (bouton inversé) et sur l'ambre | 17,52 sur texte |
| `action` | #1D9E75 | bouton principal, sélection, focus | — |
| `action-texte` | #06140F | texte sur `action` et `action-clair` | 5,56 sur action, 9,38 sur action-clair |
| `action-clair` | #5DCAA5 | vert lisible, survol du bouton principal, favorable | 8,84 sur fond |
| `action-fond` | #112B22 | teinte verte de sélection | — |
| `retard` | #EF4444 | fond ou trait rouge : argent en retard, perdu | — |
| `retard-texte` | #F87171 | texte rouge : argent en retard, perdu | 6,42 sur fond |
| `attention` | #EF9F27 | fond ou trait ambre : avertissement, erreur de saisie, échec | — |
| `attention-texte` | #F5B454 | texte ambre | 9,76 sur fond |
| `info` | #60A5FA | fond ou trait bleu : pastilles d'information, propositions | — |
| `info-texte` | #93C5FD | texte bleu, séries de graphiques | 9,85 sur fond |
| `etape-1` … `etape-9` | #818CF8 #60A5FA #22D3EE #2DD4BF #4ADE80 #A3E635 #FDE047 #F5B454 #5DCAA5 | les neuf étapes du dossier, du froid au chaud ; facturé = `attention-texte`, encaissé = `action-clair` | — |

Échelle de texte de la v2 (même bloc) : `text-corps` 16 px, `text-corps-tel` 17 px, `text-petit` 14 px,
`text-titre` 20 px, `text-grand` 24 px. Deux tailles par carte au plus. La v1 garde ses tailles.

Couples mesurés par le test (tous ≥ 4,5:1) : `texte`, `texte-2`, `texte-3`, `action-clair`, `retard-texte`,
`attention-texte`, `info-texte` sur `fond`, `surface` et `surface-2` ; `action-texte` sur `action` et
`action-clair` ; `texte-inverse` sur `texte`. Interdits par motif : `text-texte` sur `bg-action` (3,05) ou sur
`bg-retard` (3,39) ; le gris #6B7280 (3,67 sur le fond, remonté dans `texte-3`).

### Arbitrages (pris au lot A0a, ne se rediscutent pas)

- Les erreurs de formulaire (`Aide`, `Puces`, `aria-invalid`), le bouton `danger`, les échecs de tâches de fond et de
  connexions passent en ambre (`attention` / `attention-texte`). Le rouge est réservé à l'argent en retard et au perdu.
- La pastille d'étape **Perdu** passe du gris au rouge (`retard-texte`) ; **En pause** reste en gris (`texte-3`).
- L'ambre sémantique (avertissements, défavorable dans l'Analytique) reste. Plus d'orange : l'étape Encaissé prend
  `action-clair`, Facturé prend `attention-texte`.
- Les gris #6B7280, #8B919C et #4B5563 se fondent dans `texte-3` ; les roses et violets des pastilles de chronologie se
  fondent dans `info` / `info-texte`.
- Le `:root` clair (oklch) et `.toggle-track` de globals.css restent (rien ne se supprime) ; les jetons shadcn utiles
  (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--muted-foreground`,
  `--border`, `--ring`) pointent sur la charte pour que dialog, sheet et button la suivent.
- Exceptions nommées dans le test (seules valeurs hexadécimales tolérées hors globals.css) : l'aperçu de la marque de
  l'espace client (charte du site), le fond de la planche de teintes, la toile de recompression des photos, le dégradé du
  tunnel de l'Analytique (6 pas), et, hors charte, les rendus PDF, le mail HTML du webhook et les consignes des prompts.
  La couleur de la barre du navigateur (`themeColor`) lit `FOND_HEX` de `src/lib/application/charte.ts`, testée égale
  au jeton `fond`.

### Le codemod

```
node scripts/jetons-codemod.mjs --verifier   # compte ce qui reste à remplacer (sortie 1 s'il en reste)
node scripts/jetons-codemod.mjs              # remplace la forme crochets (text-[#9CA3AF] → text-texte-3)
```

Il ne touche que les classes Tailwind à crochets (préfixes `text`, `bg`, `border(-t|r|b|l|x|y)`, `ring`, `divide`,
`accent`, `decoration`, `fill`, `stroke`, `outline`, `shadow`, `from`, `to`, `via` ; variantes et opacité conservées),
signale sur stderr toute valeur hors table sans y toucher, et conserve les fins de ligne. Les constantes et styles en
ligne se passent à la main par `JETONS` / `var(--color-…)`. Le test `src/app/lisibilite.test.ts` vérifie qu'il n'a plus
rien à faire.

## Correspondance v1 → v2

À remplir par les lots A1 à A5 (une ligne par écran ; l'adresse ne change jamais).

| Écran v1 | Écran v2 | Adresse | État |
|---|---|---|---|
| | | | |

## Liste de contrôle par écran

À copier sous chaque ligne de la correspondance, et à cocher sur capture (390 × 660 et 1 440) ou par test.

- [ ] Une seule chose en haut
- [ ] Un seul bouton principal (vert), visible sans défiler à 390 × 660
- [ ] Au plus 7 blocs ; listes à 5 lignes puis « Voir les N autres »
- [ ] Aucun badge, aucun compteur (hors Aujourd'hui)
- [ ] Dates relatives, phrases, aucune capitale espacée
- [ ] Même format de situation (étape · main · prochaine action)
- [ ] Contraste ≥ 4,5:1 (jetons seulement, test vert)
- [ ] Zones tactiles ≥ 44 px ; texte courant 16 / 17 px ; deux tailles par carte
- [ ] Chaque geste répond (ligne écrite + « Annuler » 5 s)
- [ ] Rien ne bouge tout seul (`prefers-reduced-motion` respecté)
