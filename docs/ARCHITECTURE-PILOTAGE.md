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
| Aucun numéro émis réattribué | (volet comptabilité) | |
| L'agent ne décide pas seul de l'argent ni de ce qui part chez un client | (volets validation et agent) | |
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

