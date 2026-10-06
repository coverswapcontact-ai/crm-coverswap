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

## Navigation

Quatre entrées et « Plus », les mêmes sur ordinateur (barre du haut, 16 px) et sur téléphone (barre du bas, cinq
cases au pouce, libellés 14 px, zones de 64 px). Composants : `src/components/v2/CoqueV2.tsx` (serveur) et
`NavigationV2.tsx` (client) ; aucune adresse ne change.

| Entrée | Adresse | S'allume aussi sur |
|---|---|---|
| Aujourd'hui | `/taches` | — ; **le seul compteur** (tâches d'Aujourd'hui, `GET /api/pilotage/compteurs`, rafraîchi toutes les 60 s, au retour sur l'onglet et après chaque écriture) |
| Dossiers | `/dossiers` | — |
| Personnes | `/leads` | `/clients` |
| Argent | `/finances` | `/depenses/nouvelle` (la saisie d'une dépense, raccourci de l'application installée) |
| Plus | menu | Boîte mail `/mail`, Simulateur `/simulateur`, Site `/site`, Bilan `/analytique`, Réglages `/parametres`, À valider `/validation`, puis « Retour à l'ancienne interface » (`/api/interface?v=v1&retour=…`) |

Aucun badge ailleurs : les leads en retard, les mails à traiter et les échecs de tâches sont des tâches d'Aujourd'hui.
La recherche globale (`RechercheGlobale.tsx`) : la loupe à droite de la barre du haut, ou ⌘K / Ctrl K ; sur
téléphone, le champ en tête du menu « Plus ». Elle interroge `GET /api/recherche?q=` (deux caractères au moins ; la
même fonction `chercherContacts` que l'outil `chercher` du connecteur) et rend « Nom » puis « ville · état » ;
flèches pour choisir, Entrée ouvre le chemin (`/clients/<id>`, `/leads?lead=`, `/dossiers?dossier=`). Le bandeau de
rappel de la connexion Google reste monté. La coque garde `RetourAppel`, `HoteEcranSms`, le `Toaster` de la racine,
le fond et le `main` aux zones sûres : les écrans v1 s'y affichent sans changement en attendant leur écran v2. Le
seul mouvement : `TRANS_V2` (`components/v2/transitions.ts`), une transition de couleur coupée sous
`prefers-reduced-motion`.

## Bascule

`CRM_INTERFACE`, lu côté serveur à chaque requête (`src/lib/interface/choix.ts`, `interfaceCourante()`), jamais au
build :

| Valeur | Effet |
|---|---|
| absente, `v1`, ou autre chose | la v1 pour tout le monde (une faute de frappe ne bascule rien) |
| `v2` | la v2 pour tout le monde |
| `apercu` | la v1 par défaut ; la v2 pour la session qui porte le cookie `crm-interface=v2` |

Le cookie (`crm-interface`, `sameSite: lax`, chemin `/`, 7 jours) est posé par `GET /api/interface?v=v2&retour=/chemin`
et effacé par `?v=v1` ; la route redirige ensuite vers `retour` (chemin relatif du CRM seulement, sinon `/taches`).
Elle n'est pas publique : elle passe par la session, comme les autres `/api`. `?interface=v2` (ou `v1`) sur n'importe
quelle adresse du CRM fait la même chose : `PriseInterface` (client, monté par les deux gabarits) remplace la page par
cette route, puis revient à la même adresse sans le paramètre. Le point de choix est le gabarit
`src/app/(pilotage)/layout.tsx` ; chaque `page.tsx` choisira son écran de la même façon
(`const v = await interfaceCourante(); return v === "v2" ? <EcranV2 /> : <EcranV1 />`). Le service worker est passé en
`v13` : un écran mis en cache sous une coque n'est pas servi sous l'autre.

En production, le jour de la validation : `CRM_INTERFACE=v2` (ou `apercu` pour comparer d'abord) sur Railway.

## Base d'essai

`CRM_ESSAI_LOCAL=1` dans `.env.local` du poste (jamais sur Railway) : la garde dure de `src/lib/acces/essai-local.ts`
(`essaiLocal()`, lecture paresseuse). Elle suffit à elle seule, y compris avec une copie des vraies données en local
(connexion Google et abonnements push présents en base). Chaque entonnoir journalise
« [essai local] <canal> : rien n'est parti — <résumé> », garde la ligne dans `envoisRefuses()` (les 50 dernières) et
rend un résultat neutre explicite ; `instrumentation.ts` l'annonce au démarrage ; le bandeau
« Base d'essai — rien ne part » (`components/v2/BandeauEssai.tsx`, ambre, 44 px) s'affiche en v1 comme en v2.

| Canal | Entonnoir gardé | Ce que l'appelant lit |
|---|---|---|
| Telegram, ntfy, push web, mail d'alerte | `alerter()` (`lib/alertes/canaux.ts`) | une ligne « ok » par canal |
| Push web direct | `envoyerPushWeb()` (`lib/alertes/pushweb.ts`), avant toute lecture des abonnements | « ok » |
| Passerelle ntfy du site | `envoyerParRelais()` (`lib/alertes/relais-ntfy.ts`) | HTTP 200 |
| Mail au client (Gmail, Resend) | `envoyeurMail()` (`lib/mail/envoi.ts`) → envoyeur « essai local », avant le seam des tests | identifiant `essai-local-…` |
| Resend direct | accusé de réception et notification du gérant (`app/api/webhook/route.ts`), alerte de panne du simulateur (`lib/site/erreurs-generation.ts`) | rien ne part |
| SMS | `fournisseurSms()` (`lib/sms/fournisseurs/index.ts`) → `fournisseurSimulateur` | accusé simulé |
| Meta (conversions) | `envoyerConversion()` (`lib/meta/conversions.ts`) | `inactif` |
| Google : libellés Gmail, envoi, Agenda, Drive | `appelGoogle()` pour toute méthode autre que GET (`lib/google/connexion.ts`) ; les lectures passent | réponse factice `{ id: "essai-local" }` |
| Stripe | `creerSessionCheckout()` (`lib/paiement/stripe.ts`) | retour direct sur la page du client |
| OpenAI (images, vision), Anthropic | `generateurEnVigueur()`, `genererAmbiance()`, `appelerVision()`, `appelerModele()` | échec « essai local » explicite, aucun coût |

Test : `src/lib/acces/essai-local.test.ts` (les seams d'essai et `fetch` lèvent s'ils sont touchés ; onze canaux
couverts). Les tests posent `CRM_ESSAI_LOCAL=""` dans `src/test/base-essai.ts` : ceux qui vérifient un transport vers
un faux serveur local ne subissent pas la garde. Les données de l'essai : `docs/COMMENT-TESTER-V2.md` (lot A6) ; le
fichier `essai-v2.db` est couvert par `*.db` dans `.gitignore`.

## Correspondance v1 → v2

À remplir par les lots A1 à A5 (une ligne par écran ; l'adresse ne change jamais).

| Écran v1 | Écran v2 | Adresse | État |
|---|---|---|---|
| Coque (`components/pilotage/Navigation.tsx` : 10 onglets, 3 compteurs) | `components/v2/CoqueV2.tsx` + `NavigationV2.tsx` : Aujourd'hui, Dossiers, Personnes, Argent, Plus ; un compteur, recherche globale, bandeau d'essai | toutes | lot A0b, livrée |

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
