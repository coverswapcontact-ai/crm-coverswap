# Système de pilotage CoverSwap — décisions d'architecture

Ce document explique **pourquoi** le CRM est construit ainsi. Le code dit comment ;
ici on garde les raisons, les arbitrages et les limites connues, pour pouvoir
les remettre en cause en connaissance de cause.

Chaque section correspond à un volet livré dans un commit distinct (voir
`git log`), qu'on peut annuler sans défaire les autres.

## 0. Principes non négociables et où ils vivent

| Principe | Mécanisme | Où |
| --- | --- | --- |
| Rien ne se supprime | Déclencheur `BEFORE DELETE` sur chaque table + refus dans la couche Prisma ; archivage (`archiveLe`, `archiveMotif`) ; fichiers déplacés dans `archives/` ; clients Gmail et Drive sans aucune fonction de corbeille ni de suppression (archivage par libellé, dossier d'archives) | `src/lib/journal/`, `src/lib/messages/gmail.ts`, `src/lib/drive/client.ts` |
| Aucune donnée perdue | Sauvegarde vérifiée avant toute migration de schéma ou de données ; `db push` sans `--accept-data-loss` ; migrations de données idempotentes | `scripts/avant-demarrage.mjs`, `src/lib/base/` |
| Aucun numéro émis réattribué | Registre `NumeroDocument` de tout numéro émis (manuel, ancien écran, CRM) ; un numéro inscrit est sauté, jamais réattribué ni modifié ; document émis figé par la base (avoir, devis refait) | `src/lib/dossiers/numerotation.ts`, section 9 |
| L'agent ne décide pas seul de l'argent ni de ce qui part chez un client | Toute action proposée passe par `Proposition` ; seule une personne connectée valide ou rejette ; une proposition sensible ne s'exécute jamais seule ni en lot | `src/lib/validation/` |
| Aucun secret en dur | Variables d'environnement uniquement ; le dépôt est public | |
| Photos jamais sans authentification | Proxy en refus par défaut : seule une liste blanche commentée est joignable sans session | `src/proxy.ts`, `src/lib/acces/routes-publiques.ts` |
| RGPD | Consentement distinct, daté, immuable ; durées de conservation paramétrées → anonymisation proposée, décidée par une personne ; carte des données personnelles vérifiée sur le schéma ; journal caviardé ; pièces comptables gardées | `src/lib/rgpd/`, section 17 |
| Signaler, jamais bloquer | Une règle métier qui empêchait une action devient un avertissement lu puis confirmé, gardé dans l'historique ; ce qui manque est signalé sur le dossier et dans la qualité des données de /synthese. Restent protégés : les mails (validés), les numéros émis, la suppression | `src/lib/dossiers/regles.ts`, `completude.ts`, `src/lib/clients/fiches.ts`, sections 6 et 18 |

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

### Lire le journal

L'écran « Journal » (`/journal`, menu Plus) a été retiré au lot 7 de la
mission 13 (29/09/2026), avec `api/journal`, `lib/journal/lecture.ts` et
`libelles.ts` : il n'était pas utilisé. Le journal, lui, s'écrit toujours
intégralement (déclencheurs et couche Prisma ci-dessus) ; il se lit par la
carte « Historique de la fiche » d'un client (`src/lib/clients/fiches.ts`, SQL
sur `JournalModification` ; `FicheClient.tsx`), par l'historique des événements
du dossier, et en base (sauvegardes). Les secrets (jeton Google chiffré) y sont
masqués ; une copie caviardée (RGPD) y est signalée.

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
  attribuées à l'acteur du traitement avec l'origine `tache:<TYPE>` ;
- `MiroirDrive` (section 15) : état technique du miroir, réécrit à chaque passage ;
- `ContenuMessage` (section 16) : le texte d'un mail reçu, écrit une fois avec
  son `Message` (lui journalisé) ; la base en refuse toute modification, sauf
  son effacement RGPD, une fois. Le journaliser dupliquerait chaque mail ;
- `AlerteEnvoi` : registre des alertes envoyées au gérant (push, mail). Déjà un
  historique — une ligne par envoi, jamais modifiée — sans donnée métier ni
  donnée personnelle (origine de l'alerte et état de chaque canal seulement) ;
- `CleInterne` : clés générées par le serveur quand aucune variable ne les
  fournit (paire VAPID du push web) ; le journal en garderait une copie lisible ;
- `AbonnementPush` : abonnement d'un appareil aux notifications du navigateur
  (adresse de livraison, clés de chiffrement), réécrit à chaque envoi.
- `DepensePubJour`, `SeoJour`, `FicheGoogleJour` (Analytique, section 26) :
  historique quotidien copié depuis Meta et Google, écrit en rafale par upsert
  (les mêmes jours sont réécrits toutes les 3 h pour Meta, chaque nuit pour
  Google, parce que ces chiffres sont révisés), sans donnée personnelle ; la
  source de vérité reste chez Meta ou Google. Les journaliser doublerait chaque
  ligne à chaque passage sans rien apprendre ;
- `InstantaneAnalytique` : écrans de l'Analytique pré-calculés et résumé du jour,
  recalculés chaque jour à partir de données elles-mêmes lisibles ailleurs ;
- `EvenementSite` (mission 17, partie B) : la mesure d'audience du site, une ligne
  par page vue, écrite en rafale et jamais modifiée, sans donnée personnelle ; elle
  est purgée à 25 mois (ci-dessous) et une copie dans le journal immuable survivrait
  à la purge. Les copies journalisées avant le 30/09/2026 restent (sans empreinte de
  visiteur : la colonne n'existait pas).

### Modèles purgeables : la seule exception à « rien ne se supprime »

`MODELES_PURGEABLES` (dans `declencheurs.ts`) liste des mesures anonymes, sans
`archiveLe`, dont la durée de conservation est imposée. La couche Prisma n'y
accepte que `deleteMany` (jamais `delete` ni une suppression imbriquée), et le
déclencheur `interdit_suppression_<table>` n'y laisse passer qu'une ligne plus
vieille qu'un âge minimal (`createdAt`) : même une purge mal écrite ne peut pas
effacer une mesure récente.

- `EvenementSite` (âge minimal 750 jours) : la mesure d'audience du site (page
  vue, étape du simulateur), avec une empreinte de visiteur valable un jour. La
  recommandation de la CNIL pour une mesure exemptée de consentement borne la
  conservation à 25 mois : le travail quotidien `analytique-purge-mesure`
  (`analytique/mesure.ts › purgerMesureSite`) supprime ce qui a dépassé 25 mois.

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
  développement ni la production) ;
- `npm run simulateur:prompts` : régénère `src/lib/simulateur/prompts-defaut.ts` (la bibliothèque
  ChatGPT est GÉNÉRÉE par le moteur de prompt, mission 15 ; un test vérifie que le fichier est à jour).

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
- Webhooks du site, de n8n et de Zapier : secret partagé `WEBHOOK_SECRET`,
  comparé à temps constant (`src/lib/acces/secret-webhook.ts`). **Rotation sans
  perdre de lead** : poser le nouveau secret dans `WEBHOOK_SECRET` et l'ancien
  dans `WEBHOOK_SECRET_PRECEDENT`, mettre à jour chaque expéditeur (site :
  `CRM_WEBHOOK_SECRET` sur Vercel ; n8n ; URL Zapier ; scripts), puis retirer
  `WEBHOOK_SECRET_PRECEDENT`.
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
- **Attente d'une ressource extérieure** (`AttenteExterne`, `GoogleIndisponible`) :
  Google coupé ou pas connecté, droit manquant, API non activée dans le projet
  Google Cloud (403 `accessNotConfigured`, `ApiGoogleNonActivee` — mission 14,
  partie 9) → la tâche attend sans compter d'essai (15 min ; 6 h pour un droit
  ou une API qui manquent), et la reconnexion Google la réveille. Rien n'est
  perdu, rien n'est en échec.
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

Le pilotage est le seul point d'entrée du CRM. Ses écrans (Leads, Dossiers,
Espaces clients, Simulateur, Mail, Clients, Finances, puis Site, Publicité,
Tâches de fond, Dépenses, Paramètres ; À valider et Synthèse restent joignables
par leur adresse seulement — `src/components/pilotage/Navigation.tsx`, état
après le lot 7 du 29/09/2026) vivent dans le groupe de routes
`src/app/(pilotage)` : une charte sombre, une seule navigation. La connexion
(`/auth/signin`) suit la même charte.

- **Ordinateur** : barre du haut, compteurs à côté des entrées (rappels de
  leads en retard, en rouge ; mails à traiter ; tâches en échec).
- **Téléphone** : barre du bas au pouce, cinq écrans (Leads, Dossiers, Espaces,
  Mail, Clients) et « Plus » pour le reste ; le contenu réserve la hauteur de la
  barre (et la zone de sécurité de l'iPhone).
- **Primitives partagées** : `src/components/pilotage/ui.tsx` (boutons, champs à
  16 px sur mobile pour éviter le zoom de Safari, modale plein écran sur
  téléphone, puces de choix rapide, pastilles) et `client.ts` (appels d'API aux
  erreurs en français). Les outils communs des routes (`analyser`,
  `reponseErreur`, `ErreurMetier`) sont dans `src/lib/commun/`.
- L'ancien CRM (groupe `(app)`, charte claire) est retiré : voir la section 19
  pour ce qui a été repris et les redirections de ses adresses.
- **Tâches** (`/taches`, accueil depuis la mission 17) : la liste de ce que Lucas a à faire
  (`src/lib/a-faire/`, routes `/api/a-faire/…`, conception dans `docs/TACHES.md`).
- **Tâches de fond** (`/taches-de-fond`, anciennement `/taches`) : travaux périodiques et leur dernier passage,
  tâches en échec avec leur erreur, relance et annulation à la main.

## 5. Validation : « l'agent propose, je valide »

Une seule mécanique pour tout ce qu'un agent ou le système propose :
rattacher un mail, noter, changer une étape, relancer, envoyer un devis,
fusionner deux clients… (table `Proposition`, écran `/validation`). Un seul
geste pour tout : valider, corriger, rejeter.

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
- Mission 14 (partie 6) : plus aucune proposition `ENVOI_SMS` n'est créée (les
  relances sont des SMS à copier, section 25) ; celles encore en base restent
  validables jusqu'à leur expiration, comptées dans l'en-tête de Dossiers.

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

### Particulier ou entité

- **Particulier** : une personne, prénom et nom ; ni raison sociale ni SIRET
  (retirés s'ils arrivent).
- **Professionnel** (client direct) et **donneur d'ordre** (case
  « Sous-traitance » : on travaille pour le compte de cette entreprise) :
  une entité. La fiche porte la raison sociale (qui fait son nom, et celui des
  devis et factures), le SIRET et l'adresse de facturation ; créée à la main,
  elle n'a **ni prénom ni nom de personne**. Une fiche pro venue d'un formulaire
  (« projet pro ») ou d'un mail peut porter le nom de la personne qui a écrit :
  il reste visible dans « Modifier » sous « Contact », effaçable, et la fiche
  reste modifiable tant que le nom de l'entreprise n'est pas connu.
- **Règles** (`creerClientManuel`, `modifierClient`) : le nom est la seule
  exigence. Pour un pro, c'est la raison sociale : exigée à la création, quand un
  particulier devient pro et quand un pro en a déjà une (elle ne s'efface pas) ;
  un pro qui redevient particulier doit avoir un nom de personne. Un SIRET saisi
  a 14 chiffres ; une clé de Luhn fausse (exception de La Poste, SIREN
  356 000 000) est **signalée, pas refusée** : le SIRET est gardé tel quel, et
  seul un SIRET nouvellement saisi est signalé. Un SIRET déjà porté par une
  fiche active arrête la création (409 avec l'identifiant de la fiche, « Créer
  quand même » sinon, et la paire est proposée à la fusion).
- **Annuaire des entreprises** (`src/lib/clients/annuaire.ts`, route
  `/api/clients/annuaire`, protégée comme les autres) : recherche par nom, SIREN
  ou SIRET dans l'API publique de l'État (recherche-entreprises.api.gouv.fr,
  Insee et RNE), **sans clé ni compte**. Un clic remplit raison sociale, SIRET et
  adresse ; rien n'est enregistré avant la création de la fiche, et seul le texte
  cherché part vers l'annuaire. Pour chaque entreprise : les établissements qui
  correspondent à la recherche, sinon le siège ; fermés en dernier, champs non
  diffusibles laissés vides. Annuaire injoignable ou saturé : message, et la
  fiche se remplit à la main.
- **À l'ouverture d'un dossier** (création directe ou reprise, sans fiche
  choisie) : « Particulier » ou « Entreprise », avec la case « Sous-traitance »,
  la recherche dans l'annuaire et le SIRET. Le nom du dossier devient la raison
  sociale de la fiche créée ; un SIRET déjà porté par une fiche y rattache le
  dossier (avant même l'e-mail ou le numéro) et complète une fiche d'entreprise
  retrouvée qui n'en avait pas. Cocher « Sous-traitance » renseigne la source du
  dossier si elle est vide ; choisir la source « Sous-traitance » coche la case,
  et la source « Prospection » propose « Entreprise » tant que rien n'est
  choisi. Depuis un client, un lead ou un prospect, la fiche d'origine décide.

### Rien d'obligatoire au-delà du nom, tout se modifie

Même principe que les dossiers (section 18) : ce qui manque est signalé, pas
exigé.

- **Facultatif** : coordonnées, adresse, source. Une source non renseignée vaut
  « Inconnue » et le dit à la création ; /synthese compte les nouveaux clients
  sans source et les clients sans e-mail ni téléphone. Le code postal est libre
  (10 caractères : un client à l'étranger).
- **Refusé, parce qu'inutilisable** : un e-mail ou un numéro illisible (il ne
  servirait ni à joindre ni à retrouver le client) et un SIRET qui n'a pas 14
  chiffres. Le champ se laisse vide plutôt que faux.
- **Une fiche archivée se modifie** : identité, coordonnées, passif,
  consentement, puis « Restaurer ». Restent figées la fiche anonymisée (RGPD) et
  la fiche absorbée par une fusion (c'est la fiche conservée qui se modifie).
- **Coordonnée mal saisie** : corrigée sur place (`modifierCoordonnee`, crayon
  à côté du numéro ou de l'adresse), valeur et libellé ; elle garde son rang de
  principale, l'ancienne valeur reste au journal, et une valeur déjà sur la
  fiche n'est pas dupliquée. Une coordonnée qui n'est plus utilisée s'archive.
- **Archivage avec des dossiers en cours** : permis et signalé (« 2 dossiers en
  cours restent ouverts dans Dossiers ») ; les dossiers ne sont pas touchés.
- Le **consentement** reste une suite de déclarations que la base refuse de
  modifier : on en enregistre une nouvelle, à sa date réelle.

### Écrans

- `/clients` : recherche (nom, ville, e-mail, téléphone), filtres catégorie et
  source, provenance des clients avec montants signés, « Nouveau client » et
  « Nouveau client pro » (refus explicite si le SIRET, l'e-mail ou le numéro est
  déjà connu, avec un lien vers la fiche, « Créer quand même » sinon).
- `/clients/[id]` : coordonnées, provenance et recommandations, consentement,
  dossiers, passif, contacts entrants, historique de la fiche (lu dans le
  journal), « Ouvrir un dossier » pré-rempli, archivage (signalé si un dossier
  est en cours), « Modifier » et « Restaurer » sur une fiche archivée. Pour un
  pro : SIRET (lien vers sa page de l'annuaire) et contact éventuel sous le nom.
- « Ouvrir un dossier » cherche d'abord parmi les clients, puis les leads et les
  prospects.

## 7. Échecs et délais des dossiers

- **Perte figée** : au passage en « Perdu », le motif (en un clic, signalé
  s'il manque), qui a remporté le marché, à quel prix et ce qu'a dit le
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

- numéros manuels (inscrits par la migration de données, ou par « L'inscrire au
  registre et le rattacher » d'un document repris), numéros de l'ancien écran,
  documents du CRM ;
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

Déclarer un numéro à la main : refusé s'il est déjà inscrit ; dans la série des
factures, refusé s'il se glisserait derrière la numérotation du CRM ou
rouvrirait une série close (« FACT » après le passage à F). Ces règles vivent
dans `src/lib/dossiers/registre.ts` (`declarerNumero`, testé). L'écran
`/numeros` qui les portait (et qui signalait les rangs sans inscription d'une
série) a été retiré au lot 7 (29/09/2026) : aujourd'hui, la seule inscription
manuelle passe par un document repris (`inscrireNumeroManuel`,
`documents-existants.ts`), et `api/numeros` ne rend plus que les numéros libres
(plus `api/numeros/compteurs`).

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

La base refuse toute modification d'un document numéroté **généré par le CRM**
(`origine = CRM`), sauf : son statut, son PDF archivé, son client pérenne (qui
suit une fusion validée) ; destinataire et catégorie se renseignent une fois
pour les documents émis avant le gel. Un document émis ne s'archive pas non
plus : il reste visible. Pour tout document numéroté, repris compris, la base
refuse de changer le numéro, le type ou l'origine (section 18, documents
repris).

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
- Les numéros 001 à 029 de la série manuelle restent « nature inconnue » :
  depuis le retrait de `/numeros`, aucun écran ne permet de les compléter
  (`completerNumero` reste dans `registre.ts`, sans appelant).

## 10. Encaissements : l'argent reçu, distinct de ce qui est facturé

Une facture est une créance ; un encaissement est de l'argent effectivement
reçu. La comptabilité d'un micro-entrepreneur se tient sur les encaissements :
c'est eux que comptent le livre des recettes, l'URSSAF et les seuils.

### Le modèle

- `Encaissement` : payeur, montant, moyen (virement, chèque, espèces, carte,
  autre), référence (n° de chèque, libellé du virement), **date de réception**
  et, pour un chèque, **date de crédit** sur le compte, statut.
- `AffectationEncaissement` : la part d'un encaissement imputée sur une pièce
  **du registre des numéros** (section 9) : un devis pour un acompte, une
  facture du CRM, une facture manuelle ou de l'ancien écran. Passer par le
  registre donne une seule façon de régler toutes les factures, y compris
  celles émises hors du CRM.
- Un encaissement se découpe sur plusieurs pièces, une facture se règle en
  plusieurs encaissements (acompte, puis solde).

### Rien ne se supprime, tout se trace

La base refuse (déclencheurs) :

- de changer l'origine ou la clé de reprise d'un encaissement, ou le montant et
  la pièce d'une affectation ;
- de corriger le montant ou la date d'un encaissement annulé ou rejeté ;
- de rouvrir un encaissement annulé ou rejeté, ou une affectation qui a cessé
  de compter ;
- d'annuler ou de rejeter sans date ni motif.

Un **paiement se corrige** (montant, date de réception, moyen, référence,
payeur, date de crédit, note : `modifierEncaissement`), le journal gardant
chaque ancienne valeur et le dossier un événement « Paiement corrigé ». Un
montant corrigé libère ses affectations et les refait sur les mêmes pièces,
jusqu'à ce qui y reste dû. Une **erreur de saisie peut aussi s'annuler** avec
son motif (le paiement reste visible, barré) ; un **chèque impayé se rejette**,
daté et motivé. Dans ces deux cas, ses affectations passent `LIBEREE` : ce
qu'il réglait redevient dû. Le dossier se complète une fois.

### Les étapes suivent l'argent

- **« Signé » rappelle l'acompte** : la fenêtre de signature propose
  d'enregistrer l'acompte reçu (pré-rempli au pourcentage du devis choisi) ou
  de dire pourquoi il n'y en a pas (motif écrit dans l'événement) ; sans l'un
  ni l'autre, le passage se fait avec l'avertissement « Aucun acompte
  enregistré », gardé dans l'événement et signalé sur le dossier (section 18).
- **« Encaissé » est un fait** : un dossier « Facturé » dont toutes les
  factures sont réglées y passe tout seul. La fenêtre « Encaissé » propose
  d'enregistrer le paiement du solde ; s'il ne solde pas, le passage se fait
  quand même, avec le reste dû dans l'avertissement et sur le dossier.
- **Chèque rejeté ou paiement annulé** : un dossier « Encaissé » qui était
  réglé et ne l'est plus revient à « Facturé » ; un dossier mis à « Encaissé »
  à la main sans être réglé garde son étape (l'écart est signalé). Un acompte
  rejeté devient la prochaine action (« réclamer un nouveau paiement »).
- **Paiement au-delà de la pièce** : imputé jusqu'à ce qui reste dû, le
  surplus gardé non imputé et affiché, au lieu d'un refus.
- Anciens dossiers signés ou encaissés par simple case à cocher : leur
  historique reste tel quel ; les paiements s'y ajoutent à la main.

### Facture et avoir

- À la génération d'une facture, les acomptes imputés sur les devis du dossier
  lui sont **transférés** (l'affectation au devis passe `TRANSFEREE`, une
  nouvelle compte sur la facture), puis les sommes reçues non imputées.
  La facture **imprime** ces règlements (« Acompte reçu le … (chèque) : … »)
  et le reste à payer, figés avec ses mentions. Si un paiement change pendant
  la génération, elle est refusée plutôt que d'imprimer un montant faux.
- Un avoir libère ce qui réglait la facture annulée : la facture corrigée le
  reprend à sa génération.

### Reprise de l'ancien écran

Les paiements cochés dans l'ancien écran des factures (acompte et solde, avec
leur date) deviennent des encaissements, aux montants du devis d'origine, moyen
« non renseigné ». La reprise est une tâche horaire idempotente (clé de reprise)
et ne crée rien sans date : ces cas sont comptés, à saisir à la main.

### Limites connues

- Pas de remboursement ni de trop-perçu rendu : une somme reçue au-delà du dû
  reste « non imputée » et signalée sur le dossier.
- Un rejet de virement se traite comme une annulation (motif à préciser).
- Pas de facture d'acompte : l'acompte est imputé sur le devis puis imprimé sur
  la facture finale. **À faire valider par le comptable**, en particulier pour
  les clients professionnels.

## 11. Livre des recettes et tableau des finances

### Le livre se calcule, il ne se tient pas

Le livre des recettes (`src/lib/finances/livre.ts`) est **recalculé à chaque
lecture** depuis les encaissements : rien n'y est saisi, il se reconstruit à
l'identique et ne peut pas diverger de ce qui a été enregistré. Chaque ligne
porte ce qu'exige un livre de micro-entrepreneur : date d'encaissement, client,
nature de la prestation (objet du chantier), mode de règlement, pièces
justificatives (devis et factures réglés).

- **Date d'une recette** : sa réception ; pour un chèque, la règle du paramètre
  `DATE_RECETTE_CHEQUE` en vigueur à sa réception (à la réception, ou au crédit
  sur le compte). Tant que la règle n'est pas choisie, aucun chiffre qui en
  dépend ne s'affiche : rien n'est supposé.
- **Contre-passation pour une annulation** : un encaissement déjà compté puis
  annulé ou rejeté garde sa ligne et reçoit une ligne négative à la date de
  l'annulation ou du rejet ; la période passée garde son montant.
- **Correction à la date réelle** : un paiement saisi en retard (reprise
  d'avant le CRM) ou corrigé (date, montant) compte à sa date réelle, donc
  peut changer une période passée. La fenêtre de correction le dit (« le livre
  de juillet change : si ce mois est déjà déclaré, la déclaration est à
  corriger ») ; les mois figés de /synthese gardent ce qui était figé et
  montrent l'écart. Le journal garde les anciennes valeurs.
- Export CSV pour le comptable (`/api/finances/livre?annee=…`) : points-virgules,
  montants à la française, UTF-8 avec BOM pour Excel.

### Le tableau `/finances`

- Encaissé de l'année (et de l'année précédente), du mois, par mois.
- **URSSAF** : la période en cours et la précédente, selon
  `PERIODICITE_DECLARATION`, avec la date limite de déclaration (dernier jour du
  mois qui suit la période). Chaque recette est multipliée par les taux **en
  vigueur à sa date** (cotisations, CFP, versement libératoire si l'option est
  prise) ; un arrondi par jeu de taux. Présenté comme une estimation : l'URSSAF
  calcule le montant exact.
- **Seuils** : chiffre d'affaires encaissé de l'année face aux seuils de
  franchise de TVA et au plafond micro, avec une projection au rythme actuel
  (à partir de 30 jours de recul). Les règles de dépassement (année précédente,
  seuil majoré) restent à lire avec le comptable ; le tableau n'en tire aucune
  conclusion à sa place.
- **Reste à encaisser** : factures actives non réglées, du CRM comme émises
  ailleurs (dès que leur montant est au registre), avec leur retard depuis
  l'échéance (à réception pour un particulier) ; un paiement s'y enregistre
  d'un geste.
- **Chèques à créditer**, avec crédit et rejet sur place.
- **À corriger pour des chiffres justes** : paiements repris sans mode de
  règlement, paiements de l'ancien écran sans date, factures hors CRM sans
  montant, dossiers « Encaissé » sans paiement, sommes non imputées, chèques non
  crédités depuis plus de 15 jours. Les chiffres ne cachent pas leurs trous.
- Chaque section qui dépend d'un paramètre absent le dit et ouvre sa saisie ;
  les autres s'affichent quand même.

L'ancien écran `/finances` (calculé sur les factures « soldées » de l'ancien
écran) est remplacé : il comptait des factures, pas de l'argent reçu.

### Limites connues

- Pas d'export PDF du livre (le CSV suffit au comptable ; un PDF viendra si
  besoin).
- Les instantanés mensuels figés (ce qui a été déclaré) arrivent avec la vue de
  synthèse : ils permettront de montrer l'écart entre le déclaré et le
  recalculé quand une recette est saisie en retard.

## 12. Dépenses : rattachées au chantier, saisies au téléphone

### Pourquoi et comment

Un micro-entrepreneur prestataire ne déduit pas ses dépenses : elles servent à
**connaître la marge de chaque chantier** (et, plus tard, la synthèse par
dimension). Une dépense porte : date, montant payé, fournisseur, catégorie,
moyen, justificatif (photo du ticket ou PDF), et son **rattachement** : un
chantier, ou « hors chantier » choisi explicitement (frais généraux). Ni l'un ni
l'autre : « à rattacher », compté et signalé.

### Rattacher est plus facile qu'oublier

- L'écran de saisie (`/depenses/nouvelle`, pensé pour le téléphone) liste les
  chantiers où l'on travaille (à la pose, puis planifiés au plus près du jour,
  puis signés) et **pré-choisit le chantier probable** quand il n'y a pas
  d'ambiguïté (un seul à la pose, ou un seul planifié à trois jours près).
- Depuis un dossier, « + Dépense » ouvre la saisie avec son chantier choisi.
- Une catégorie de frais généraux (publicité, logiciels, assurance…) propose
  « hors chantier » tant que le rattachement n'a pas été choisi à la main.
- Le dossier affiche ses dépenses et une marge indicative (facturé, à défaut
  devis signé, moins dépensé).
- La liste de l'année (à rattacher, sans justificatif, fiche d'une dépense pour
  la modifier, la rattacher ou la retirer) est une section de Finances depuis la
  mission 18 (A3, 03/10/2026) : `/finances?section=depenses`, sur la même année
  que le reste de l'écran ; l'ancienne adresse `/depenses` y redirige. La
  saisie `/depenses/nouvelle` reste un écran (raccourci de l'application
  installée) et ramène à la section.

### Rien ne se perd, rien ne se supprime

- **Coupure réseau** (4G du chantier) : la saisie, photo comprise, est gardée
  dans le navigateur (IndexedDB) et part dès que le réseau revient (page ouverte)
  ou à la prochaine ouverture de la page. Chaque saisie porte un identifiant :
  renvoyée deux fois, elle n'est enregistrée qu'une fois.
- **Même ticket deux fois** : l'empreinte (SHA-256) du justificatif signale le
  doublon probable ; « Enregistrer quand même » reste possible.
- Une dépense saisie par erreur se **retire avec son motif** (archivée,
  toujours visible barrée dans son dossier) ; un justificatif remplacé part aux
  archives, sa ligne `Fichier` est archivée.
- Les justificatifs ne sont servis qu'avec une session (route `/api`, sans
  extension de fichier : toujours filtrée par le proxy).

### Limites connues

- La page de saisie doit avoir été ouverte avec du réseau : sans application
  installable (service worker), elle ne se charge pas hors ligne ; seul l'envoi
  est protégé.
- Pas de lecture automatique du ticket (montant, fournisseur) : saisie à la
  main, aidée par les fournisseurs récents.

## 13. Mails vers les clients et relances : proposés, jamais envoyés seuls

### Ce qui a changé

La route `/api/cron/relance` **envoyait seule** une relance aux clients dont le
devis (ancien écran) avait plus de trois jours : contraire à « aucun mail
envoyé sans validation ». Elle a d'abord été réduite à **proposer** les relances
dues, puis retirée au lot 7 (29/09/2026 : Railway n'a pas de cron, elle n'avait
aucun appelant). Il reste le travail périodique `propositions-relances`, toutes
les six heures (`src/lib/relances/service.ts`).

### Un seul chemin pour un mail vers un client

Tout mail qui part chez un client est une proposition `ENVOI_MAIL`
(`src/lib/mail/propositions.ts`) : destinataire, objet, message, documents
joints (PDF du devis ou de la facture). Elle est **sensible** : jamais exécutée
sans décision humaine, jamais validée en lot, jamais exécutée par un agent.

- Rédigée par le système (relance), plus tard par l'agent mail, ou par la
  personne elle-même (« Envoyer par mail » sur un devis ou une facture, qui
  propose et valide dans le même geste) : le circuit est le même.
- Le texte validé (modifiable) est celui qui part ; il est gardé dans la trace.
- L'envoi passe par la file de tâches (nouvel essai en cas de panne). La trace
  `MAIL_ENVOYE` est écrite dès l'envoi et empêche un second envoi si la tâche
  est rejouée.
- Effets : document « Envoyé » ; une relance fait passer « Devis envoyé » à
  « Relance ».
- Envoyeur : la boîte Gmail connectée avec l'accès d'envoi (section 16), sinon
  Resend si `RESEND_API_KEY` et `EMAIL_FROM` sont configurées ; sans envoyeur,
  la tâche échoue en le disant et rien ne part. Réponse attendue sur
  `coverswap.contact@gmail.com` (Reply-To).

### Relances de devis (`src/lib/relances/service.ts`)

- Délai : le paramètre daté `DELAI_RELANCE_DEVIS` ; sans lui, rien n'est
  proposé.
- Dossier à l'étape « Devis envoyé » ou « Relance », devis visible dans l'espace
  (numéroté, GENERE ou ENVOYE, non archivé) ; **deux relances par devis au plus,
  tous canaux confondus** (mission 14, partie 6 : un mail parti et un SMS copié
  se comptent ensemble, `relancesDuDevis` ; la référence du délai est la
  dernière relance, sinon le plus tardif de la date d'émission et du dépôt).
- Le mail n'est proposé qu'avec une adresse connue et sans refus des mails ; le
  SMS à copier est proposé dans tous les cas (section 25). Un client qui a
  refusé ou retiré son accord pour les mails est compté, à relancer par SMS ou
  par téléphone.
- Un mail de relance ne se propose qu'une fois par rang (même rejeté) ; une
  proposition non traitée expire au bout de quatorze jours, devient sans objet
  si le dossier a changé d'étape entre-temps, et est annulée si la relance du
  même rang part par SMS.

### Limites connues

- Les relances ne portent que sur les dossiers du module Dossiers, plus sur
  l'ancien écran des devis.
- Pas de suivi de lecture : les réponses des clients arrivent par l'agent mail (section 16).

## 14. Synthèse, mois figés et alertes

### Deux formats, une seule source

`calculerSynthese(du, au)` (`src/lib/synthese/calcul.ts`) rend une synthèse
**structurée** ; `redigerSynthese` en tire une **version rédigée** en
français. La rédaction est un gabarit déterministe, sans modèle de langue :
mêmes données, même texte, aucun coût, rien d'inventé. Exports : texte et
JSON (`/api/synthese/export`).

- **Commercial** : cohorte (dossiers ouverts dans la période, suivis jusqu'à
  aujourd'hui : devis, signés, encaissés, perdus, taux de signature, par
  source) ; contacts entrants reçus dans la période par source d'arrivée (site,
  simulateur, Meta…), suivis jusqu'au dossier et à la signature (les archivés
  ne comptent pas ; absent des mois figés avant la version 3) ; activité de la
  période (devis émis, signatures, factures, avoirs, pertes) ; délais médians
  entre étapes ; écart moyen entre premier devis et devis signé ; pertes par
  motif, par étape, concurrents et leur écart de prix.
- **Finances** : encaissé (livre des recettes) par mois, par origine des
  clients, par type de client, par département ; dépenses par catégorie ; marge
  brute ; paniers moyens ; reste à encaisser ; marge des dossiers facturés.
- **Clients** : nouveaux par origine et campagne ; recommandations et qui
  recommande ; relations contre publicité payante (nouveaux clients et
  encaissé) ; clients revenus ; anciens clients sans nouvelle depuis un an.
- **Agent** : par auteur (agent mail, relances, doublons…) propositions,
  validées, corrigées avant validation, rejetées, expirées, taux d'acceptation,
  délai de décision ; motifs de rejet.
- **Qualité des données** : écritures hors de l'application, dossiers sans
  client, clients injoignables, sources inconnues, pertes sans concurrent,
  dépenses à rattacher ou sans justificatif, et les points de `/finances`.
- **Guide de lecture** intégré à l'écran : ce que dit chaque indicateur et ce
  qu'il ne dit pas.

### Aucun nom dans la synthèse

La synthèse structurée désigne clients et dossiers par **identifiant** ; les
noms sont résolus à l'affichage (`references.ts`). Le **mode anonymisé**
remplace ces noms par des pseudonymes stables (« Client 3K7Q ») et retire les
noms des alertes ; montants et répartitions restent exacts, les concurrents
(entreprises) restent nommés.

### Mois figés (`InstantaneMensuel`)

Une tâche quotidienne fige chaque mois écoulé depuis le premier mois
d'activité : la synthèse du mois est enregistrée **une fois** (avec son
empreinte SHA-256) et la base refuse toute modification. Parce qu'elle ne
contient aucun nom, un instantané reste compatible avec l'anonymisation d'un
client. À la lecture, l'instantané est comparé à un recalcul du jour : un écart
(encaissé, signatures, factures…) signale une saisie tardive ou une correction,
à regarder avant une déclaration. Un mois dont les encaissements ne se
calculent pas encore (règle de date des chèques manquante) n'est pas figé ; il
le sera au passage suivant.

Correctif trouvé en chemin : le livre des recettes ne tient compte que des
encaissements qui peuvent mettre une ligne dans la période ; un vieux chèque
sans règle de date bloquait sinon toutes les périodes suivantes.

### Alertes (`alertes.ts`)

Calculées à la demande, jamais stockées, les plus graves d'abord : devis sans
réponse (au-delà de deux fois le délai de relance `DELAI_RELANCE_DEVIS` ; les
relances elles-mêmes, mail proposé et SMS à copier : section 25), factures impayées depuis
plus de 30 jours (urgent au-delà de 60), seuil fiscal atteint à 80 % ou dépassé
en projection, baisse des nouveaux dossiers (moins de la moitié de la moyenne
des six mois précédents), acceptation des propositions de l'agent en baisse
d'au moins 20 points, tâches de fond en échec, paramètres manquants. Ces seuils
d'alerte sont des choix de lecture nommés dans le code, pas des règles
fiscales.

### Limites connues

- Le reste à encaisser d'un instantané est celui du jour du gel, pas celui du
  dernier jour du mois.
- Les délais et taux sur de très petits nombres sont affichés avec leur effectif
  (entre parenthèses) : en dessous de cinq, une indication, pas une tendance.

## 15. Connexion Google et miroir Drive

### Connexion Google (`src/lib/google/`)

Une seule connexion au compte Google de l'entreprise sert au miroir Drive et à
l'agent mail. Appels REST directs (aucun SDK Google ajouté), simulables en test.

- **OAuth 2 « application web »** : bouton « Connecter le compte Google » dans
  Paramètres → consentement Google → retour sur `/api/google/retour` (état
  anti-falsification vérifié par cookie). Portées au plus juste : `drive.file`
  (le CRM ne voit que les fichiers qu'il a créés), `gmail.modify` (lire, ranger,
  archiver ; le code n'appelle jamais la corbeille ni la suppression),
  `gmail.send`, et `calendar.events` (l'agenda des rappels, mission 14).
- **Jeton de renouvellement chiffré** (AES-256-GCM) avec `GOOGLE_TOKEN_KEY`,
  clé hors base : une copie de la base (ou du journal) ne donne pas accès au
  compte. Les jetons d'accès restent en mémoire.
- Déconnexion : révocation chez Google ; la ligne reste, datée. Accès révoqué
  côté Google : les tâches s'arrêtent en le disant, la connexion affiche
  « reconnecter ». API non activée dans le projet Google Cloud (403
  `accessNotConfigured` alors que la portée est accordée — vu en production le
  29/09/2026 pour Google Calendar) : les tâches **attendent** (6 h entre deux
  essais, `ApiGoogleNonActivee`) au lieu d'échouer, quelle que soit l'API
  (Calendar, Gmail, Drive) ; Paramètres → Connexions et `sante_systeme` le
  disent, API par API, avec la réponse de Google (mission 14, partie 9).
- **Mode Test : reconnexion tous les 7 jours.** Tant que l'application reste en
  mode Test dans Google Cloud, Google fait expirer le jeton de renouvellement
  7 jours après l'autorisation (portées Drive et Gmail). L'échéance se calcule
  depuis la connexion (`src/lib/google/echeance.ts`) : date et délai dans
  Paramètres ; à 48 h, bandeau orange sous la navigation de tous les écrans de
  pilotage, avec « Reconnecter Google » (appuyé les dernières 24 h) ; expirée,
  ou refusée par Google, bandeau rouge (miroir Drive et agent mail à l'arrêt).
  Le bandeau suit les compteurs de la navigation (`/api/pilotage/compteurs`,
  chaque minute). Reconnecter crée une nouvelle connexion : 7 jours de plus.
  Une fois l'application publiée, `GOOGLE_APPLICATION_PUBLIEE=1` éteint le
  rappel des 7 jours (un refus de Google reste signalé).

**À faire une fois (Lucas)** : dans Google Cloud Console, créer un projet,
activer les API Drive, Gmail **et Google Calendar** (API et services → Google
Calendar API ; sans elle, les rappels attendent), configurer l'écran de consentement (type
« interne » si Google Workspace, sinon « externe » en mode test avec
`coverswap.contact@gmail.com` comme utilisateur test), créer un identifiant
OAuth « application web » avec l'URI de redirection
`https://<adresse du CRM>/api/google/retour`, puis définir sur le serveur
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_TOKEN_KEY` (générée par
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
Perdre `GOOGLE_TOKEN_KEY` oblige seulement à reconnecter le compte.

### Miroir Drive (`src/lib/drive/`)

La base est la source ; Drive en est une **copie lisible**, jamais lue pour
nourrir le CRM.

```
CoverSwap CRM/
  Clients/<client · code>/<AAAA-MM objet>/
    Photos avant/   Photos après/   Devis et factures/   Fiche du dossier.txt
  Clients/Sans fiche client/…
  Comptabilité/<année>/Livre des recettes <année>.csv
  Comptabilité/<année>/Justificatifs de dépenses/<AAAA-MM>/<date fournisseur montant>
  Archives (retirés du CRM)/
```

- **Plan puis passage** : `planMiroir` calcule l'arbre voulu (chaque élément a
  une clé stable : `client:<id>`, `document:<id>`…) ; `synchroniserMiroir`
  crée ce qui manque, renomme ou déplace ce qui a changé, renvoie un fichier dont
  le contenu a changé (fiche, livre des recettes). Idempotent et rejouable : un
  second passage ne fait rien ; un élément en échec est repris au suivant.
- **Rien ne se supprime** : un élément qui sort du plan (photo retirée, client
  fusionné) est déplacé dans « Archives (retirés du CRM) ».
- **Vérification quotidienne** : un élément supprimé, mis à la corbeille ou
  renommé à la main dans Drive est reconstruit ou renommé comme le CRM le dit.
- **Ne bloque jamais l'interface** : passage toutes les 30 minutes en tâche de
  fond, « Synchroniser maintenant » met une tâche en file.
- **Inactif sans connexion Google** (ou avec `MIROIR_DRIVE=0`).
- État technique (`MiroirDrive`) hors journal : réécrit à chaque passage, sans
  donnée métier.

### Photos après chantier

Les photos « après » (portfolio) s'ajoutent depuis le dossier ; elles sont
rangées dans `photos-apres/` sur le volume et dans « Photos après » sur Drive.
Retirer une photo la range aux archives (le libellé « Supprimer définitivement »
de l'écran était faux et devient « Retirer »).

### Limites connues

- Non testé contre les vrais serveurs de Google (identifiants absents du poste
  de développement) : testé contre un Drive simulé en mémoire. Premier passage
  réel à surveiller dans l'écran des tâches.
- Le premier passage envoie tous les fichiers existants : prévoir quelques
  minutes selon le volume de photos.
- La fiche du dossier contient les coordonnées du client : le Drive doit rester
  privé au compte de l'entreprise (ne pas partager le dossier « CoverSwap CRM »).

## 16. Agent mail : trier la boîte, nourrir les dossiers, proposer le reste

### Ce qu'il fait (`src/lib/messages/`)

- **Relevé** toutes les minutes (travail `mail`, `src/lib/mail/taches.ts` ;
  5 minutes à l'origine) des mails reçus et envoyés de
  la boîte connectée : depuis le dernier message connu moins un jour ; au
  premier passage, depuis la semaine qui précède la connexion. Spam, corbeille
  et brouillons sont ignorés. Rejouable sans doublon (identifiant Gmail unique).
- **Stockage** : `Message` (qui, quand, statut du tri, client, dossier ;
  journalisé), `ContenuMessage` (texte brut — le HTML n'est jamais affiché —,
  en-têtes utiles au tri et aux réponses ; écrit une fois, immuable),
  `PieceMessage` (description des pièces jointes).
- **Tri** : l'analyse de l'agent v1 (tâche `ANALYSE_MESSAGE`, `regles.ts`,
  `ia-lecture.ts`, relecture par l'IA) a été retirée au lot 7 (29/09/2026 ; la
  table `AnalyseMessage` reste en base). Le tri relève de l'onglet Mail v2
  (missions 7 et 9) : règles apprises (`src/lib/mail/regles-apprises.ts`), tri
  (`mail/tri.ts`, `messages/tri.ts`), boîte « À traiter » (`mail/vues.ts`), et
  Claude par le serveur MCP pour le reste.

### Ce que l'agent fait seul — et seulement cela

(Tableau de l'agent v1, retiré au lot 7 du 29/09/2026 : gardé pour mémoire des
garde-fous. Le tri de Mail v2 est décrit dans `docs/REPRISE-MISSION.md`,
missions 7 et 9.)

| Geste | Condition (toutes requises) | Confiance |
| --- | --- | --- |
| Archiver un mail publicitaire : retiré de la boîte de réception, libellé « CoverSwap CRM/Bruit archivé » | classé par Gmail en Promotions ou Réseaux sociaux ; en-tête de liste de diffusion (`List-Unsubscribe`, `Precedence: bulk`) ; expéditeur inconnu du CRM ; pas de réponse de notre part dans la conversation ; pas de PDF joint | 0,99 |
| Ranger un mail chez le client | adresse exacte d'une seule fiche client active ; dossier : le seul en cours, ou celui où la conversation est déjà rangée (sinon la fiche seule, et le choix du dossier est proposé) | 0,97 à 0,98 |
| Classer hors clients | mail envoyé à quelqu'un qui n'est pas client, ou de la boîte à elle-même | 0,99 |

Ces gestes passent par `executerSansValidation` (types déclarés automatisables,
jamais sensibles, seuil 0,95) : statut `AUTOMATIQUE`, visibles dans
l'historique de « À valider ». « Ce n'est pas du bruit » défait un archivage et
remet le mail dans la boîte ; ranger ailleurs un mail rangé seul se fait en un
geste.

### Ce qu'il propose, et que la personne décide

- Sans IA : archivage probable (notification, adresse `noreply`), rangement
  suggéré (fiche archivée, autre adresse dans une conversation déjà rangée),
  choix du dossier pour un client qui en a plusieurs en cours.
- Avec l'IA : le classement (fournisseur, administratif, personnel…), une
  **nouvelle demande prête** — fiche client, et dossier ouvert avec les photos
  reçues quand l'adresse du chantier, le téléphone, l'objet et une photo sont
  là ; sinon la fiche seule, et la réponse proposée demande ce qui manque —, une
  note, une prochaine action, un changement d'étape, un brouillon de réponse.
- L'écran **« À trier »** (`/messages`, agent v1) est retiré (lot 7). Ce qui
  attend une décision se lit dans la boîte **« À traiter »** de `/mail`
  (`src/lib/mail/vues.ts`, `listerVue("A_TRAITER")`) : ranger chez un client,
  nouvelle demande, bruit, hors clients, répondre. « Relire avec l'IA »
  (`api/messages/[id]/relire`) n'existe plus.
- **Motifs de rejet sans saisie** : quand la personne trie depuis la file, la
  proposition de l'agent est validée si c'est la même décision (il est
  crédité) ; sinon elle est rejetée avec le motif que la décision rend évident
  (« Mauvais dossier ou mauvais client », « Information inexacte ») et la
  décision prise en commentaire. La mesure de l'agent reste juste sans rien
  demander de plus.

### Garde-fous

- **Aucune suppression dans Gmail** : le client Gmail (`gmail.ts`) n'a ni
  corbeille ni suppression ; les tests vérifient qu'aucun appel `DELETE`,
  `trash` ou `batchDelete` n'est jamais émis.
- **Aucun mail envoyé sans validation** : réponse = `ENVOI_MAIL` (sensible),
  exécutée par la file au nom de la personne qui a validé.
- **Aucune fusion de clients** : une nouvelle demande dont l'adresse ou le
  numéro existe déjà s'arrête (« ranger le mail sur sa fiche ») ; les
  rapprochements restent des propositions `FUSION_CLIENTS`.
- **Étapes d'argent jamais automatiques** ; une étape n'est proposée que si la
  phrase citée par le modèle figure mot pour mot dans le mail.
- **Le mail est une donnée, pas une consigne** : le texte du mail est isolé
  dans des balises que le mail ne peut pas imiter ; la sortie du modèle est un
  outil imposé, validé par zod ; le modèle n'a aucun moyen d'agir ; un
  identifiant de dossier hors de la liste fournie, un téléphone ou un code
  postal absents du mail sont écartés ; une consigne adressée à l'IA trouvée
  dans le mail est signalée (« Alerte ») et ignorée. Le destinataire d'une
  réponse est toujours l'expéditeur réel, jamais une adresse lue dans le texte.
- **Confiance calculée par le code** (certitude déclarée → 0,85 / 0,65 / 0,40,
  plafonnée) : une proposition issue de l'IA ne s'exécute jamais seule.

### L'IA : un seul point d'appel, un budget (`src/lib/ia/modele.ts`)

- **Désactivée par défaut** : il faut la clé `ANTHROPIC_API_KEY` sur le serveur
  et, dans Paramètres → « Agent mail et IA », l'interrupteur « Active », le
  modèle, ses deux prix (euros par million de jetons lus et écrits) et le
  budget mensuel. Aucune valeur par défaut : rien ne se dépense sans décision.
- **Plafond** : un appel dont le coût estimé dépasserait le budget du mois civil
  (heure de Paris) n'est pas fait ; le mail le dit (« Pas lu par l'IA : budget
  du mois atteint »). « En pause » coupe l'IA sans rien défaire.
- **Registre** `AppelIa` : chaque appel, réussi ou non, avec ses jetons, son
  coût aux prix datés en vigueur et sa durée. Pas de cache des consignes : à ce
  volume, les écritures de cache coûteraient plus qu'elles n'économisent.
- **Pourquoi le modèle est un paramètre daté** : modèles et prix changent ; un
  nouveau modèle se saisit avec ses prix à la même date et le coût passé reste
  juste, sans redéploiement.

### Envoi par la boîte Gmail

- Connectée avec l'accès d'envoi, la boîte envoie tout mail validé (devis,
  facture, relance, réponse) : il figure dans ses « Messages envoyés », une
  réponse reste dans sa conversation (`threadId`, `In-Reply-To`,
  `References`), et le message envoyé est connu du CRM (pas relevé en double).
  À défaut, Resend ; sinon rien ne part.
- Le mail MIME est construit sans dépendance (`mime.ts`) : en-têtes encodés,
  noms de pièces jointes accentués, aucune injection d'en-tête possible (testé).

### Pièces jointes, dossiers, fiches

- Photos et PDF (9 Mo au plus) conservés dans le CRM dès que le mail n'est pas
  du bruit (`Fichier`, servis seulement dans une session) ; les autres pièces
  restent dans Gmail. Images intégrées (logos, signatures) ignorées. Une
  nouvelle demande validée copie les photos reçues dans le dossier.
- Mail rangé dans un dossier : événement « Mail reçu » ou « Mail envoyé » daté
  de sa réception, avec ses pièces, lisible depuis l'historique du dossier.
  Rangé ensuite ailleurs : l'ancien événement est archivé
  (`DossierEvenement.archiveLe`), jamais effacé.
- Fiche client : section « Mails ».

### WhatsApp demain

Le modèle est prévu pour plusieurs canaux : `Message.canal` (`EMAIL`,
`WHATSAPP`), `identifiantCanal` et `filCanal`, `MessageRecu` indépendant du
fournisseur, événements `WHATSAPP_RECU` / `WHATSAPP_ENVOYE` déjà définis. Pour
brancher WhatsApp Business (API Cloud de Meta) : une route webhook (signature
`X-Hub-Signature-256` vérifiée avec `META_APP_SECRET`, route publique déclarée
dans `routes-publiques.ts`) qui traduit chaque message en `MessageRecu` (de =
numéro normalisé) puis appelle `enregistrerMessageRecu` et le passe au tri de
Mail v2 (`src/lib/messages/tri.ts` ; la tâche `ANALYSE_MESSAGE` et `regles.ts`
n'existent plus) ; le numéro exact y remplace l'adresse
(`trouverClientParCoordonnees` sait déjà le faire) ; l'archivage dans la boîte
est sans objet ; l'envoi passerait par une proposition `ENVOI_WHATSAPP`
sensible (fenêtre de 24 h et modèles de message imposés par Meta). Non
construit : il faut d'abord un compte WhatsApp Business vérifié par Meta.

### Réglages et interrupteurs

- Paramètres → Connexions : état de l'agent (dernier relevé, mails à traiter) et
  de l'IA (modèle, dépense du mois sur le budget) ; « Relever maintenant ».
- `AGENT_MAIL=0` coupe l'agent (relevé compris) sans toucher à la connexion
  Google ; le miroir Drive garde son propre interrupteur (`MIROIR_DRIVE`).

### Limites connues

- Non testé contre les vrais serveurs de Gmail et d'Anthropic (identifiants
  absents du poste de développement, aucun appel payant fait) : testé contre
  une boîte Gmail et un modèle simulés. Surveiller le premier relevé réel et
  les premières lectures (écran des tâches, analyses affichées sur les mails).
- L'archivage automatique s'appuie sur le classement de Gmail : un expéditeur
  légitime classé en Promotions, avec lien de désinscription, serait archivé.
  Il reste dans « Tous les messages » sous le libellé du CRM, et « Ce n'est pas
  du bruit » le remet dans la boîte.
- Un client qui écrit d'une adresse non enregistrée reste à trier (par
  principe, aucun rapprochement flou) — sauf dans une conversation déjà rangée,
  où le rangement est proposé.
- Relevé par fenêtre de dates : un mail remis avec plus d'un jour de retard sur
  le dernier connu pourrait être manqué. Si cela arrive, passer à l'historique
  Gmail (`history.list`).
- L'historique cité est retiré d'après les formules usuelles (« Le … a écrit : »,
  « De : … Envoyé : ») ; le texte complet reste consultable.
- Une réponse sans dossier dont la tâche s'interromprait entre l'envoi et son
  enregistrement pourrait repartir à la reprise (fenêtre de quelques
  millisecondes) ; un envoi rangé dans un dossier est protégé par sa trace.
- Le coût d'un appel est estimé d'avance (environ 3 caractères par jeton) ; le
  coût enregistré est celui des jetons réellement facturés.

## 17. Données personnelles (RGPD)

### Ce qui existait déjà

- **Consentement** aux mails commerciaux, distinct et daté, immuable, avec sa
  preuve (section 6) ; pas de relance par mail sans accord (section 13).
- **Synthèse et mois figés sans nom** (section 14).

### Durées de conservation (paramètres datés, sans valeur par défaut)

- `RGPD_CONSERVATION_PROSPECTS` : mois après la dernière activité pour un
  contact qui n'a rien signé ; `RGPD_CONSERVATION_CLIENTS` : mois après la
  dernière activité pour un client qui a signé (paiement reçu, ou dossier passé
  par « Signé »).
- Travail quotidien `conservation-rgpd` : dès que la durée est écoulée,
  l'anonymisation est **proposée** (`ANONYMISATION_CLIENT`, sensible : jamais
  exécutée seule, jamais en lot). Un dossier en cours suspend tout. Dernière
  activité : premier contact, fiche, dossiers, leads, mails, paiements ; une
  nouvelle activité repousse l'échéance (la clé d'unicité porte la date).
- Sans durée réglée, rien n'est proposé. Le titre de la proposition ne porte
  pas de nom (référence seulement).

### Anonymiser (fiche client → « Anonymiser (RGPD) », ou proposition validée)

- **Aperçu avant de décider** : ce qui part, ce qui reste, ce qui bloque
  (dossier en cours, fiche fusionnée dans une autre) et ce qui est à faire à la
  main hors du CRM (adresses à chercher dans Gmail, numéros à retirer du
  téléphone : après l'anonymisation, le CRM ne les connaît plus).
- **Carte des données personnelles** (`src/lib/rgpd/carte.ts`) : pour chaque
  modèle rattaché à une personne, les champs remplacés, ou la raison de tout
  garder. Un test parcourt le schéma : un modèle qui porte un lien vers un
  client, un lead, un dossier, un message ou un prospect et qui n'y figure pas
  fait échouer les tests.
- **Gardé** (obligation légale, ou statistique sans identité) : documents émis
  (identité imprimée, PDF), paiements (payeur, montant, référence : livre des
  recettes), registre des numéros, factures de l'ancien écran (et le nom du
  lead qu'elles impriment), preuves de consentement, étapes, montants, dates,
  code postal et ville, provenance, mesure de l'agent.
- **Effacé** : identité et coordonnées (fiche et fiches fusionnées dans
  celle-ci, leads, dossiers), notes, texte libre de l'historique (un
  changement d'étape garde sa structure), mails (texte, en-têtes, objet,
  expéditeur), analyses de l'agent, contenu des propositions, simulations,
  brouillons de prospection, adresse e-mail nominative d'un prospect.
- **Journal** : les copies des lignes concernées sont caviardées avec les mêmes
  remplacements (le journal n'accepte qu'un caviardage par ligne ; horodatage,
  auteur et opération restent). Les copies des pièces comptables ne le sont
  pas : l'identité y est légale.
- **Fichiers** : photos des dossiers (avant, après, et celles déjà retirées aux
  archives du volume), pièces jointes des mails, images de simulation sont
  **effacés physiquement** par la tâche `EFFACEMENT_RGPD` (rejouable). C'est la
  seule exception délibérée à « rien ne se supprime » : décidée par une
  personne, sur une fiche précise, avec sa trace (la proposition validée, son
  motif et son bilan).
- **Drive** : les copies des photos sont neutralisées (contenu remplacé, nommées
  « Photo effacée (RGPD).txt ») puis rangées aux archives du miroir ; rien
  n'est supprimé dans Drive. La fiche du dossier y est réécrite sans identité,
  le dossier du client renommé.
- **Gmail** : le CRM n'y supprime jamais rien ; l'aperçu liste les adresses à
  traiter à la main.
- **Ce qui était en cours** : les propositions en attente sont annulées ; un
  envoi validé mais pas encore parti échoue (son contenu est effacé) : rien ne
  part.
- **Après** : fiche archivée, nommée « Client anonymisé · XXXX » (la référence
  de la synthèse), qui ne se modifie ni ne se restaure plus.
- **Vérifié par un test** qui anonymise un client complet (lead, simulation,
  dossier et photos, note, historique, facture émise, paiement, mail avec pièce
  jointe et analyse, proposition de l'agent) puis balaie toutes les tables,
  journal compris : son nom, son adresse, son téléphone, son e-mail et une
  phrase de ses notes ne subsistent que dans la facture et le paiement.

### Limites connues, et à confirmer par un avocat

- Les durées elles-mêmes (la CNIL recommande 3 ans pour les prospects ; pour les
  clients : garanties, délais de réclamation et de prescription).
- Les devis émis mais jamais signés sont gardés tels quels (identité imprimée) :
  pièce commerciale plutôt que comptable ; à confirmer.
- La preuve d'un consentement saisie à la main est immuable : la rédiger sans
  nom (« mail du 12/09 », pas « mail de Mme X »).
- Les sauvegardes (`sauvegardes/` sur le serveur, tirages sur le poste) gardent
  les données d'avant l'anonymisation jusqu'à leur rotation : à inscrire dans
  la politique de conservation.
- Drive garde les révisions précédentes d'un fichier 30 jours ; Gmail et les
  contacts du téléphone restent à traiter à la main.
- Droit d'accès et portabilité : pas d'export dédié ; la fiche client, ses
  dossiers et ses mails en tiennent lieu.

## 18. Reprise d'activité : signaler, jamais bloquer

L'activité réelle bascule sur le CRM avec des dossiers commencés avant lui, à
des étapes différentes, avec des devis émis à la main. Le module les accueille
tels quels : la discipline vient de ce qui se voit, pas de l'interdiction.

### Règles devenues avertissements (`src/lib/dossiers/regles.ts`)

- **Toute étape vers toute autre**, dans les deux sens, y compris depuis
  « Encaissé » ; seul le passage à l'étape où l'on est déjà est refusé (il ne
  changerait rien). `REGLES_ETAPES.sorties` ne dit plus ce qui est permis mais
  le chemin habituel, mis en avant à l'écran ; les autres étapes sont dans
  « Passer à une autre étape… ».
- **Avertissements** : en avançant, les critères d'entrée de chaque étape
  franchie (sauter du devis au chantier rappelle la signature, l'acompte et la
  date de chantier), le motif pour une perte ; un retour, une pause ou une
  reprise ne rappellent rien. Ils sont calculés par la même fonction pure à
  l'écran (« À savoir avant de passer », puis « Passer quand même ») et au
  serveur, qui les écrit dans l'événement (`avertissements`) et dans son texte
  (« Passé en connaissance de cause : … »). Ce qui est apporté dans la fenêtre
  (acompte, motif, date de chantier, bon pour accord) lève l'avertissement
  correspondant.
- **Franchir « Signé »** en avançant, même d'un saut : le devis choisi (à
  défaut le dernier) devient le devis accepté ; sans devis, rien n'est accepté
  et c'est signalé.
- **Plus de refus métier ailleurs** : un document se génère à toute étape
  (perdu, en pause, encaissé : c'est dit à l'écran), la date de chantier se
  vide, la dernière photo se retire, un paiement s'enregistre sans devis ni
  facture (gardé non imputé, imputé à la facture) et sans moyen de paiement
  (« non renseigné » au livre).

### Rien d'obligatoire sauf le nom (`src/lib/dossiers/dossiers.ts`)

- À la création comme à la modification, seul le nom du client est exigé.
  Adresse, code postal, ville, téléphone et objet vides s'enregistrent vides ;
  une source absente vaut `INCONNUE` (« Non renseignée ») ; les photos sont
  facultatives, y compris pour un dossier ouvert depuis un mail validé.
- Un dossier naît à l'étape choisie (« Étape actuelle ») : l'événement
  d'ouverture porte cette étape.
- Reste refusé ce qui ne peut pas s'enregistrer tel quel : un texte trop long,
  une adresse e-mail illisible, un montant qui n'est pas un nombre, une date
  impossible. Un téléphone incomplet ou un code postal qui n'a pas cinq
  chiffres sont gardés tels quels, avec une remarque sous le champ.
- La fiche client rattachée se change depuis le dossier : ses devis, factures
  et paiements rattachés à l'ancienne fiche la suivent, un événement le dit et
  le journal garde l'ancienne valeur.

### Ce qui manque se voit (`src/lib/dossiers/completude.ts`)

Une seule fonction pure dit ce qui manque, selon l'étape : fiche client,
téléphone, adresse complète, objet, photos, source ; à partir de « Devis
envoyé » un devis, de « Signé » un acompte ou son motif, de « Planifié » une
date de chantier, de « Facturé » une facture ; « Encaissé » avec un reste dû ;
des dates d'étape inconnues. Un dossier perdu ne réclame que son motif ; un
dossier en pause est jugé à l'étape quittée. Le « reste dû » compare les
factures actives aux paiements valides du dossier (sans le détail des
imputations) : le même calcul partout.

- Panneau du dossier : bloc « À compléter » en tête.
- Cartes du kanban et liste : « n à compléter ».
- /synthese, qualité des données : le nombre de dossiers concernés par point,
  à ce jour, archivés exclus (remplace « Dossiers sans client rattaché »).

### Dates réelles (`ouvertLe`, `survenuLe`)

Un dossier signé en juillet porte juillet, pas le jour de sa saisie.

- **Colonnes** : `Dossier.ouvertLe` (ouverture réelle) et
  `DossierEvenement.survenuLe` (date réelle d'un événement) ; nulles, la date
  de saisie (`createdAt`) vaut date réelle. La saisie reste donc toujours
  lisible (« saisi le … ») et chaque correction est au journal. Migration
  `20260918090000_dates_reelles` : deux `ADD COLUMN` nullables.
- **Au passage** : la fenêtre de changement d'étape a une « Date du passage »
  (aujourd'hui par défaut, jamais à venir) ; une perte datée dans le passé
  prend cette date pour `perteLe`.
- **Après coup** : chaque passage d'étape se redate depuis « Délais et prix »
  (`PATCH /api/dossiers/[id]/evenements/[evenementId]`). Redater l'ouverture
  redate le dossier (`ouvertLe`) ; redater la dernière perte d'un dossier perdu
  redate `perteLe` ; une date « inconnue » (reprise) devient connue. Une date
  hors de l'ordre du parcours est signalée, puis le parcours se remet dans
  l'ordre des dates (à date égale, l'ordre de saisie).
- **Fiche client** : son premier contact recule à l'ouverture réelle d'un de
  ses dossiers quand elle est plus ancienne (reprise, ouverture redatée, dossier
  rattaché à une autre fiche ; `reculerPremierContact`), jamais l'inverse. Un
  client repris en septembre pour un dossier ouvert en juin compte parmi les
  nouveaux clients de juin.
- **Lecteurs** : parcours et délais du dossier (`delais.ts`), historique (à la
  date réelle), ancienneté de la liste, synthèse (cohorte au mois de
  l'ouverture réelle, signatures et pertes au mois de leur date réelle,
  délais), alerte « moins de nouveaux dossiers ». Une date inconnue compte
  pour l'étape atteinte, jamais pour une période ni un délai.
- **Paiements** : voir section 10, « Rien ne se supprime, tout se trace ».

### Documents déjà émis (`src/lib/dossiers/documents-existants.ts`)

Un devis ou une facture fait à la main avant le CRM se rattache au dossier sans
rien générer (« Enregistrer un document existant ») : numéro, date d'émission
réelle, montant, statut du devis (envoyé, accepté, refusé), acompte prévu,
objet, PDF.

- **Registre** : le numéro doit y être (les numéros libres, émis hors du CRM et
  pas encore rattachés, sont proposés à la saisie : ceux que le registre donne
  pour ce type, quelle que soit leur série, puisque devis et factures
  partageaient la série sans préfixe avant le CRM ; un numéro de type inconnu à
  une facture, et à un devis s'il est sans préfixe — `numeros-libres.ts`). Le
  compteur ne bouge pas :
  la ligne du registre reçoit seulement `documentId`, le montant, et la date et
  le destinataire s'ils manquaient. Un numéro déjà rattaché est refusé (il ne
  sert qu'une fois). Un numéro absent du registre est refusé avec
  `absentDuRegistre`, et ne s'y inscrit que sur demande explicite (« L'inscrire
  au registre et le rattacher », mêmes règles de série que `declarerNumero` —
  l'écran `/numeros` qui les portait est retiré) : une faute de frappe inscrite y
  resterait pour toujours.
  Nature, date ou montant qui diffèrent du registre sont signalés ; la date
  d'émission du registre, renseignée une fois, n'y change pas.
- **Document** `origine = REPRISE` (migration `20260918100000_documents_repris`,
  colonne à défaut `CRM`) : pas de lignes, pas de mentions ; événement
  « Document repris » à la date d'émission ; pastille « Repris », et une
  facture reprise se lit « Émise » (et non « Généré »). Une facture reprise reçoit les
  paiements déjà enregistrés sur le dossier, comme une facture générée.
- **Correction** : date, montant (le reste dû suit ; un trop-perçu est
  signalé), objet, statut, acompte ; jamais le numéro. Le PDF s'importe ou se
  remplace (vérifié : `%PDF-`, 9 Mo au plus), l'ancien part aux archives.
- **Sans PDF** : rien ne se reconstitue à sa place (un faux PDF aux couleurs du
  CRM serait pire que pas de PDF) ; le document ne s'ouvre ni ne s'envoie par
  mail, et n'est pas copié dans le miroir Drive.
- **Avoir** d'une facture reprise : une ligne « Annulation de la facture … » de
  son montant, dans la série F comme tout avoir.
- Les avertissements d'étape disent « aucun devis généré ni enregistré ».

### Mode reprise (`src/lib/dossiers/reprise.ts`)

« Ouvrir un dossier » a un troisième onglet, « Reprise d'un dossier en cours » :
un seul écran pour saisir un dossier historique en deux minutes.

- **Contenu** : client (fiche existante à rattacher ou créée depuis le nom),
  coordonnées et chantier facultatifs, étape actuelle (étapes actives), dates
  clés (ouverture, devis envoyé, signé, chantier commencé, facturé, selon
  l'étape ; arrivée à l'étape actuelle ; date du chantier), devis et factures
  déjà émis (avec PDF), paiements déjà reçus.
- **Une transaction** (`POST /api/dossiers/reprise`) : le dossier et son
  ouverture datée, les documents (règles de la section précédente), les
  paiements (imputés sur ces pièces), puis le parcours : un passage par jalon
  daté et l'arrivée à l'étape actuelle, à leurs dates réelles, la signature
  portant le devis accepté. Un document refusé (numéro déjà rattaché…) annule
  tout. Les PDF suivent un à un sur la route du document (limite de 10 Mo par
  requête), puis le panneau du dossier s'ouvre.
- **Dates** : un jalon sans date ne crée pas de passage (rien n'est inventé) ;
  l'arrivée à l'étape actuelle sans date est gardée « date inconnue »,
  signalée sur le dossier. L'écran déduit une date vide quand il peut (premier
  devis, première facture, date du chantier, dernier paiement pour
  « Encaissé », plus ancienne date saisie pour l'ouverture) et le dit sous le
  champ. Des dates qui ne se suivent pas sont signalées, pas refusées.
- Le lead ou le prospect d'origine suit comme à une ouverture (statut du lead
  selon l'étape) ; rien ne part chez Meta pour un dossier repris.

## 19. Prospects : tout ce qui précède un dossier

L'ancien CRM (leads) et le module de prospection (établissements Google Places)
étaient devenus une section du pilotage, `/prospects`, à deux onglets. Depuis le
21/09/2026 c'est la section **Leads** (`/leads`, section 21) qui alimente les
dossiers ; `/prospects` et l'onglet Démarchage ont été retirés au lot 7
(29/09/2026). Ce qui suit décrit ce qui reste et ce qui a disparu.

### Entrants (modèle `Lead`, `src/lib/prospects/entrants.ts`)

Ce qui arrive de soi-même : formulaires du site et simulateur (`/api/webhook`),
publicités Meta (`/api/webhook/meta`), Zapier, et la saisie à la main
(« Nouveau contact »).

- **Listes** : les groupes d'origine (`groupeDuLead`, `listerEntrants`) n'ont
  plus d'écran ; l'écran Leads lit `src/lib/prospects/leads.ts` — *À appeler*
  (jamais appelé), *À rappeler* (déjà appelé, ou rappel daté), *Sans suite*,
  *Archivés* (mission 14, partie 3 ; section 25). Le compteur de la navigation
  est le nombre de rappels en retard.
- **Fiche** : coordonnées et gestes (« Noter l'appel » : la feuille de fin
  d'appel ; « SMS avec le lien » : l'écran SMS ; e-mail ; fiche client), statut,
  section « Rappel » (date, « Retirer la date », dernier appel et tentatives sans
  réponse), échanges (`Interaction` ; un appel noté autrement que « pas de
  réponse » ou un échange fait passer « Contacté »), simulations avant/après et
  leur PDF, demande et notes, dossiers, anciens devis et factures de l'ancien
  CRM avec leur document, archivage motivé et restauration.
- **Sans suite** demande un motif, noté dans les échanges. **Correction** : seuls
  les champs changés partent ; un numéro ou une adresse corrigés rejoignent
  aussi la fiche client (les anciens y restent, archivables depuis la fiche).
- **Dès qu'un dossier existe**, le statut suit le dossier
  (`src/lib/dossiers/transitions.ts`) et le suivi se note sur le dossier :
  l'API refuse (409) un statut ou un échange posé sur le contact.
- **Saisie à la main** : un prénom ou un nom suffit ; un numéro ou une adresse
  illisibles sont refusés ; le contact rejoint aussitôt la fiche client qui a
  ces coordonnées, ou en crée une (`rattacherLead`, règle d'identité de la
  section 6).

### Démarchage (modèle `Prospect`) : retiré

Le démarchage B2B (`lib/prospects/demarchage.ts`, `lib/prospection/*` : agents
hôtels et restaurants, scoring local, sourcing Google Places, fiche prospect,
« Ouvrir un dossier » depuis un prospect, `/dossiers?prospect=<id>`) a été
retiré au lot 7 (29/09/2026), avec ses routes, ses scripts npm et ses tests.
Les tables `Prospect`, `ProspectActivity` et `AgentProfile` restent en base ;
la migration de données `agents-prospection` (déjà livrée, jamais retirée)
porte les deux profils en dur et rejoue à l'identique.

### Prospects de la base locale : retiré

Le script `scripts/exporter-prospects.mjs` et l'import de l'onglet Démarchage
sont partis avec lui (lot 7).

### L'ancien CRM : repris, réécrit, abandonné

- **Réécrit dans Prospects, puis Leads** : liste et fiche des leads, saisie
  d'un lead, simulations et leur PDF, échanges, anciens devis et factures (lus
  sur la fiche du contact ; l'écran du registre des numéros est retiré) ; le
  tableau et la fiche de prospection ont été retirés au lot 7 (les indicateurs
  et la file de validation factices de l'ancien écran n'ont jamais été repris :
  la validation est `/validation`).
- **Abandonné** : tableau de bord (remplacé par Dossiers et Synthèse ; les
  statistiques par source de l'ancien écran sont réécrites dans la Synthèse,
  section 14), assistant conversationnel sans accès aux
  données, kanban des leads (les groupes le remplacent), écrans chantiers et
  commandes de matière (les dossiers et leur prochaine action les remplacent ;
  les données restent en base, lisibles sur la fiche du contact), route
  d'envoi de mail sans appelant (`/api/email` : aucun mail ne part sans
  validation), API des anciens écrans.
- **Gardé tel quel** : webhooks, simulateur, PDF des anciens devis et factures,
  PDF des simulations, fichiers protégés (`/api/uploads`).
- **Anciennes adresses** (`next.config.ts`, redirections temporaires) :
  `/leads/<id>` → `/leads?lead=<id>` (liens des anciens mails de
  notification), `/leads/kanban`, `/leads/nouveau` → Leads, `/dashboard` →
  Dossiers, `/analytics` → Synthèse, `/devis/nouveau` (avec `?leadId=` :
  `/dossiers?lead=`) et `/devis/*` → Dossiers, `/factures` → Finances,
  `/chantiers/*`, `/commandes`, `/assistant` → Dossiers. `/prospection` n'a plus
  de redirection. Les notifications pointent sur `/leads?lead=<id>`.
- **Aucune donnée retirée** : leads, prospects, devis, factures, chantiers et
  commandes restent en base et au journal.

## 20. Tunnel commercial : priorité, SMS, espace client, relances, application mobile

Du lead Meta au chantier signé. Un principe traverse tout : **le CRM prépare, la
personne envoie**. Une seule chose part toute seule — l'accusé de réception dans
la minute qui suit un lead. Tout le reste est proposé, relu, corrigé, envoyé d'un
clic ; ce qui est corrigé est gardé à côté de ce qui avait été proposé.

### Priorité d'un lead (`src/lib/prospects/priorite.ts`, `qualification.ts`)

`qualifier()` est pure : à partir des réponses du formulaire (occupation, délai,
taille de cuisine) et du code postal, elle rend `PRIORITAIRE`, `STANDARD`,
`SECONDAIRE` ou `A_ECARTER`, avec son motif en clair. La zone d'intervention
est un paramètre daté (`ZONE_DEPARTEMENTS`, `ZONE_DEPARTEMENTS_PROCHES`), jamais
une constante : zone vide → « inconnue », pas « hors zone ». Une priorité posée
à la main (`prioriteManuelle`) n'est plus jamais recalculée. La classe sort dans
le titre et l'urgence de la notification ; un lead à écarter n'arme pas la
relance à trente minutes, reste dans « À appeler » (pastille en anneau gris)
mais hors de la file « Enchaîner les appels ».

### SMS (`src/lib/sms/`)

- **Fournisseurs** (`fournisseurs/`) : une interface, trois réalisations. `ovh`
  (numéro 09 « Time2Chat » : envoi et réponses, celles-ci par relève toutes les
  trente secondes — OVH n'a pas de webhook), `brevo` (envoi seul : en France un SMS
  Brevo ne reçoit pas de réponse), `simulateur` (essais, rien ne part). Choix :
  `SMS_FOURNISSEUR`, sinon OVH si ses cinq variables sont là, sinon Brevo, sinon
  aucun — Paramètres → SMS le dit. Le fournisseur ne sert plus qu'aux envois
  automatiques (accusés de réception) et à deux textes envoyés depuis un écran
  (nouveau lien, simulation en ligne) : tout le reste est **copié** par Lucas
  depuis son téléphone (mission 14, section 25).
- **Modèle** : `ConversationSms` (une par numéro, rattachée à un contact, un client,
  ou à personne) et `Sms`. Pas de surcharge de `Message` (tri
  des mails, contenu immuable). Chaque SMS parti par le fournisseur écrit un
  événement `SMS_ENVOYE` / `SMS_RECU` sur le dossier quand il y en a un ; un SMS
  copié écrit `SMS_COPIE` (ou un échange SMS sur un lead sans dossier) : appels,
  notes et SMS se lisent dans le même fil.
- **Envoi** (`envoi.ts`) : l'écriture en base et l'envoi sont séparés. `envoyerSms`
  écrit la ligne (`A_ENVOYER`) et met une tâche `SMS_ENVOI` en file ; la tâche parle
  au fournisseur, avec reprises. `cleEnvoi` (unique) rend l'envoi idempotent : le
  téléphone peut renvoyer dix fois la même demande, un seul SMS part. Un SMS dont le
  fournisseur a accusé réception n'est jamais renvoyé, même si l'écriture de son
  identifiant échoue.
- **Consentement** : le premier SMS vers un numéro porte la mention STOP
  (`avecMentionStop`) et dit que c'est un nouveau numéro. Un STOP reçu
  (`estDemandeArret` : STOP, ARRET, DESABONNER…) pose `stopLe` sur la conversation :
  tout envoi vers ce numéro est ensuite refusé par le serveur, quel que soit l'écran.
- **Coût** : `mesurerSms` compte en GSM-7 (160/153) ou en Unicode (70/67) et nomme
  les caractères fautifs ; `simplifierPourGsm` les remplace. Seuls les textes qui
  peuvent partir par le fournisseur (drapeau `fournisseur` du catalogue : accusés,
  nouveau lien, simulation en ligne) sont tenus en GSM-7 ; les SMS
  copiés par Lucas partent de son téléphone (« À » permis).
- **Catalogue unique** (mission 14, `catalogue.ts`) : chaque code a son libellé, son
  groupe (Automatiques, Après un appel, Espace client, Relances), sa phrase d'usage,
  ses variables permises, son lien (toujours en dernier) et son texte de départ. Les
  textes modifiés
  vivent dans `ModeleSms` (une ligne par code, Paramètres → SMS, `verifierTexteSms`
  au serveur comme à l'écran) et se lisent par `texteDuCatalogue` (`modeles.ts`) ;
  l'interrupteur `actif` ne vaut que pour les deux accusés (`lireModele`). Le SMS
  proposé (`proposition.ts`) suit l'action et la source du
  lead ; copier vaut envoi (`copie.ts`, événement `SMS_COPIE`, ou échange SMS d'un
  lead sans dossier) : un texte qui porte le lien (`porteLienEspace`) passe la main
  au client et fait tomber « Lien pas encore envoyé ». Les six codes de l'ancien
  circuit de relances par le fournisseur sont archivés (partie 6).
- **Accusé de réception** (`accuse.ts`) : seul envoi automatique. Texte de jour entre
  8 h 30 et 19 h 30 hors dimanche, variante « dès demain matin » sinon. Clé
  `accuse:<leadId>` : un lead, un accusé. Coupé si le modèle est désactivé, si le
  numéro n'est pas un mobile français, si le lead est à écarter.
- **Temps réel et messagerie : retirés** (lot 7, 29/09/2026). La route `/api/sms/flux`
  (SSE), l'écran de conversation `/sms`, l'application « Messages CoverSwap »
  (`/messagerie`) et `src/components/sms/` n'existent plus : pas de numéro
  professionnel en service, les SMS se copient. Piège : `src/lib/sms/flux.ts`
  (l'`EventEmitter`) reste, et `envoi.ts`, `reception.ts`, `propositions.ts` et
  `taches.ts` y émettent encore, sans plus aucun lecteur. Un SMS reçu par le
  fournisseur s'écrit sur le dossier (`SMS_RECU`) et sonne (alerte vers la fiche du
  contact).

### Espace client (`src/lib/espace/`, site : `/e/<jeton>`)

Un lien signé, sans compte : `https://coverswap.fr/e/<code8>-<signature16>`. La
signature est un HMAC du code et de sa version ; le jeton n'est jamais stocké. Il
n'expire plus (mission 5 : un client = un espace permanent ; après 90 jours sans
visite, l'espace demande les quatre derniers chiffres du téléphone), se révoque
(`revoqueLe`) et se renouvelle (`version + 1` : l'ancien lien meurt). La page du site ne contient rien : le navigateur du client parle à l'API
publique du CRM, `/api/espace/<jeton>/…` (CORS limité à coverswap.fr, 400 requêtes par
dix minutes et par adresse, vingt jetons invalides et l'adresse est refusée). Chaque
lecture passe par l'espace du jeton : un client ne peut pas nommer le dossier d'un autre.

Le client y dépose ses photos (réduites avant l'envoi, rangées dans le dossier et dans
Drive), dit ce qu'il veut, compare et choisit ses simulations, complète ses
coordonnées, lit son devis et clique « Bon pour accord ». L'accord écrit un
`AccordDevis` (nom saisi, mention, montant figé du devis, date, adresse IP, navigateur), fait passer le dossier
à `SIGNE` — l'accord vaut signature, le paiement vient après — et affiche le RIB pour
l'acompte. Acteur de toutes ces écritures : `EXTERNE:espace-client`. Chaque geste écrit
un événement `ESPACE_*` sur le dossier ; les gestes qui comptent (photos, choix, accord)
sonnent sur le téléphone, les photos regroupées par une tâche différée.

### Relances proposées : l'ancien circuit `relances-sms` est retiré

Le travail périodique horaire de `src/lib/commercial/relances.ts` (photos attendues
depuis deux jours, simulation sans réaction depuis trois, devis sans réponse depuis
quatre, silence depuis dix → propositions `ENVOI_SMS` envoyées par le fournisseur
après validation, plafond de cinq SMS en dix jours, puis « perdu — sans réponse »
proposé) a été supprimé par la mission 14 (partie 6, 29/09/2026) : un seul circuit
de relances, des SMS à copier et le mail existant (section 25). `sms/propositions.ts`
garde seulement l'exécution des propositions `ENVOI_SMS` encore en base (validables
jusqu'à leur expiration, comptées dans l'en-tête de Dossiers) ; la ligne
`Planification` « relances-sms » reste en base sans effet (l'exécuteur ne lit que les
travaux enregistrés dans `taches/traitements.ts`).

### Pilotage commercial (`src/lib/commercial/pilotage.ts`) : l'écran est retiré

L'écran `/commercial` (une seule liste des affaires vivantes rangée par à qui est
la main, fin d'appel en deux gestes) a été retiré au lot 7 (29/09/2026), avec
`api/commercial/pilotage` et `api/commercial/notes`. Le calcul reste :
`pilotageCommercial()` sert les outils MCP `ce_qui_m_attend` et `point_du_jour`
(la main se lit dans les faits, `src/lib/dossiers/main.ts` ; les contacts suivent
les deux listes de Leads). La fin d'appel vit dans Leads : feuille
`FeuilleFinAppel`, `POST /api/commercial/appels`, `noterAppel` (section 25).

### Application mobile (`public/sw.js`, `public/manifest-crm.webmanifest`)

Une seule application installable, « CoverSwap » (le CRM, ouvre `/leads` ;
raccourcis « À valider » et « Nouvelle dépense »). L'application « Messages
CoverSwap » (`/messagerie`) et ses icônes ont été retirées au lot 7. iOS lit le
manifeste et l'icône de la page d'où l'on fait « Sur l'écran d'accueil » : le
gabarit `(pilotage)/layout.tsx` les porte (`src/lib/application/installation.ts`,
`ApplicationInstallable = "crm"`). Icônes et écrans de démarrage :
`node scripts/generer-icones.mjs`.

Le service worker (`VERSION = "v10"`) fait trois choses. **Notifications** : affiche
le push, pose le badge (somme des SMS non lus), ouvre au tap l'écran concerné ; une
alerte qui porte un numéro a deux boutons, « Appeler » (`tel:`) et le lien de l'alerte
(« Ouvrir la fiche »…) — sur iPhone, iOS n'affiche pas ces boutons, le toucher ouvre
la fiche (mission 14, partie 7). **Réseau médiocre** : fichiers de
l'application en cache ; un écran déjà connu n'attend le réseau que 2,5 s. **Coupure**
(ou serveur qui redémarre, 502 à 504) : dernière version connue de l'écran et des
lectures utiles (liste des leads, compteurs), sinon `hors-ligne.html` ;
l'écran est prévenu (`serviDepuisLeCache.ts`) et affiche un bandeau. Jamais en cache :
connexion, webhooks, espace client, push, et toute réponse redirigée. Changer
`VERSION` dans `sw.js` vide les caches au passage suivant.

Le push web (`src/lib/alertes/pushweb.ts`) est un canal d'alerte comme les autres :
`alerter()` envoie à tous les canaux configurés, toujours ensemble. Clés VAPID en
variables, sinon générées et gardées dans `CleInterne`. Un abonnement révoqué par le
navigateur (404, 410) est archivé ; il renaît à l'ouverture suivante de l'application.

### Limites connues

- Aucun fournisseur de SMS réel n'a été essayé : OVH et Brevo sont testés contre de
  faux serveurs qui imitent leurs API (`fournisseurs.test.ts`). Premier envoi réel à
  surveiller dans Tâches de fond.
- OVH ne pousse pas les réponses : elles arrivent à la relève (trente secondes).
- `src/lib/sms/flux.ts` émet encore des événements sans aucun lecteur depuis le
  retrait de `/api/sms/flux` (lot 7) : à retirer avec le prochain ménage.
- Le service worker garde sur le téléphone des écrans lus avec une session. La page de
  connexion les efface (arriver là, c'est ne plus avoir de session) ; tant que la session
  vit, un téléphone perdu les montre encore — hors ligne compris.
- Paiement par carte de l'acompte : non fait (`paiementCarte` est prêt côté API,
  `STRIPE_SECRET_KEY` réservée). Aujourd'hui : virement, RIB affiché après l'accord.

## 21. Navigation resserrée, section Leads, simulation → dossier, audit des connexions

Simplification du 21/09/2026. Règle : **retirer un écran du menu ne retire ni donnée ni
traitement**. Le journal enregistre, le registre des numéros protège la numérotation, la
synthèse fige ses mois, la boîte mail se trie : les onglets ont disparu, et leurs adresses
ont répondu jusqu'au lot 7 de la mission 13 (29/09/2026), qui a retiré pour de bon les
écrans sans usage — `/commercial`, `/prospects`, `/messages`, `/numeros`, `/journal`,
`/sms`, `/messagerie` (404 aujourd'hui, sans redirection ; les données restent en base).
Seuls `/validation` et `/synthese` répondent encore par leur adresse.

### Navigation (`src/components/pilotage/Navigation.tsx`)

Sept entrées, dans l'ordre du travail : **Leads** (compteur rouge : rappels en retard),
**Dossiers, Espaces clients, Simulateur, Mail** (compteur : mails à traiter), **Clients,
Finances** ; sur téléphone, Leads, Dossiers, Espaces, Mail et Clients au pouce, le reste
sous « Plus ». Les petites icônes de droite restent (Site, Publicité, Tâches de fond,
Dépenses, Paramètres). L'onglet SMS du 21/09 a été retiré dès la mission 7 (pas de numéro
professionnel) ; le mail a pris le relais. Accueil, connexion et application installée
ouvrent `/leads`.

« À valider » n'étant plus au menu, ce que le CRM propose remonte là où on travaille :
les décisions en attente (dossier à classer « perdu — sans réponse », mail préparé, SMS
de l'ancien circuit encore en base) apparaissent dans l'en-tête de Dossiers
(`PropositionsEnAttente.tsx`), seulement quand il y en a, et mènent à `/validation`
(aussi raccourci de l'application installée). La relecture des SMS proposés dans la
conversation (`RelancesProposees.tsx`) est partie avec l'écran SMS (lot 7).

### Leads (`src/lib/prospects/leads.ts`, `/leads`)

Tout ce qui est entré — Meta, Google Ads à venir, formulaires du site, simulateur,
saisie à la main — et n'a **pas de dossier vivant**. Un dossier s'ouvre : le lead sort des
listes (il vit dans Dossiers, aucun doublon, aucun devis envoyé ici). Depuis la mission 14
(partie 3), deux listes et non plus une : **À appeler** (jamais appelés, le plus récent en
haut ; la priorité se lit sur la pastille et ne change pas l'ordre) et **À rappeler**
(rappels datés dans l'ordre chronologique, retards en rouge en tête, puis les rappels sans
date, plus ancien appel d'abord), plus « Sans suite » et « Archivés ». Chaque ligne : nom,
téléphone cliquable, ville, source et campagne ; dans « À appeler », heure d'arrivée,
réponses au formulaire et « attend un appel depuis… » (vert jusqu'à cinq minutes, ambre
jusqu'à une heure, rouge ensuite) ; dans « À rappeler », la puce de rappel (déplaçable
sans ouvrir la fiche) et le nombre de tentatives sans réponse. Sous les puces : « N rappels
aujourd'hui · N en retard · N relances proposables ». Le détail : section 25.

**Appels à la suite** (« Enchaîner les appels ») : la file = les leads de la liste
affichée (jamais appelés sans les « à écarter », ou rappels en retard), dans l'ordre de la
liste. Un appel, puis la feuille de fin d'appel (Pas de réponse, À rappeler, Intéressé, Pas
intéressé), puis l'écran SMS s'il y a un texte à copier, puis le lead suivant. « Intéressé »
ouvre le dossier d'abord — l'appel s'écrit dans SON histoire — et son espace, et propose
le SMS avec le lien ; « pas de réponse » pose le rappel du lendemain 18 h (modifiable) et
propose le SMS. Le lead affiché reste en tête jusqu'à son issue ou « Passer », même si un
rafraîchissement l'a retiré de la liste.

**Ouvrir un dossier en un bouton** (`src/lib/dossiers/depuis-lead.ts`,
`POST /api/leads/[id]/dossier`) : coordonnées, projet, source, montant simulé, rappel
prévu ; une première note reprend la campagne, la publicité, les réponses, le message, le
classement et les échanges d'avant ; les photos jointes et les simulations rejoignent les
photos du dossier. L'espace client passe par la même porte (`dossierDuContact`).

### Simulation du site → dossier

(Du 22/09 au 03/10/2026, section 24 : une simulation du site restait sur le lead, sans
dossier d'office. Mission 18, A2 : le dossier s'ouvre de nouveau tout seul, pour une
simulation, des photos ou une demande de devis venues du site (`ouvrirDossierAutomatique`,
faits postérieurs au 03/10/2026 seulement, hors zone exclu ; voir `docs/REPRISE-LOCAL.md`).)

Coordonnées + photo = dossier. Une simulation rattachée à un contact (webhook du site,
`/api/simulate`) ouvre son dossier toute seule (`ouvrirDossierAutomatique`), photo avant
et chaque rendu dans les photos de chantier — donc dans Drive, le miroir les recopie.
Plusieurs simulations : le même dossier, la photo avant une seule fois. Un dossier vivant
existe déjà pour ce client (ni perdu ni encaissé) : on range dedans. Génération échouée
mais photo transmise : le dossier s'ouvre aussi. Idempotent : `Simulation.dossierId` /
`PhotoLead.dossierId` disent où c'est rangé. Rattrapage : migration
`simulations-du-site-vers-dossiers` (l'existant, contacts archivés exclus) et travail
périodique `simulations-dossiers` (quinze minutes). Le lead du simulateur n'en disparaît pas pour
autant de Leads (voir ci-dessous). Les demandes du site déclenchent désormais un **push** (`notifierDemandeDuSite`),
comme les leads Meta — avant, seulement un mail.

### Audit des connexions (`src/lib/audit/connexions.ts`, Tâches de fond)

Neuf maillons vérifiés sur les vraies données, en lecture seule (rien n'est créé ni
envoyé) : lead Meta → pastille et push ; Leads sans doublon ; dossier issu d'un lead ;
simulation → dossier et photos ; documents et photos → Drive ; espace client → photos,
Signé, notification ; encaissement → livre des recettes ; canaux de notification ;
fournisseur de SMS. « Rien à vérifier » = le cas ne s'est pas encore présenté en
production (il reste couvert par les essais). L'audit s'écrit aussi dans les journaux du
serveur 45 s après chaque démarrage (`[audit] …`), et se relit par `GET /api/audit/connexions`.

### Lead du simulateur : dans Leads jusqu'au premier appel (21/09/2026)

Le lead le plus chaud — il a vu sa cuisine rénovée — ne doit pas être appelé en dernier.
Depuis le 22/09/2026 sa simulation reste sur sa fiche (section 24 : plus de dossier
d'office) ; s'il a déjà un dossier (ouvert par Lucas, ou rangé dans le dossier vivant de
son client), il reste dans **« À appeler »** — et en tête de la file d'appels — tant
qu'aucun appel ni aucune note d'appel n'est retenu et qu'aucun rappel n'est daté
(`siteNonAppele`, `src/lib/prospects/leads.ts` ; mission 14, partie 3 ; mission 18 : demandes de devis comprises). Même contact,
même dossier : deux vues, aucun doublon. Conditions : 60 jours depuis son arrivée ou sa
dernière simulation, dossier encore en Qualification ou Simulation. Le premier appel noté
(ou le premier rappel daté) l'y fait sortir vers son dossier, où vit son rappel ; il n'est
jamais dans « À rappeler ».

- Classe : **Prioritaire par défaut, sauf hors zone** (`qualifier`, entrée `simulation`) ;
  reclassé quand une simulation est rangée, et une fois pour l'existant (migration
  `priorite-des-leads-du-simulateur`). Une priorité posée à la main n'est pas touchée.
- Écran : pastille « Simulation » à côté de la priorité ; « Voir le dossier » à la place
  d'« Ouvrir un dossier » ; en mode appels, ses rendus (avant / après, finition, prix)
  s'ouvrent en grand pour en parler pendant l'appel, et l'appel s'écrit dans son dossier.

### Actions rapides sur les leads (21/09/2026)

Sur chaque ligne de Leads, sans ouvrir la fiche (`src/lib/prospects/menage.ts`,
`POST /api/leads/actions`) :

- **Archiver**, motif en un geste (Test, Doublon, Hors cible, Autre) : le lead sort de Leads
  et de la file ; il se retrouve dans le filtre **Archivés**, d'où on le restaure.
- **Traité** : retiré par la mission 14 (parties 2 et 3). Un lead qui ne décrochait pas
  sortait de la liste par « Traiter » et se perdait ; désormais un lead ne sort des listes
  que vers un dossier, en « sans suite » avec motif, ou archivé — un appel sans réponse le
  met dans « À rappeler » avec son rappel. `Lead.traiteLe` reste en base, plus lu ni écrit ;
  `ACTIONS_LEADS` = ARCHIVER | RESTAURER (TRAITER et REPRENDRE refusés, 400) ; la
  migration `leads-a-rappeler-14-2` a ramené les leads traités ou archivés depuis le
  01/09/2026 dont le dernier appel était sans réponse.
- **Sélection multiple** : cases à cocher, barre en bas de l'écran — archiver (motif), ou
  restaurer depuis Archivés.
- Chaque action affiche « Annuler » sept secondes : l'action inverse, sur les leads
  réellement changés. Rien ne se supprime ; le journal garde chaque changement.

Le ménage des leads de test du 21/09/2026 est une migration à **liste explicite**
(`menage-des-leads-de-test-21-09`), relevée en production en lecture seule : un
identifiant qui ne ressemble plus à un test est laissé tel quel ; seuls les dossiers
vides ouverts ce jour-là par le rattrapage des simulations sont archivés avec eux.

## 22. Espace client v2, simulateur du CRM, bibliothèque de prompts (21/09/2026)

Trois morceaux d'un même système : l'espace où le client décide, le simulateur où Lucas
prépare les rendus, la bibliothèque qui fixe les prompts. **Un seul moteur de génération.**

### Espace client (site `coverswap/src/components/espace`, API CRM `/api/espace/<jeton>/…`)

Une seule chose à faire à la fois : l'étape se déduit des faits (`src/lib/espace/etapes.ts`,
pur) — devis à signer > simulations à choisir > photos manquantes > projet à préciser > attente.
Progression en cinq étapes (Photos, Projet, Simulation, Devis, Acompte). Rien n'est redemandé :
ce que le formulaire Meta ou le site a dit (délai, propriétaire, taille, zones, teintes essayées)
préremplit l'écran.

- **Photos** : guide illustré (vue d'ensemble, hauts, bas, plan, détail), bons et mauvais exemples ;
  appareil ou galerie, plusieurs à la fois ; réduction à 2 000 px avant envoi, HEIC accepté ;
  file d'attente IndexedDB (réseau coupé : rien n'est perdu, renvoi automatique) ; progression par
  photo. Côté CRM : un seul événement par dépôt (regroupé 15 min), alerte, photos du dossier + Drive.
- **Projet** (`src/lib/espace/projet.ts`) : zones en cartes dessinées, goûts sur vrais échantillons
  (« je ne sais pas, proposez-moi »), mètres avec repères (un mur ≈ 3 m, en L ≈ 5, en U ≈ 7,
  îlot ≈ 8), délai s'il est inconnu ; enregistré au fil de la saisie ; résumé dans le dossier.
- **Simulations** : seulement les publiées ; avant/après sur SA photo, côte à côte, plein écran ;
  choisir une proposition ou composer zone par zone (`choix` composite) ; demander une autre
  proposition avec un commentaire. Chaque geste : événement, prochaine action, alerte.
- **Devis** : lignes, total, acompte/solde, conditions (celles du PDF, `src/lib/pdf/conditions.ts`),
  PDF ; consultations comptées une fois par 30 min, de façon atomique (alerte à la 1re et à la 3e :
  « il hésite ») ; adresse (suggestions BAN, code postal du dossier d'abord) et e-mail demandés ici
  seulement s'ils manquent ; bon pour accord = case + signature au doigt facultative (PNG gardé avec
  l'accord), horodatage, IP, navigateur ; sous le bouton, ce qui manque encore, en clair.
- **Acompte** : montant, RIB copiable (l'IBAN ne se coupe qu'entre ses groupes), référence du
  virement, emplacement « carte » activable plus tard, « et ensuite » ; après chantier : avis
  (publication sur le site seulement avec accord).
- Sécurité : lien signé, expirable, révocable ; aucun compte ; aucune mesure tierce (les visites
  sont comptées par le CRM, 1 par 10 min) ; **aperçu** pour Lucas (`?apercu=`, marque signée
  valable deux jours, lecture seule, visites non comptées).

### Simulations du dossier (`src/lib/simulations/dossier.ts`)

Sources SITE | CHATGPT | API | MANUEL ; statuts BROUILLON → PUBLIEE ⇄ MASQUEE ; « retirer » archive.
Tout arrive en brouillon sauf les simulations faites par le client lui-même sur le site.
« Publier » : visible dans l'espace, étape Simulation ; l'écran publie sans envoyer de SMS
(`prevenir: false`, mission 14 partie 5 : le texte `SIMULATION_PRETE` vit dans le catalogue
et n'a plus d'interrupteur ; la route `…/simulations/publier` garde `prevenir` pour un
envoi par le fournisseur, en GSM-7).

Client existant qui refait une simulation sur le site : rattachée par téléphone puis e-mail au
dossier vivant, rangée dans son espace, alerte « il est en train de se décider ». Téléphone et
e-mail différents mais même nom et même ville ou code postal sous 21 jours : **doublon probable**
(`src/lib/prospects/doublons.ts`, `Lead.doublonDe`) signalé dans Leads, fusion en un clic (le
doublon est archivé, ses simulations et photos rejoignent le dossier, une note reprend ses
coordonnées et son message) ou « ce n'est pas la même personne ».

### Simulateur du CRM (`/simulateur`, `src/lib/simulateur/`)

Client/dossier → photo avant (parmi les siennes) → type de surface (10 types, `types-surface.ts`) →
une teinte par zone (catalogue du site, goûts du client et teintes essayées en premier, recherche
en français : `recherche-teintes.ts`, même logique côté site dans `src/lib/recherche-finitions.ts`).

- **Par l'API** (mission 15, partie 2) : coût estimé sur le bouton (qualité de l'espace et du CRM,
  Paramètres) ; plus aucune consigne demandée au site — la génération passe par le **pipeline
  commun** `src/lib/simulations/pipeline.ts › genererAvecMoteur` (le même pour le site, l'espace
  client et le banc), moteur **V1 ou V2 selon `SIMULATEUR_MOTEUR`** : V1 = le « V1 revu » de
  `moteur/v1.ts` (structure de l'ancien prompt du site, textes des zones de la source unique
  `zones.ts`) avec les échantillons bruts du cache ; V2 = analyse de la photo par vision
  (`analyses.ts`, réutilisée par empreinte SHA-256 : table `AnalysePhoto`), planche d'échantillons
  étiquetés (`moteur/planche.tsx`, `SIMULATEUR_PLANCHE`), prompt « studio » en douze blocs
  (`moteur/index.ts › construirePrompt`, direction artistique par règles, réalisme des matériaux),
  contrôle automatique du rendu (`moteur/controle-rendu.ts`, score sur 10) et, sous
  `SIMULATEUR_SEUIL_CONTROLE`, une seconde tentative avec les défauts rappelés — la meilleure gardée,
  si le temps de la tâche le permet. `genererRendu` (`src/lib/simulations/generation.ts`) reste le
  seul appel d'image (JPEG q90). Une tâche reprise après un redéploiement pose ECHEC « interrompue »
  sans rappeler OpenAI. Résultat en brouillon avec son coût réel, le moteur, le score, les défauts, la
  direction artistique et le prompt donné au modèle (fiche du dossier, `ResultatPreparation`,
  outil MCP `voir_simulations` avec `avec_prompt`).
- **Paramètres → Simulateur** (`SIMULATEUR_*`) : `SIMULATEUR_MOTEUR` (V1/V2, défaut V1 jusqu'à la
  campagne du banc), `SIMULATEUR_PLANCHE` (OUI/NON), `SIMULATEUR_QUALITE_SITE` (medium),
  `SIMULATEUR_QUALITE_ESPACE` (high, vaut aussi pour le CRM), `SIMULATEUR_SEUIL_CONTROLE` (5 à 9,
  défaut 7) ; lus par `simulateur/reglages.ts`.
- **Banc de comparaison** (mission 15, partie 3 : `/simulateur/banc`, `src/lib/simulateur/banc/`) :
  six cas fixes (`cas.ts` : la PHOTO d'un dossier de prod par ses identifiants `dossierId` +
  `photoId`, pièce, zones et teintes ; rien n'est copié dans le dépôt, un identifiant inconnu affiche
  « photo introuvable » et le cas n'est pas lancé) × trois variantes (`v1-swatches` : V1 revu,
  échantillons bruts, medium ; `v2-planche` et `v2-swatches` : moteur studio à la qualité de
  l'espace). Coût estimé AVANT tout lancement (`estimerCampagne` : une génération par rendu, une
  analyse par photo, un contrôle par rendu V2, et le pire cas avec une seconde tentative) ; « Lancer
  la campagne » avec confirmation, ou un cas, ou une variante — rien ne part sans le clic de Lucas.
  Chaque rendu = une tâche **`SIMULATION_BANC`** (voie longue, une tentative, 8 min) qui passe par le
  pipeline commun avec les réglages de la variante, et une ligne **`RenduBanc`** (statut, étape,
  score, défauts, tentatives, coût réel, durée, prompt, direction artistique ; image sous
  `banc/<cas>/<variante>-<n>.jpg`). Jamais de `SimulationEspace` ; les appels comptent dans
  `GenerationImage` à l'origine CRM. La page se relit toutes les 5 s (`GET /api/simulateur/banc`),
  rendus côte à côte par cas (vignette → plein écran, « Voir le prompt »), total de la campagne ;
  elle rappelle `SIMULATEUR_MOTEUR` et renvoie vers Paramètres → Simulateur (c'est Lucas qui bascule).
  Un rendu déjà en attente ou en cours pour le même cas et la même variante n'est pas doublé ; une
  tâche reprise après un redéploiement pose ECHEC « interrompu » sans rappeler OpenAI. Tenue en
  ordre : la ligne et sa tâche naissent dans une même transaction ; une ligne en attente ou en cours
  dont la tâche `banc:<id>` n'est plus vivante (annulée depuis l'écran des tâches, échec hors du
  rendu) est basculée en ECHEC « tâche annulée ou perdue » à la relecture ou au lancement suivant
  (`remettreEnOrdreBanc`) ; un rendu payé dont l'image ne peut pas être écrite (volume plein) passe
  en ECHEC avec son coût réel. Le total de la campagne est compté en base sur tous les rendus
  (agrégats, pas les 200 relus) et comprend les analyses de photo (`GenerationImage` phase
  `analyse`, origine CRM, dossiers du banc, depuis le premier rendu). Rétention : les images du banc
  sont effacées après 30 jours (`purgerRendusBanc`, appelée par la purge opportuniste du simulateur ;
  ligne gardée avec `chemin: null`). RGPD : les rendus d'un dossier entrent dans l'anonymisation
  (image et consigne effacées).
- **Routes publiques du simulateur du site** (sans session, CORS coverswap.fr) : `POST /api/simulate`
  (travail asynchrone ; en V2 les références sont confrontées aux échantillons signés après une
  relecture du catalogue, au plus 4 zones, 409 « zone-non-visible » d'après l'analyse connue),
  `POST|GET /api/simulate/analyse` (analyse de la photo lancée dès qu'elle est chargée, tâche
  **`ANALYSE_PHOTO`** en voie longue, 10 analyses par adresse et 400 par jour comptées seulement
  quand une tâche est mise en file ; le site ne lit qu'un code de raison), `GET /api/site/simulateur`
  (pièces et zones de la source unique, sans consigne). Partie 4 : le site est un simple client —
  `POST /api/simulate` reçoit `{ projet, selections, sig, exp, parcoursId, photo_base64, asynchrone }`
  (signature HMAC de « v2 / parcours / projet / surface:ref,… / exp », `lib/site/contrat-simulate.ts`) et
  relit zones et références lui-même ; l'ancien corps asynchrone (prompt signé) reste accepté le temps
  du déploiement, le contrat synchrone est retiré (400 « contrat »). `POST /api/simulate/photo`
  (multipart : la photo HEIC décodée par `heic-decode` (pixels bruts passés à sharp, une conversion à la fois, 20 par adresse et 60 pour le site par 10 min) et réduite, rien d'écrit) et
  `GET /api/site/echantillons/<ref>[?l=320]` (vignettes du catalogue pour le simulateur public).
  Événements de l'entonnoir (`site/evenements.ts`) : `PIECE_CHOISIE`, `PHOTO_CHARGEE`,
  `GENERATION_LANCEE`, `RESULTAT_VU`, puis `DEVIS_DEMANDE` ; `entonnoirSite()` (emboîté, abandons par
  étape) dans « Sur le site cette semaine ».
- **Avis Google de l'accueil du site** (mission 16, partie 3, `lib/site/avis-google.ts`) :
  `GET /api/site/avis-google` (publique, CORS ouvert, cache HTTP d'une heure, 120 appels par IP et par
  10 min) rend `{ disponible: false }` sans `GOOGLE_PLACES_API_KEY` ou sans `GOOGLE_PLACE_ID` (le site
  n'affiche alors aucun chiffre) ; sinon Places API (New) `places/<id>?fields=rating,userRatingCount,reviews`
  (clé dans l'en-tête `X-Goog-Api-Key`, jamais dans une adresse), copie de 24 h sur le volume
  (`<uploads>/cache/avis-google.json`), une lecture à la fois, une heure de pause après un échec ; une
  copie de plus de 24 h n'est jamais servie (échec → `{ disponible: false }`) → `{ disponible: true, note,
  nombre, avis: [{ auteur, lienAuteur, photoAuteur, lienAvis, note, texte ≤ 300, date }] }` (cinq avis au
  plus, le site en montre trois). Attribution exigée par les règles de la Places API : le nom de l'auteur
  tel que Google le donne, son profil et son avatar, le lien de l'avis sur Google Maps (`https:`
  seulement) ; le site ajoute la mention « Google Maps » et l'ordre des avis. La copie sur le volume
  reste à trancher par Lucas (les conditions de Google n'autorisent à stocker que l'identifiant du lieu).
  `sante_systeme` dit « Avis Google : non connectés (GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID) » ou la
  dernière lecture.
  Photos des publications (`/api/site/photos/<id>/<avant|apres>`) : `?l=480|960|1600` rend un WebP
  réduit (sharp, jamais agrandi, gardé en mémoire), pour le `srcset` du site (ouverture de l'accueil,
  cartes de réalisation) ; sans `l`, la photo telle quelle.
  Événement `WHATSAPP_CLIQUE` (« Écrire sur WhatsApp » de l'accueil) : liste blanche, ligne « Clics
  WhatsApp » de la synthèse, son propre type canonique.
- **Tunnel du site** (mission 16, partie 4, `lib/site/tunnel.ts`, `lib/site/tarifs-publics.ts`) :
  `GET /api/site/tarifs` (publique, rendue à la demande — la base n'existe pas au build de Railway —,
  cache HTTP d'une heure, 120 appels par IP et par 10 min) rend, par famille, chaque sous-partie avec
  `metrage` et `prixUnitaire` (tarif attribué ou trouvé par mots-clés, `null` sinon) et les formats de
  pièce tirés des repères de taille (cuisine : Petite ≈ 3 m, Moyenne ≈ 5 m, Grande ≈ 8 m ; salle de
  bain : ses deux repères ; mobilier et pro : aucun) ; jamais une désignation ni une marge. Le webhook
  accepte `rappelCreneau` (`ce-soir-18h` | `demain-10h` | `demain-18h` → `rappelLe` par
  `rappelDuCreneau`, heure de Paris, « ce soir » après 17 h 30 = demain, samedi et dimanche → lundi),
  `estimationMin` / `estimationMax` / `formatPiece` / `canal` / `pageEntree` (colonnes du lead ; une
  valeur illisible est ignorée, jamais une raison de perdre le lead), `SITE_PRO` (score 40, mail au
  gérant comme une demande de devis, `surfaceM2` en note, `surfaceMl` en `mlEstimes`). Une seule règle
  dit ce qu'est une demande de devis (`estDemandeDeDevis`, `FILTRE_DEMANDE_DE_DEVIS`,
  `prospects/constantes.ts`) : `SITE_DEVIS` (ancien), `SITE_PRO`, et `SITE_CONTACT` quand le formulaire de
  /contact porte un projet (« Autre » = un message) — webhook (statut, accusé, mail), classement,
  intention, push, point du jour ; un message de /contact d'un contact déjà connu prévient aussi Lucas
  (mail et push). Après un rendu du simulateur (`SITE_SIMULATEUR` avec une simulation imagée ou une
  photo, et `afficherLienEspace: true` envoyé par le site — ni l'ancien site ni la demande après un échec
  de génération ne le posent), l'espace s'ouvre
  (`ouvrirEspaceALEnvoi` : dossier « Rappeler » ou « Appeler : simulation faite sur le site ») et
  `lienEspace` revient dans la réponse — le site l'AFFICHE, rien n'est envoyé — mais SEULEMENT à un
  contact neuf (aucune autre fiche, archivées comprises, ni dossier, ni espace avant la demande) ou au
  même parcours qui l'a déjà reçu : à un contact déjà connu, jamais (sinon quiconque connaît son
  téléphone ouvrirait son espace) ; au-delà de deux projets en cours ou lien désactivé : `null`, c'est
  Lucas qui ouvre. Un événement `ESPACE_DEMANDE_SITE` (entrant, metadata `{ parcoursId, lienAffiche }`)
  l'écrit au dossier et rend la main à Lucas (« Demande du site : le rappeler ») ; quand le lien est
  affiché, il rappelle que le téléphone n'est pas vérifié (régénérer le lien au moindre doute, avant tout
  devis). Le rappel suit le contact
  (`suivreLeRappel` : dossier vivant → `rappelALOuverture`, sinon « À rappeler » +
  `synchroniserRappel`). La note du lead dit l'estimation vue, le rappel demandé et l'origine.
  Événements `ESTIMATION_VUE` et `RAPPEL_DEMANDE` ; l'entonnoir compte sept étapes (visite → pièce →
  photo → génération → rendu vu → estimation vue → contact ou rappel), l'estimation étant FACULTATIVE
  (sans abandons ; le contact se compte parmi les rendus vus). Doublons : `nomNormalise` garde chaque mot
  une fois (un prénom recopié en nom reste un prénom seul, jamais un doublon probable).
- **Entonnoir par source** (mission 16, partie 6, `lib/site/familles-source.ts`, pur, réexporté par
  `site/evenements.ts`) : `familleSource(source)` range la source d'une visite (`utm_source[/medium]` ou
  domaine référent, premier segment découpé en mots) en Meta (`meta`, `fb`, `facebook`, `ig`,
  `instagram`, `msg`), recherche (`google`, `bing`, `duckduckgo`, `qwant`, `ecosia`, `yahoo`), direct
  (vide) ou autre (nom gardé). Calculée à la LECTURE : rien n'est réécrit dans `EvenementSite`. Un parcours
  prend la famille de sa première source non vide (`familleDesParcours`, lecture par date croissante) ;
  `calculerEntonnoirParFamille` rend l'entonnoir global, les quatre entonnoirs de famille (leur somme =
  le global) et les huit premières sources « autres ». `entonnoirSite(7)` (Leads → « Sur le site cette
  semaine », sélecteur Toutes · Meta · Recherche · Direct) et `syntheseSite` (`site.entonnoir`,
  `VERSION_SYNTHESE` 5) le rendent ; outils `synthese` (une ligne par famille) et `voir_publicite` (la
  ligne Meta des 7 derniers jours). Le site ne dépose plus aucun traceur tiers (GTM, GA4, pixel Meta,
  Clarity, Vercel Analytics retirés) : les conversions Meta passent par l'API Conversions du CRM.
- **Pour ChatGPT** : prompt de la bibliothèque rempli (désignation « Image 1 / Image 2 », une
  section par zone avec nom, référence, couleur mesurée, motif, sens de pose, finition, méthode du
  film, verrous, contrôle final, `{{direction_artistique}}`), planche PNG (grands échantillons
  étiquetés par zone, `next/og`), photo avant recadrée au format de sortie. iPhone : « Enregistrer
  les 2 images » (feuille de partage), « Copier le prompt », « Ouvrir ChatGPT », puis « Déposer
  l'image » : le rendu reprend seul la photo avant, les teintes, le type et la version du prompt
  (dernière préparation ChatGPT de moins de 72 h, `PreparationSimulation`).
- **Couleurs mesurées** (`couleur.ts`) : moyenne Lab sur l'échantillon, mise en mots (un chêne est
  « miel » ou « beige », jamais « jaune ») ; cache `analyses-couleur.json`, travail périodique
  `catalogue-couleurs`.
- **Crédit** (`consommation.ts`) : chaque génération (site, espace ou CRM) et chaque appel vision
  (phase `analyse` ou `controle`, origine du demandeur) laisse une `GenerationImage` immuable
  (jetons, coût) ; compteur du mois ventilé par origine, solde estimé depuis le paramètre
  `SIMULATEUR_CREDIT_OPENAI` (ou `OPENAI_ADMIN_KEY` si posée), simulations restantes et garde de
  l'espace au prix de la qualité de l'espace (analyse et contrôle compris en V2), alerte sous 2 $.

### Bibliothèque de prompts (`/simulateur/prompts`, `bibliotheque.ts`, `prompts-defaut.ts`)

`prompts-defaut.ts` est **généré** (`npm run simulateur:prompts` → `moteur/generer-prompts.ts` →
`moteur/modele-chatgpt.ts`) : la version 1 de chaque prompt est le prompt du moteur en mode
`chatgpt`, avec les marqueurs de la bibliothèque ; la migration `prompts-studio-15-2` a posé cette
version sur les prompts jamais modifiés par Lucas. Un prompt par type de surface ; chaque
enregistrement est une nouvelle version immuable (`PromptSimulationVersion`), « revenir » recopie
une ancienne version sous un nouveau numéro.
Vérification avant enregistrement (`verifierModele`) : une section `[zone:…]` par zone avec
`{{teinte}}` et `{{etiquette}}`, balises équilibrées, variables connues, « Image 1 / Image 2 ».
Chaque version affiche ses résultats (simulations, publiées, masquées, choisies).

### Espaces clients (`/espaces`, `src/lib/espace/suivi.ts`)

> Mission 18 (A1, 03/10/2026) : l'onglet est retiré. L'état de l'espace est la colonne « Espace » et le filtre
> « Espaces » de Dossiers (`/dossiers?espace=TOUS`, où `/espaces` redirige ; `suivi.ts › espacesDesDossiers`) ; les
> gestes restent dans le bloc Espace du panneau du dossier et dans la fiche client. La description ci-dessous est
> celle de l'ancien onglet.

Une carte par espace : étape, ce qui est fait, dernière visite, qui a la main (moi / client) ;
signaux (photos sans simulation, autre proposition demandée, brouillons, devis relu sans
signature, lien jamais ouvert après 48 h, lien qui expire, date à fixer) ; tri « à moi d'abord » ;
actions (dossier, voir comme le client, copier, « SMS avec le lien » — l'écran SMS avec
`LIEN_ESPACE`, `LIEN_ESPACE_RAPPEL` si le lien actuel a déjà été communiqué ou l'espace
ouvert, `LIEN_ESPACE_NOUVEAU` après « Nouveau lien » —, simulateur, renouveler, désactiver).
Rien d'autre que l'espace :
le reste vit dans Dossiers.

### Migration et essais

Migration `simulateur-espace-21-09` : prompts d'origine, messages types manquants
(`RELANCE_DEVIS_QUESTIONS`, `LIEN_ESPACE_RAPPEL`), repérage des copies de rendus dans les photos
du dossier. Essais : `src/lib/espace/espace-v2.test.ts`, `src/lib/simulateur/simulateur.test.ts`,
`src/lib/prospects/doublons.test.ts`.

### Seconde passe (21/09/2026, soir)

- **Hauteur réelle** : l'accueil de l'espace se mesure à 390 × 660 (iPhone courant dans Safari)
  et 375 × 560 (SE), pas à la taille de l'écran. Tout le haut (bonjour, qui je suis en une ligne,
  cinq étapes, carte d'action et son bouton) tient au-dessus de la barre d'appel, claire.
- **Projet en quatre questions** (`EtapeProjet`) : zones, goûts, taille, délai + un mot ; chaque
  geste enregistré ; le préremplissage suit la version à jour de l'espace tant que rien n'est touché.
- **Devis prérempli** (`src/lib/espace/devis-propose.ts`, GET `/api/dossiers/[id]/devis-propose`) :
  une ligne par groupe de zones (façades hautes et basses ensemble), teintes en sous-désignation,
  mètres du client sur la première ligne de meubles seulement, prix des tarifs (`PresetTarif`)
  trouvés par mots-clés ; sans tarif, prix et quantité vides (le générateur refuse d'émettre).
  Ouvert par « Faire le devis » (panneau Espace du dossier, Espaces clients : `&devis=nouveau`) et
  par « Générer un devis » quand le dossier n'a aucun devis. « Préparer le devis » (posé au choix)
  est remplacé à l'émission du devis.
- **Espaces clients** : `attente.geste` (DEVIS | SIMULATEUR | PUBLIER | APPELER) = bouton vert en
  tête de carte. Une demande d'autre proposition cesse d'être en attente après un choix ou une
  signature postérieurs.
- **Zones retrouvées par libellé** (`surfaceDepuisLibelle`, dans `lireZones`) : une simulation du
  site rangée sans identifiant (« Façades : K1 (Black mat) ») retrouve ses zones.
- **SMS** : `LIEN_ESPACE_SIMULATION` remplace `LIEN_ESPACE` quand une simulation du site rangée
  dans le dossier, avec son rendu, est dans l'espace (`simulationDansLEspace` ; migration
  `sms-lien-simulation-21-09`, règle resserrée par la mission 14, partie 5).
- **Photos** : sélecteurs en `accept="image/*"` (l'iPhone convertit ses HEIC en JPEG) ; photo
  illisible au recadrage du simulateur = message clair.
- **Typographie** : insécables avant « : ; ! ? % » et dans les guillemets (échappements dans le
  source, jamais de caractère invisible) ; e-mail facultatif pour signer ; avis jamais coché d'office.

## 23. Notes d'appel, kanban chargé, panneaux au pouce, espace client v3 (21/09/2026, soir)

### Notes d'appel (`src/lib/commercial/notes-appel.ts`, `src/components/pilotage/NotesAppel.tsx`)

Modèle `NoteAppel` (lead, `appelLe`, texte, étiquettes JSON, issue, `dossierEvenementId`). Un champ
toujours visible — carte du lead, fiche du lead, mode « Enchaîner les appels » (grand) — qui
s'enregistre à la frappe (1,2 s), à la sortie du champ, en passant à une autre appli (`keepalive`) ;
sans réseau, gardé dans le téléphone (`note-appel:<lead>`) et renvoyé au retour. Une note par
appel : la dernière de moins de 3 h se complète, au-delà la frappe en ouvre une nouvelle (« Nouvel
appel » pour forcer). Huit étiquettes (`ETIQUETTES_APPEL`, codes stables pour les statistiques).
L'issue enregistrée en fin d'appel s'accroche à la note ouverte (`noterIssueSurNote`). Depuis la
mission 14 (partie 3), une note qui a du texte ou une étiquette compte comme un appel
(`retenirAppel` : `Lead.dernierAppelLe`, tentatives inchangées) et fait passer le lead dans
« À rappeler » ; la feuille de fin d'appel attend `viderNotesEnAttente` avant d'écrire l'issue. À l'ouverture
du dossier, notes et étiquettes passent dans son historique (événement `NOTE_APPEL`, daté du jour de
l'appel via `survenuLe`) ; les notes suivantes s'y reflètent. Un lead jamais converti garde ses notes.
Retour de l'écran d'appel d'iOS : l'appui sur le numéro note `appel-en-cours` ; au retour
(`visibilitychange`, `pageshow`), le champ du bon lead revient au centre, focalisé (mode appels >
fiche > liste). Deux blocs du même lead à l'écran restent synchronisés (abonnés par lead).
RGPD : le texte est effacé à l'anonymisation, date, étiquettes et issue restent.

### Kanban des dossiers (`VueKanban.tsx`, `CarteDossier.tsx`)

Hauteur des colonnes mesurée (du haut du kanban au bas de l'écran, barre du téléphone déduite) :
chaque colonne défile seule, la page ne s'allonge plus. Cartes jamais écrasées (`shrink-0`) ;
au-delà de 6 dossiers, cartes compactes de hauteur fixe (nom, prochaine action et date, liseré et
pastille de retard, « À moi »). Tri par colonne : où j'ai la main d'abord, puis par échéance.
En-tête : nombre, ▶ à faire, ● en retard, total court (« 130 k€ »). Filtre « Masquer les inactifs »
(30 jours sans modification et le client a la main ; jamais un dossier qui m'attend), mémorisé.

### Fermer au pouce (`src/components/pilotage/fermeture-mobile.ts`)

`useRetourFerme(ouvert, fermer)` : chaque panneau ouvert pousse une entrée d'historique (état de Next
conservé) ; le geste retour ferme celui du dessus ; fermé par un bouton, il retire son entrée — sauf
si l'on a navigué ailleurs entre-temps (un lien suivi n'est jamais défait). `useGlisserPourFermer` :
depuis le bord gauche (panneaux latéraux, plein écran) ou vers le bas (barre de titre des fenêtres).
Branché une fois dans `SheetContent` (fiche dossier, fiche lead, prospect — bouton `Close` caché +
zones sûres haut et bas) et `Modale` (toutes les fenêtres : zones sûres, geste retour, glisser),
plus le mode appels, la visionneuse de simulations et le sélecteur de teinte (le volet contexte des
SMS est parti avec l'écran SMS, lot 7).

### Espace client v3 (site `coverswap/src/components/espace`)

Une seule navigation : la barre d'onglets en bas (Photos · Projet · Simulations · Devis · Paiement),
coches « fait », cadenas et raison écrite (`RAISONS_VERROU`), point rouge sur la prochaine étape.
Accueil = une phrase + un bouton (`prochainPas`). L'espace parle au nom de CoverSwap (logo, « nous »),
le numéro reste celui de Lucas (`marque`). Projet : zones (+ « Autre chose »), taille (repères +
pas de 0,5 m), un mot ; enregistré à la frappe (pastille « Enregistré », erreurs du serveur dites en
clair, réseau coupé gardé) ; plus de goûts ni de délai (les anciens restent lus). Alerte « projet
précisé » unique, trois minutes après (tâche `ESPACE_PROJET_ALERTE`). Simulations : galerie (site,
lui, CoverSwap), vue agrandie avant/après + teinte de chaque zone + « Valider cette simulation »
(ouvre le Devis, prochaine action « préparer le devis », changeable tant qu'aucun devis n'est émis),
mélange zone par zone ; simulateur intégré (`CreationSimulation`, `CatalogueTeintes`) : sa photo ou
une nouvelle, zones cochées d'après le Projet, une teinte par zone dans les 497 références
(familles toutes visibles, recherche française, vignettes 320 px servies par le CRM, agrandir,
favoris gardés et vus par Lucas), même moteur que le site et le CRM (préparation `origine CLIENT`,
mode API). Garde-fous : `SIMULATEUR_ESPACE_GRATUITES` (5 si vide), « Demander d'autres
simulations » → Lucas accorde 3 d'un clic (Espaces clients, fiche dossier) ; crédit épuisé : rien
ne part, message clair, choix gardés, Lucas prévenu (au plus toutes les 3 h) ; coupure réseau
pendant la génération : elle continue côté serveur, l'écran le dit et la montre au retour.
Aperçu : chaque geste affiche « rien n'est enregistré » (plus aucun bouton muet). Feuilles plein
écran (`Feuille`) : bouton de fermeture en bas, glisser vers le bas, geste retour.

Mission 15 (partie 5) — même moteur, même niveau que le site : `CreationSimulation` reprend le
parcours et les composants du simulateur du site (Pièce · Photo · Matières, `CartesPieces`,
`FeuilleCatalogue`, `EcranAttente`, `AvantApres` avec « Comparer », plein écran, « Télécharger »,
« Essayer d'autres matières ») ; `CatalogueTeintes` a disparu. Côté CRM (`src/lib/espace/simulateur.ts`) :
pièces et zones de la source unique `simulateur/zones.ts` (`piecesPourLeClient` : MURS et
`tablier-baignoire` proposés, `IDS_FAMILLE` intact, limite `ZONES_MAX` rendue dans `creation.zonesMax` et
lue aussi par `schemaPreparation`) ; `POST /simulations/analyse { photoId, piece }` et
`GET /simulations/analyse/<empreinte>` (la photo du dossier cadrée comme pour la génération → même
empreinte, même cache ; tâche ANALYSE_PHOTO comptée à l'espace sur son dossier, `AnalysePhoto.dossierId` =
preuve du suivi par jeton ; un projet figé n'analyse plus (409 `fige`) ; au plus `LIMITE_ANALYSES.parEspace`
analyses par dossier et par jour, comptées seulement quand une tâche part, sous le plafond global du site
→ 429 « vous pouvez lancer la simulation sans ») ; `POST /simulations/creer` refuse en 409
`zone-non-visible` une zone que l'analyse connue de la photo cadrée ne voit pas (même phrase que
`/api/simulate`, jamais à l'aveugle), AVANT de compter ou de lancer. Le bloc « simulations créées par le
client » (quota, lancement, suivi, demandes et accords) vit dans `src/lib/espace/creation.ts` (réexporté par
`service.ts`). `GET /simulations/creation/<id>` rend `etape` et `attenteEstimeeS` (médiane des dernières
générations par l'API), et le statut `RELECTURE` ; `creation.enCours` porte la photo et les teintes (écran
d'attente sur un autre appareil), `creation.enRelecture` les brouillons qui attendent Lucas. Contrôle
automatique avant publication (`executerGenerationApi`, origine CLIENT) : score sous
`SIMULATEUR_SEUIL_CONTROLE` après les deux tentatives du pipeline → `SimulationEspace` source CLIENT en
BROUILLON (score et défauts dans la fiche, libellé « Faite par le client (espace) »), événement
`ESPACE_SIMULATION_RELECTURE` (la main revient à Lucas), alerte « Simulation à relire » ; le client lit
« Votre simulation demande une relecture » et la reçoit quand Lucas la publie (mail « simulation publiée »
existant ; elle est alors « Nouveau » dans sa galerie jusqu'à sa première visite, `vueLe` posé) — une
seule ligne, quota compté une fois.


## 24. Cohérence entre les sections (22/09/2026)

Matrice complète : `docs/COHERENCE.md`. À retenir pour toute évolution :

- **Une lecture unique des faits d'un espace** : `src/lib/espace/faits.ts` (devis en vigueur et montants — un devis
  REPRIS n'a pas de lignes, son montant est `totalHt` ; accord `ESPACE` ou `CRM` ; paiements détaillés ; quota, où
  les simulations du site comptent). Ne jamais recalculer un total ou un « signé » ailleurs.
- **Tout geste de l'espace se défait** : `src/lib/espace/validations.ts`, auteur `CLIENT` ou `LUCAS`. Le mouvement du
  dossier porte une `raison` (métadonnée du CHANGEMENT_ETAPE) ; le retour ne défait QUE le mouvement qui porte cette
  raison. `AccordDevis.retireLe` : tout lecteur d'accords filtre `retireLe: null`.
- **Vue et gestes du CRM** : `src/lib/espace/vue-crm.ts` (`POST /api/dossiers/[id]/espace { geste }`).
- **L'étape suit l'argent** : `suivreSoldeDossier` (factures) et `suivreAcompteDossier` (acompte → Signé, et retour).
- **Simulation du site = lead** (plus de dossier d'office) ; `dossiers/archivage.ts` archive / restaure un dossier et
  rend ses simulations au lead.
- **Contrôle** : `src/lib/coherence/controle.ts` (démarrage + quotidien, Tâches de fond, `corrigerIncoherence`).

## 25. Appels, rappels, relances, SMS : un seul circuit (mission 14, 29/09/2026)

Principe : **un écran montre une seule chose, un lead a toujours une destination, les
textes SMS n'existent qu'à un seul endroit**. Aucun nouvel envoi automatique : les SMS
se copient depuis le téléphone de Lucas, et copier vaut envoi ; les accusés de réception
et les mails de l'espace sont inchangés. Rien n'est supprimé ; chaque partie a sa
migration de données idempotente, jouée au démarrage après sauvegarde. Le détail, partie
par partie, est dans `docs/REPRISE-MISSION.md` (« Mission 14 »).

### Qui a la main (partie 1, `src/lib/dossiers/main.ts`, `devis-envoye.ts`)

Quatre règles, lues par une seule fonction (`lireFaitsMain` → `mainSelonFaits`) : un devis
visible dans l'espace (numéroté, généré ou envoyé, non archivé) vaut « Devis envoyé »,
d'où qu'il vienne (émis, déposé, rendu visible) — un devis masqué ne passe plus la main au
client ; un message du client (mail rattaché, message d'espace) resté sans réponse épingle
la main à Lucas (« Répondre à {nom} ») quels que soient les gestes plus récents, jusqu'à la
réponse (mail, réponse dans l'espace, SMS copié ou parti, appel abouti) ; l'objet du
dossier suit le projet validé (`objetDepuisProjet`) tant que Lucas ne l'a pas écrit lui-même
(`Dossier.objetManuelLe`) ; l'espace n'a qu'une étape, déduite de celle du dossier
(`espace/etapes.ts`). Migration `qui-a-la-main-14-1`.

### Leads : deux listes (parties 2 et 3, `src/lib/prospects/leads.ts`)

- **À appeler** = jamais appelé (`Lead.dernierAppelLe` nul, aucun rappel daté), le plus
  récent en haut. **À rappeler** = déjà appelé ou rappel daté : rappels datés dans l'ordre
  chronologique, retards en rouge en tête, puis les rappels sans date, plus ancien appel
  d'abord. Un lead ne sort des listes que vers un dossier vivant, en « sans suite » (motif
  obligatoire) ou archivé ; « Traiter » n'existe plus.
- **Une seule règle de l'appel** : « appelé » = fin d'appel, échange APPEL ou note d'appel
  non vide (`retenirAppel`) ; « sans réponse » = l'issue quand elle est connue, sinon les
  mots du texte (`commercial/sans-reponse.ts`) ; `Lead.tentatives` compte les appels sans
  réponse d'affilée. Migrations `leads-a-rappeler-14-2` (les leads traités ou archivés
  depuis le 01/09/2026 après un dernier appel sans réponse reviennent, rappel le lendemain
  18 h, sauf rappel déjà prévu plus tard) et `appels-des-leads-14-3` (`dernierAppelLe` et
  `tentatives` relus sur tout l'historique, `updatedAt` gardé).
- Le compteur de l'onglet Leads ne compte que les retards ; la puce de rappel d'une ligne
  se déplace sans ouvrir la fiche (`PATCH /api/prospects/entrants/[id] { rappelLe }`).
- Dates en heure de Paris : `commercial/quand.ts › aHeureParis` (« demain 18 h » au
  calendrier, changements d'heure compris) — le serveur est en UTC.

### Fin d'appel (partie 4, `src/lib/commercial/appels.ts`, `components/pilotage/FinAppel.tsx`)

`noterAppel` est le seul chemin (feuille de l'écran, mode appels, outil MCP `noter_appel`).
Quatre issues : **Pas de réponse** (tentatives + 1, rappel demain 18 h modifiable, le lead
est dans « À rappeler » ; SMS A, puis D dès la deuxième tentative) ; **À rappeler** (date
et heure — ce soir 18 h, demain 10 h, demain 18 h, lundi 10 h, autre — ou sans date ;
SMS B) ; **Intéressé** (dossier vivant repris ou ouvert, puis son espace ; SMS
`LIEN_ESPACE`, ou `LIEN_ESPACE_SIMULATION` si une simulation est déjà dans l'espace) ;
**Pas intéressé** (motif de perte obligatoire, règle unique `dossiers/perte.ts` ; aucun
SMS). À la troisième tentative sans réponse, le CRM propose « Pas intéressé — plus de
réponse » sans l'imposer. L'appel s'écrit sur le dossier vivant du lead s'il en a un
(sinon sur le lead ; un dossier clos garde l'histoire). Après la feuille : l'écran SMS si
un texte est proposé, puis le lead suivant (`GET /api/leads/suivant`).

### SMS : écran et catalogue unique, copier vaut envoi (partie 5, `src/lib/sms/`)

- **Écran SMS** (`components/pilotage/sms/EcranSms.tsx`, ouvert de n'importe où par
  `ouvrirEcranSms`) : un message prérempli selon la source du lead et l'action,
  modifiable, « Copier » (44 px) et « Passer ». Copier = presse-papiers + `POST
  /api/sms/copie` : événement `SMS_COPIE` sur le dossier (ou échange SMS d'un lead sans
  dossier), main au client si le texte porte le lien (`porteLienEspace`), relance comptée
  s'il s'agit d'une relance ; double toucher en dix minutes = une seule trace. « Passer »
  n'écrit rien.
- **Catalogue** (`sms/catalogue.ts`, pur) : par code, libellé, groupe (Automatiques, Après
  un appel, Espace client, Relances), usage, variables permises (`{prenom}`, `{quand}`,
  `{lien}`…), lien en dernier, texte de départ ; `verifierTexteSms` au serveur comme à
  l'écran. Textes modifiés en base (`ModeleSms`, Paramètres → SMS), lus par
  `texteDuCatalogue`. Le SMS proposé (`sms/proposition.ts`) choisit le code (tentatives,
  simulation du site, lien déjà communiqué…) et remplit `{quand}` en heure de Paris
  (`quandLisible`). Tout texte SMS qui vivait ailleurs (mail du lien, publication d'une
  simulation, nouveau lien) est rapatrié. Migration `catalogue-sms-14-5`.

### Relances : un seul circuit (partie 6, `src/lib/relances/`)

- **Devis** : quand une relance devient proposable (délai `DELAI_RELANCE_DEVIS` depuis
  l'émission ou la dernière relance, deux au plus tous canaux confondus), le CRM propose
  le mail existant (proposition `ENVOI_MAIL`, s'il y a une adresse et pas de refus des
  mails) **et** le SMS à copier (`RELANCE_DEVIS_1` / `_2`), toujours. La copie compte comme
  une relance : le dossier passe en « Relance », le mail du même rang en attente est annulé
  (« Relance faite par SMS ») ; un mail validé ou parti ferme le rang au SMS.
- **Photos** : un espace ouvert sans photo ni simulation depuis `DELAI_RELANCE_PHOTOS`
  jours (3 au départ) fait proposer le SMS du lien (`LIEN_ESPACE_RAPPEL`, ou
  `LIEN_ESPACE` si le lien n'a jamais été communiqué) ; deux au plus ; une simulation faite
  sur le site compte (`espace/simulations-faites.ts`, règle unique « a fait une
  simulation »).
- **Source unique** : `relances/proposables.ts › relancesProposables` → `GET /api/relances`,
  la feuille Relances de l'écran Leads (`FeuilleRelances.tsx`), la rubrique de la fiche
  du dossier, `voir_relances`, `manager_operations`, la ligne du jour. Tout est proposé,
  rien n'est envoyé. L'ancien circuit `relances-sms` est **retiré** (section 20 ;
  migration `relances-un-circuit-14-6` : modèles archivés, délai photos posé, mains
  relues).

### Agenda et notifications des rappels (partie 7, `src/lib/agenda/rappels.ts`)

- Un **rappel** = celui d'un lead des listes (`Lead.rappelLe`) ou la prochaine action
  « Rappeler… » datée d'un dossier ni archivé ni clos. Chaque rappel a **un** événement
  Google Calendar de 15 minutes (« Rappeler {nom} – {ville} », `tel:` et lien de la fiche
  dans la description), créé, déplacé ou supprimé par la tâche `AGENDA_RAPPEL` (mode
  RECONCILIATION, une par fiche ; identifiant rangé dans `agendaEvenementId`), et une
  notification 10 minutes avant (`RAPPEL_NOTIFICATION`, une par instant, qui relit le
  rappel avant de sonner : déplacé ou retiré, elle se tait) sur les canaux poussés, avec
  le numéro. Un rappel de dossier noté au jour seul (midi UTC sans
  `prochaineActionInstant`) devient un événement « toute la journée », notifié à 9 h.
- `synchroniserRappel` est appelée partout où un rappel change, après l'écriture, jamais
  dans une transaction (sauf l'anonymisation RGPD, qui remet la tâche en file dans la
  sienne). `planifierAction` (outil `planifier`, bouton d'un mail) passe par là pour un
  rappel suivi ; une autre action de dossier ou un rappel hors des listes garde l'événement
  direct d'avant.
- **Sans Google, sans le droit `calendar.events`, ou sans l'API Google Calendar activée
  dans le projet Google Cloud** (partie 9 : 403 `accessNotConfigured` →
  `ApiGoogleNonActivee`, une `AttenteExterne`), la tâche attend — 6 h entre deux essais,
  réveillée par « Reconnecter » — sans alerte ; Paramètres → Connexions le dit en une
  phrase, `sante_systeme` dans son bloc Google, `planifier` dans sa réponse ; l'événement
  se pose dès que c'est réglé. L'état se lit sur les tâches en attente
  (`etatConnexionGoogle` : `agenda`, `agendaApiActivee`, `agendaApiMessage`, et
  `autresApisNonActivees` pour Gmail ou Drive dans le même cas), sans état à
  tenir. Migrations `agenda-des-rappels-14-7` (rappels futurs mis en file) et
  `agenda-rappels-en-attente-14-9` (tâches déjà en échec pour cette raison remises en
  attente).
- **Les nombres du jour** (`agenda/resume.ts`) : « N rappels aujourd'hui, N en retard, N
  relances proposables », dans `point_du_jour` et sous les puces de Leads.

### Outils MCP (partie 8, `src/lib/assistant/outils/`)

80 outils. `leads_a_appeler` ne rend que « À appeler » ; `leads_a_rappeler` (nouveau), même
tri et même pagination que l'écran ; `noter_appel` rend le SMS proposé (code et texte)
pour que Lucas le copie depuis la conversation ; `noter_sms` (nouveau) — « SMS envoyé à X »,
code ou texte libre — produit les mêmes effets que « Copier » ; `voir_relances` montre
les clients sans e-mail avec leur SMS et les relances photos ; `espaces_clients` filtre
« sans photo ni simulation depuis N jours » et rend téléphone et texte ; `voir_parametres`
(groupe SMS) et `modifier_parametres` (`sms_code` + `sms_texte`) couvrent le catalogue.
Consignes : section « Appels, rappels, SMS (mission 14) » jointe à la lecture. Un outil
ajouté change l'empreinte du catalogue : reconnecter le connecteur Claude.

### Limites connues

- Rien de tout cela n'a été essayé sur un vrai iPhone (feuille de fin d'appel par-dessus
  la fiche, presse-papiers de Safari, retour depuis l'application Téléphone, boutons de
  notification — iOS ne les affiche pas, le toucher ouvre la fiche).
- Une fin d'appel sur un dossier clos pose un rappel non suivi (ni liste, ni agenda, ni
  notification) ; le résumé le dit.
- L'état « API Google Calendar non activée » ne se lit que tant qu'une tâche attend pour
  cette raison : après l'activation, la carte le dit encore jusqu'au passage suivant (6 h
  au plus ; « Reconnecter » tout de suite — « Relancer » dans Tâches de fond ne vaut que
  pour une tâche en échec ou annulée, pas pour une tâche en attente).
- `commercial/pilotage.ts › relancesAValider` et `ce_qui_m_attend` comptent toutes les
  propositions en attente, pas seulement les relances.
- Transactions : le test de fusion des doublons (`prospects/doublons.test.ts`) passait par
  `ouvrirEspace`, qui chargeait un module **dans** sa transaction (verrou d'écriture SQLite
  tenu le temps de la transpilation, au-delà des 5 s de Prisma quand le processeur est
  occupé) ; l'import est remonté avant la transaction (partie 9). Règle : rien de lent
  (import, réseau, fichier, rendu) dans une transaction interactive — hors `documents.ts`
  et `reprise.ts`, qui font exprès un travail long avec un délai déclaré.

## 26. Analytique : connecteurs et mesure du site (mission 17, partie B, 30/09/2026)

Conception : `docs/ANALYTIQUE.md`. Cette section décrit la RÉCEPTION des chiffres ;
les écrans et leurs calculs sont dans `src/lib/analytique/` (types.ts, écrans).

### Familles de source (`src/lib/analytique/sources.ts`)

Une seule définition, pure (importable côté client) : `familleDe({ source, medium,
campagne, referent, gclid, leadSource, canal })` → meta, google-ads, seo,
fiche-google, ia, reseaux, direct, autre ; `familleDuLead(lead)` (Lead.source
META_ADS → meta, puis `canal`, puis le parcours, puis la source du lead). L'IA est
testée avant Meta et le SEO sur l'hôte complet (`meta.ai` n'est pas Meta,
`gemini.google.com` n'est pas du SEO). `site/familles-source.ts` (entonnoir de
l'écran Leads, outils `synthese` et `voir_publicite`) s'y appuie désormais : un lien
Facebook sans marqueur payant est un réseau social, `chatgpt.com` est de l'IA ;
un instantané mensuel d'avant (familles meta, recherche, direct, autre) reste lisible.

### Mesure du site sans cookie (`analytique/mesure.ts`, `api/site/evenements`)

À chaque événement, le CRM calcule `visiteur = sha256(sel du jour ‖ IP tronquée
(/24, /48) ‖ User-Agent ‖ "coverswap.fr")` tronqué à 16 caractères, la classe
d'appareil (TELEPHONE, TABLETTE, ORDINATEUR), le pays d'après le fuseau horaire
envoyé par le site (table fuseau → pays, sans géolocalisation), l'hôte référent et
la famille ; puis il oublie l'IP et le User-Agent. Les robots (User-Agent vide ou de
robot, aperçu de lien, navigateur sans tête, Lighthouse) ne sont pas enregistrés. Le
sel du jour est tiré au hasard et gardé sous UNE clé de `CleInterne`
(`analytique-sel-du-jour`, table hors journal), remplacée au premier événement de
chaque jour (heure de Paris) : aucun historique des sels, aucune empreinte reliable
d'un jour à l'autre. Nouveaux champs acceptés (tous facultatifs) : `referent`,
`fuseau`, `utmSource`/`utm_source`, `utmMedium`, `utmCampagne`, `utmContenu`
(ou un objet `utm`), `gclid` (présence seulement) ; `parcoursId` devient facultatif
(l'empreinte du jour en tient lieu : `v-<visiteur>`). Conservation : 25 mois.

`analytique/visites.ts › visitesSurPeriode(du, au, { famille? })` : visite = même
visiteur du jour, pause de moins de 30 minutes ; page d'entrée = première PAGE_VUE ;
famille, appareil et pays = ceux de la première page. Un passage linéaire sur les
événements triés par visiteur (index `[visiteur, createdAt]`), par tranches de
5 000. Les événements d'avant la mesure (sans empreinte) se regroupent par parcours.

### Connecteurs

| Source | Module | Variables Railway | Écrit |
|---|---|---|---|
| Meta (vraie dépense) | `meta/depense.ts` (`graph.ts › appelerTout`) | `META_AD_ACCOUNT_ID`, `META_ADS_TOKEN` (repli `META_ACCESS_TOKEN`) | `DepensePubJour` |
| Search Console | `google/search-console.ts` | `GOOGLE_SERVICE_ACCOUNT_JSON`, `SEARCH_CONSOLE_SITE` (défaut `sc-domain:coverswap.fr`) | `SeoJour` |
| Fiche Google | `google/fiche.ts` | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_BUSINESS_LOCATION`, `GOOGLE_BUSINESS_ACCOUNT` | `FicheGoogleJour` |
| Google Ads | — (aucune campagne) | — | — |

- Google par compte de service (`google/compte-service.ts`) : JWT RS256 signé avec
  `node:crypto`, échangé à `oauth2.googleapis.com/token`, jeton gardé en mémoire
  jusqu'à 60 s avant expiration ; 401 → nouveau jeton, un seul nouvel essai ; 401,
  403 ou « quota 0 » → `AccesEnAttente` (état « en attente d'accès », jamais une
  erreur bruyante). Indépendant de la connexion OAuth de Lucas (pas d'alerte
  « Google coupé »).
- Meta : `/act_<id>/insights` niveau publicité, `time_increment=1`, pagination
  suivie ; leads = `onsite_conversion.lead_grouped` sinon `lead` ; codes 80000 à
  80014 passagers (limites « Business Use Case ») ; jeton refusé → échec définitif.
- Suivi (`analytique/suivi.ts`) : une ligne `SourceAnalytique` par source (dernier
  essai, dernière réussite gardée en cas d'échec, erreur, échecs de suite, détail JSON
  avec l'état et le début de la série d'échecs). État lu par
  `analytique/etat.ts › etatDesSources` (écran, `sante_systeme` : champ `analytique`).
- File de tâches (`analytique/synchro.ts`) : traitement `ANALYTIQUE_SYNCHRO`
  (charge `{ source, depuis?, jusqua? }`), travaux `analytique-meta-recent` (3 derniers
  jours toutes les 3 h), `analytique-nuit` (à partir de 4 h, Paris : Meta sur toute la
  campagne ou 90 jours, Search Console 16 mois au premier passage puis 5 jours, fiche
  540 jours puis 10), `analytique-purge-mesure` (quotidien). `relancerSynchro(source)`
  pour le bouton « Relancer ».
- Pannes : tâche système `SYSTEME:synchro-<source>` (niveau 4 au-delà de 24 h
  d'échec), détecteur `a-faire/detecteurs/systeme.ts` ; les tâches `ANALYTIQUE_SYNCHRO`
  en échec ne font pas en plus une tâche « tâches de fond ».

### Limites connues

- Pays : déduit du fuseau horaire (un Belge réglé sur Paris compte en France).
- iPad récent : il se présente comme un Mac, compté « ordinateur ».
- Meta : une publicité dont Meta ramènerait la dépense d'un jour à rien garde sa
  dernière ligne (upsert sans effacement) ; les jours suivent le fuseau du compte.
- Search Console : jours de Google (heure du Pacifique) ; requêtes anonymisées
  absentes du détail (les totaux viennent de la ligne TOTAL).
- Fiche Google : les API Business Profile restent fermées tant que Google n'a pas
  accordé l'accès au projet ; aucun appel réel n'a encore abouti.

