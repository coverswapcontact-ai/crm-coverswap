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
| 6 | **Chaque geste répond.** Une ligne écrite après chaque action, avec « Annuler » pendant 5 s. Rien ne change en silence. | Test du mécanisme généralisé (lot A2 : `toastAnnulable`, `aujourdhui-ecran.test.ts`) ; parcours réel en local : chaque geste affiche sa ligne. |
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

### Les couleurs d'avant → les jetons (table du codemod, `scripts/jetons-codemod.mjs › TABLE`)

Soixante-deux valeurs à crochets, vingt-trois jetons : dix-neuf valeurs gardent leur teinte (le jeton porte le même
hex), quarante-trois se fondent dans un jeton voisin. Une valeur se lit avec le préfixe de la classe (`text-`, `bg-`,
`border-`…) ; une seule dépend du préfixe (#16181D en `text-` est le texte inversé, ailleurs le fond). Les quatre
dernières lignes gardent une opacité (le codemod ne les remplace que sans opacité déjà posée).

| Jeton | Hex d'avant |
|---|---|
| `fond` | #16181D, #0F1115 |
| `surface` | #1C1F25, #20232A, #23262D, #191B20 |
| `surface-2` | #22262D, #272B33, #2A2F37, #23272F |
| `trait` | #2A2D34 |
| `trait-2` | #3A3E47, #4B5160 |
| `texte` | #F2F3F5, #E5E7EB |
| `texte-2` | #D1D5DB, #B4BAC4 |
| `texte-3` | #9CA3AF, #6B7280, #8B919C, #4B5563 |
| `texte-inverse` | #0B0D10, #1A1206, #16181D (en `text-` seulement) |
| `action` | #1D9E75, #178A66 |
| `action-texte` | #06140F, #0B1612, #0F1A16 |
| `action-clair` | #5DCAA5, #8FE0C3, #D1FAE5, #9FD9C2, #C9EFE1, #5E8F7B, #6FD6B3 |
| `action-fond` | #112B22, #143528, #15201C, #1A2420, #15251F |
| `retard` | #EF4444 |
| `retard-texte` | #F87171, #FCA5A5 |
| `attention` | #EF9F27 |
| `attention-texte` | #F5B454, #FCD9A0, #C9A46A |
| `info` | #60A5FA, #F472B6, #A78BFA |
| `info-texte` | #93C5FD, #7AA7FF, #F9A8D4, #C4B5FD, #BFDBFE, #C4A5FF |
| `action/40` | #2F3B36, #24463A |
| `attention/40` | #5B3A1E |
| `attention/15` | #3A2A10 |
| `attention/10` | #2B2414 |

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
| `v2` | la v2 pour tout le monde ; la session qui porte le cookie `crm-interface=v1` (`?interface=v1`) revient à la v1, pour comparer, et `?interface=v2` la ramène (décision des correctifs du 07/10) |
| `apercu` | la v1 par défaut ; la v2 pour la session qui porte le cookie `crm-interface=v2` |

Le cookie (`crm-interface`, `sameSite: lax`, chemin `/`, 7 jours) vaut `v2` ou `v1` ; il est posé par
`GET /api/interface?v=v2|v1&retour=/chemin`, qui redirige ensuite vers `retour` (un chemin relatif du CRM seulement :
résolu contre une origine factice, refusé s'il en sort ou s'il contient un espace, une tabulation ou un retour à la
ligne ; sinon `/taches`). Elle n'est pas publique : elle passe par la session, comme les autres `/api`. `?interface=v2`
(ou `v1`) sur n'importe quelle adresse du CRM fait la même chose : `PriseInterface` (client, monté par les deux
gabarits) remplace la page par cette route, puis revient à la même adresse sans le paramètre. Sans drapeau (absent ou
`v1`), `?interface=v2` est donc sans effet : le cookie est posé, la v1 reste servie — c'est voulu, une session ne
bascule rien tant que le serveur n'est pas en `apercu` ou en `v2`. Le point de choix est le gabarit
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

## Journal « Depuis ta dernière visite » (lot A1)

Un fil unique, global, en lecture seule : `src/lib/chronologie/journal.ts › journal({ depuis, jusqua?, filtres?, page?,
parPage? })`, bâti à côté de `chronologie.ts` (le fil d'un contact, inchangé) avec les mêmes libellés
(`LIBELLES_TYPE_EVENEMENT`, complété des 21 types qui sortaient bruts) et les mêmes liens. Chaque source est lue par date
(500 lignes au plus chacune), le tout trié en mémoire ; `depuis` est borné à 30 jours (`@@index([createdAt])` ajouté sur
`DossierEvenement`). Trois filtres : **Clients** (ce que les personnes ont fait ou reçu), **Argent** (devis, factures,
paiements), **Système** (Claude, tâches de fond, alertes).

| Source (table) | Ligne rendue | Filtre |
|---|---|---|
| `Message` entrant, canal mail, classe ≠ BRUIT | « Mail reçu de X — objet », extrait, attendu ; lien `/mail?mail=` | Clients |
| `MessageEspace` auteur CLIENT | « Message du client depuis son espace », « Commentaire du client sur une simulation », « Autre proposition demandée » ; l'événement jumeau du dossier (`evenementId`) est exclu | Clients |
| `Sms` entrant ; sortant d'origine RELANCE, ACCUSE_AUTO, LIEN_ESPACE | « SMS reçu », « Relance envoyée par SMS », « Accusé de réception envoyé par SMS », « Lien de l'espace envoyé par SMS » ; un échec passe en Système | Clients |
| `DossierEvenement` (sauf MAIL_RECU, WHATSAPP_*, NOTE_APPEL, APPEL, SMS_RECU, SMS_ENVOYE, ENCAISSEMENT_ENREGISTRE, DOSSIER_MODIFIE, ESPACE_DEVIS_CONSULTE : chacun a sa propre source) | le libellé du type ; « Passé en Simulation » pour un changement d'étape ; MAIL_ENVOYE seulement comme « Relance du devis envoyée par mail » (motif RELANCE_DEVIS), SMS_COPIE seulement comme « Relance du devis envoyée par SMS » | Clients ; documents, avoirs, paiements, accord du client → Argent ; cohérence corrigée → Système |
| `Document` DEVIS `consulteLe` | « Devis 2026-041 ouvert par le client », « … relu 3 fois » (le compteur vit sur le devis) | Clients |
| `NoteAppel` | « Appel — Intéressé », la note ; lien `/leads?lead=` | Clients |
| `Dossier.mainLe` | « La main est passée au client » / « La main est revenue à toi », le motif | Clients |
| `Encaissement` | « Paiement reçu : 450 € par virement », payeur et référence ; « (rejeté depuis) » | Argent |
| `EnvoiMail` ENVOYE de nature NOTIFICATION ; ECHEC (toute nature sauf ESSAI) | « Notification envoyée par mail : « objet » » ; « Mail non parti : « objet » » | Clients ; échec → Système |
| `Proposition` EN_ATTENTE (créées), REJETEE / ANNULEE / ECHEC (décidées), EXECUTEE (exécutées) | « À valider : … » avec les deux gestes (`/api/validation/<id>/valider`, `…/rejeter`), « Proposition ignorée : … », « … devenue sans objet : … », « … en échec : … », « … exécutée : … » | Clients (dossier ou client connu) ; échec ou sans personne → Système |
| `ModificationAssistant`, `ModificationDossier` `par` ASSISTANT: | « Claude a modifié <nom> », les champs « libellé : avant → après » ; « Modification de Claude annulée … » | Système |
| `Tache` ECHEC_DEFINITIF ; `Planification` ECHEC ; `Planification` sauvegarde SUCCES ; `AlerteEnvoi` non aboutie | « Tâche de fond en échec définitif : … », « Travail périodique en échec : … », « Sauvegarde du jour faite », « Alerte non remise (origine) » ; lien Réglages › Système | Système |

**Groupé** (une ligne, `occurrences`) : les événements de même type, même dossier et même document (« Photos déposées
par le client · 3 fois »), les échecs définitifs d'un même type de tâche, les alertes non remises d'une même origine,
les mails non partis d'un même modèle. **Exclu** : le bruit des mails, les SMS manuels du gérant (tracés dans la fiche),
les visites répétées de l'espace (seule la première est un événement), les travaux périodiques réussis (hors la
sauvegarde), les alertes remises, les archivés, et tout ce qui précède `depuis` − 30 jours.

- **Paramètre `JOURNAL_VU_LE`** (`lib/parametres/definitions.ts`, nature texte, groupe Pilotage ; aucun mécanisme de
  masquage dans Réglages : il y reste visible, avec une aide qui dit qu'il n'y a rien à saisir) : l'instant ISO du
  dernier « Tout vu », écrit par `marquerJournalVu(maintenant)` → `enregistrerParametre` (une ligne par « Tout vu »,
  l'historique reste). `depuisDeLaVisite(maintenant)` rend `{ vuLe, depuis }` : `vuLe` sinon 48 h, borné à 30 jours ;
  `depuisDerniereVisite(maintenant)` ajoute le total et les compteurs (Aujourd'hui, `etat_crm`).
- **Routes** (non publiques) : `GET /api/journal?depuis&jusqua&filtres=CLIENTS,ARGENT,SYSTEME&page&par_page`
  (défaut `depuis` = `JOURNAL_VU_LE`, sinon 48 h ; rend aussi `vuLe`) ; `POST /api/journal/vu`.
- **Outil** : `lister` JOURNAL (vues DEPUIS_VISITE par défaut, TOUT avec `filtres.du` / `filtres.au` ; `filtres.filtre`
  CLIENTS, ARGENT ou SYSTEME ; mêmes phrases, repères `[dossier:…]`, `[proposition:…]` et les deux gestes), et la ligne
  « Depuis ta dernière visite : N faits (clients K, argent M, système P) » d'`etat_crm` (`donnees.depuisVisite`).
- **Écran** `components/v2/journal/Journal.tsx` + `GroupeParPersonne.tsx`, page `/journal` (v2 seulement ; en v1,
  redirection vers `/taches` ; `?jours=7` lit une période fixe sans « Tout vu »). Groupes par personne (le client
  réunit ses leads et ses dossiers ; le système en dernier), 5 groupes puis « Voir les N autres », filtres en boutons
  de 44 px (un seul actif ou tous), chaque ligne = phrase + date relative (`lib/v2/dates.ts › dateRelative`, exacte au
  survol) + lien ; « Tout vu » = l'unique bouton principal ; Valider / Ignorer sur une proposition partent 5 s plus
  tard avec « Annuler » (Ignorer = rejet « Inutile », visible ensuite dans À valider › Historique). Le lot A2 importe
  `Journal` en `compact` dans Aujourd'hui.
- **Tests** : `lib/chronologie/journal.test.ts` (base d'essai, 13 cas), `app/api/journal/route.test.ts`,
  `lib/v2/dates.test.ts`, `lib/v2/journal.test.ts`, `components/v2/journal/journal-ecran.test.ts` (sources),
  `lib/mcp/mcp-lister-etat.test.ts` (JOURNAL, `etat_crm`).

## Aujourd'hui (lot A2)

L'accueil de la v2, à `/taches` (`components/v2/taches/Aujourdhui.tsx`, monté par `app/(pilotage)/taches/page.tsx`
quand `interfaceCourante()` rend `v2` ; sinon `EcranTaches` v1, intouché). Sept blocs au plus, dans cet ordre, rien
d'autre au-dessus ; le journal passe à droite sur ordinateur (`lg:`), dessous sur téléphone.

| # | Bloc | Contenu | Gestes |
|---|---|---|---|
| 1 | **Reprendre** | une ligne, seulement s'il y a quelque chose depuis moins de 48 h : « Reprendre : dossier Nom · objet — il y a 2 h » (lien) ; fermable (la croix mémorise l'instant fermé) | `BandeauReprendre` |
| 2 | **Maintenant** | `aujourdhui[0]` en grand (`CarteTache`, extraite du corps du mode « Commencer ») : « Maintenant · environ 3 min », le titre (24 px), la raison en phrase, la marche à suivre, **l'unique bouton principal vert** = le geste prêt, puis Fait / Plus tard / Pas à faire en contour (une proposition : Valider en principal, Ignorer à côté) ; balayer à droite = Fait (Relire pour une sensible), à gauche = Plus tard. Sous la carte, en contour : « Commencer · N tâches · durée » (`ModeTaches`, la série plein écran de la v1) et « J'ai 5 / 15 / 30 min » (`GET /api/a-faire/minutes?m=` : le plan remplace la liste, « Rien ne tient » + « Tout voir » sinon) | `useGestesTaches` |
| 3 | **Ensuite** | `aujourdhui.slice(1, 6)` en lignes sobres (`LigneTacheV2` : titre, durée · raison, bouton du geste en contour, « … » = les trois réponses ; toucher = la fiche ; balayage conservé), « Voir les N autres » ; « Ajouter une tâche » (`AjoutTache` v1) et « Actualiser » (`POST /api/a-faire/detecter`) | idem |
| 4 | **En lot** | une ligne par lot : « Tout classer » (ligne + Annuler 5 s, défait ce classement seul) et « Revoir un par un » (série) | `toastAnnulable` |
| 5 | **Plus tard** | replié ; trois lignes puis « Voir les N autres » | idem |
| 6 | **Fait aujourd'hui** | replié ; `LigneFaiteV2` (titre, « fait par … à 10:12 » ou la preuve lue par le CRM) | — |
| 7 | **Depuis ta dernière visite** | `<Journal compact />` du lot A1 (`parPage` 20, cinq groupes puis « Voir les N autres », « Tout vu » **en contour** ici : le seul bouton vert de l'écran est celui de Maintenant), lien « Tout le journal » | lot A1 |

Vide : « Rien à faire maintenant. » (+ « Demain : N tâches reviennent »), « Ajouter une tâche », le journal reste.
Hors ligne : la dernière liste connue et une ligne ambre. Le compteur de la coque est le seul badge.

**La règle du bouton principal** (`lib/v2/geste-pret.ts › gestePret(tache)`, pure, testée) : une proposition qui se
valide d'un geste → « Valider » ; une tâche à moi sans rien à ouvrir → « Fait » ; une proposition sensible (argent,
client) → « Relire et valider » (son aperçu dans À valider : rien ne se valide d'un geste) ; un appel avec un numéro
lisible → lien `tel:` ; une page externe → lien dans un nouvel onglet ; sinon l'action du raccourci avec son libellé
(SMS, mail, espace, devis, encaisser, date du chantier, simulateur, relance, lead, cohérence). `BoutonGeste` rend ce
geste en `principale` (56 px, vert, plein largeur, dans la carte) ou en `ligne` (contour, 44 px, dans Ensuite).

**Chaque geste répond** (`components/v2/taches/toastAnnulable.ts`) : `toastAnnulable(message, annuler, description)`
= la ligne écrite (« Fait », « Validé », « Plus tard · revient demain 9 h », « Pas à faire · déjà fait hors CRM »,
« 3 tâches classées ») avec « Annuler » pendant 5 s ; côté serveur l'effet part à 6 s (`DELAI_EFFET_MS`) et
`POST /api/a-faire/<id>/annuler` le défait encore après. Les messages sont ceux de `lib/v2/aujourdhui.ts › messageReponse`.

**Reprendre** (règle 7) : deux mémoires réunies par `lib/v2/reprendre.ts › choisirReprendre` (la plus récente, 48 h ;
même chemin → le titre nommé du serveur). Côté appareil, `localStorage["reprendre"]` = `{ chemin, titre, le }`, écrit
par `components/v2/MemoireReprendre.tsx` (monté par la coque v2, dans un `Suspense`) à chaque `/dossiers?dossier=`,
`/leads?lead=`, `/clients/<id>`, `/mail?mail=`, et par `useGestesTaches` quand un panneau de dossier s'ouvre depuis
Aujourd'hui (titres génériques : « le dossier ouvert », « le contact ouvert », « la fiche client », « le mail ouvert »).
Côté serveur, le paramètre `DERNIER_DOSSIER_OUVERT` (« <dossierId>|<ISO> », groupe Pilotage, visible dans Réglages
avec une aide qui dit qu'il n'y a rien à saisir), écrit par `POST /api/reprendre { dossierId }` (non publique ; pas de
seconde ligne pour le même dossier dans le quart d'heure) et lu par `lib/v2/reprendre-serveur.ts › lireReprendre`
(le dossier nommé « dossier Nom · objet », jamais un archivé).

**Ce qui a été extrait de la v1** (`EcranTaches.tsx` reste tel quel : duplication acceptée, la v1 rend exactement
pareil) : `useListeTaches(initiale)` (relecture 4,5 s / 20 s, écoutes `pilotage:compteurs`, `leads:modifies`,
`appel:termine`, retour sur l'onglet, réseau, hors ligne), `useGestesTaches` (repondre / annuler / lancer / appeler /
ouvrirFiche / corriger / commencer / noterRetour ; états occupées, ouvert, réponse, retour, traitées ;
`sessionStorage["taches:position"]` conservé), `PanneauxRaccourcis` (PanneauDossier, PanneauMail, PanneauEntrant,
RelectureMail, FeuilleDateChantier, FeuilleReponse de la v1, montés une fois), `CarteTache` (le corps de `ModeTaches`).
Les prédicats de `LigneTache.tsx` (`estSensible`, `valideDansLaLigne`, `raccourciDe`, `numeroDe`, `sansRaccourci`)
sont repris en pur dans `lib/v2/geste-pret.ts` ; la v2 réutilise `useBalayage`, `FondBalayage` et `ICONES_RACCOURCI`.

- **Mesure** : `/taches` à chaud en local (`next dev`, base d'essai) : 0,26 à 0,33 s (`curl -w "%{time_total}"`) ;
  une seule requête serveur pour la liste, le journal borné à 20 lignes, Reprendre une lecture de paramètre.
- **Tests** : `lib/v2/geste-pret.test.ts` (règle du geste prêt, blocs, ligne de réponse), `lib/v2/reprendre.test.ts`
  (adresses, 48 h, choix), `app/api/reprendre/route.test.ts` (base d'essai : paramètre, dédoublonnage, nommé, archivé),
  `components/v2/taches/aujourdhui-ecran.test.ts` (sources : ordre des blocs, un seul `bg-action`, cinq lignes,
  `toastAnnulable`, gestes repris, échelle de texte, `TRANS_V2`, la page choisit par `interfaceCourante()`, la v1
  n'importe rien de la v2), `app/lisibilite.test.ts` (déjà en place, couvre `src/components/v2/`).

## Panneau de dossier (lot A3)

Le panneau d'un dossier (`components/v2/dossier/PanneauDossierV2.tsx`), monté par `DossiersPilotage` quand
`app/(pilotage)/dossiers/page.tsx` lit `v2` (`interfaceCourante()` → prop `interface` ; sinon `PanneauDossier` v1,
intouché) et par `PanneauxRaccourcis` d'Aujourd'hui (v2 seulement). Même contrat que la v1 (`{ dossierId, demande,
maintenant, onFermer, onMisAJour, onArchive }`), même `Sheet` à droite (620 px, plein écran sur téléphone), même
fermeture au pouce (geste retour, glissement depuis le bord gauche), mêmes `?dossier=`, `?rubrique=` et `?devis=`,
même relecture toutes les 30 s et au retour sur l'onglet. Cinq blocs, dans cet ordre :

| # | Bloc | Contenu |
|---|---|---|
| 1 | **En-tête de situation** (`EnTeteSituation`, phrases de `lib/v2/situation.ts`, le même format pour tous les écrans v2) | ligne 1 : « Nom · cuisine, salle de bain · Ville », l'étape en mots avec son point de couleur ; ligne 2 : « Chez le client depuis vendredi 9 h — devis envoyé : en attente de sa réponse, devis 2026-041 relu 2 fois » (`mainDe` en phrase, `depuisLisible(mainLe)`, `mainMotif` sauf « Étape « … » », puis ce que dit l'espace : devis relu ≥ 2 fois, signaux actifs) ; ligne 3 : « Relancer · lundi » (`jourRelatif`, « en retard de N jours », « Aucune prochaine action ») et « Modifier » (`ProchaineActionEditeur` v1, sous l'en-tête). Date exacte au survol. |
| 2 | **Le bouton principal** (`BoutonGesteDossier`, règle `lib/dossiers/geste-principal.ts`) et **Autres gestes** repliés | l'unique bouton vert (56 px, plein largeur) ; « Autres gestes » = liste de lignes de 44 px : le reste des passages d'étape (suggérés d'abord, « Marquer perdu » en rouge), « Déposer un devis PDF », « Modifier la prochaine action », « Archiver le dossier » (dernier) |
| 3 | **À faire ici** (`AFaireIci`) | les tâches du dossier (`detail.taches` : Aujourd'hui puis Plus tard), en `LigneTacheV2`, mêmes gestes qu'Aujourd'hui (`useGestesTaches`), cinq lignes puis « Voir les N autres » ; une tâche qui « ouvre le dossier » (rubrique, devis, encaissement) agit ici, jamais dans un second panneau ; rien quand le dossier n'a pas de tâche |
| 4 | **Ce qui s'est passé ici** (`CeQuiSestPasseIci`) | cinq lignes de `GET /api/chronologie?dossier=&client=` (date relative, exacte au survol, titre, texte, lien), « Voir les N autres » déplie la `Chronologie` v1 en compact (filtres par famille) |
| 5 | **Rubriques** (`RubriquesDossier`, `lib/v2/rubriques-dossier.ts`) | treize lignes de 44 px, titres en phrases (« Photos du chantier », « Espace client », « Devis et factures », « Paiements », « Simulations », « Étapes et notes », « Historique », « Coordonnées », « Familles et teintes », « Délais et prix », « Dépenses », « À compléter » s'il y a des points, « Archiver le dossier »), un résumé quand elles sont fermées, **toutes fermées sauf celle de l'étape** ; identifiants `rubrique-<x>` conservés pour les raccourcis |

**La règle du bouton principal** (`gestePrincipal({ detail, espace, tache, maintenant })`, pure, testée) : la première
tâche encore à faire du dossier (`tachePrete` : à faire, ou un Plus tard dont l'heure est passée) → son raccourci, le
même bouton qu'Aujourd'hui ; sinon le geste de l'étape :

| Étape | Bouton principal | Ce qu'il ouvre |
|---|---|---|
| Qualification | « Appeler » ; « Préparer la simulation » dès qu'une photo est reçue | lien `tel:` (début d'appel noté) ; `/simulateur?dossier=` |
| Simulation | « Publier la simulation » s'il y a un brouillon dans l'espace (signal `BROUILLONS`) ; sinon « Faire le devis » | la rubrique Simulations (le bouton Publier de la v1, avec « prévenir le client ») ; `GenerateurDocument` devis |
| Devis envoyé, Relance | « Relancer » | la relance proposable du dossier (`GET /api/relances?dossierId=`) : devis (SMS, ou la relecture du mail en STOP), photos, avis ; rien de proposable → « Relancer par téléphone » (`tel:`) ; sans numéro → l'espace client |
| Signé | « Fixer la date du chantier » ; date déjà posée → « Passer en planifié » | `FeuilleDateChantier` ; fenêtre d'étape |
| Planifié | « Passer en chantier » | `ChangementEtape` (garde-fous de la v1), dans « Étapes et notes » |
| Chantier | « Facturer » | `GenerateurDocument` facture |
| Facturé | « Encaisser » | `ModalePaiement` |
| Encaissé | « Demander un avis » | le SMS d'avis proposable, sinon l'espace client |
| Perdu, En pause | « Reprendre en « étape quittée » » | `ChangementEtape` |

**La rubrique ouverte par étape** (`rubriqueDeLEtape`) : Qualification → photos ; Simulation → simulations ; Devis
envoyé, Relance, Signé → devis ; Planifié, Chantier, Perdu, En pause → étapes et notes ; Facturé, Encaissé → paiements.
Un `?rubrique=` ouvre la sienne à la place (`rubriqueDemandee` : photos, messages → espace, devis, encaisser → paiements,
historique, etape), fait défiler jusqu'à elle (`cibleDuDefilement`), et pour « messages » met le curseur dans le champ
de réponse, comme en v1.

**Chaque geste répond** (règle 6) : les gestes de tâches (bloc 2 quand c'est une tâche, bloc 3) passent par
`useGestesTaches` → ligne écrite + « Annuler » 5 s. Les gestes d'étape répondent par une ligne seule, sans « Annuler » :
« Dossier passé à « X » » (`ChangementEtape`), « Chantier fixé au … » (`FeuilleDateChantier`), « Paiement enregistré »
(`ModalePaiement`), « Devis généré » / « Facture générée » (le panneau, après `GenerateurDocument`), « Simulation
publiée dans l'espace du client » (`SimulationsDossier`), « Dossier archivé » (`ArchivageDossier`), « Prochaine action
enregistrée » ; un SMS de relance s'ouvre dans l'écran SMS (copier vaut relance). Ils ne se défont pas d'un bouton :
une étape se corrige par un passage en arrière, un paiement par sa correction dans Paiements, un document par un avoir
ou un devis refait.

**Ce qui est réutilisé de la v1** (aucun composant réécrit) : `PhotosDossier`, `EspaceDossier`, `DocumentsDossier`,
`PaiementsDossier` + `ModalePaiement`, `SimulationsDossier`, `FamillesDossier`, `DelaisEcarts`, `DepensesDossier`,
`TimelineEtapes`, `CoordonneesClient`, `HistoriqueEvenements`, `ACompleter`, `ArchivageDossier`, `ChangementEtape`,
`ProchaineActionEditeur`, `GenerateurDocument`, `ModaleDocumentExistant`, `FeuilleDateChantier`, `RelectureMail`,
`ouvrirEcranSms`, `Chronologie`, `noterDebutAppel`. De la v2 : `useGestesTaches`, `LigneTacheV2`, `BoutonGeste`
(étendu : `BoutonGesteBrut` = le rendu, `BoutonGesteDossier` = le bouton d'un dossier), `FeuillesRaccourcis`
(`PanneauxRaccourcis` moins le panneau de dossier : le panneau monte le mail, le contact, la relecture, la date, la
feuille de réponse, jamais un second panneau), `toastAnnulable`, `lib/v2/dates.ts` (+ `jourRelatif`).

**Serveur** (ajouts de champs) : `GET /api/dossiers/[id]` rend le détail complété de `espace` (`EspaceResume | null`,
par `espacesDesDossiers`) et `taches` (`TacheVue[]`, par `lib/a-faire/lecture.ts › tachesDuDossier(dossierId,
maintenant)` : les tâches d'Aujourd'hui du dossier puis celles de Plus tard, hors lot) — `lib/dossiers/situation.ts ›
completerDetail`. `chargerDetail` et les routes d'écriture ne changent pas : leur réponse n'a ni `espace` ni `taches`,
le panneau garde les précédents. `GET /api/a-faire` est inchangé.

- **Décisions** : « À compléter » devient une rubrique (fermée, avec son nombre) au lieu d'un bloc en tête ; le bloc
  « Encaisser » et `RelancesDuDossier` (boutons verts concurrents de la v1) ne sont plus montés : l'encaissement et la
  relance sont le bouton principal à leur étape, et restent dans Paiements / l'espace client ; « Publier la simulation »
  ouvre la rubrique plutôt que de publier d'un geste (le choix « prévenir le client » de la v1 reste) ; Signé avec une
  date déjà posée → « Passer en planifié » ; « Autres gestes » en liste de lignes (pas un menu flottant) ; les treize
  rubriques comptent pour un bloc (une table des matières fermée), le panneau en a cinq.
- **Tests** : `lib/dossiers/geste-principal.test.ts` (règle, autres gestes, rubriques par étape), `lib/v2/situation.test.ts`
  (les trois lignes, `jourRelatif`), `lib/a-faire/taches-dossier.test.ts` (base d'essai : `tachesDuDossier`,
  `GET /api/dossiers/[id]` complété, 404), `components/v2/dossier/panneau-ecran.test.ts` (sources : ordre des blocs, un
  seul `bg-action`, contrat v1, point de choix, lisibilité), `app/lisibilite.test.ts` (couvre `components/v2/dossier/`).

## Dossiers (lot A4)

L'écran Dossiers de la v2 (`components/v2/dossiers/DossiersV2.tsx`, monté par `app/(pilotage)/dossiers/page.tsx` quand
`interfaceCourante()` rend `v2` ; sinon `DossiersPilotage` v1, intouché, avec les mêmes données qu'avant). La page lit
l'interface d'abord : en v2 elle demande au serveur la vue « À faire » (`pageDossiers({ vue: "A_FAIRE", recherche })`),
c'est-à-dire « ce qui m'attend » (`whereAFaire` : la main à moi, ou le client en retard à relancer). Deux blocs :

| # | Bloc | Contenu |
|---|---|---|
| 1 | **Quels dossiers** | les segments **Chez moi · Chez le client · Tous · Archives** (`Segments`, 44 px, un seul actif, aucun compteur) ; à droite « Vue en colonnes » / « Vue en liste » (le kanban de la v1, `VueKanban` tel quel, même préférence `localStorage["dossiers:vue"]` ; la liste par défaut) et « Ouvrir un dossier » (`CreationDossier` v1, préremplie par `?lead=`, `?client=`, `?prospect=`) ; puis la recherche (`ChampRecherche`, 16 / 17 px, `?q=`, `GET /api/dossiers?q=`) et « Plus de filtres » → « Avec un espace client » (`FiltreEspaces` v1 : qui a la main, signaux, étape de l'espace ; `?espace=`, `?etapeEspace=`) |
| 2 | **La liste** | triée « ce qui m'attend » (`lib/v2/dossiers.ts › trierCeQuiMattend` : les actions datées d'abord, la plus ancienne en tête, donc les retards devant ; puis sans date par dernière activité ; perdus et encaissés en dernier) ; **cinq lignes puis « Voir les N autres »**, puis les pages du serveur en phrase (`PagesV2` : « Page 2 sur 4 · 51 à 100 sur 180 », Page précédente / suivante) ; une ligne (`LigneDossierV2`) = la **barre de couleur** à gauche (vert `action-clair` = chez moi, gris `texte-3` = chez le client, rouge `retard` = facture en retard ou dossier perdu ; `couleurBarre`), les **trois lignes de situation** au format du panneau (`lib/v2/situation.ts › situationDe` : « Nom · cuisine · Ville » + l'étape en mots, « Chez le client depuis vendredi 9 h — devis envoyé… », « Relancer · lundi » ; date exacte au survol), et le **bouton du geste principal** en contour (`BoutonGesteDossier` forme « ligne », règle `gesteDeLaLigne` = `gestePrincipal` sans tâche : le serveur sert désormais `dateChantier`, `nbPhotos` et `clientTelephone` dans le résumé). Toucher la ligne ouvre `PanneauDossierV2` (`?dossier=`, `?rubrique=`) |

**Segments** (`lib/v2/dossiers.ts`) : Chez moi = `vue=A_FAIRE` ; Chez le client = la page « en cours » filtrée dans
le navigateur par `coteDe` (= `mainDe` CLIENT) ; Tous = `vue=TOUS` (perdus et en pause compris) ; Archives = le volet
`DossiersArchives` de la v1 ouvert (`?archives=1`), le segment d'avant revient à sa fermeture. Les compteurs de l'en-tête
v1 (en cours, à faire, en retard) ne s'affichent plus (règle 8).

**Le geste d'une ligne** : « Appeler » compose (`tel:`, début d'appel noté) ; « Préparer la simulation » va au
simulateur ; « Faire le devis » ouvre le panneau avec le générateur (`?devis=nouveau`) ; « Facturer », « Encaisser »,
« Fixer la date du chantier », « Relancer » et « Demander un avis » ouvrent le panneau qui exécute le geste à
l'ouverture (`DemandeOuvertureV2.geste`, lu par `PanneauDossierV2` ; la relance part une fois `GET /api/relances` lu) ;
« Passer en … » / « Reprendre en … » ouvrent la fenêtre d'étape ; « Publier la simulation » ouvre le panneau sur la
rubrique Simulations (celle de l'étape). Un seul chemin d'exécution : les modales et feuilles du panneau.

- **Décisions** : la recherche n'est pas en premier (règle 1) mais sous les segments, dans le même bloc ; la barre verte
  est `action-clair` (le vert plein reste au bouton principal du panneau) ; « Chez le client » filtre la page de 50
  côté navigateur (pas de nouvelle vue serveur) ; la liste est la vue par défaut sur ordinateur aussi (la v1 ouvrait le
  kanban) ; le tri de la liste v1 (montant, ancienneté) n'est pas repris (le kanban et la v1 restent) ; « Masquer les
  inactifs », « Perdus et en pause », la légende et `PropositionsEnAttente` ne sont pas repris (Tous, le journal et
  À valider les couvrent).
- **Tests** : `lib/v2/dossiers.test.ts` (segments, barre, tri, geste de la ligne, demande au panneau, cinq lignes,
  pages), `components/v2/ecrans-a4.test.ts` (sources), `components/v2/dossier/panneau-ecran.test.ts` (ajusté : la page
  lit l'interface d'abord).

## Personnes (lot A4)

Une seule page v2 pour `/leads` et `/clients` (`components/v2/personnes/PersonnesV2.tsx`, montée par les deux
`page.tsx` en v2 ; `EcranLeads` et `ListeClients` v1 intouchés). Trois blocs :

| # | Bloc | Contenu |
|---|---|---|
| 1 | **La recherche** | le champ en premier (`?q=`, aussi rempli par la loupe / Ctrl K de la coque : « Tout chercher dans Personnes », ou Entrée sans résultat) ; dès deux caractères, `GET /api/recherche?q=` (la même fonction que l'outil `chercher`) et les résultats **en phrases** (`LigneResultatV2` : le nom, « Dossier · Ville · Devis envoyé ») remplacent les listes ; un contact s'ouvre sur place (`PanneauEntrant`), un client ou un dossier par son chemin |
| 2 | **Les segments** | **À appeler · À rappeler · Clients · Sans suite · Archivés** (les quatre vues de `listerLeads` et `pageClients`) ; `/clients` ouvre sur Clients, `/leads` sur À appeler (`?liste=appeler|rappeler|sans-suite|archives`) ; changer de segment change l'adresse par `replaceState` sans changer de page (`adresseDuSegment`) ; en contour : « Enchaîner les appels · N » (`ModeAppels` v1, même file que la v1 : `fileDAppels`) et « Ajouter » (un contact à appeler → `NouveauContact` ; un client particulier ou professionnel → `CreationClient`) |
| 3 | **La liste** | cinq lignes puis « Voir les N autres », puis les pages (`GET /api/leads?vue&page`, `GET /api/clients?page`) ; un lead (`LigneLeadV2`) = le nom, « ville · état en phrase » (`etatLead` : « attend un appel depuis 12 min », « à rappeler demain 9 h », « à rappeler depuis hier 18 h », « appelé il y a 3 h », « 2 tentatives sans réponse », « a un dossier », « sans suite », « archivé hier · motif »), et **le bouton « Appeler » vert** (lien `tel:`, début d'appel noté, la fin d'appel revient comme en v1) ; un client (`LigneClientV2`) = le nom, « ville · 2 dossiers, 1 en cours », vers `/clients/<id>` (la `FicheClient` v1, sous la coque v2) |

La liste se relit comme en v1 : `leads:modifies`, `appel:termine` (la file passe au suivant), retour sur l'onglet,
réseau, chaque minute ; hors ligne, la dernière liste connue (une ligne ambre). `NotificationsAppareil` reste monté.

- **Décisions** : les boutons « Appeler » des lignes sont les seuls verts de l'écran (l'énoncé les veut ainsi ;
  « Enchaîner » et « Ajouter » en contour) ; un rappel en retard n'est pas en rouge (règle 3 : le rouge est à l'argent ;
  la phrase « à rappeler depuis hier » le dit) ; la date de rappel se change dans la fiche, pas sur la ligne ; la
  sélection multiple (archiver / restaurer plusieurs contacts), le filtre par source, « Sur le site » et la ligne du jour
  ne sont pas repris (la v1 les garde ; le journal et Aujourd'hui couvrent le site et les rappels) ; `/leads` ouvre sur
  À appeler même avec des rappels en retard (ils sont des tâches d'Aujourd'hui).
- **Tests** : `lib/v2/personnes.test.ts` (segments et adresses, état en phrase, clients, résultats, file d'appels),
  `components/v2/ecrans-a4.test.ts` (sources).

## Argent (lot A4)

L'écran Argent de la v2 (`components/v2/argent/ArgentV2.tsx`, monté par `app/(pilotage)/finances/page.tsx` en v2 ;
`TableauFinances` v1 intouché). La page ajoute l'encaissé et le dépensé du mois courant (`encaissementsDeLaPeriode` et
`depensesDeLaPeriode` sur [1er du mois, aujourd'hui], Paris). Six blocs au plus :

| # | Bloc | Contenu |
|---|---|---|
| 1 | **Les trois nombres** | « À encaisser », « Encaissé ce mois (octobre 2026) », « Dépensé ce mois » (`troisNombres`), chacun en 24 px (`text-grand`, la seule taille grande) ; **rouge seulement** sur le reste à encaisser s'il contient une facture en retard. Si la règle de datation des chèques manque : une ligne « Il manque : … » et « Renseigner » (`useParametresExiges` v1) |
| 2 | **Factures à encaisser** | une ligne par facture : numéro (→ `/dossiers?dossier=`), client, reste dû, « en retard de 12 jours » en rouge (`phraseRetard`), « émise il y a 3 jours · déjà réglé … » ; **« Encaisser »** = le bouton principal (→ `ModalePaiementFacture` v1 : « Paiement enregistré ») ; **« Relancer »** en contour (nouveau geste, `moyenDeRelance`) : avec un numéro, l'écran SMS existant avec un texte court sans nom de client (`texteRelanceFacture`, code `LIBRE`) — copier vaut relance, tracée dans le dossier par `POST /api/sms/copie`, et la ligne « Facture F-… relancée par SMS » ; sans numéro, `/mail?dossier=` ; hors CRM, une ligne qui le dit. Cinq lignes puis « Voir les N autres » |
| 3 | **Chèques à créditer** | « 450 € · Payeur · n° 123 · reçu il y a 12 jours » (ambre au-delà de 15 jours), « Crédité » et « Rejeté » en contour (`ModaleActionEncaissement` v1) |
| 4 | **Dépenses** | replié (ouvert par `?section=depenses`, où mène l'ancienne adresse `/depenses`), « Ajouter une dépense » → `/depenses/nouvelle` ; dedans, `ListeDepenses` v1 tel quel |
| 5 | **Livre des recettes** | le total de l'année, les mois qui ont des recettes (du plus récent, cinq puis « Voir les N autres »), l'année précédente / suivante (`/finances?annee=`), « Exporter le livre (CSV) » (`/api/finances/livre?annee=`) |
| 6 | **À corriger** | replié, avec son nombre ; chaque point en phrase (cinq détails puis « et N autres ») et « Corriger » |

- **Décisions** : « Encaisser » est vert sur chaque ligne (l'énoncé le veut ainsi) ; le SMS de relance ne passe pas par
  le catalogue (code `LIBRE`, déjà accepté par la copie ; aucun ajout au moteur SMS) ; un seul ajout au serveur :
  `LigneEncours.telephone` (le numéro du dossier) ; le livre ne liste plus chaque encaissement (les mois, puis le CSV ;
  la v1 et le Bilan les gardent) ; URSSAF, seuils et courbes restent dans le Bilan (onglet Argent), comme en v1.
- **Tests** : `lib/v2/argent.test.ts` (trois nombres, plage du mois, phrases, SMS de relance, moyen),
  `components/v2/ecrans-a4.test.ts` (sources).

## Écrans de Plus (lot A5)

Boîte mail, Simulateur (avec le banc et les prompts), Le site, Bilan, Réglages, À valider et Nouvelle dépense **restent
les composants de la v1** (aucune réécriture) : la coque v2 les sert tels quels, et chaque `page.tsx` les coiffe de
`components/v2/EnTeteEcran.tsx` quand `interfaceCourante()` rend `v2` (titre en phrase, 20 px ; une ligne d'aide
facultative ; un seul bouton principal facultatif ; `cadre` = la largeur et les marges exactes de l'écran coiffé). En
v1, rien ne change. Le titre que l'écran v1 porte lui-même (`EnTetePage`, ou son propre `h1`) est masqué sous l'en-tête
(`[&_h1]:hidden` : chaque écran n'a qu'un `h1`, en tête) ; son sous-titre et ses boutons restent. Dans « Plus »,
« À valider » dit en phrase ce qui attend (« À valider — 3 en attente », `lib/v2/plus.ts`, clé `propositionsEnAttente`
ajoutée à `GET /api/pilotage/compteurs`), jamais en badge ; `/validation?proposition=` s'ouvre dans la coque v2 depuis
le journal et depuis Aujourd'hui.

| Écran | Titre v2 (page) | Aide | Cadre | Écarts aux dix règles qui subsistent dans l'écran v1 (non corrigés : la v1 ne bouge pas) |
|---|---|---|---|---|
| Boîte mail | « Boîte mail » (`mail/page.tsx`) | — (le sous-titre v1 reste) | colonne-4 | nombres par vue dans les onglets (règle 8) ; mentions et heures en 11 à 13,5 px (règle 9) ; surtitre « Clients » en capitales espacées (règle 4) ; deux boutons d'en-tête (Relire, Tout nettoyer) en contour |
| Simulateur | « Simulateur » (`simulateur/page.tsx`) ; « Banc du simulateur », « Prompts du simulateur » (sous-pages) | — | colonne-4 / large-4 | numéros d'étape en capitales espacées (« 1 · Le client ») ; aides en 11 à 13 px ; Banc et Prompts en liens d'en-tête ; un seul vert (Préparer pour ChatGPT) |
| Le site | « Le site » (`site/page.tsx`) | — | large-5 | titres de section en capitales avec compteur (« Réalisations · 0 ») ; textes en 12 à 13 px ; un seul vert (Nouvelle publication) |
| Bilan | « Bilan » (`analytique/page.tsx`) | « Publicité, Google, site et argent, comparés à la période d'avant. » | bilan | capitales espacées sur chaque tuile et sur « Résumé du jour » ; 10 à 13 px partout (12 textes à 10 px sur téléphone) ; bien plus de 7 blocs ; la période et les onglets en tête (règle 1) ; aucun bouton principal ; le `h1` « Analytique » (28/34 px, Space Grotesk) est masqué |
| Réglages | « Réglages » (`parametres/page.tsx`) | — (le sous-titre v1 reste : « N à renseigner ») | colonne-5 | titres de groupes en capitales espacées ; 11 à 13,5 px ; sept onglets qui défilent ; « Nouvelle valeur » en contour par ligne ; aucun vert |
| À valider | « À valider » (`validation/page.tsx`) | — (le sous-titre v1 reste : « N propositions… ») | colonne-5 | pastilles « NOTE » (code en capitales) et « Argent ou client » (ambre) par carte ; **« Valider » vert sur chaque carte** (règle 3) ; date exacte « 7 oct. 2026, 01:37 » au lieu de « il y a 3 h » (règle 4) ; 12 à 13 px |
| Nouvelle dépense | « Nouvelle dépense » (`depenses/nouvelle/page.tsx`) | « Le ticket en photo, le montant, le chantier : trois gestes. » | etroit | libellés en 11,5 à 13 px ; un seul vert (Enregistrer), dans une barre fixe posée juste au-dessus de la barre du bas (`bottom-16`, aucun chevauchement) |

- **Vérifié dans la coque v2** (`essai-v2.db`, 390 × 660 et 1 440) : un seul `h1` visible par écran, l'en-tête aligné
  au pixel sur l'écran v1 (même gauche, même largeur), aucun débordement horizontal, la barre fixe de Nouvelle dépense
  au ras de la barre du bas, le menu Plus « À valider — 2 en attente », `?proposition=` ouvert depuis le journal.
- **Décisions** : les sous-titres v1 restent visibles (ils sont dynamiques : « 18 à renseigner », « 2 propositions ») et
  l'aide v2 n'est posée que là où la v1 n'en a pas (Bilan, Nouvelle dépense) ; aucun bouton principal dans l'en-tête v2
  (la v1 garde le sien : Nouvelle publication, Tout valider) ; les deux sous-pages du simulateur reçoivent le même
  en-tête ; la coque n'a rien eu à corriger (largeurs, `padding-bottom`, barre du haut : déjà justes).
- **Redirections** : `next.config.ts › ANCIENNES_ADRESSES` inchangé (toutes les adresses v1 restent des écrans) ;
  `/journal` en v1 → `/taches` dans la page, selon l'interface.
- **Tests** : `components/v2/ecrans-plus.test.ts` (sources : pages, en-tête, cadres, navigation, route, redirections),
  `lib/v2/plus.test.ts` (phrases).

## Correspondance v1 → v2

À remplir par les lots A1 à A5 (une ligne par écran ; l'adresse ne change jamais).

| Écran v1 | Écran v2 | Adresse | État |
|---|---|---|---|
| Coque (`components/pilotage/Navigation.tsx` : 10 onglets, 3 compteurs) | `components/v2/CoqueV2.tsx` + `NavigationV2.tsx` : Aujourd'hui, Dossiers, Personnes, Argent, Plus ; un compteur, recherche globale, bandeau d'essai | toutes | lot A0b, livrée |
| — (la v1 n'a pas de journal global : `Chronologie.tsx` par contact seulement) | `components/v2/journal/Journal.tsx` + `GroupeParPersonne.tsx` : « Depuis ta dernière visite », groupes par personne, filtres, « Tout vu » | `/journal` (nouvelle ; en v1 → `/taches`), bloc d'Aujourd'hui au lot A2 | lot A1, livrée |
| Tâches (`taches/_components/EcranTaches.tsx` : en-tête, Actualiser, Ajouter, J'ai N min, Commencer, Aujourd'hui en lignes, En lot, Plus tard, Fait aujourd'hui ; panneaux, ModeTaches, FeuilleReponse) | `components/v2/taches/Aujourdhui.tsx` : Reprendre, Maintenant (carte + geste prêt), Commencer et J'ai 5/15/30 min en contour, Ensuite (5 + « Voir les N autres », Ajouter, Actualiser), En lot, Plus tard, Fait aujourd'hui, journal compact ; mêmes panneaux, même ModeTaches, même FeuilleReponse, mêmes routes | `/taches` | lot A2, livrée |
| Panneau de dossier (`dossiers/_components/PanneauDossier.tsx` : en-tête à liséré, pastilles et badges, À compléter, prochaine action, relances, bloc Encaisser, ChangementEtape, 7 sections en capitales) | `components/v2/dossier/PanneauDossierV2.tsx` : en-tête de situation (3 lignes), un seul bouton principal + Autres gestes, À faire ici, Ce qui s'est passé ici, 13 rubriques fermées sauf celle de l'étape ; mêmes sections, modales, feuilles et routes ; `GET /api/dossiers/[id]` + `espace` + `taches` | `/dossiers?dossier=` (+ `?rubrique=`, `?devis=`), panneaux d'Aujourd'hui | lot A3, livrée |
| Dossiers (`dossiers/_components/DossiersPilotage.tsx` : en-tête à compteurs, Tous / À faire, kanban ou liste triable, Perdus et en pause, Masquer les inactifs, Espaces, Archivés, Légende, recherche) | `components/v2/dossiers/DossiersV2.tsx` : segments Chez moi · Chez le client · Tous · Archives, recherche, « Plus de filtres » (espaces), liste « ce qui m'attend » (situation en 3 lignes + geste principal, barre de couleur, 5 lignes puis « Voir les N autres », pages), kanban en seconde vue, même panneau v2, même création, mêmes archives | `/dossiers` (+ `?dossier=`, `?rubrique=`, `?q=`, `?espace=`, `?archives=1`, `?lead=`, `?client=`, `?prospect=`) | lot A4, livrée |
| Leads (`leads/_components/EcranLeads.tsx` : À appeler, À rappeler, Sans suite, Archivés, source, sélection, Sur le site, ligne du jour, Enchaîner, Nouveau) et Clients (`clients/_components/ListeClients.tsx` : recherche, catégories, source, archivées, doublons, Nouveau client) | `components/v2/personnes/PersonnesV2.tsx` : recherche d'abord (résultats en phrases), segments À appeler · À rappeler · Clients · Sans suite · Archivés, lignes en phrases avec « Appeler », « Enchaîner les appels » (ModeAppels), « Ajouter » (NouveauContact, CreationClient), PanneauEntrant ; la fiche client reste la v1 | `/leads` (+ `?lead=`, `?liste=`, `?appels=1`, `?q=`), `/clients` (+ `?q=`), `/clients/<id>` | lot A4, livrée |
| Finances (`finances/_components/TableauFinances.tsx` : Reste à encaisser, Chèques, À corriger, Dépenses, Livre par encaissement, année) | `components/v2/argent/ArgentV2.tsx` : trois nombres (à encaisser, encaissé ce mois, dépensé ce mois), Factures à encaisser (Encaisser / Relancer), Chèques, Dépenses repliées (ListeDepenses), Livre par mois + CSV + année, À corriger replié ; mêmes modales, mêmes routes | `/finances` (+ `?annee=`, `?section=depenses`), `/depenses/nouvelle` | lot A4, livrée |
| Mail (`mail/_components/EcranMail.tsx` : À traiter / Clients / Administratif, recherche, Relire, Tout nettoyer, rangés) | le même écran v1 sous `components/v2/EnTeteEcran.tsx` « Boîte mail » ; les mails à traiter sont des tâches d'Aujourd'hui | `/mail` (+ `?mail=`, `?client=`, `?lead=`, `?dossier=`, `?consigne=`) | lot A5, livrée |
| Simulateur (`simulateur/_components/EcranSimulateur.tsx`, banc, prompts) | le même écran v1 sous l'en-tête « Simulateur » (« Banc du simulateur », « Prompts du simulateur ») | `/simulateur` (+ `?dossier=`, `?preparation=`), `/simulateur/banc`, `/simulateur/prompts` | lot A5, livrée |
| Site (`site/_components/EcranSite.tsx` : réalisations, avis, Nouvelle publication) | le même écran v1 sous l'en-tête « Le site » | `/site` | lot A5, livrée |
| Analytique (`components/pilotage/analytique/EcranAnalytique.tsx` : onglets, périodes, sources, tuiles, courbes) | le même écran v1 sous l'en-tête « Bilan » + aide | `/analytique` (+ `?onglet=`, `?p=`, `?du=&au=`, `?source=`) | lot A5, livrée |
| Paramètres (`parametres/_components/OngletsParametres.tsx` : sept onglets) | le même écran v1 sous l'en-tête « Réglages » | `/parametres` (+ `?section=`, `#facturation`, `#mail`) | lot A5, livrée |
| À valider (`validation/_components/FileValidation.tsx` : en attente, en cours ou en échec, historique, Tout valider) | le même écran v1 sous l'en-tête « À valider » ; ses propositions arrivent aussi dans le journal (Valider / Ignorer en ligne) ; « À valider — N en attente » dans Plus | `/validation` (+ `?proposition=`) | lot A5, livrée |
| Nouvelle dépense (`depenses/_components/SaisieDepense.tsx`) | le même écran v1 sous l'en-tête « Nouvelle dépense » + aide | `/depenses/nouvelle` (+ `?dossier=`) | lot A5, livrée |

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
