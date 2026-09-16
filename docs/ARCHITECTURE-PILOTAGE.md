# Système de pilotage CoverSwap — décisions d'architecture

Ce document explique **pourquoi** le CRM est construit ainsi. Le code dit comment ;
ici on garde les raisons, les arbitrages et les limites connues, pour pouvoir
les remettre en cause en connaissance de cause.

Chaque section correspond à un volet livré dans un commit distinct (voir
`git log`), qu'on peut annuler sans défaire les autres.

## 0. Principes non négociables et où ils vivent

| Principe | Mécanisme | Où |
| --- | --- | --- |
| Rien ne se supprime | Déclencheur `BEFORE DELETE` sur chaque table + refus dans la couche Prisma ; archivage (`archiveLe`, `archiveMotif`) ; fichiers déplacés dans `archives/` | `src/lib/journal/` |
| Aucune donnée perdue | Sauvegarde vérifiée avant toute migration de schéma ou de données ; `db push` sans `--accept-data-loss` ; migrations de données idempotentes | `scripts/avant-demarrage.mjs`, `src/lib/base/` |
| Aucun numéro émis réattribué | Registre `NumeroDocument` de tout numéro émis (manuel, ancien écran, CRM) ; un numéro inscrit est sauté, jamais réattribué ni modifié ; document émis figé par la base (avoir, devis refait) | `src/lib/dossiers/numerotation.ts`, section 9 |
| L'agent ne décide pas seul de l'argent ni de ce qui part chez un client | Toute action proposée passe par `Proposition` ; seule une personne connectée valide ou rejette ; une proposition sensible ne s'exécute jamais seule ni en lot | `src/lib/validation/` |
| Aucun secret en dur | Variables d'environnement uniquement ; le dépôt est public | |
| Photos jamais sans authentification | Proxy en refus par défaut : seule une liste blanche commentée est joignable sans session | `src/proxy.ts`, `src/lib/acces/routes-publiques.ts` |
| RGPD | (volet RGPD) | |

## 1. Traçabilité intégrale : le journal des modifications

### Ce qui est garanti

Toute création, modification, archivage ou restauration d'un enregistrement,
quelle que soit sa provenance (route, script, tâche de fond, SQL brut), laisse
une ligne dans `JournalModification` avec :

- l'horodatage (milliseconde) ;
- le modèle et l'identifiant de l'enregistrement ;
- l'opération : `ETAT_INITIAL`, `CREATION`, `MODIFICATION`, `ARCHIVAGE`, `RESTAURATION` ;
- l'auteur (`acteur`, voir plus bas), l'origine (route ou tâche), l'identifiant
  de la requête (qui regroupe les écritures d'un même geste) et un jeton par
  écriture logique (partagé par ses écritures imbriquées) ;
- l'enregistrement **complet** avant et après, en JSON.

Une mise à jour qui ne change rien (même valeur, ou seulement `updatedAt`) ne
laisse pas de ligne.

### La décision : des déclencheurs SQLite, alimentés par une couche Prisma unique

Trois options étaient possibles :

1. **Un appel de journalisation dans chaque route.** Rejeté : on en oublierait,
   et un script ou une tâche de fond passerait à côté.
2. **Une extension Prisma qui écrit le journal elle-même.** Rejeté : elle ne voit
   ni le SQL brut, ni les écritures faites par un autre client (script, outil),
   et elle devrait relire l'enregistrement avant chaque écriture (coût, et
   fenêtre de concurrence entre la lecture et l'écriture).
3. **Des déclencheurs dans la base** (retenu). Ils voient **toutes** les
   écritures, dans la même transaction : si l'écriture est annulée, sa ligne
   de journal l'est aussi, et une ligne de journal ne peut pas exister sans
   l'écriture correspondante. Ils ont accès à `OLD` et `NEW` sans relecture.

Le déclencheur ne connaît pas l'auteur. On le lui transmet par une colonne
`ecriture` (JSON `{ acteur, jeton, origine, requete }`) présente sur chaque
table, que **l'extension Prisma** (`src/lib/journal/extension.ts`) remplit à
chaque écriture, imbriquées comprises. C'est la seule couche par laquelle
passent les écritures de l'application : aucune route n'a à s'en soucier.

Si une écriture contourne la couche (SQL brut, outil externe), la colonne
`ecriture` ne change pas : le déclencheur le détecte et journalise l'écriture
avec l'acteur `INCONNU:hors-couche`. Elle est donc tracée quand même, et
repérable. Le SQL brut de l'application (numérotation) pose `ecriture` à la
main avec `ecritureCourante()`.

Les déclencheurs sont **générés depuis le schéma Prisma** (DMMF) par
`src/lib/journal/declencheurs.ts` : une nouvelle table ou une nouvelle colonne
est couverte sans rien écrire.

### Les auteurs (`acteur`)

Format `TYPE:identifiant`, résolu dans cet ordre (`src/lib/journal/acteur.ts`) :

1. un contexte explicite `avecActeur(...)` : `AGENT:mail`, `SYSTEME:taches`, `MIGRATION:<nom>`… ;
2. la session NextAuth de la requête (jeton vérifié, jamais un en-tête) : `HUMAIN:<email>` ;
3. le poste local sans connexion (réglage de développement) : `HUMAIN:poste-local` ;
4. un appel sans session sur une route publique (webhook) : `EXTERNE:<chemin>` ;
5. un script lancé hors de Next : `SCRIPT:<nom du fichier>` ;
6. sinon `INCONNU:…`, compté dans la section qualité des données de la synthèse.

Le middleware pose sur chaque requête `x-coverswap-origine` (méthode et chemin)
et `x-coverswap-requete` (identifiant aléatoire), en écrasant toute valeur
envoyée par le navigateur. Ils ne servent qu'à dater et regrouper, jamais à
identifier.

Piège rencontré : les requêtes Prisma sont paresseuses (elles partent au premier
`then`). `avecActeur` attend donc la fonction **dans** le contexte, sinon la
requête partirait hors de lui et perdrait son auteur.

### Rien ne se supprime

- Base : chaque table porte un déclencheur `BEFORE DELETE` qui refuse, y compris
  en SQL brut. La couche Prisma refuse `delete`, `deleteMany` et les
  suppressions imbriquées avant d'atteindre la base, avec un message en français.
- Les modèles métier portent `archiveLe` et `archiveMotif`. Archiver = une
  modification, journalisée comme `ARCHIVAGE` ; l'annuler = `RESTAURATION`.
- **Lecture** : `findMany`, `findFirst`, `count`, `aggregate` et `groupBy`
  ignorent les enregistrements archivés, sauf si la requête parle elle-même de
  `archiveLe` (pour tout voir : `where: { ...AVEC_ARCHIVES, … }`). `findUnique`
  les rend toujours : un lien direct vers un enregistrement archivé doit
  l'afficher. Les inclusions imbriquées (`include`) ne sont pas filtrées :
  filtrer explicitement là où c'est utile.
- Fichiers : retirer une photo, ou annuler une génération de PDF, déplace le
  fichier dans `archives/<horodatage>-<raison>/` sous le répertoire d'upload.
- Le journal lui-même ne se modifie pas, sauf un **caviardage RGPD** (une fois,
  sans toucher à l'horodatage, l'auteur, l'opération ni l'identifiant).
- **Refus lisibles** : le moteur SQLite de Prisma rapporte toute erreur levée
  par un déclencheur comme « Foreign key constraint violated », sans son
  message. La couche (`src/lib/journal/refus.ts`) le retrouve : en SQL brut, le
  message du déclencheur est transmis ; pour une opération de modèle, une
  modification refusée sur un modèle immuable qui ne pose aucun lien ne peut
  venir que de son déclencheur, dont elle reprend le message. L'appelant reçoit
  une `EcritureRefusee` (HTTP 409, message en français). Les tests vérifient le
  type d'erreur, pas seulement un motif de texte : l'extrait de code qu'ajoute
  Prisma à ses messages contient les lignes du test et faisait passer des
  assertions à tort.

### Modèles hors journal

`MODELES_HORS_JOURNAL` (dans `declencheurs.ts`) liste les tables dont chaque
écriture n'est pas journalisée (leurs suppressions restent refusées). Tout ajout
doit être justifié ici :

- `JournalModification` : c'est le journal ;
- `Tache` et `Planification` (file de tâches, section 3) : leurs lignes sont
  déjà un historique d'exécution (tentatives, erreurs, résultat) et changent à
  chaque tour ; les écritures faites **par** les tâches sont journalisées,
  attribuées à l'acteur du traitement avec l'origine `tache:<TYPE>`.

### Limites connues

- `connect`, `disconnect` et `set` sur une relation « vers plusieurs », écrits
  depuis le parent, modifient la clé étrangère des enfants sans passer par
  leurs données : l'écriture est journalisée mais attribuée à
  `INCONNU:hors-couche`. Convention : modifier la clé étrangère sur l'enfant.
- Le journal stocke l'enregistrement complet à chaque modification. Pour ce
  volume d'activité (quelques centaines d'écritures par jour), c'est quelques
  Mo par an ; à surveiller si un traitement de masse réécrit de gros champs
  JSON en boucle.
- `prisma db push` supprime les déclencheurs des tables qu'il reconstruit : ils
  sont réinstallés au démarrage, avant toute requête (voir 1bis).
- Base Turso (libSQL) : les déclencheurs y fonctionnent, mais `prisma db push`
  au démarrage ne modifie pas une base Turso. Si `TURSO_DATABASE_URL` est
  définie en production, le schéma doit y être appliqué séparément ;
  l'application refuse de démarrer tant qu'il manque une colonne.

## 1bis. Démarrage, migrations et sauvegardes

Ordre en production (`npm start`) :

1. `scripts/avant-demarrage.mjs` : compare la base au schéma (`prisma migrate
   diff`, lecture seule). S'il y a une différence (ou si la comparaison échoue) :
   sauvegarde vérifiée (`VACUUM INTO` puis `PRAGMA integrity_check`), sinon
   arrêt ; puis retrait des déclencheurs du journal, que `db push` empêcherait
   de reconstruire les tables.
2. `prisma db push --skip-generate`, **sans `--accept-data-loss`** : une
   modification du schéma qui détruirait des données fait échouer le
   démarrage au lieu de passer.
3. `next start` ; avant la première requête, `src/instrumentation.ts` appelle
   `preparerBase()` : vérification que chaque table et colonne du schéma
   existent (sinon refus de démarrer), réinstallation des déclencheurs dans une
   transaction, puis migrations de données en attente.

Migrations de données (`src/lib/base/migrations/`) : exécutées une seule fois,
dans l'ordre, enregistrées dans `MigrationDonnees`, précédées d'une sauvegarde,
attribuées à `MIGRATION:<nom>`. Chacune doit être idempotente : si le démarrage
s'interrompt entre son exécution et son enregistrement, elle est rejouée. On
n'en renomme ni n'en retire jamais une.

La première, `2026-09-16-journal-etat-initial`, photographie chaque
enregistrement existant dans le journal (`ETAT_INITIAL`) : l'état de n'importe
quel enregistrement à n'importe quelle date se lit ensuite dans le journal seul.

Sauvegardes : dans `SAUVEGARDES_DIR`, ou à défaut `sauvegardes/` à côté du
fichier de base (sur le volume `/data` en production). Aucune n'est effacée
automatiquement. Une sauvegarde n'est prise que lorsqu'une migration va avoir
lieu : un simple redémarrage n'en crée pas.

Commandes locales :

- `npm run base:sauvegarder` : sauvegarde manuelle ;
- `npm run base:pousser` : sauvegarde si besoin, `db push`, puis déclencheurs et
  migrations de données (redémarrer ensuite le serveur de développement) ;
- `npm test` : tests sur des copies temporaires de la base (jamais la base de
  développement ni la production).

## 2. Accès : refus par défaut

Jusqu'ici, le middleware protégeait une **liste de préfixes** : toute nouvelle
route était publique tant qu'on n'avait pas pensé à l'ajouter. Cinq oublis ont
été constatés (dont les photos de clients sous `/api/uploads`). La logique est
inversée : `src/lib/acces/routes-publiques.ts` liste les seules routes
joignables sans session, chacune avec la manière dont elle se protège
elle-même ; tout le reste exige une connexion.

- Pages : redirection vers la connexion, en conservant l'adresse demandée.
- API : `401 { error: "Connexion requise" }`.
- Un test vérifie que chaque entrée publique correspond à une route existante et
  qu'une route inconnue est refusée.
- `/api/cron/*` refuse tout si `CRON_SECRET` n'est pas définie (avant : ouverte).
- Webhook Meta : signature `X-Hub-Signature-256` vérifiée dès que
  `META_APP_SECRET` est définie.
- Le fichier suit la convention `proxy.ts` de Next 16 (`middleware.ts` est dépréciée).

## 3. Tâches de fond

Tout ce qui parle à un service extérieur (Google Drive, Gmail, envoi de mail)
ou qui peut attendre passe par une **file de tâches en base** (`Tache`), jamais
dans le chemin d'une requête : l'interface n'attend pas, et une panne réseau ne
perd rien.

- **Idempotence** : chaque tâche a une clé unique. Mode `UNIQUE` (défaut) : une
  clé déjà connue n'est jamais rejouée — un envoi validé ne part qu'une fois.
  Mode `RECONCILIATION` : la tâche remet un état en ordre (miroir Drive) ; la
  remettre en file la rejoue, même terminée, ou après la fin si elle tourne.
- **Transactionnel** : `mettreEnFile(demande, tx)` dans la transaction de
  l'écriture qui la motive ; la tâche existe si et seulement si l'écriture a eu lieu.
- **Réessais** : 30 s, 1 min, 2 min… plafonnés à 6 h (avec un peu d'aléa), 8
  tentatives par défaut ; `ErreurDefinitive` (accès révoqué, donnée invalide)
  abandonne tout de suite. Une tâche abandonnée reste visible, avec son erreur,
  et se relance à la main.
- **Reprise après plantage** : une tâche en cours porte un bail
  (`verrouJusqua`) ; passé ce délai, elle est reprise. La réservation
  (`UPDATE … WHERE statut = …`) garantit une seule exécution à la fois, même
  avec plusieurs processus.
- **Délai maximal** par traitement : au-delà, la tentative est interrompue
  (signal d'annulation) et reprogrammée.
- **Travaux périodiques** (`Planification`) : une ligne par travail (relève des
  mails, vérification du miroir…), son dernier passage, ses échecs consécutifs.
  Pas une ligne par passage : la table ne grossit pas.
- **Exécuteur** : dans le processus Next, démarré par `src/instrumentation.ts`
  après la préparation de la base ; un tour toutes les 15 s, ou tout de suite
  après une mise en file. `TACHES_DESACTIVEES=1` le coupe (maintenance).
- **Registre explicite** : `src/lib/taches/traitements.ts` est la liste de tout
  ce qui tourne en arrière-plan.

Pourquoi pas un service de file externe (Redis, BullMQ, Inngest) : une instance
unique sur Railway, une base SQLite déjà sauvegardée ; un service de plus serait
une panne de plus et un secret de plus, pour un volume de quelques centaines de
tâches par jour.

## 4. Interface : un gabarit commun aux écrans de pilotage

Les écrans du pilotage (Dossiers, À valider, Prospection, Tâches, puis Clients,
Finances, Dépenses, Boîte mail, Synthèse) vivent dans le groupe de routes
`src/app/(pilotage)` : même charte sombre que /prospection et /dossiers, une
seule navigation.

- **Ordinateur** : barre du haut, compteurs à côté des entrées (propositions à
  valider, tâches en échec).
- **Téléphone** : barre du bas au pouce, quatre écrans au plus et « Plus » pour
  le reste ; le contenu réserve la hauteur de la barre (et la zone de sécurité
  de l'iPhone).
- **Primitives partagées** : `src/components/pilotage/ui.tsx` (boutons, champs à
  16 px sur mobile pour éviter le zoom de Safari, modale plein écran sur
  téléphone, puces de choix rapide, pastilles) et `client.ts` (appels d'API aux
  erreurs en français). Les outils communs des routes (`analyser`,
  `reponseErreur`, `ErreurMetier`) sont dans `src/lib/commun/`.
- Les anciens écrans (groupe `(app)`, charte claire) restent joignables par
  « Anciens écrans » tant qu'ils ne sont pas remplacés.
- **Tâches de fond** (`/taches`) : travaux périodiques et leur dernier passage,
  tâches en échec avec leur erreur, relance et annulation à la main.

## 5. Validation : « l'agent propose, je valide »

Une seule mécanique pour tout ce qu'un agent ou le système propose :
rattacher un mail, noter, changer une étape, relancer, envoyer un devis,
fusionner deux clients… (table `Proposition`, écran `/validation`). Elle
reprend le geste de la file de /prospection (valider, corriger, rejeter) et le
généralise.

- **Définitions explicites** : `src/lib/validation/catalogue.ts` liste chaque
  type avec son schéma de contenu (zod), ses champs corrigeables, ses motifs de
  rejet propres, son mode d'exécution et sa sensibilité.
- **Seule une personne décide.** Valider ou rejeter exige un acteur `HUMAIN`
  (session vérifiée) : un agent, un script ou une tâche reçoit un refus 403.
- **Sensible = argent ou client** (étapes Signé, Facturé, Encaissé, Perdu ;
  envoi d'un mail ; encaissement…) : jamais exécutée sans décision humaine,
  jamais validée en lot, signalée « Argent ou client » à l'écran. La
  sensibilité peut dépendre du contenu (un changement d'étape vers Simulation
  ne l'est pas).
- **Exécution sans validation** : réservée aux types déclarés `automatisable`
  (archiver du bruit, noter un événement certain), au-dessus d'un seuil de
  confiance, et refusée d'office pour une proposition sensible — c'est le
  verrou du principe, testé. Elle reste tracée (statut `AUTOMATIQUE`).
- **Corriger avant de valider** : seuls les champs déclarés corrigeables sont
  pris en compte (on ne change pas le dossier visé par l'API) ; la version de
  l'agent reste (`contenu`), la version exécutée aussi (`contenuValide`), et
  `modifiee` mesure le taux de correction.
- **Rejeter** : motif obligatoire en un clic (liste fermée), commentaire exigé
  pour « Autre ». Ces motifs servent à mesurer l'agent (synthèse).
- **Exécution IMMEDIATE** (écritures en base) : dans la transaction de la
  validation ; si elle échoue, rien n'est écrit, la proposition reste à valider
  et l'erreur est affichée sur la carte. **FILE** (service extérieur : envoi) :
  par la file de tâches, au nom de la personne qui a validé ; en échec après
  5 tentatives, « Réessayer » la relance ; rejouer la tâche n'exécute jamais
  deux fois.
- **Une même chose n'est proposée qu'une fois** (`cleUnicite`), rejetée ou non :
  l'agent ne harcèle pas avec ce qu'on a déjà refusé.
- **Devenue sans objet** (dossier archivé, étape déjà atteinte) : annulée au
  moment de la validation, sans être exécutée. Une échéance (`expireLe`) fait
  expirer les propositions périmées (travail périodique horaire).
- Raisonnement de l'agent et confiance (calculée par le code) conservés et
  affichés (« Pourquoi ? »).

## 6. Clients pérennes

Un **client** (`Client`) est une personne ou une entreprise, au-delà d'un lead
ou d'un dossier : ses dossiers, ses contacts entrants, sa provenance, qui l'a
recommandé et qui il a recommandé, son passif, son consentement aux mails.

- **Coordonnées multiples** : `ClientEmail` et `ClientTelephone`, normalisés
  (`+33612345678`, minuscules), une principale, archivables (jamais effacées).
- **Provenance** : `source` en liste fermée (publicité Meta, site, recommandation,
  bouche-à-oreille, réseaux, prospection, sous-traitance, salon…), précision,
  campagne, publicité et formulaire (extraits des anciennes notes des webhooks,
  écrits en champs désormais), date du premier contact. Les familles de sources
  permettent de chiffrer « bouche-à-oreille contre Meta » : nombre de clients,
  clients signés, montant signé, sur l'écran /clients.
- **Recommandations** : `recommandeParId` (une fiche, donc chiffrable : ce que
  les recommandés ont signé) ou `recommandeParTexte` pour quelqu'un qui n'est
  pas client.
- **Consentement** (`ConsentementMail`) : une ligne par déclaration, datée, avec
  le moyen et la preuve ; **la base refuse toute modification** (seul le
  rattachement à la fiche conservée lors d'une fusion peut changer). Sans
  déclaration, pas de mail commercial.

### Retrouver le client : règle d'identité

Une adresse e-mail ou un numéro identiques, une fois normalisés, désignent le
même client (`trouverClientParCoordonnees`). C'est la règle que les webhooks
appliquaient déjà aux leads ; elle sert aux leads entrants (site, Meta, Zapier)
et à l'ouverture d'un dossier. Un rattachement qui échoue ne bloque jamais la
réception d'un lead : le travail périodique `rattachement-clients` rattrape les
leads et dossiers restés sans client.

### Doublons : proposés, jamais imposés

- **Reprise de l'existant** (migration `2026-09-17-clients-perennes`) : une fiche
  par lead, **sans chercher les fiches existantes** — même deux leads au même
  numéro gardent chacun leur fiche. Les dossiers rejoignent la fiche de leur
  lead ou de leur prospect, sinon une fiche créée depuis leurs coordonnées ; les
  prospects convertis reçoivent la leur.
- **Détection** (`doublons-clients`, chaque jour, ou « Chercher les doublons ») :
  même e-mail, même numéro, même SIRET, même nom dans la même ville, nom à une
  lettre près. Chaque paire devient une proposition `FUSION_CLIENTS` avec ses
  indices et une confiance. Dans un groupe, chaque fiche est rapprochée de la
  fiche de référence (plus de dossiers, puis plus ancienne) et non de toutes les
  autres ; une coordonnée partagée par plus de 4 fiches est un standard ou une
  valeur générique, sans proposition (constaté sur les données de démonstration :
  11 fiches au même numéro donnaient 55 propositions).
- **Fusion** (après validation seulement, jamais en lot) : tout ce qui porte un
  `clientId` — lu dans le schéma, un nouveau modèle est couvert d'office — passe
  sur la fiche conservée ; les blancs sont complétés ; l'acquisition retenue est
  celle du premier contact ; la fiche absorbée est archivée avec
  `fusionneDansId`. Une paire rejetée n'est jamais reproposée.

### Écrans

- `/clients` : recherche (nom, ville, e-mail, téléphone), filtres catégorie et
  source, provenance des clients avec montants signés, « Nouveau client » (refus
  explicite si l'e-mail ou le numéro est déjà connu, « Créer quand même » sinon).
- `/clients/[id]` : coordonnées, provenance et recommandations, consentement,
  dossiers, passif, contacts entrants, historique de la fiche (lu dans le
  journal), « Ouvrir un dossier » pré-rempli, archivage (refusé tant qu'un
  dossier est en cours).
- « Ouvrir un dossier » cherche d'abord parmi les clients, puis les leads et les
  prospects.

## 7. Échecs et délais des dossiers

- **Perte figée** : au passage en « Perdu », le motif (obligatoire, en un clic),
  et en facultatif qui a remporté le marché, à quel prix et ce qu'a dit le
  client ; le système fige aussi l'étape perdue (celle d'avant une éventuelle
  pause) et notre dernier prix (dernier devis émis, sinon estimation). Colonnes
  `perte*` du dossier pour les requêtes ; la reprise les retire, mais
  l'événement de changement d'étape les garde pour toujours.
- **Délais** (`src/lib/dossiers/delais.ts`, pur) : parcours des étapes lu dans
  les événements, temps cumulé par étape (un retour ajoute un second passage),
  délais clés (ouverture → signature, signature → chantier, facturation →
  encaissement, bout en bout). Rien n'est stocké : tout se recalcule depuis
  l'historique, qui fait foi.
- **Écarts de prix** : estimation, premier et dernier devis émis, devis signé et
  écart avec le premier devis (montant et pourcentage), facturé.
- Panneau du dossier : section « Délais et prix ».

## 8. Paramètres datés, sans valeur par défaut

Seuils de franchise de TVA, plafond micro, taux de cotisations, de CFP et de
versement libératoire, périodicité de déclaration, règle de date des chèques,
délai de paiement et pénalités des factures aux professionnels, indemnité de
recouvrement, escompte, délai de relance (`src/lib/parametres/definitions.ts`).

- **Aucune valeur dans le code.** Un seuil ou un taux faux fausserait les
  calculs sans que personne ne le voie ; le code dit seulement où trouver la
  valeur (URSSAF, impots.gouv.fr, article de loi, comptable).
- **Saisie forcée à la première utilisation** : un calcul ou un document qui a
  besoin d'un paramètre absent à la date voulue lève `ParametresManquants`
  (HTTP 428 avec la liste) ; l'écran ouvre la fenêtre de saisie de tous les
  paramètres manquants puis relance l'action (`useParametresExiges`).
- **Datés et immuables** : chaque saisie est une ligne `Parametre` avec sa date
  d'effet et sa source, que la base refuse de modifier ; une nouvelle valeur ne
  réécrit jamais le passé (une recette de mars se calcule au taux de mars).
- Écran `/parametres` : valeur en vigueur, valeurs à venir, historique.

## 9. Numérotation et documents émis

### La situation de départ

2026 a d'abord été numéroté à la main, en **une série partagée** entre devis et
factures : 2026-001 à 2026-037, dont 030 et 032 sont des factures, 031 et 033 à
037 des devis (la nature de 001 à 029 n'est pas connue). L'ancien écran du CRM
numérotait ensuite « 2026-0001 » (devis) et « FACT-2026-0001 » (factures) ; le
module Dossiers, une série de devis et une série F de factures. Un numéro déjà
envoyé à un client ne doit jamais resservir, et une série de factures doit être
continue et chronologique.

### Le registre : tout numéro émis, d'où qu'il vienne

`NumeroDocument` inscrit chaque numéro émis, une ligne par numéro, identifié
par une clé `famille:année:rang` (« F:2026:12 », « :2026:38 ») :

- numéros manuels (inscrits par la migration de données, ou déclarés à l'écran
  `/numeros`), numéros de l'ancien écran, documents du CRM ;
- « 2026-0001 » et « 2026-001 » ont la même clé : ils se lisent pareil pour un
  client. Si deux sources ont émis le même numéro, la migration le **signale**
  dans la note de la ligne, sans rien écraser ;
- la base refuse de changer un numéro inscrit (seuls nature, destinataire,
  montant et note se complètent) et, comme partout, de le supprimer.

### L'attribution (`src/lib/dossiers/numerotation.ts`)

- Dans la transaction qui crée le document : si la génération échoue, compteur
  et registre reviennent en arrière et le numéro n'a jamais existé (le PDF déjà
  écrit part aux archives).
- Une seule instruction lit et incrémente le compteur : deux générations
  simultanées n'obtiennent jamais le même numéro.
- Un compteur démarre, à sa création, après le plus haut rang inscrit pour ses
  familles précédentes (la série F reprend après les « FACT-… » de l'année),
  à défaut après l'amorce du code (devis 2026 : 37).
- **Un numéro déjà inscrit est sauté**, jamais réattribué.
- Une facture ou un avoir ne peut pas être daté avant le dernier document daté
  de sa série (horloge du serveur déréglée).

Déclarer un numéro à la main (`/numeros`) : refusé s'il est déjà inscrit ; dans
la série des factures, refusé s'il se glisserait derrière la numérotation du
CRM ou rouvrirait une série close (« FACT » après le passage à F). L'écran
signale les rangs sans inscription d'une série : un trou dans une série de
factures est à déclarer ou à expliquer.

### Choix des séries : le plus prudent, à faire valider

Devis : la série sans préfixe continue (2026-038…). Factures et avoirs : une
seule série F continue et chronologique (F2026-001…). Une série partagée avec
les devis ne peut pas être continue pour les factures ; des séries distinctes
sont admises quand elles sont justifiées, mais **le comptable doit valider ce
choix**. S'il préfère une série unique, la modification tient dans
`NUMEROTATION` (`src/lib/dossiers/constants.ts`) ; le registre garantit dans
tous les cas qu'aucun numéro émis ne resservira.

### Un document émis est figé

À l'émission, le document reçoit et garde : destinataire tel qu'imprimé
(nom, adresse, SIRET), catégorie du client ce jour-là, mentions légales,
échéance. Le PDF archivé se reconstitue à l'identique depuis ces données, même
si la fiche client change ensuite.

La base refuse toute modification d'un document numéroté, sauf : son statut,
son PDF archivé, son client pérenne (qui suit une fusion validée) ; destinataire
et catégorie se renseignent une fois pour les documents émis avant le gel.
Un document émis ne s'archive pas non plus : il reste visible.

- **Facture erronée** : avoir total (même montant, même série F, mentions « Avoir
  sur la facture n° … du … » et motif obligatoire), la facture passe « Annulée
  par avoir » ; s'il n'en reste aucune active, le dossier revient à « Chantier »
  en attendant la facture corrigée. Pas d'avoir partiel : annuler puis refaire.
- **Devis à revoir** : « Refaire ce devis » émet un nouveau numéro et marque
  l'ancien « Remplacé » (un devis accepté ne se remplace pas).

### Mentions selon le destinataire (`src/lib/dossiers/mentions.ts`)

- Particulier : « Paiement à réception de facture ».
- Professionnel ou donneur d'ordre : date d'échéance, taux des pénalités de
  retard, indemnité forfaitaire de recouvrement, conditions d'escompte. Ces
  valeurs sont des **paramètres datés sans défaut** (section 8) : sans elles,
  la génération demande leur saisie, et **aucun numéro n'est consommé**.
- Le PDF imprime les mentions figées du document : il s'adapte seul au
  destinataire.

### Limites connues

- La catégorie (particulier ou professionnel) vient de la fiche client ; un
  dossier sans client pérenne est traité en particulier.
- Les numéros 001 à 029 de la série manuelle restent « nature inconnue » tant
  qu'ils ne sont pas complétés à l'écran.

