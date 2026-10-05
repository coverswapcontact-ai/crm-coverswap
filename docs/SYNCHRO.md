# Dossier et espace client toujours synchronisés (mission 18, partie B)

Ce document est la matrice « événement → effets » du dossier. Chaque lot de la partie B la tient à jour : quand un
geste passe par le point d'entrée, sa ligne quitte le tableau 4 (« pas encore branché ») pour le tableau 3.

## 1. Le principe

Tout ce qui arrive à un dossier (geste du client dans son espace, geste de Lucas, fait automatique) passe par **un seul
point d'entrée** : `src/lib/dossiers/synchro.ts`.

**Dans la transaction de l'appelant**, après les écritures propres au geste (photo, choix, document, accord…),
`appliquerEvenementDossier(tx, dossierId, evenement)` met à jour :
- l'étape (à venir, lot par lot : aujourd'hui les gestes l'écrivent encore eux-mêmes, voir le tableau 3) ;
- la prochaine action prévue par la matrice (`prochaineActionDe`) ;
- la main, recalculée et écrite en dernier (`main.ts › ecrireMain`), pour lire tout ce que la transaction a écrit ;
- l'état de l'espace : il n'est jamais stocké, `espace/etapes.ts › etapeEspace` le calcule à chaque lecture d'après
  les faits du dossier (le site ne fait qu'afficher ce que le CRM calcule) ;
- les relances : elles ne sont pas stockées non plus, `relances/service.ts` les recalcule (étape, devis visible,
  date de référence) ;
- les tâches explicites (une tâche « à moi » écrite dans la transaction, voir § 2) ; les autres tâches restent
  dérivées des faits par les détecteurs (passe 3 s après le signal) ;
- l'historique (`DossierEvenement`) et le statut du lead (avec l'étape).

**Après la transaction**, `suitesEvenementDossier(suites)` lance les effets externes existants, jamais bloquants :
effets des changements d'étape (conversion Meta, « projet terminé », agenda), l'agenda si la prochaine action a changé,
le signal des tâches. Les notifications au client restent celles des automatismes existants, avec leurs interrupteurs :
**aucun nouvel envoi**.

`evenementDossier(dossierId, evenement)` enchaîne les deux pour un événement seul (sa propre transaction,
`maxWait` 10 s, `timeout` 30 s).

SQLite n'a qu'un écrivain : dans la transaction, rien ne passe par le client Prisma global (`tx` partout) ; le signal
des tâches, l'agenda, les alertes et les mails partent toujours après.

## 2. La prochaine action posée à la main n'est jamais écrasée

`src/lib/dossiers/prochaine-action-auto.ts › ecrireProchaineActionAuto(tx, dossierId, voulu)`.

- Une action est « posée à la main » quand Lucas ou Claude l'ont écrite (`prochaine-action-manuelle.ts` : trio
  `prochaineActionManuelleLe / Manuelle / Par`) et que le texte du dossier est toujours celui-là.
- Un événement automatique ne la remplace pas, ne l'efface pas : il range à la place une tâche à moi (type MANUELLE,
  source MANUELLE, niveau 2 par défaut, 1 pour l'argent, 3 pour la production), de clé stable
  `MANUELLE:synchro:<dossierId>:<code>`, titre « ‹ ce que l'événement aurait écrit › · ‹ client › », raison
  « ta prochaine action « … » est gardée ».
- Un événement rejoué ne crée jamais de seconde tâche (même clé). Une tâche déjà répondue (Fait, Pas à faire) revient
  à faire au geste suivant : c'est un nouveau besoin. Une tâche « Plus tard » garde son report ; une tâche archivée
  n'est plus touchée. Une tâche MANUELLE n'est jamais cochée par absence (moteur des tâches).
- Rien n'est rangé quand l'événement voudrait effacer l'action ou écrire le texte qu'elle porte déjà, ni quand sa
  condition n'est pas remplie (par exemple « si vide ou « attendre les photos » »).
- Sans action posée à la main, le texte est écrit comme avant (mêmes libellés, mêmes conditions : des expressions
  régulières les relisent, dont le contrôle `PROCHAINE_ACTION_PERIMEE` et les migrations 13 et 14).

La vigueur d'une action manuelle (`a-faire/vigueur.ts`) tombe toujours au premier geste du client ; le texte, lui,
reste sur le dossier jusqu'à ce que Lucas le change.

## 3. Les événements du point d'entrée

Colonnes : **Étape** (du dossier), **Main** (motif écrit), **Prochaine action** (texte, condition ; code de la tâche
rangée si une action manuelle est en place), **Espace** (étape de l'espace du client, calculée), **Relances**,
**Tâches** (explicites, puis dérivées), **Historique**, **Lead** (statut), **Externe** (effets après la transaction).
« Après » = écrit hors de la transaction de l'événement, par la fonction d'origine (à rapatrier par le lot indiqué).

| Événement | Fonction d'origine | Étape | Main | Prochaine action | Espace | Relances | Tâches | Historique | Lead | Externe |
|---|---|---|---|---|---|---|---|---|---|---|
| `PHOTOS_RECUES` | `espace/service.ts › deposerPhotos` | inchangée | MOI « Photos reçues dans son espace » | « Préparer la simulation (photos reçues) », si vide ou « attendre les photos » ; tâche `photos` | PHOTOS → PROJET ou SIMULATIONS | la relance photos n'est plus proposable | `photos` si gardée ; puis détecteurs | `ESPACE_PHOTOS` (un par dépôt de 15 min) | inchangé | alerte Lucas (file, 2 min) ; agenda |
| `PROJET_VALIDE` | `espace/validations.ts › validerProjet` | Q → S après (`deplacerDossier`, B9) | MOI « Projet validé par le client » (geste du client) | « Suivre ses simulations, ou lui en préparer une (projet validé) », si vide ou « attendre (les photos, qu'il, le projet) » ; tâche `projet-valide` | PROJET → SIMULATIONS | — | `projet-valide` si gardée | `ESPACE_PROJET_VALIDE` ; objet et source du dossier complétés | CONTACTE (par le changement d'étape) | alerte Lucas (client) ; agenda |
| `PROJET_DEVALIDE` | `validations.ts › devaliderProjet` | S → Q après, si la validation l'y avait mis et sans choix | CLIENT « Il modifie son projet » (geste du client) | « Attendre qu'il valide son projet (il le modifie) », si le texte contient « (projet validé) » | → PROJET | — | `projet-devalide` si gardée | `ESPACE_PROJET_DEVALIDE` | inchangé | agenda |
| `CHOIX_VALIDE` | `espace/service.ts › choisir` | inchangée (Q → S : B9) | MOI « Simulation validée : faire le devis » (client) | « Préparer le devis (simulation choisie) », toujours ; tâche `choix` | → ATTENTE_DEVIS | — | `choix` si gardée ; détecteur DEVIS | `ESPACE_SIMULATION_CHOISIE` | inchangé | alerte Lucas (client) ; agenda. Teintes non reportées dans `Dossier.teintes` (B11) |
| `CHOIX_DEVALIDE` | `validations.ts › devaliderChoix` | inchangée | CLIENT (geste du client) | « Attendre qu'il valide une simulation (il a dévalidé la sienne) », si « préparer le devis (simulation » | ATTENTE_DEVIS → SIMULATIONS | — | `choix-devalide` si gardée | `ESPACE_SIMULATION_DEVALIDEE` | inchangé | alerte Lucas (client) ; agenda |
| `PROPOSITION_DEMANDEE` | `service.ts › demanderProposition` | inchangée | MOI « Il demande une autre proposition » | « Préparer une autre proposition — « son mot » », toujours ; tâche `proposition` | inchangée | — | `proposition` si gardée ; message d'espace (détecteur des messages) | `ESPACE_NOUVELLE_PROPOSITION` ; `MessageEspace` | inchangé | alerte Lucas ; agenda |
| `PROPOSITION_RETIREE` | `validations.ts › retirerDemandeProposition` | inchangée | CLIENT (geste du client) | si « autre proposition » : « Préparer le devis (simulation choisie) » si une simulation reste validée, sinon effacée | inchangée | — | `proposition-retiree` si gardée | `ESPACE_PROPOSITION_RETIREE` | inchangé | agenda |
| `DEVIS_ACCEPTE` | `service.ts › accepterDevis` | → SIGNE avant, dans une 2e transaction (`changerEtape`, B8) ; devis ACCEPTE, autres NON_RETENU | MOI « Il a choisi le devis … : fixer la date du chantier » | « Appeler le client : fixer la date du chantier, suivre l'acompte », toujours ; tâche `accord` (niveau 1) | → ACOMPTE | arrêtées (étape SIGNE) | `accord` si gardée ; DATE_CHANTIER, ENCAISSER | `ESPACE_DEVIS_ACCEPTE`, `CHANGEMENT_ETAPE` ; `AccordDevis` | SIGNE (transaction de l'étape) | Meta SIGNE ; alerte « DEVIS SIGNÉ » ; agenda |
| `ACCORD_RETIRE` | `validations.ts › retirerAccord` | SIGNE → DEVIS_ENVOYE après (`deplacerDossier`) ; NON_RETENU → ENVOYE | MOI « Il a retiré son bon pour accord : l'appeler » (client) | « Appeler : il a retiré son bon pour accord » (client) ou « Refaire signer le devis » (Lucas), toujours ; tâche `accord-retire` (niveau 1) | ACOMPTE → DEVIS | reprennent (calculées) | `accord-retire` si gardée | `ESPACE_ACCORD_RETIRE` | DEVIS_ENVOYE (effets du changement) | alerte forte (client) ; agenda |
| `SIMULATION_PUBLIEE` | `simulations/dossier.ts › publierSimulations` | Q → S après (`changerEtape`) | CLIENT « Simulation publiée : en attente de son retour » | « Attendre le retour du client sur la simulation », toujours ; tâche `simulation-publiee` (niveau 3) | → SIMULATIONS | — | `simulation-publiee` si gardée | `ESPACE_SIMULATION_DEPOSEE` | CONTACTE (changement d'étape) | mail SIMULATION_PUBLIEE (une fois par publication) ; SMS SIMULATION_PRETE si demandé ; agenda |
| `DEVIS_GENERE` (`envoye: true`) | `dossiers/documents.ts › emettre` (B1 : annoncé — mail DEVIS_DISPONIBLE programmable, ou interrupteur coupé et espace ouvert ; ou variante silencieuse dans un espace ouvert après Simulation) | Q, S, RELANCE → DEVIS_ENVOYE dans la transaction ; CHANTIER → FACTURE pour une facture | CLIENT « Devis envoyé : en attente de sa réponse » | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; tâche `devis` (niveau 3) | → DEVIS | depuis max(émission, création) (B5 : depuis la mise en ligne) | `devis` si gardée ; RELANCER_DEVIS ensuite | `DEVIS_GENERE` (`envoye: true`, `visibleEspace`), `CHANGEMENT_ETAPE` | DEVIS_ENVOYE (effets du changement) | mail DEVIS_DISPONIBLE (si le modèle est actif) ; Meta DEVIS_ENVOYE |
| `DEVIS_GENERE` (`envoye: false`) | `documents.ts › emettre` (B1 : `notifier: false`, ou ni adresse ni espace ouvert pour l'annoncer) | inchangée ; devis MASQUÉ en Q et S (visible ensuite, sans annonce) | MOI « Devis prêt, pas encore envoyé (n°) : à lui envoyer », tant qu'il est « Généré » et pas mis en ligne | « Envoyer le devis au client », si « Préparer le devis… » ; action posée à la main gardée SANS tâche à la place (ENVOYER_DEVIS la remplace) | inchangée (le devis masqué n'y est pas) | aucune (étape inchangée, devis masqué) | ENVOYER_DEVIS « Envoyer le devis · X » (niveau 2, jamais écartée par une action manuelle ; cochée quand le devis est mis en ligne, envoyé par mail, accepté, annulé ou remplacé) | `DEVIS_GENERE` (`envoye: false`) | inchangé | aucun envoi ; /commercial : groupe DEVIS « Devis prêt, pas encore envoyé » |
| `DEVIS_DEPOSE` | `documents-existants.ts › rattacherDocumentExistant` | Q, S, RELANCE → DEVIS_ENVOYE si visible, émis ou envoyé ; un dépôt « accepté » ne signe pas (B4) | CLIENT (dépôt avant signature) | comme `DEVIS_GENERE` envoyé (« Attendre l'accord… ») ; tâche `devis` | → DEVIS | depuis le dépôt | `devis` si gardée | `DOCUMENT_REPRIS` | DEVIS_ENVOYE (effets du changement) | Meta DEVIS_ENVOYE ; aucune notification au client |
| `DEVIS_ENVOYE` (`canal: "MAIL"`) | `mail/propositions.ts` (exécution de la proposition ENVOI_MAIL, motif ENVOI_DEVIS : bouton « Envoyer par mail » du dossier, `mail/service.ts › envoyerDocumentParMail`, outil `envoyer_document`) — B2 | Q, S, RELANCE → DEVIS_ENVOYE dans la transaction de l'envoi (`passerEnDevisEnvoye`) | CLIENT « Devis envoyé : en attente de sa réponse » (l'événement `DEVIS_ENVOYE`, écrit après `MAIL_ENVOYE`) | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; tâche `devis` (niveau 3) | → DEVIS (le devis devient visible) | depuis l'envoi : la référence est la plus tardive de l'émission, du dépôt et du dernier `DEVIS_ENVOYE` du devis | ENVOYER_DEVIS cochée (« envoyé par mail ») ; RELANCER_DEVIS ensuite | `MAIL_ENVOYE` (trace de l'envoi, avant tout), `DEVIS_ENVOYE` (`documentId`, `canal`, `propositionId`), `CHANGEMENT_ETAPE` ; devis « Envoyé », `visibleEspace` | DEVIS_ENVOYE (effets du changement) | le mail lui-même (proposition validée par Lucas, file d'envoi) : il vaut l'annonce, pas de « Devis disponible » en plus ; Meta DEVIS_ENVOYE ; agenda |
| `DEVIS_ENVOYE` (`canal: "GMAIL"`) | `devis-gmail.ts › enregistrerDevisGmail`, appelé par `depot-document.ts › deposerDocument` quand la source est la pièce d'un mail SORTANT parti de Gmail (modale « Enregistrer comme devis envoyé » : `/api/dossiers/[id]/devis-gmail` ; outil `ajouter_fichier` piece_mail) — B3 | Q, S, RELANCE → DEVIS_ENVOYE dans la même transaction que le dépôt (`passerEnDevisEnvoye`) | CLIENT « Devis envoyé : en attente de sa réponse » | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; tâche `devis` (niveau 3) | → DEVIS (devis déposé visible, ou devis du CRM rendu visible) | depuis le MAIL (`envoyeLe` de l'événement), pas depuis le dépôt (`relances/service.ts › envoiDuDevis`) | ENREGISTRER_DEVIS cochée (« enregistré comme envoyé depuis Gmail ») ; ENVOYER_DEVIS cochée (devis du CRM) ; RELANCER_DEVIS ensuite | `DOCUMENT_REPRIS` (dépôt, PDF du mail) ou devis du CRM « Envoyé » ; `DEVIS_ENVOYE` (`documentId`, `canal`, `messageId`, `pieceId`, `envoyeLe`), `CHANGEMENT_ETAPE` | DEVIS_ENVOYE (effets du changement) | aucun mail (le client a déjà le devis) ; Meta DEVIS_ENVOYE ; agenda |
| `ACOMPTE_REJETE` | `encaissements/service.ts › rejeterEncaissement` (`terminerEncaissement`) | SIGNE → DEVIS_ENVOYE s'il ne reste aucun paiement ; ENCAISSE → FACTURE | selon l'étape | « Chèque d'acompte rejeté : réclamer un nouveau paiement » (aujourd'hui), si l'acompte d'un devis est rejeté ; tâche `acompte-rejete` (niveau 1) | ACOMPTE si signé | — | `acompte-rejete` si gardée ; ENCAISSER | `ENCAISSEMENT_REJETE` | suit l'étape | agenda |

Les changements d'étape demandés (écran, assistant `changer_etape`, propositions, paiement à la signature :
`transitions.ts › changerEtapeDansTransaction`) écrivent **la main et le statut du lead dans leur transaction** ;
leurs effets d'après (`effetsDuChangementEtape`) ne gardent que l'agenda, « projet terminé », Meta et le signal des
tâches. Les changements écrits par `appliquerChangementEtape` seul (génération, dépôt, relance, paiements, retours
de l'espace, cohérence) gardent le recalcul de la main et du lead après la transaction, en attendant leur lot.

**Un seul mail par envoi (B2).** L'envoi d'un document par mail est une proposition ENVOI_MAIL validée une fois
(`envoyerDocumentParMail`, aussi pour l'outil `envoyer_document`, qui ne revalide plus) et de clé
`envoi-document:<document>:<empreinte du destinataire, de l'objet et du texte>` : le même envoi refait (double clic,
outil relancé) rend la proposition déjà décidée, sans effet ; écarté (rejeté, annulé, expiré) ou parti depuis plus de
30 minutes, il peut être refait (l'ancienne garde sa trace sous une clé close). L'exécution relit la pertinence
(`executerPropositionValidee`) : un devis annulé ou remplacé entre la validation et l'envoi ne part pas (proposition
ANNULEE). Une tâche rejouée après l'envoi ne renvoie rien (trace `MAIL_ENVOYE`). Les autres mails du CRM (facture,
relance, réponse) recalculent la main après l'envoi.

## 4. Pas encore branchés (écarts de la partie B)

| Geste | Fonction d'origine | Aujourd'hui | Lot |
|---|---|---|---|
| Dépôt d'un devis avec son PDF | `depot-document.ts › deposerDocument` | étape changée avant la vérification du PDF ; « accepté » ne signe pas | B4 |
| Devis rendu visible | `presentation-devis.ts › modifierPresentationDevis`, `devis-envoye.ts › devisRenduVisible` | étape et main, sans notification ni date de mise en ligne | B5 |
| Devis annulé ou masqué | `documents.ts › annulerDevis`, `presentation-devis.ts` | la main seule ; ni retour d'étape ni « Refaire le devis » | B6 |
| Avenant sur un dossier signé | `espace/service.ts › accepterDevis`, `EtatEspace` | l'espace ne montre que l'accepté | B7 |
| Signature | `service.ts › accepterDevis` | accord, puis étape dans une 2e transaction, puis prochaine action | B8 |
| Publier ou retirer depuis le bloc Espace | `simulations/dossier.ts › changerStatutSimulation` | ni Q → S, ni prochaine action, ni agenda | B9 |
| Paiement par carte | `/paiement-carte` (à créer) | absent | B10 |
| Consultations de devis, teintes | `service.ts › noterConsultationDevis`, `choisir` | deux sources | B11 |
| Statut du lead | `statut-lead.ts`, `coherence/controle.ts` | deux tables divergentes, le dernier dossier changé décide | B12 |
| Cohérence | `coherence/controle.ts` | pas de règle pour les écarts 1, 3, 5, 6, 7 | B13 |

**Devis envoyé depuis Gmail (B3).** Un mail SORTANT parti de la boîte (pas par le CRM), non automatique, rangé dans le
dossier d'un client (`mail/rattachement.ts › suitesDuTri`) met ses PDF en file (`MAIL_PDF_SORTANTS` :
`conserverPieces(…, { seulementPdf: true })`, l'agent mail doit être actif). Le détecteur des dossiers
(`devis-gmail.ts › devisGmailNonEnregistres`) propose « Enregistrer comme devis envoyé · X » pour chaque PDF conservé
de moins de 30 jours dont le nom évoque un devis, sur un dossier vivant, qui n'est ni un envoi du CRM (identifiant
« crm: », `EnvoiMail` ou `MAIL_ENVOYE` de proposition de même objet et même destinataire), ni déjà dans le CRM (devis de
ce numéro déjà envoyé, devis déposé depuis cette pièce, ou — sans numéro lisible — devis entré après le mail). Le
geste : la modale de dépôt préremplie (numéro lu dans le nom, date du mail, montant du registre s'il y est). Un devis
du CRM de ce numéro, généré mais pas encore envoyé, passe « Envoyé » au lieu d'être déposé une seconde fois.

## 5. Ce qui ne passe pas par le point d'entrée

- **Les gestes de Lucas qui posent eux-mêmes la prochaine action** : appel noté (`commercial/appels.ts`), rappel
  (`agenda/rappels.ts`), « Planifier » (`agenda/planification.ts`), modification du dossier (`dossiers.ts ›
  modifierDossier`, assistant compris). Ce sont des actions posées à la main (`noterProchaineActionManuelle`).
- La reprise d'un dossier entier (`reprise.ts`), datée du passé (nature REPRISE, sans Meta).
- Les corrections du contrôle de cohérence (`coherence/controle.ts`), en attendant B13.

## 6. Tester des deux côtés

`src/test/etat-dossier.ts › etatDesDeuxCotes(dossierId, { maintenant?, taches? })` rend, pour un dossier :
étape ; main écrite et main calculée (elles doivent être égales) ; prochaine action et action manuelle en place ;
statut du lead ; étape de l'espace (la lecture du site) ; relances proposables (« DEVIS n° rang », « PHOTOS », « AVIS »)
et relances de devis à venir avec leur date ; tâches ouvertes du dossier après une passe de réconciliation complète.
Chaque écart corrigé a son essai : le déclencheur, puis cet état comparé à l'attendu. Premier usage :
`src/lib/dossiers/synchro.test.ts`, qui vérifie aussi que chaque événement de `TYPES_EVENEMENT_DOSSIER` a sa ligne ici.
