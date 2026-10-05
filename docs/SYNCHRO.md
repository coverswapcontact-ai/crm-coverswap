# Dossier et espace client toujours synchronisés (mission 18, partie B)

Ce document est la matrice « événement → effets » du dossier. Chaque lot de la partie B la tient à jour : quand un
geste passe par le point d'entrée, sa ligne quitte le tableau 4 (« pas encore branché ») pour le tableau 3.

## 1. Le principe

Tout ce qui arrive à un dossier (geste du client dans son espace, geste de Lucas, fait automatique) passe par **un seul
point d'entrée** : `src/lib/dossiers/synchro.ts`.

**Dans la transaction de l'appelant**, après les écritures propres au geste (photo, choix, document, accord…),
`appliquerEvenementDossier(tx, dossierId, evenement)` met à jour :
- l'étape (lot par lot : Qualification → Simulation par le point d'entrée lui-même depuis B9, les autres passages par
  le geste dans la même transaction ou encore après, voir le tableau 3) ;
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
  condition n'est pas remplie (par exemple « si vide ou « attendre les photos » »), ni quand ce qu'il écrirait est une
  attente du client (« Attendre le retour du client sur la simulation », « Attendre l'accord du client sur le devis » :
  rien à faire de mon côté, `tache: false`, relecture) ou un besoin qui a déjà sa tâche dérivée (ENVOYER_DEVIS).
- **Un rappel daté est gardé pareil** (relecture) : un « Rappeler… » posé par un appel noté (« à rappeler », « pas de
  réponse »), un rappel repris du lead ou une demande de rappel, daté d'aujourd'hui ou plus tard
  (`prochaine-action-auto.ts › estRappelAVenir`), n'est pas écrasé : une tâche est rangée à la place (raison « ton rappel
  « Rappeler » du jj/mm est gardé »), le rappel reste dans l'agenda. Passé d'un jour, ou sans date, il ne tient plus.
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
| `PROJET_VALIDE` | `espace/validations.ts › validerProjet` | Q → S dans la transaction, par le point d'entrée (AUTOMATIQUE, raison « projet validé dans l'espace client », relue par `devaliderProjet` pour défaire) — B9 | MOI « Projet validé par le client » (geste du client) | « Suivre ses simulations, ou lui en préparer une (projet validé) », si vide ou « attendre (les photos, qu'il, le projet) » ; tâche `projet-valide` | PROJET → SIMULATIONS | — | `projet-valide` si gardée | `ESPACE_PROJET_VALIDE`, `CHANGEMENT_ETAPE` ; objet et source du dossier complétés | CONTACTE (dans la transaction du passage) | alerte Lucas (client) ; agenda |
| `PROJET_DEVALIDE` | `validations.ts › devaliderProjet` | S → Q après, si la validation l'y avait mis et sans choix | CLIENT « Il modifie son projet » (geste du client) | « Attendre qu'il valide son projet (il le modifie) », si le texte contient « (projet validé) » | → PROJET | — | `projet-devalide` si gardée | `ESPACE_PROJET_DEVALIDE` | inchangé | agenda |
| `CHOIX_VALIDE` | `espace/service.ts › choisir` | Q → S dans la transaction, par le point d'entrée (raison « simulation validée dans l'espace client ») — B9 ; ailleurs inchangée | MOI « Simulation validée : faire le devis » (client) | « Préparer le devis (simulation choisie) », toujours ; tâche `choix` | → ATTENTE_DEVIS | — | `choix` si gardée ; détecteur DEVIS | `ESPACE_SIMULATION_CHOISIE` (+ `CHANGEMENT_ETAPE` depuis Q) | CONTACTE depuis Q (dans la transaction) | alerte Lucas (client) ; agenda. Teintes du choix reportées dans `Dossier.teintes` dans la transaction (B11) |
| `CHOIX_DEVALIDE` | `validations.ts › devaliderChoix` ; B9 : aussi Lucas qui masque, repasse en brouillon ou retire une simulation du choix (la validée, ou celle d'une zone d'un mélange : `validations.ts › simulationDansLeChoix`), d'un bloc avec le geste (`devaliderChoixDansTransaction`) — bloc Espace et outil `publier` (`simulations/dossier.ts › changerStatutSimulation`), outil `modifier` SIMULATION, ancien retrait (`espace/service.ts › retirerSimulation`) | inchangée | CLIENT (geste du client) | « Attendre qu'il valide une simulation (il a dévalidé la sienne) », si « préparer le devis (simulation » | ATTENTE_DEVIS → SIMULATIONS | — | `choix-devalide` si gardée | `ESPACE_SIMULATION_DEVALIDEE` (B9 : « Simulation dévalidée par Lucas, … (simulation masquée : titre) ») | inchangé | alerte Lucas (client) ; agenda |
| `PROPOSITION_DEMANDEE` | `service.ts › demanderProposition` | inchangée | MOI « Il demande une autre proposition » | « Préparer une autre proposition — « son mot » », toujours ; tâche `proposition` | inchangée | — | `proposition` si gardée ; message d'espace (détecteur des messages) | `ESPACE_NOUVELLE_PROPOSITION` ; `MessageEspace` | inchangé | alerte Lucas ; agenda |
| `PROPOSITION_RETIREE` | `validations.ts › retirerDemandeProposition` | inchangée | CLIENT (geste du client) | si « autre proposition » : « Préparer le devis (simulation choisie) » si une simulation reste validée, sinon effacée | inchangée | — | `proposition-retiree` si gardée | `ESPACE_PROPOSITION_RETIREE` | inchangé | agenda |
| `DEVIS_ACCEPTE` | `service.ts › accepterDevis` (bon pour accord dans l'espace) ; B4 : devis noté « accepté » par Lucas qui signe le dossier — `documents-existants.ts` (déposé « accepté » : modale, `ajouter_fichier` ; devis repris corrigé en « accepté » : écran, `modifier` DOCUMENT) et la correction de cohérence `DEVIS_ACCEPTE_AVANT_SIGNE`, par `devis-signe.ts › signerParDevisAccepte` | espace : → SIGNE avant, dans une 2e transaction (`changerEtape`, B8) ; devis ACCEPTE, autres NON_RETENU. B4 : Q, S, DEVIS_ENVOYE, RELANCE → SIGNE dans la transaction du geste (`changerEtapeDansTransaction`, bon pour accord déclaré), les autres devis émis ou envoyés NON_RETENU (`retenirDevis`) ; relecture : EN PAUSE depuis une de ces étapes aussi (sortie de pause) ; perdu, déjà signé ou en pause après la signature : rien | espace : MOI « Il a choisi le devis … : fixer la date du chantier » ; B4 : CLIENT « Étape « Signé » » (l'acompte est attendu de lui) | « Appeler le client : fixer la date du chantier, suivre l'acompte », toujours ; tâche `accord` (niveau 1) | → ACOMPTE | arrêtées (étape SIGNE) | `accord` si gardée ; DATE_CHANTIER, ENCAISSER ; ENVOYER_DEVIS cochée (devis non retenu) | `ESPACE_DEVIS_ACCEPTE`, `CHANGEMENT_ETAPE` ; `AccordDevis`. B4 : `DOCUMENT_REPRIS` « …, accepté (signé hors ligne) » (ou `COHERENCE_CORRIGEE`), `CHANGEMENT_ETAPE` (raison : le devis, les non retenus) | SIGNE (transaction de l'étape) | Meta SIGNE ; alerte « DEVIS SIGNÉ » (espace seulement) ; agenda |
| `ACCORD_RETIRE` | `validations.ts › retirerAccord` | SIGNE → DEVIS_ENVOYE après (`deplacerDossier`) ; NON_RETENU → ENVOYE | MOI « Il a retiré son bon pour accord : l'appeler » (client) | « Appeler : il a retiré son bon pour accord » (client) ou « Refaire signer le devis » (Lucas), toujours ; tâche `accord-retire` (niveau 1) | ACOMPTE → DEVIS | reprennent (calculées) | `accord-retire` si gardée | `ESPACE_ACCORD_RETIRE` | DEVIS_ENVOYE (effets du changement) | alerte forte (client) ; agenda |
| `SIMULATION_PUBLIEE` | `simulations/dossier.ts › publierSimulations` (bouton « Publier », outil `publier`) ; B9 : « Publier » ou « Republier » une simulation du bloc Espace (`changerStatutSimulation(…, "afficher")`, PATCH `…/simulations/[sid]`, outil `publier` `reafficher`), même fonction (`publierDansLEspace`) | Q → S dans la transaction, par le point d'entrée (raison « simulation(s) publiée(s) dans son espace ») — B9 | CLIENT « Simulation publiée : en attente de son retour » | « Attendre le retour du client sur la simulation », toujours ; action posée à la main gardée sans tâche (une attente du client) | → SIMULATIONS | — | aucune rangée | `ESPACE_SIMULATION_DEPOSEE` (« republiée » pour une simulation masquée remise), `CHANGEMENT_ETAPE` depuis Q | CONTACTE (dans la transaction du passage) | mail SIMULATION_PUBLIEE (automatisme existant, une fois par publication : même clé qu'avant, jamais deux mails pour la même simulation) ; SMS SIMULATION_PRETE seulement par le bouton « Publier », si demandé ; agenda |
| `SIMULATION_DU_CLIENT` | B9 : `simulateur/preparation.ts › publierSimulationDuClient` (créée par le client dans son espace, `ESPACE` ; pas une simulation gardée en brouillon pour relecture : elle suivra sa publication) ; `simulations/dossier.ts › synchroniserSimulationsSite` (faite sur coverswap.fr et rangée dans son espace, `SITE` : lecture de l'espace, liste du dossier, ouverture de l'espace, rangement du lead) | Q → S dans la transaction, par le point d'entrée (raison « simulation créée par le client dans son espace » ou « simulation faite sur coverswap.fr, rangée dans son espace ») ; ailleurs inchangée | `ESPACE` : CLIENT « Il a créé une simulation : à lui d'en valider une » ; `SITE` : l'étape (le CHANGEMENT_ETAPE n'est pas un geste) | aucune (comme avant) | → SIMULATIONS (sa simulation est dans sa galerie) | — | détecteurs | `ESPACE_SIMULATION_CLIENT` (`ESPACE`) ; `ESPACE_SIMULATION_SITE` après, par `rangerSimulationsSiteDansLEspace` (`SITE`) ; `CHANGEMENT_ETAPE` depuis Q | CONTACTE (dans la transaction du passage) | alerte Lucas (comme avant) ; agenda |
| `DEVIS_GENERE` (`envoye: true`) | `dossiers/documents.ts › emettre` (B1 : annoncé — `notifier` demandé et `devis-envoye.ts › annonceAboutit` : espace ouvert et adresse valide, ou interrupteur coupé et espace ouvert) | Q, S, RELANCE → DEVIS_ENVOYE dans la transaction ; CHANTIER → FACTURE pour une facture | CLIENT « Devis envoyé : en attente de sa réponse » | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; action posée à la main gardée sans tâche (une attente du client) | → DEVIS | depuis max(émission, création) ; mis en ligne plus tard : depuis la mise en ligne (B5) | RELANCER_DEVIS ensuite | `DEVIS_GENERE` (`envoye: true`, `visibleEspace`), `CHANGEMENT_ETAPE` | DEVIS_ENVOYE dans la transaction (relecture) | mail DEVIS_DISPONIBLE (si le modèle est actif) ; Meta DEVIS_ENVOYE |
| `DEVIS_GENERE` (`envoye: false`) | `documents.ts › emettre` (B1 : `notifier: false`, ou ni adresse ni espace ouvert pour l'annoncer ; relecture : la variante silencieuse aussi, à toute étape — « Devis envoyé » seulement si visible ET notifié, ou envoyé par mail) | inchangée (une variante en Relance ne repasse pas en Devis envoyé) ; devis MASQUÉ en Q et S (visible ensuite, sans annonce) | MOI « Devis prêt, pas encore envoyé (n°) : à lui envoyer », tant qu'il est « Généré » et pas mis en ligne | « Envoyer le devis au client », si « Préparer le devis… » ; action posée à la main gardée SANS tâche à la place (ENVOYER_DEVIS la remplace) | inchangée (le devis masqué n'y est pas) | aucune sur ce devis, même visible : `relances/service.ts › chargerDossiersARelancer` et le SMS (`sms/copie.ts › devisARelancer`) écartent les devis de `devisAEnvoyer` ; la relance reste sur le devis réellement envoyé | ENVOYER_DEVIS « Envoyer le devis · X » (niveau 2, jamais écartée par une action manuelle ; cochée quand le devis est mis en ligne, envoyé par mail, accepté, annulé ou remplacé) | `DEVIS_GENERE` (`envoye: false`) | inchangé | aucun envoi ; /commercial : groupe DEVIS « Devis prêt, pas encore envoyé » |
| `DEVIS_DEPOSE` | `documents-existants.ts › rattacherDocumentExistant` ; B4 : par `depot-document.ts › deposerDocument` (outil `ajouter_fichier`) et `enregistrerDocumentExistant` (modale, le PDF dans la même requête) : PDF vérifié AVANT toute écriture, puis document, PDF et étape d'un bloc | Q, S, RELANCE → DEVIS_ENVOYE dans la transaction du dépôt si visible, émis ou envoyé ; déposé « accepté » sur un dossier pas encore signé : voir `DEVIS_ACCEPTE` (B4) | CLIENT (dépôt avant signature) | comme `DEVIS_GENERE` envoyé (« Attendre l'accord… », sans tâche sous une action posée à la main) ; déposé « accepté » sur un dossier déjà signé, perdu ou en pause après la signature (`accepte`) : aucune | → DEVIS | depuis le dépôt | — | `DOCUMENT_REPRIS` (PDF rattaché) | DEVIS_ENVOYE dans la transaction (relecture) | Meta DEVIS_ENVOYE ; aucune notification au client. Faux PDF ou transaction annulée : rien d'écrit, aucun numéro consommé, le PDF écrit quitte sa place (archives) |
| `DEVIS_ENVOYE` (`canal: "MAIL"`) | `mail/propositions.ts` (exécution de la proposition ENVOI_MAIL, motif ENVOI_DEVIS : bouton « Envoyer par mail » du dossier, `mail/service.ts › envoyerDocumentParMail`, outil `envoyer_document`) — B2 | Q, S, RELANCE → DEVIS_ENVOYE dans la transaction de l'envoi (`passerEnDevisEnvoye`) | CLIENT « Devis envoyé : en attente de sa réponse » (l'événement `DEVIS_ENVOYE`, écrit après `MAIL_ENVOYE`) | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; action posée à la main gardée sans tâche | → DEVIS (le devis devient visible) | depuis l'envoi : la référence est la plus tardive de l'émission, du dépôt et du dernier `DEVIS_ENVOYE` du devis | ENVOYER_DEVIS cochée (« envoyé par mail ») ; RELANCER_DEVIS ensuite | `MAIL_ENVOYE` (trace de l'envoi, avant tout), `DEVIS_ENVOYE` (`documentId`, `canal`, `propositionId`), `CHANGEMENT_ETAPE` ; devis « Envoyé », `visibleEspace` | DEVIS_ENVOYE dans la transaction (`passerEnDevisEnvoye`, relecture) | le mail lui-même (proposition validée par Lucas, file d'envoi) : il vaut l'annonce, pas de « Devis disponible » en plus ; Meta DEVIS_ENVOYE ; agenda |
| `DEVIS_ENVOYE` (`canal: "GMAIL"`) | `devis-gmail.ts › enregistrerDevisGmail`, appelé par `depot-document.ts › deposerDocument` quand la source est la pièce d'un mail SORTANT parti de Gmail (modale « Enregistrer comme devis envoyé » : `/api/dossiers/[id]/devis-gmail` ; outil `ajouter_fichier` piece_mail) — B3 | Q, S, RELANCE → DEVIS_ENVOYE dans la même transaction que le dépôt (`passerEnDevisEnvoye`) | CLIENT « Devis envoyé : en attente de sa réponse » | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; action posée à la main gardée sans tâche | → DEVIS (devis déposé visible, ou devis du CRM rendu visible) | depuis le MAIL (`envoyeLe` de l'événement), pas depuis le dépôt (`relances/service.ts › envoiDuDevis`) | ENREGISTRER_DEVIS cochée (« enregistré comme envoyé depuis Gmail ») ; ENVOYER_DEVIS cochée (devis du CRM) ; RELANCER_DEVIS ensuite | `DOCUMENT_REPRIS` (dépôt, PDF du mail) ou devis du CRM « Envoyé » ; `DEVIS_ENVOYE` (`documentId`, `canal`, `messageId`, `pieceId`, `envoyeLe`), `CHANGEMENT_ETAPE` | DEVIS_ENVOYE dans la transaction (relecture) | aucun mail (le client a déjà le devis) ; Meta DEVIS_ENVOYE ; agenda |
| `DEVIS_ENVOYE` (`canal: "ESPACE"`) | `devis-envoye.ts › mettreEnLigneDevis`, appelé par `presentation-devis.ts › modifierPresentationDevis` (interrupteur « visible dans son espace » du bloc Espace, PATCH `…/documents/[documentId]`, outil `modifier` DOCUMENT `visible_espace`) et par `documents-existants.ts › modifierDocumentExistant` (devis repris corrigé visible) — B5 : un devis masqué, « Généré » ou « Envoyé », rendu visible. Relecture : un devis du CRM qui n'a jamais atteint le client n'est mis en ligne que si l'annonce aboutit (`annonceAboutit`, la règle de la génération) ; sinon `rendreVisibleSansEnvoi` : visible, `NOTE_AJOUTEE` « …, pas encore envoyé (raison) », main relue, ni étape ni relance, ENVOYER_DEVIS reste ouverte, l'écran et l'outil le disent (`nonEnvoye`) | Q, S, RELANCE → DEVIS_ENVOYE dans la même transaction que la visibilité (`passerEnDevisEnvoye`) | CLIENT « Devis envoyé : en attente de sa réponse » | « Attendre l'accord du client sur le devis », si « Préparer le devis… » ou « Envoyer le devis au client » ; action posée à la main gardée sans tâche | → DEVIS | depuis la mise en ligne (le dernier `DEVIS_ENVOYE` du devis) ; « envoyé il y a N jours », « envoyé le » et « adressé le » de la relance le disent (`dateDEnvoiDuDevis`) | ENVOYER_DEVIS cochée (« mis en ligne ») ; RELANCER_DEVIS ensuite | `DEVIS_ENVOYE` « Devis N : visible dans l'espace client » (`documentId`, `presentation`, `canal`), `CHANGEMENT_ETAPE` « devis N rendu visible dans son espace » | DEVIS_ENVOYE dans la transaction (relecture) | mail DEVIS_DISPONIBLE (automatisme existant, une fois par devis : clé `notif:DEVIS_DISPONIBLE:<devis>`, interrupteur gardé) pour un devis du CRM encore « Généré » ; aucun pour un devis repris (fait ailleurs) ou déjà « Envoyé » (mail du CRM, Gmail) ; l'écran et l'outil disent s'il est parti ou pourquoi pas (`annonce`) ; Meta DEVIS_ENVOYE ; agenda |
| `DEVIS_RETIRE` | `devis-retire.ts › retirerDevis`, appelé par `documents.ts › annulerDevis` (« Annuler ce devis », POST `…/annulation`, outil `annuler_document`) et `presentation-devis.ts › modifierPresentationDevis` masqué (interrupteur du bloc Espace, PATCH `…/documents/[documentId]`, outil `modifier` DOCUMENT `visible_espace: false`, annulation de « rendre visible ») et par `documents-existants.ts › modifierDocumentExistant` (devis repris corrigé masqué) — B6 | DEVIS_ENVOYE, RELANCE → l'étape d'avant le devis dans la même transaction (nature RETOUR), s'il ne reste aucun autre devis en attente (visible « Généré », « Envoyé » ou « Non retenu », ni devis accepté) : le `de` du dernier passage en « Devis envoyé » s'il vaut Qualification ou Simulation, sinon Simulation s'il y a une simulation publiée ou choisie, sinon Qualification ; ailleurs, ou avec un autre devis en attente : inchangée | retour : MOI « Devis N annulé (masqué) : refaire le devis » (le CHANGEMENT_ETAPE marqué `devisRetire`) ; sinon relue (le devis retiré n'attend plus de réponse) | retour : « Refaire le devis », toujours (date du jour) ; tâche `devis-a-refaire` si une action posée à la main est en place. Sans retour, devis annulé en Q ou S sans autre devis « Généré » ou « Envoyé » : « Refaire le devis » si vide, « Attendre l'accord… » ou « Envoyer le devis au client » | DEVIS → l'étape d'avant (ATTENTE_DEVIS s'il a choisi, SIMULATIONS, PHOTOS…) ; le devis n'est plus proposé | arrêtées (étape quittée, devis plus visible) ; mails de relance EN_ATTENTE ou en ECHEC annulés (« Devis annulé ou masqué : plus de relance ») : ceux du devis retiré, et au retour ceux de tous les devis du dossier | DEVIS « Refaire le devis · X » (pilotage : groupe DEVIS sur ce motif ; aussi quand un devis annulé existe), cochée par le prochain devis visible ; ENVOYER_DEVIS cochée (devis annulé) ; RELANCER_DEVIS disparaît | `NOTE_AJOUTEE` (annulation, ou « masqué dans l'espace client »), `CHANGEMENT_ETAPE` « Devis envoyé → Simulation : devis N annulé, plus aucun devis n'attend sa réponse (retour en arrière) » | CONTACTE (dans la transaction du retour) | aucun envoi ; pas de Meta (RETOUR) ; agenda ; l'écran et l'outil disent le retour (`avertissements`, `retrait`) |
| `ACOMPTE_REJETE` | `encaissements/service.ts › rejeterEncaissement` (`terminerEncaissement`) | SIGNE → DEVIS_ENVOYE s'il ne reste aucun paiement ; ENCAISSE → FACTURE | selon l'étape | « Chèque d'acompte rejeté : réclamer un nouveau paiement » (aujourd'hui), si l'acompte d'un devis est rejeté ; tâche `acompte-rejete` (niveau 1) | ACOMPTE si signé | — | `acompte-rejete` si gardée ; ENCAISSER | `ENCAISSEMENT_REJETE` | suit l'étape | agenda |
| `PAIEMENT_RECU` | `encaissements/service.ts › enregistrerEncaissement` : paiement saisi (écran « Ajouter un paiement », Finances, outil `saisir_encaissement`) ou payé en ligne (« Payer par carte » de l'espace, webhook Stripe : `paiement/carte.ts › enregistrerPaiementStripe`, moyen CARTE, origine STRIPE, clé `stripe:<session>`) — B10 | dans la transaction du paiement : FACTURE → ENCAISSE si tout est réglé (`suivreSoldeDossier`) ; sinon DEVIS_ENVOYE, RELANCE → SIGNE (un paiement reçu vaut accord, `suivreAcompteDossier`) : le devis que règle l'acompte (imputations du paiement, à défaut celles du dossier, puis le plus récent) passe ACCEPTE, les autres variantes NON_RETENU (`devis-retenu.ts › retenirDevis`), raison « acompte encaissé ; non retenu : … » ; ailleurs inchangée | relue (écrite en dernier) | signé par l'acompte : « Appeler le client : fixer la date du chantier (acompte reçu) », toujours ; tâche `acompte-recu` (niveau 1) si une action posée à la main est en place. Autre paiement : « Chèque d'acompte rejeté : réclamer un nouveau paiement » effacée (le paiement est arrivé), rien d'autre | ACOMPTE → CHANTIER (acompte reçu en entier) ; → TERMINE (encaissé) ; « Mes documents » : la facture « Réglée » ou « Reste X € » d'après les encaissements (`compte.ts › statutFacture`) | arrêtées (étape SIGNE) | `acompte-recu` si gardée ; ENCAISSER (acompte, solde) se ferme quand l'argent est là ; ENVOYER_DEVIS cochée (variante non retenue) | `ENCAISSEMENT_ENREGISTRE`, `CHANGEMENT_ETAPE` | SIGNE ou TERMINE dans la transaction du passage (`ecrireStatutLead`, changement marqué synchronisé) | mail « paiement reçu » (automatisme existant `NOTIF_PAIEMENT_RECU`, une fois par paiement, interrupteur gardé) ; « projet terminé » (Encaissé, une fois) ; Meta SIGNE ou ENCAISSE ; agenda ; Stripe : alerte « Paiement par carte reçu » à Lucas (pas un envoi au client) |
| `CORRECTION_COHERENCE` | B13 : `coherence/controle.ts › appliquerCorrection` (bouton « Corriger » de Paramètres › Système et de Tâches, `agir_systeme` CORRIGER_INCOHERENCE, mise en route) pour `DEVIS_ENVOYE_SANS_DEVIS_ACTIF` (écart 6), `DEVIS_ENVOYE_SANS_ENVOI` (écart 1), `ATTENTE_ACCORD_SANS_DEVIS`, `DATE_CHANTIER_EN_SIGNE` | écarts 1 et 6 : DEVIS_ENVOYE, RELANCE → l'étape d'avant le devis dans la transaction (nature RETOUR, raison « contrôle de cohérence : aucun devis n'attend sa réponse » / « … n'est parti chez le client »), comme B6 (`etapeAvantLeDevis`) ; date du chantier : SIGNE → PLANIFIE (AUTOMATIQUE) ; « Attendre l'accord » : inchangée | écart 6 avec un devis annulé : MOI « Devis N annulé : refaire le devis » (`devisRetire`) ; sinon celle de l'étape (MOI en Q, S, Planifié) | écart 6 : « Refaire le devis », toujours (tâche `devis-a-refaire` sous une action posée à la main) ; écart 1 : « Envoyer le devis au client », toujours (tâche `devis-a-envoyer`) ; « Attendre l'accord… » effacée si c'est elle ; « … fixer la date du chantier … » effacée (rien rangé sous une action posée à la main) | DEVIS → l'étape d'avant (écarts 1 et 6) ; ACOMPTE → CHANTIER (date) | écarts 1 et 6 : arrêtées (étape quittée), mails de relance EN_ATTENTE ou en ECHEC des devis du dossier annulés | `devis-a-refaire` / `devis-a-envoyer` si gardée ; DEVIS « Refaire le devis » ; la tâche « Corriger · X » se coche (« incohérence corrigée ») | `CHANGEMENT_ETAPE`, `COHERENCE_CORRIGEE` (« Contrôle de cohérence : … », avec le code) | CONTACTE (écarts 1, 6) ou CHANTIER_PLANIFIE, dans la transaction (changement marqué synchronisé) | aucun envoi ; pas de Meta (RETOUR ; PLANIFIE n'en a pas) ; agenda |

Les changements d'étape demandés (écran, assistant `changer_etape`, propositions, paiement à la signature :
`transitions.ts › changerEtapeDansTransaction`) écrivent **la main et le statut du lead dans leur transaction** ;
leurs effets d'après (`effetsDuChangementEtape`) ne gardent que l'agenda, « projet terminé », Meta et le signal des
tâches. Les passages en « Devis envoyé » (génération annoncée, mail du CRM, Gmail, dépôt, mise en ligne :
`devis-envoye.ts › passerEnDevisEnvoye` et `documents.ts › emettre`) et les retours du devis retiré (B6) écrivent
aussi le statut du lead dans leur transaction, la main y étant écrite par le point d'entrée : ils sont marqués
synchronisés (`marquerSynchronise`, relecture). De même les passages Qualification → Simulation du point d'entrée (B9). Les autres changements écrits par `appliquerChangementEtape` seul
(facture, relance, paiement annulé ou rejeté, retours de l'espace, cohérence) gardent le recalcul de la main et du lead
après la transaction, en attendant leur lot (B12 pour le lead). Un paiement reçu (B10) écrit le statut du lead dans sa
transaction et marque son changement synchronisé, la main y étant écrite par le point d'entrée (`PAIEMENT_RECU`).

**Un seul mail par envoi (B2).** L'envoi d'un document par mail est une proposition ENVOI_MAIL validée une fois
(`envoyerDocumentParMail`, aussi pour l'outil `envoyer_document`, qui ne revalide plus) et de clé
`envoi-document:<document>:<empreinte du destinataire, de l'objet et du texte>` : le même envoi refait (double clic,
outil relancé) rend la proposition déjà décidée, sans effet ; écarté (rejeté, annulé, expiré) ou parti depuis plus de
30 minutes, il peut être refait (l'ancienne garde sa trace sous une clé close). L'exécution relit la pertinence
(`executerPropositionValidee`) : un devis annulé ou remplacé entre la validation et l'envoi ne part pas (proposition
ANNULEE). Une tâche rejouée après l'envoi ne renvoie rien (trace `MAIL_ENVOYE`) ; relecture : un message déjà parti
(`dejaExecutee` de la définition : trace `MAIL_ENVOYE` de la proposition, SMS de clé `proposition:<id>`) n'est plus
relu au moment d'exécuter — la proposition est notée exécutée, `executer` écrit ce qui manque sans renvoyer, jamais
« sans objet » pour un message que le client a reçu. Les autres mails du CRM (facture,
relance, réponse) recalculent la main après l'envoi.

## 4. Pas encore branchés (écarts de la partie B)

| Geste | Fonction d'origine | Aujourd'hui | Lot |
|---|---|---|---|
| Avenant sur un dossier signé | `espace/service.ts › accepterDevis`, `EtatEspace` | l'espace ne montre que l'accepté | B7 |
| Signature | `service.ts › accepterDevis` | accord, puis étape dans une 2e transaction, puis prochaine action | B8 |
| Statut du lead | `statut-lead.ts`, `coherence/controle.ts` | deux tables divergentes, le dernier dossier changé décide | B12 |

**Devis envoyé depuis Gmail (B3).** Un mail SORTANT parti de la boîte (pas par le CRM), non automatique, rangé dans le
dossier d'un client (`mail/rattachement.ts › suitesDuTri`) met ses PDF en file (`MAIL_PDF_SORTANTS` :
`conserverPieces(…, { seulementPdf: true })`, l'agent mail doit être actif). Le détecteur des dossiers
(`devis-gmail.ts › devisGmailNonEnregistres`) propose « Enregistrer comme devis envoyé · X » pour chaque PDF conservé
de moins de 30 jours dont le nom évoque un devis, sur un dossier vivant, qui n'est ni un envoi du CRM (identifiant
« crm: », `EnvoiMail` ou `MAIL_ENVOYE` de proposition de même objet et même destinataire), ni déjà dans le CRM (devis de
ce numéro déjà envoyé, devis déposé depuis cette pièce, ou — sans numéro lisible — devis entré après le mail). Le
geste : la modale de dépôt préremplie (numéro lu dans le nom, date du mail, montant du registre s'il y est). Un devis
du CRM de ce numéro, généré mais pas encore envoyé, passe « Envoyé » au lieu d'être déposé une seconde fois.

**Dépôt d'un bloc, devis « accepté » = signé (B4).** Un devis ou une facture déposé (modale « Enregistrer un document
existant », qui envoie le PDF dans la même requête ; outil `ajouter_fichier`) : le PDF est vérifié avant toute écriture
(`documents-existants.ts › verifierPdf` : vide, 9 Mo, `%PDF-`), puis document, PDF (écrit sous le numéro du registre),
étape, prochaine action et main dans UNE transaction ; si elle échoue, rien n'est écrit et le PDF quitte sa place
(gardé aux archives) : on peut réessayer avec le même numéro. Un devis déposé « accepté » (signé hors ligne) sur un
dossier en Qualification, Simulation, Devis envoyé ou Relance le fait passer en « Signé » dans la même transaction
(`devis-signe.ts › signerParDevisAccepte` : les autres devis émis ou envoyés « non retenus », puis
`changerEtapeDansTransaction` avec le bon pour accord déclaré), avec la prochaine action d'un accord (`DEVIS_ACCEPTE`).
Même règle pour un devis repris corrigé en « accepté » (`modifierDocumentExistant`) et pour la correction du contrôle
`DEVIS_ACCEPTE_AVANT_SIGNE`, qui signe au lieu de remettre le devis « émis ». Relecture : un dossier EN PAUSE depuis
une étape d'avant « Signé » (l'étape d'avant la pause) passe en « Signé » aussi, la signature le sort de la pause
(`devis-signe.ts › estSigneeParDevisAccepte`, `constants.ts › signeParDevisAccepte` pour l'écran) ; perdu, déjà signé
ou en pause après la signature (un avenant) : l'étape ne bouge pas. La reprise d'un dossier entier (`avancerEtape: false`) ne signe jamais.

**Devis rendu visible = mis en ligne (B5).** Rendre visible un devis masqué (« Généré » ou « Envoyé ») est une mise
en ligne : dans une transaction, la visibilité, l'événement `DEVIS_ENVOYE` (`canal: "ESPACE"`), le passage Q, S,
Relance → Devis envoyé et le point d'entrée (prochaine action, main) ; après, les suites (lead, Meta, agenda, tâches)
puis l'annonce par l'automatisme existant « Devis disponible » — seulement pour un devis du CRM encore « Généré » (un
devis repris est fait ailleurs, un devis « Envoyé » est déjà parti par mail), une fois par devis (masqué puis remis en
ligne : pas de second mail), et jamais si l'interrupteur du modèle est coupé. Relecture, une seule règle avec la
génération (`devis-envoye.ts › annonceAboutit`) : un devis du CRM qui n'a jamais atteint le client (ni « Envoyé », ni
repris, ni déjà mis en ligne : `devisDejaParti`) n'est envoyé par sa mise en ligne que si elle est annoncée — espace
ouvert et adresse valide, ou interrupteur coupé (décision 7). Sans espace ouvert, ou sans adresse avec le modèle actif,
il devient visible SANS être envoyé (`rendreVisibleSansEnvoi`) : pas de « Devis envoyé », pas d'étape, pas de relance,
la tâche « Envoyer le devis » reste ouverte ; l'écran et l'outil le disent (`nonEnvoye`). L'écran demande confirmation
avant de rendre visible un devis du CRM « Généré » (le mail « Devis disponible » partira), comme l'aperçu de l'outil. La relance compte depuis la dernière mise en
ligne, et les textes (« envoyé il y a N jours », « envoyé le », « adressé le ») datent l'envoi, plus l'émission.

**Devis annulé ou masqué sans autre devis en attente (B6).** Annuler un devis (écran, `annuler_document`) ou le
masquer dans l'espace (interrupteur, `modifier` DOCUMENT, annulation de « rendre visible », correction d'un devis
repris) passe par
`devis-retire.ts › retirerDevis`, dans la transaction du geste (statut ou visibilité, trace `NOTE_AJOUTEE`). S'il ne
reste aucun autre devis qui attend la réponse du client et que le dossier est en « Devis envoyé » ou « Relance », il
revient à son étape d'avant le devis (nature RETOUR : pas de Meta, pas de « projet terminé ») ; le statut du lead
(CONTACTE) et la main (« Devis N annulé : refaire le devis », portée par le retour lui-même) sont écrits dans la même
transaction ; « Refaire le devis » remplace la prochaine action (une action posée à la main reste, la tâche
`devis-a-refaire` à côté) ; les mails de relance en attente de validation ou en échec sont annulés. La tâche DEVIS
s'intitule « Refaire le devis » (motif de la main, ou devis annulé dans le dossier) et se coche au prochain devis
visible. Un devis non retenu visible ou un devis accepté comptent comme en attente : le retour les ferait revivre.
Avec un autre devis en attente, l'étape ne bouge pas, seuls les mails de relance du devis retiré sont annulés et la
main est relue. Remis en ligne, le devis repasse en « Devis envoyé » (B5), « Refaire le devis » devient « Attendre
l'accord ».

**Publier depuis le bloc Espace, simulation du client (B9).** « Publier » ou « Republier » une simulation depuis le
bloc Espace du dossier (interrupteur, PATCH `…/simulations/[sid]` `afficher`, outil `publier` `reafficher`) passe par
la même fonction que le bouton « Publier » (`simulations/dossier.ts › publierDansLEspace`) : statut, événement, puis le
point d'entrée (SIMULATION_PUBLIEE) dans une transaction ; les suites, puis le mail automatique « votre simulation est
prête » (même clé : une simulation remise après masquage ne repart pas). Le SMS reste le choix du bouton « Publier ».
Masquer, repasser en brouillon ou retirer une simulation qui fait partie du choix du client (la validée, ou celle d'une
zone d'un mélange) dévalide son choix dans la même transaction (CHOIX_DEVALIDE : « Préparer le devis » redevient
« Attendre qu'il valide une simulation », l'espace revient aux simulations) ; l'ancien retrait (`retirerSimulation`) fait
de même. Le passage Qualification → Simulation est porté par le point d'entrée lui-même
(`synchro.ts › raisonDuPassageEnSimulation`, changement AUTOMATIQUE avec sa raison, statut du lead dans la transaction) :
simulation publiée, simulation du client (créée dans son espace, ou faite sur le site et rangée dans son espace — une
lecture qui écrit, décision du plan : elle émet l'événement), simulation validée, projet validé. Ailleurs qu'en
Qualification, l'étape ne bouge pas. Masquer une simulation ne fait pas revenir le dossier en Qualification.

**Paiement par carte, variantes retenues (B10).** « Payer par carte » (onglet Paiement de l'espace, bouton affiché
seulement si `STRIPE_SECRET_KEY` ET `STRIPE_WEBHOOK_SECRET` sont posées : `paiement/stripe.ts › stripeActif`) appelle
`POST /api/espace/<jeton>/paiement-carte` : le CRM calcule seul ce qui est dû (`paiement/carte.ts › aReglerParCarte` :
l'acompte du devis signé moins ce qui est reçu, sinon, chantier facturé, le reste des factures), ouvre une session
Stripe Checkout par `fetch` (aucune dépendance ; aucun moyen de paiement imposé : Klarna, Alma s'activent dans Stripe,
sans code ; clé d'idempotence par dossier, montant et fenêtre de 10 minutes) et rend son adresse ; retour sur l'espace,
`#paiement`. Refusé en aperçu (403), sans Stripe (409 `carte-fermee`), sans rien à régler (409 `rien-a-regler`), lien
révoqué (409) ; 10 essais par adresse IP. Ouvrir la page ne change rien au dossier. Le webhook signé
(`POST /api/webhook/stripe`, route publique, HMAC du corps brut, 5 minutes de tolérance, 503 sans secret) enregistre la
session réglée (`checkout.session.completed` payée, `async_payment_succeeded`) par `enregistrerEncaissement` : la ligne
`PAIEMENT_RECU`. Rejoué : 200, rien d'écrit (clé unique de l'encaissement). Le passage en « Signé » de l'écran, de
l'assistant (`changerEtapeDansTransaction`) et la correction de cohérence `PAIEMENT_AVANT_SIGNATURE` /
`ACCORD_SANS_SIGNATURE` (devis de l'accord, ou devis des acomptes) passent aussi les autres variantes « non retenu »
(`retenirDevis`) ; l'imputation automatique n'impute plus un acompte sur un devis non retenu, remplacé ou annulé
(`soldes.ts › piecesDuDossier`, devis actif = émis, envoyé ou accepté).

**États en double : lectures du devis, teintes (B11).** Les lectures d'un devis n'ont qu'une source :
`Document.consultations` et `consulteLe`, comptées par `espace/service.ts › noterConsultationDevis` (une par visite de
30 minutes, mise à jour conditionnelle). La copie de l'espace (`EspaceClient.devisConsultations`, `devisConsulteId`,
`devisConsulteLe`) n'est plus écrite (colonnes gardées) ; tous les lecteurs lisent le devis : bloc Espace et colonne
Espace de Dossiers, signal et tâche « relu N fois sans signer », contexte des mails, `lister` ESPACES, et
`manager_commercial` (devis en attente, « relus sans signature » : chaque devis ses propres lectures). « Réinitialiser »
l'étape Devis (écran, `geste_espace` REINITIALISER DEVIS : `vue-crm.ts › gesteDeLucas`) retire l'accord en ligne puis,
dans une transaction, remet à zéro le compteur de chaque devis du dossier (et l'ancienne copie de l'espace) avec sa ligne
d'historique : le signal tombe, la lecture suivante repart de 1, sonne de nouveau et ouvre une nouvelle ligne
`ESPACE_DEVIS_CONSULTE` (l'ancienne reste). Lire ou réinitialiser ne change ni l'étape, ni la main, ni la prochaine
action, ni l'espace. Teintes : valider une simulation ou un mélange (`choisir`, client ou Lucas) reporte, dans la
transaction du choix, les teintes des zones choisies sur les sous-parties du projet qu'elles habillent
(`espace/teintes-choix.ts › reporterTeintesDuChoix` ; sous-parties cochées, sinon celles que les surfaces laissent
deviner ; une sous-partie à deux zones les nomme toutes deux) : celles-là sont remplacées, les autres gardent leur
teinte. Dévalider ne touche pas aux teintes. La liste des espaces lit le choix comme l'espace du client (un choix
illisible n'en est pas un : `lireChoixEspace`). Reprise de l'existant : migration `etats-en-double-18` (lectures : le
plus grand des deux compteurs, jamais abaissé ; teintes d'un choix déjà validé : seulement les sous-parties sans teinte).

**Cohérence (B13).** Le contrôle (`coherence/controle.ts`, docs/COHERENCE.md § 5) voit ce que les gestes d'avant la
partie B ont laissé : « Devis envoyé » sans devis parti (écart 1 : retour, « Envoyer le devis au client ») ou sans devis
actif (écart 6 : retour, « Refaire le devis »), devis visible jamais annoncé (écart 5 : mis en ligne aujourd'hui et
annoncé par « Devis disponible », l'automatisme existant), PDF parti de Gmail pas enregistré (écart 3 : la fonction de
la tâche, quand le devis du CRM ou le registre donne le montant), devis émis après la signature que l'espace ne propose
pas (écart 7 : envoyé par mail, texte type), « Attendre l'accord » sans devis, date du chantier posée en « Signé »,
espace encore ouvert d'un dossier perdu ou archivé. Chacun se corrige d'un clic quand c'est possible ; les corrections
qui changent l'étape ou envoient un mail sont sensibles (l'assistant demande confirmation, la mise en route ne les
applique pas d'office).

## 5. Ce qui ne passe pas par le point d'entrée

- **Les gestes de Lucas qui posent eux-mêmes la prochaine action** : appel noté (`commercial/appels.ts`), rappel
  (`agenda/rappels.ts`), « Planifier » (`agenda/planification.ts`), modification du dossier (`dossiers.ts ›
  modifierDossier`, assistant compris). « Planifier » et la modification sont des actions posées à la main
  (`noterProchaineActionManuelle`) ; l'appel noté et le rappel repris écrivent un « Rappeler » daté, gardé par le point
  d'entrée comme une action posée à la main tant que sa date n'est pas passée (§ 2, relecture).
- La reprise d'un dossier entier (`reprise.ts`), datée du passé (nature REPRISE, sans Meta).
- Les corrections du contrôle de cohérence qui ne touchent ni la phase du devis ni le chantier (`coherence/controle.ts` :
  statut du lead, main, dévalidations, rangement, espace d'un dossier clos…) : elles passent par les fonctions du métier
  et laissent leur trace `COHERENCE_CORRIGEE`. Celles des écarts (B13) passent par le point d'entrée : `CORRECTION_COHERENCE`
  (écarts 1 et 6, « Attendre l'accord » sans devis, date du chantier), `DEVIS_ENVOYE` canal ESPACE (écart 5, par
  `mettreEnLigneDevis`), `DEVIS_ENVOYE` canal GMAIL (écart 3, par `enregistrerDevisGmail`), `DEVIS_ACCEPTE` (B4) ;
  l'écart 7 passe par l'envoi par mail (`envoyerDocumentParMail`, B2).

## 6. Tester des deux côtés

`src/test/etat-dossier.ts › etatDesDeuxCotes(dossierId, { maintenant?, taches? })` rend, pour un dossier :
étape ; main écrite et main calculée (elles doivent être égales) ; prochaine action et action manuelle en place ;
statut du lead ; étape de l'espace (la lecture du site) ; relances proposables (« DEVIS n° rang », « PHOTOS », « AVIS »)
et relances de devis à venir avec leur date ; tâches ouvertes du dossier après une passe de réconciliation complète.
Chaque écart corrigé a son essai : le déclencheur, puis cet état comparé à l'attendu. Premier usage :
`src/lib/dossiers/synchro.test.ts`, qui vérifie aussi que chaque événement de `TYPES_EVENEMENT_DOSSIER` a sa ligne ici.

## 7. La mise en route (migration `mise-en-route-18`)

Au premier démarrage qui suit le déploiement, après la sauvegarde automatique prise avant toute migration
(`base/preparation.ts › executerMigrationsDonnees` : « [base] Sauvegarde avant migration : … » ; si le volume Railway
est plein, le CRM ne démarre pas : lire « [sauvegarde] Volume » avant de déployer). Fichier
`src/lib/base/migrations/mission-18-mise-en-route.ts`, dernière de `MIGRATIONS_DONNEES`. Base neuve : rien.

1. **Un** contrôle de cohérence étendu (`controlerCoherence({ etendu: true })`) : tous les dossiers, perdus et archivés
   compris.
2. **Réparations sûres appliquées** par `appliquerCorrection` (la fonction du bouton « Corriger », sans rejouer le
   contrôle) : les codes qui ont une correction et ne sont pas dans `CORRECTIONS_SENSIBLES` — `ATTENTE_ACCORD_SANS_DEVIS`,
   `ESPACE_ACTIF_DOSSIER_CLOS`, `STATUT_DU_LEAD`, `MAIN_DECALEE`, `PROCHAINE_ACTION_PERIMEE`, `CHOIX_SANS_SIMULATION`,
   `PROJETS_AU_DELA_DE_LA_LIMITE`. Aucune ne change l'étape, ne touche un devis ni n'envoie de mail : ni mail au client,
   ni conversion Meta (un essai le vérifie avec Meta « configuré »). `SIMULATIONS_HORS_DOSSIER` est laissé au filet des
   15 minutes (`rattraperSimulationsSansDossier`, la même fonction, qui range aussi dans l'espace).
3. **Le reste** (corrections sensibles, ou à la main) : un contrôle ordinaire dit ce que le détecteur COHERENCE remontera
   de lui-même (« Corriger · Nom ») — rien n'est écrit pour ceux-là ; ce qu'il ne voit pas (dossiers perdus ou archivés)
   devient une tâche à moi `MANUELLE:coherence-18-<clé>`, lot « coherence-18 », avec le constat et la correction
   proposée (« à décider : jamais appliquée d'office »).
4. Le détecteur oublie son rapport gardé (`invaliderCoherence`), la liste des tâches est prévenue.

Lecture : le journal de démarrage (`[migration mise-en-route-18] … dossiers contrôlés … : N écarts trouvés, M réparés…`
puis une ligne par règle, clients en initiales ; `[base] Migration de données « mise-en-route-18 » : {…}`) et
`etat_crm` SANTE (ligne « Dernières migrations » : les trois dernières, par règle « CODE n trouvés, m réparés, k en
tâche, j au détecteur »). Résumé en base (`MigrationDonnees.resume`) : `dossiersControles`, totaux `trouves`, `repares`,
`taches`, `detecteur`, `echecs`, puis `trouves.<CODE>`, `repares.<CODE>`, `taches.<CODE>`, `detecteur.<CODE>`,
`echecs.<CODE>` non nuls. Ne lève jamais (un échec est compté, le démarrage continue) ; rejouée, elle ne répare plus rien
et ne recrée aucune tâche. Essai : `src/lib/base/mission-18-mise-en-route.test.ts`.
