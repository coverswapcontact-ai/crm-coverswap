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
  attribuées à l'acteur du traitement avec l'origine `tache:<TYPE>` ;
- `MiroirDrive` (section 15) : état technique du miroir, réécrit à chaque passage ;
- `ContenuMessage` (section 16) : le texte d'un mail reçu, écrit une fois avec
  son `Message` (lui journalisé) ; la base en refuse toute modification, sauf
  son effacement RGPD, une fois. Le journaliser dupliquerait chaque mail.

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

### Rien ne se supprime, rien ne se réécrit

La base refuse (déclencheurs) :

- de modifier montant, date de réception, payeur d'un encaissement, ou le
  montant et la pièce d'une affectation ;
- de rouvrir un encaissement annulé ou rejeté, ou une affectation qui a cessé
  de compter ;
- d'annuler ou de rejeter sans date ni motif.

Ce qui se complète une fois : le moyen (inconnu à la reprise), la référence,
la date de crédit, le dossier. Une **erreur de saisie s'annule** avec son motif
(le paiement reste visible, barré) ; un **chèque impayé se rejette**, daté et
motivé. Dans les deux cas, ses affectations passent `LIBEREE` : ce qu'il
réglait redevient dû.

### Les étapes suivent l'argent

- **« Signé » exige l'acompte** : la fenêtre de signature propose l'acompte
  pré-rempli (pourcentage du devis choisi), à confirmer d'un moyen de
  paiement ; l'éviter demande de choisir pourquoi (paiement à la facture,
  sous-traitance, petit montant…), motif écrit dans l'événement. Enregistrer
  l'acompte est plus rapide que s'en passer.
- **« Encaissé » est un fait** : un dossier « Facturé » dont toutes les
  factures sont réglées y passe tout seul ; la fenêtre « Encaissé » propose le
  paiement du solde, pré-rempli au reste dû, et refuse (sans rien écrire) s'il
  ne solde pas.
- **Chèque rejeté ou paiement annulé** : un dossier « Encaissé » dont une
  facture n'est plus réglée revient à « Facturé » ; un acompte rejeté devient la
  prochaine action (« réclamer un nouveau paiement »).
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
- **Contre-passation, jamais de rature** : un encaissement déjà compté puis
  annulé ou rejeté garde sa ligne et reçoit une ligne négative à la date de
  l'annulation ou du rejet. Une période passée, peut-être déjà déclarée, n'est
  jamais réécrite : la correction tombe dans la période où elle a lieu. C'est
  la pratique comptable ; le prix est un couple +X / −X visible pour une coquille
  corrigée le jour même.
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
envoyé sans validation ». Elle ne fait plus que **proposer** les relances dues ;
la même proposition tourne en tâche de fond toutes les six heures.

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
- Dossier à l'étape « Devis envoyé » ou « Relance », devis en vigueur, adresse
  connue ; deux relances par devis au plus (la seconde, « une dernière fois »,
  un délai après la première).
- Client qui a refusé ou retiré son accord pour les mails : pas de relance par
  mail (compté, à relancer autrement).
- Une relance ne se propose qu'une fois par rang (même rejetée) ; une
  proposition non traitée expire au bout de quatorze jours, et devient sans
  objet si le dossier a changé d'étape entre-temps.

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
  source) et activité de la période (devis émis, signatures, factures, avoirs,
  pertes) ; délais médians entre étapes ; écart moyen entre premier devis et
  devis signé ; pertes par motif, par étape, concurrents et leur écart de prix.
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
réponse (au-delà de deux fois le délai de relance), factures impayées depuis
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
  `gmail.send`.
- **Jeton de renouvellement chiffré** (AES-256-GCM) avec `GOOGLE_TOKEN_KEY`,
  clé hors base : une copie de la base (ou du journal) ne donne pas accès au
  compte. Les jetons d'accès restent en mémoire.
- Déconnexion : révocation chez Google ; la ligne reste, datée. Accès révoqué
  côté Google : les tâches s'arrêtent en le disant, la connexion affiche
  « reconnecter ».

**À faire une fois (Lucas)** : dans Google Cloud Console, créer un projet,
activer les API Drive et Gmail, configurer l'écran de consentement (type
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

- **Relevé** toutes les 5 minutes (tâche de fond) des mails reçus et envoyés de
  la boîte connectée : depuis le dernier message connu moins un jour ; au
  premier passage, depuis la semaine qui précède la connexion. Spam, corbeille
  et brouillons sont ignorés. Rejouable sans doublon (identifiant Gmail unique).
- **Stockage** : `Message` (qui, quand, statut du tri, client, dossier ;
  journalisé), `ContenuMessage` (texte brut — le HTML n'est jamais affiché —,
  en-têtes utiles au tri et aux réponses ; écrit une fois, immuable),
  `PieceMessage` (description des pièces jointes).
- **Analyse** (tâche `ANALYSE_MESSAGE`, acteur `AGENT:mail`) : les règles sûres
  (`regles.ts`, fonction pure, testée), la conservation des pièces jointes,
  puis la lecture par l'IA si elle est active. Chaque analyse est gardée
  (`AnalyseMessage`, immuable) avec son raisonnement.

### Ce que l'agent fait seul — et seulement cela

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
- La file **« À trier »** (`/messages`) garde ce qui n'est pas rangé. Chaque
  mail s'y trie en un geste : ranger chez un client (recherche pré-remplie avec
  le nom de l'expéditeur), nouvelle demande (formulaire pré-rempli par l'agent
  ou, à défaut, par le mail : nom, téléphone, code postal), bruit, hors
  clients, répondre, relire avec l'IA.
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
numéro normalisé) puis appelle `enregistrerMessageRecu` et met en file
`ANALYSE_MESSAGE` ; dans les règles, le numéro exact remplace l'adresse
(`trouverClientParCoordonnees` sait déjà le faire) ; l'archivage dans la boîte
est sans objet ; l'envoi passerait par une proposition `ENVOI_WHATSAPP`
sensible (fenêtre de 24 h et modèles de message imposés par Meta). Non
construit : il faut d'abord un compte WhatsApp Business vérifié par Meta.

### Réglages et interrupteurs

- Paramètres → Connexions : état de l'agent (dernier relevé, mails à trier) et
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
