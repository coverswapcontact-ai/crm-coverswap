# Reprise de mission — espace client, onglet Espaces clients, simulateur CRM

> Fichier de bord tenu par l'agent. À relire EN PREMIER à chaque reprise, puis continuer
> sans rien demander à Lucas (mandat d'autonomie complète). Aucun secret ici : dépôt public.
> Journal de la mission précédente (tunnel de vente, terminée le 21/09) : historique git,
> commit `95bce8e`.

Mission lancée le 21/09/2026. Énoncé : message de Lucas « Mission autonome — Espace client,
simulateur CRM et générateur de prompts » (transcript de la session).

## Règles permanentes (rappel)

- Rien ne se supprime, tout s'archive. Sauvegarde avant migration (automatique au démarrage).
- Aucun secret en dur ; ne jamais lire ni afficher `.env.local` ni les variables Railway.
- `src/proxy.ts` porte une garde de connexion locale : **ne jamais la commiter** (`git add` par chemins).
- Aucun envoi automatique hors accusé de réception : le SMS « simulations prêtes » part du clic
  « Publier » de Lucas, texte visible et décochable.
- Tests sur base d'essai, jamais sur la prod. Rien pousser qui ne tourne pas (tests, eslint, build).
- Coût des essais OpenAI : ≈ 0,21 $ + 0,066 $ par échantillon ; une simulation API réelle demandée
  par Lucas (≈ 0,35 $), rien d'autre sans raison.
- Commits terminés par `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Ordre de déploiement : CRM d'abord (API de l'espace rétrocompatible), puis site.

## Décisions d'architecture

- **Un moteur** : la consigne du mode API est construite par le SITE (`coverswap/src/lib/simulation-prompt.ts`,
  source unique) via une nouvelle route signée `POST coverswap.fr/api/simulation/consigne` (HMAC
  `SIMULATE_TOKEN_SECRET`) ; l'appel OpenAI est celui du CRM, extrait de `/api/simulate` dans
  `src/lib/simulations/generation.ts` (utilisé par la route ET par le simulateur CRM).
- **Catalogue** : lu sur le site (`GET coverswap.fr/api/catalogue`), cache mémoire + copie sur le volume.
- **Bibliothèque ChatGPT** : un prompt par type de surface (10), en base (`PromptSimulation` +
  `PromptSimulationVersion`), sections `[zone:…]…[/zone]` et variables `{{…}}` ; restaurer = nouvelle
  version avec l'ancien texte.
- **Simulations d'un dossier** : `SimulationEspace` étendue (source SITE/API/CHATGPT/MANUEL, statut
  BROUILLON/PUBLIEE/MASQUEE, photo avant, zones, version du prompt…). Espace créé au 1er brouillon ;
  les simulations du site rejoignent l'espace (publiées d'office) à son ouverture ou à leur arrivée.
- **Préparation** (`PreparationSimulation`) : mode CHATGPT (prompt + planche + photo cadrée) ou API
  (tâche de fond `SIMULATION_API`) ; le dépôt d'une image ChatGPT reprend la dernière préparation.
- **Consommation OpenAI** : `GenerationImage` (jetons, coût en $), site + CRM ; solde estimé =
  paramètre daté « crédit OpenAI » − consommation depuis sa date ; clé admin facultative.
- **Choix composite** : `EspaceClient.choix` (JSON) + `choixLe`.
- **Aperçu** : lien `?apercu=<signature>` depuis le CRM, lecture seule, visites non comptées.

## Lots et avancement

- [x] A1 Schéma Prisma (colonnes + 4 modèles) et migration de données (anciennes simulations, rendus du site).
- [x] A2 Espace v2 côté CRM : état par étape, projet, choix composite, consultations du devis,
      accord + signature, avis, adresse (BAN via CRM), portrait, aperçu, événements + notifications.
- [x] A3 Simulations du dossier : liste, publication (+ SMS), masquer, dépôt, synchro site.
- [x] A4 Simulateur : types de surface, catalogue, bibliothèque de prompts (textes soignés), préparation
      ChatGPT (prompt, planche, photo), mode API (tâche), consommation / crédit.
- [x] A5 Suivi des espaces (onglet Espaces clients) : état, signaux, tri, filtres, actions.
- [x] A6 Site refait par un client qui a déjà un espace ; doublon probable + fusion en un clic.
- [x] A7 Relances : visites, consultations du devis, brouillons exclus.
  → commit local `2af0b85` (NON poussé) ; 346 tests verts. Routes site `api/catalogue` et
    `api/simulation/consigne` écrites dans coverswap (non commitées).
- [x] B  Site : espace client v2 (coverswap/src/components/espace), routes catalogue + consigne,
      images du guide photo et des styles, préchargement du héros hors espace.
- [x] C  CRM : navigation, /espaces, panneau dossier (simulations), /simulateur (+ Prompts), Leads (doublon),
      Paramètres (portrait, crédit OpenAI).
- [x] D  Tests unitaires + parcours réels (iPhone, réseau lent, quitter/revenir, 60 ans ; simulateur
      ChatGPT de bout en bout ; API ; site avec un client existant).
- [x] E  Déploiement (CRM puis site) et vérification en production sans y créer de données.
- [x] F  Rapport final avec captures mobiles.

## Journal
- 21/09 : serveur du CRM terminé et testé (lots A1-A7). Reste : interfaces (site B, CRM C), parcours réels (D),
  déploiement (E), rapport (F). Pièges : une barre oblique inverse suivie de « n » dans un patch Python en
  heredoc devient un vrai retour à la ligne (casse les regex) — écrire ces morceaux avec Write/Edit ; les déclencheurs d'immuabilité ne sont pas
  posés dans la base d'essai (appeler `installerDeclencheurs()` dans le test qui en dépend).
- 21/09 (après-midi) : parcours réels faits en local (Marie, Jeanne) : ChatGPT de bout en bout (préparation →
  planche/photo/prompt → dépôt → brouillon → publication + SMS simulé → vu dans l'espace), API (faux OpenAI :
  brouillon + coût + compteur), choix composé, autre proposition, devis lu/signé au doigt, acompte, simulation
  du site par une cliente existante (rangée sans doublon), doublon probable (même nom/ville) fusionné.
  Correctifs issus des essais : recherche de teintes en français (CRM + site), nommage des couleurs chaudes
  (plus de « jaune » pour un chêne), comptage atomique des consultations du devis, suggestions d'adresse
  par code postal, CORS local du simulateur (dev seulement), repli du simulateur du site si le CRM est
  injoignable, message « il reste à… » sous « Bon pour accord », IBAN non coupé, SMS « renvoyer le lien »
  neutre (LIEN_ESPACE_RAPPEL, posé par la migration simulateur-espace-21-09).
  Simulation API RÉELLE impossible en local : aucune clé OpenAI sur le poste (elle n'existe que sur Railway).
  Captures mobiles : scratchpad/captures (Chrome sans interface, script captures.mjs, plans planN.json).
  Piège : `.next/dev` corrompu après un arrêt brutal → toutes les routes /api en 404 ; le déplacer (pas supprimer).
  Reste : E (tests complets, lint, builds, commit chemins explicites — jamais src/proxy.ts —, push CRM puis
  site, vérif prod) et F (rapport + captures finales).
- 21/09 (fin) : MISSION TERMINÉE. En production : CRM b4d43f7 → ecaf00e → 00f832e → 3a8f59e, site 9a771e1
  (santé ok des deux côtés, routes publiques/protégées vérifiées sans créer de données). 352 tests verts.
  Rapport : https://claude.ai/artifact/34t7FaQBxNzsKJh8wQ2TJR (privé). Restent chez Lucas : photo (Paramètres),
  solde OpenAI, 1re simulation API réelle (~0,34 $) et 1re préparation ChatGPT sur iPhone, relecture des prompts.

## Passe 2 (21/09, soir) — Lucas a renvoyé l'énoncé : relecture critique et corrections

Constat de départ (essais à 390 × 660, la hauteur utile d'un iPhone dans Safari, et 375 × 560, un
iPhone SE) : à l'arrivée, le bouton de l'action n'est PAS visible sans défiler, la barre « Appeler
Lucas » le recouvre. Les captures de la passe 1 étaient prises à 390 × 844, sans les barres de Safari.

- [x] P1 Espace : l'action visible dès l'arrivée (accueil resserré, « qui je suis » en une ligne,
      « sans engagement » au pied du bouton, barre d'appel claire) ; vérifier chaque étape aux deux tailles.
- [x] P2 CRM : devis prérempli depuis le choix du client (teintes par zone, mètres, tarifs existants ;
      jamais de prix inventé : ligne sans tarif = prix à saisir) ; raccourcis « Faire le devis ».
- [x] P3 Espace : espaces insécables (: ; ! ? %), avis NON coché d'office pour la publication,
      e-mail facultatif pour signer, doublon de mention sur la page photos.
- [x] P4 (revu) SMS : pas de raccourcissement (ton dégradé pour un gain d'un SMS) ; à la place, SMS « votre simulation
      vous attend » pour les clients venus du simulateur (LIEN_ESPACE_SIMULATION, migration sms-lien-simulation-21-09).
- [x] P5 Rapport : droit de rétractation (signature à distance) signalé — décision de Lucas, rien changé au contrat.
- [x] P6 Tests (356), lint, builds, déploiement CRM `eaddcb8` puis site `b2497f4` + `5062e5d`, rapport v2 au même lien.

Journal passe 2 :
- Accueil resserré (bouton visible à 390 × 660 et 375 × 560, barre d'appel blanche), carte « essai du site » : image
  2:1 puis bouton puis texte. Captures : scratchpad/passe2/img (script captures.mjs, champ « ecran » par étape).
- CRM : `src/lib/espace/devis-propose.ts` + GET /api/dossiers/[id]/devis-propose ; générateur prérempli (bandeau) ;
  « Faire le devis » dans le panneau Espace et dans Espaces clients (`&devis=nouveau`) ; geste du moment par carte
  (suivi-types `attente.geste`) ; demande d'autre proposition caduque après un choix ou une signature ; « Préparer le
  devis » remplacé à l'émission du devis (documents.ts). Tests : espace-v2.test.ts (+3).
- Site : insécables posés par script (scratchpad/passe2/insecables.cjs, analyse TypeScript, jamais les classes) ;
  avis non coché d'office ; e-mail facultatif pour signer ; pied de page sans doublon.
- Piège : les tests à double montage de React (dev) consomment un paramètre d'adresse lu dans un effet : ne le
  retirer qu'à l'ouverture effective. Données d'essai : Hélène Fabre-Essai a le numéro de Léa → même personne (normal).
- 21/09 (soir, fin) : PASSE 2 TERMINÉE. En plus du plan : projet en quatre questions, zones du site retrouvées
  par libellé, guide photo selon la pièce, HEIC converti par l'iPhone. Prod vérifiée (santé, routes fermées,
  lien invalide). Rapport v2 : https://claude.ai/artifact/34t7FaQBxNzsKJh8wQ2TJR

---

# Mission 3 (21/09/2026, soir) — Notes d'appel, Dossiers, espace client v3

Énoncé : message de Lucas « Mission autonome — Notes d'appel, Dossiers, et espace client v3 » (remplace la
mission précédente). Garder : bouton d'action visible sans défiler (hauteurs Safari 390 × 660 / 375 × 560),
devis prérempli, conversion HEIC. Le Projet perd les goûts et le délai (le parcours en 4 questions disparaît).

## Lots
- [x] M0 Bug « valider le projet ne fait rien » : cause trouvée, corrigée ; aucun bouton de l'espace muet.
- [x] M1 Notes d'appel : champ toujours visible (Leads + mode appels), enregistrement à la frappe, dictée,
      appels empilés et datés, étiquettes (8), reprise dans l'historique du dossier, retour iOS sur le bon lead.
- [x] M2 Dossiers : kanban à 30-50 cartes par colonne (hauteur fixe, défilement par colonne, compteur,
      « à moi » en haut, compact, masquer les inactifs) ; panneaux fermables au pouce (zone de sécurité,
      bouton bas, glissement, retour navigateur) — dossier, client, lead, appels, simulateur, paramètres, espaces.
- [x] M3 Espace v3 : onglets Photos · Projet · Simulations · Devis · Paiement (Devis/Paiement verrouillés,
      raison écrite), accueil = une phrase + un bouton, plus de « Votre dossier », Projet = zones (+ autre),
      taille, note ; enregistré à la frappe.
- [x] M4 Simulations dans l'espace : galerie (site, client, CRM publiées), simulateur intégré (même moteur),
      catalogue miniature (familles visibles, recherche FR, grille, agrandir, favoris), quota (3 par défaut,
      paramètre CRM, demande, accorder en un clic), crédit épuisé, réseau coupé ; validation = débloque Devis,
      notifie, prochaine action ; changement possible tant que le devis n'est pas émis.
- [x] M5 Marque CoverSwap dans l'espace (logo, « l'équipe CoverSwap »), « Acompte » → « Paiement » partout,
      Paramètres : logo au lieu de « ta photo ».
- [x] M6 CRM : événements et alertes vérifiés, zones + taille dans la fiche, simulations du client dans le
      dossier et Drive, favoris et teintes du client en premier dans le simulateur, Espaces clients à jour.
- [x] M7 Essais (Forestier venu du site, client Meta sans photo, 60 ans ; limite, crédit, coupure ; notes
      d'appel sur mobile ; kanban chargé), déploiement, rapport court.

## Avancement (serveur CRM fait, non commité)
- Base : `NoteAppel` (lead, appelLe, texte, étiquettes JSON, issue, dossierEvenementId), `EspaceClient.simulationsAccordees
  / simulationsDemandeesLe / favoris`, `PreparationSimulation.origine` (CRM | CLIENT). Schéma d'avant :
  scratchpad `schema-avant-mission3.prisma`. `db push` suffit (colonnes avec défaut).
- Notes : `src/lib/commercial/notes-appel.ts` + routes `/api/leads/[id]/notes-appel[/noteId]` ; reprises dans le
  dossier à l'ouverture (`depuis-lead.ts`), l'issue d'un appel se note sur la note de moins de 3 h. Tests 4/4.
- Espace v3 serveur : `etapes.ts` (verrous + raisons), `service.ts` (quota, creerSimulationClient, suivreCreation,
  demander/accorder, favoris, choix figé après devis émis), routes `simulations/creer|demande|creation/<id>`,
  `favoris` ; paramètre `SIMULATEUR_ESPACE_GRATUITES` (3 si vide) ; Drive « Simulations » ; RGPD NoteAppel.
  Tests simulateur 16/16 (dont quota, crédit épuisé, favoris).
- Reste : interface du site (espace v3), interface CRM (notes, kanban, panneaux, Espaces clients), essais, déploiement.
- (21/09 soir, suite) Site espace v3 écrit : `EspaceClient.tsx` (barre d'onglets, accueil une phrase + un bouton),
  `EtapeProjet.tsx` (zones + autre, taille, note, enregistrement à la frappe + pastille), `EtapeSimulations.tsx`
  (galerie, vue agrandie, validation, mélange, suivi de création avec coupure réseau), `CreationSimulation.tsx`,
  `CatalogueTeintes.tsx` (vignettes `?l=320` servies par le CRM), `EtapePaiement.tsx` (ex-EtapeAcompte),
  `ui.tsx` (Feuille plein écran : bouton en bas, glisser, geste retour ; Verrou ; Enregistrement ; useCopie honnête).
  CRM : limite par défaut 3 (Number(null) = 0 corrigé), « CoverSwap prépare » seulement si brouillon/préparation,
  libellés de zones du client (« Façades hautes »), alerte crédit dès qu'un client voit l'indisponibilité,
  alerte « projet précisé » unique et différée (tâche ESPACE_PROJET_ALERTE), vignettes d'échantillons.
- Essais locaux (captures dans scratchpad `m3/martine`, `m3/forestier`) : Martine (Meta, sans photo) → photos,
  projet, création avec catalogue, validation, devis en préparation ; Forestier-Essai (site) → accueil « Vos photos
  sont là », projet prérempli, aperçu (message à chaque geste), limite 1 + coupure réseau + demande + accord CRM,
  crédit épuisé. Paramètre local SIMULATEUR_ESPACE_GRATUITES posé à 1 dans dev.db (essai).
- Reste : CRM (notes d'appel UI, kanban, panneaux au pouce, Espaces clients), 60 ans, tests, build, déploiement, rapport.
- (21/09 soir, fin) CRM : NotesAppel (liste, fiche, mode appels ; retour iOS), kanban (colonnes à
  hauteur mesurée, cartes compactes, tri « à moi », inactifs), fermeture au pouce (fermeture-mobile.ts
  dans SheetContent et Modale + overlays), Espaces clients (faites/restantes, validée, Accorder 3).
  Essais : captures scratchpad `m3/crm`. Tests 363/363, lint et builds OK (site + CRM).
- Reste M7 : commit (chemins explicites, jamais src/proxy.ts), déploiement CRM puis site, contrôle prod
  sans créer de données, rapport court avec captures iPhone + liste de ce qui reste fragile.
- (21/09 soir, clos) Déployé : CRM 617ff0b + c47bb3e (Espaces clients : un client qui a sa simulation
  n'attend plus Lucas), site 99ac39a. Contrôles prod sans créer de données (pré-vol CORS 204, lien
  invalide refusé, notes d'appel 401 sans session, page /e/ en v3). Rapport :
  https://claude.ai/artifact/1mjsCAjyWiNHbLxGjNTM54 . Mission 3 terminée.


---

# Mission 4 (nuit du 21 au 22/09/2026) — Corrections après premier test réel

Énoncé complet : mémoire privée `project_mission4_nuit_coherence.md` (les dépôts sont publics : pas de nom de vrai
client ici, initiales seulement). Autonomie complète, Lucas dort : reprendre seul après chaque limite de tokens.
Relevé de prod (lecture seule, session Chrome de Lucas) : scratchpad `m4/dossiers-rattrapage-prod.txt`.

## Causes trouvées à l'inspection
- « 0 € » (dossier J. R.) : un devis REPRIS n'a pas de lignes (`lignes: "[]"`, montant dans `totalHt`) et l'espace
  recalculait le total depuis les lignes. Et un devis repris ACCEPTE n'a pas d'`AccordDevis` (signé sur papier) :
  l'espace ne le croyait pas signé → Paiement verrouillé, acompte invisible.
- Note de la demande d'autre proposition (F.) : elle ARRIVE dans l'événement du dossier, mais nulle part ailleurs
  (ni prochaine action, ni panneau Espace, ni Espaces clients) → à stocker sur l'espace et à afficher.
- 26 dossiers ouverts par le rattrapage en prod (tous : Qualification, « Appeler : simulation faite sur le site »,
  1 note, 0 document, aucun appel). S. E. et L. P. ont été ouverts par Lucas (leads Meta) : gardés.

## Lots
- [x] N1 Schéma (sauvegarde avant) : projet validé, message de la demande, accord retirable, photos retirées.
- [x] N2 Socle unique `src/lib/espace/faits.ts` : montants (devis repris compris), accord, paiements, quota (site compté).
- [x] N3 Espace serveur : valider / dévalider le projet, retirer une photo, dévalider une simulation, retirer une
      demande, retirer l'accord ; tout événement porte le contenu entier.
- [x] N4 Propagation (serveur) Espace → Dossier (étape, prochaine action, retour en arrière tracé) et Dossier → Espace.
- [x] N5 CRM : bloc « Espace client » de la fiche dossier (voir ET modifier), onglet Espaces clients au même niveau.
- [x] N6 Paiement : devis signé, acompte payé le … par …, solde, « Réglé, merci » ; encaissement annulé → à régler.
- [x] N7 Site : Projet (valider / modifier), Simulations en 2 sous-onglets, création express toutes pièces, quota 5
      (site compté), supprimer une photo, retirer une demande, changer de simulation, retirer l'accord, Paiement.
- [x] N8 Ménage : archiver / restaurer un dossier (lead qui revient), migration à liste explicite (26), règle
      « simulation = lead, pas dossier ».
- [x] N9 Cohérence : `docs/COHERENCE.md`, contrôle automatique (démarrage + quotidien), Tâches de fond + corriger.
- [x] N10 Essais locaux iPhone (parcours de l'énoncé), tests, builds, déploiement, vérifs prod, rapport.

## Journal
- 21/09 nuit : inspection faite (causes ci-dessus), plan posé.
- 22/09 ~01 h : SERVEUR CRM FAIT (commit local « point d'étape 1 », non poussé) : schéma (projetValideLe,
  propositionMessage, photosRetirees, AccordDevis.retireLe), `espace/faits.ts` (lecture unique : montants des devis
  repris, accord ESPACE|CRM, paiements détaillés, quota site compté, 5 par défaut), `espace/validations.ts` (valider /
  dévalider projet, dévalider choix, retirer demande / photo / accord ; auteur CLIENT ou LUCAS ; le dossier avance et
  recule avec la raison écrite), `espace/vue-crm.ts` (vue complète + gestes de Lucas + réinitialiser une étape),
  routes espace `projet/validation|devalidation`, `choix/retrait`, `proposition/retrait`, `accord/retrait`,
  `photos/<id>/retrait` ; toutes les pièces du site dans la création (`piece`), `dossiers/archivage.ts` (archiver /
  restaurer, le lead revient), règle « simulation = lead » (depuis-lead.ts, webhook, audit), migration à liste
  explicite `menage-des-dossiers-du-rattrapage-22-09` (26), acompte encaissé → Signé / annulé → recul
  (`suivreAcompteDossier`), `coherence/controle.ts` (14 contrôles, corriger, quotidien + démarrage), API
  `/api/coherence`. Tests : `src/lib/coherence/coherence.test.ts` (12) ; suite entière verte (377).
- 22/09 ~02 h : INTERFACES FAITES. CRM : `EspaceDossier.tsx` réécrit (5 onglets du client, reste à faire, photos +
  retirées, projet validé / valider à sa place / modifier / réinitialiser, simulations avec valider-dévalider-masquer,
  demande avec son mot, devis-accord-retrait, paiement, gestes), `ArchivageDossier.tsx` (+ « Archivés » dans Dossiers),
  `ControleCoherence.tsx` dans Tâches de fond, Espaces clients enrichi. Site : Projet (valider / modifier), Simulations
  en 2 sous-onglets, `CreationSimulation.tsx` en ligne (toutes les pièces, repart de zéro, choix gardés seulement
  après un échec), `BoutonAConfirmer` (ui.tsx), retrait photo / validation / demande / accord, Paiement v2.
  `docs/COHERENCE.md` écrit. Essais iPhone complets en local (captures : scratchpad `m4/captures/{olga,jerome,nina,crm}`,
  plans `m4/plan-m4.mjs`) : tout l'aller-retour vérifié des deux côtés. Tests 376/376, lint, builds OK, montée de
  schéma simulée sur une copie (rien perdu). Prod : quota jamais saisi → 5 par défaut s'applique.
- (fait, voir plus bas) commits, push CRM (la migration des 26 dossiers tourne au démarrage, sauvegarde avant), push site,
  vérifs prod (dossier J. R. : 3 460 €, acompte 1 038 € payé le 18/09 par virement ; F. ; S. E. ; liste des archivés),
  rapport avec captures.
- 22/09 ~00 h 15 : DÉPLOYÉ ET VÉRIFIÉ. CRM d92ce19 → bcd231f → bb7ba60 → 062cce2, site 9fd0e1b. Prod (lecture seule,
  session Chrome de Lucas) : migration `menage-des-dossiers-du-rattrapage-22-09` = 26 archivés (32 → 6 dossiers), leurs
  leads revenus dans Leads avec leurs simulations (toutes > 60 jours : aucun dans la file d'appels) ; dossier repris :
  3 460 €, acompte 1 038 € « payé le 18 septembre par virement », solde 2 422 € (lu dans son espace en aperçu) ; seul
  dossier repris de la base ; client venu du site : 1 faite sur 5 ; migration `mots-des-demandes…` = son mot recopié ;
  contrôle de cohérence : 6 dossiers, 0 incohérence. Rapport : https://claude.ai/artifact/Mte6YFG2JJaNGaRHLpnCaj .
  MISSION 4 TERMINÉE. Fragile : génération réelle jamais faite depuis l'espace ; retrait d'accord par le client
  (règle : dossier « Signé » et aucun paiement) ; acompte encaissé = Signé automatique.

# Mission 5 (22/09/2026) — L'espace client devient permanent et multi-projets

Énoncé complet : mémoire privée `project_mission5_espace_permanent.md` (dépôts publics : initiales seulement).
Autonomie complète : reprendre seul après chaque limite, ne jamais attendre. Rapport court avec captures iPhone.

## Décisions
- **Source unique des prestations** : CRM `src/lib/prestations/prestations.ts` (données pures : 4 familles CUISINE, SDB,
  MEUBLES « Mobilier », PRO ; sous-parties ; zones du moteur ; tarif par défaut ; question de taille ; guide photo ;
  mots « votre cuisine »…). Servie en JSON public `GET /api/site/prestations` (liste blanche, sans tarifs ; le site la lit, ISR 1 h) et dans l'état de
  l'espace. Les ids de famille restent ceux de `Lead.typeProjet` (aucune migration de leads).
- Zones du moteur : chaque sous-partie pointe des surfaces du PROJET du simulateur du site de sa famille (la route
  consigne refuse une surface hors projet) : ex. SdB « portes de placard » → meuble-vasque ; Mobilier « bar,
  bibliothèque, bureau, autre » → meuble-complet ; Pro « façade » → rangements-pro + habillage-mural.
- **Dossier.prestations** (JSON `{ FAMILLE: [sous-parties] }`) = vérité unique des familles d'un projet, écrite par le
  client (onglet Projet) ou par Lucas (dossier). Famille « connue » = cochée ; sinon suggestion (simulations du site,
  formulaire du site) sans l'écrire ; jamais le `typeProjet` par défaut d'un lead Meta.
- **EspacePermanent** (un par client pérenne, `clientId` unique) : code + version (lien signé, sans expiration),
  révocable, visites, confirmation du téléphone (90 j sans ouverture → 4 derniers chiffres, 5 essais / 24 h),
  favoris, projets accordés au-delà de 2. `EspaceClient` = un PROJET (un dossier) rattaché (`permanentId`, `nomProjet`).
  Migration : le permanent reprend le code et la version de l'espace existant → les liens envoyés restent LE lien ;
  les codes des autres projets restent des alias. Régénérer = version +1 sur le permanent ET ses projets.
- API espace rétrocompatible : `GET /api/espace/<jeton>` rend l'état du projet courant + `compte` (projets, documents,
  favoris) ; `?projet=<code>` choisit le projet ; confirmation requise → seul `compte.confirmation` sort.
- Projet figé : dossier ENCAISSE (terminé) ou PERDU (non réalisé) → consultation seule (écritures refusées, avis
  unique permis). Projet signé / devis émis : onglet Projet en lecture.
- Nouveau projet par le client : dossier Qualification, source ESPACE_CLIENT, client pérenne, coordonnées reprises,
  sans lead ; événement ESPACE_NOUVEAU_PROJET + alerte distincte ; limite 2 en cours (+ accordés par Lucas).

## Lots
- [x] P1 Prestations : fichier unique + helpers + tests ; `/api/site/prestations` (route publique).
- [x] P2 Schéma (sauvegarde avant) : Dossier.prestations, EspacePermanent, EspaceClient.permanentId/nomProjet ;
      migration de données (permanents, prestations reprises : J. R. = 3 familles, F. = ses zones).
- [x] P3 Liens permanents : jeton → permanent (+ alias), régénérer, révoquer, confirmation 90 j.
- [x] P4 Service espace : compte (projets en cartes, documents, favoris, contact/message), projet courant, nouveau
      projet (dossier auto + alerte), limite 2, projet figé, familles dans Projet / Photos / Simulations.
- [x] P5 CRM serveur : devis prérempli par sous-parties + tarifs par sous-partie, simulateur (zones), cohérence
      (figé, limite), fusion de clients, Espaces clients par client, vue du dossier, SMS de régénération.
- [x] P6 CRM écrans : familles du dossier (panneau + carte kanban), fiche client (espace), Espaces clients,
      tarifs par sous-partie, régénérer + SMS, projet accordé.
- [x] P7 Site espace v4 : Mes projets, confirmation, nouveau projet, Projet à deux niveaux, guide photo par famille,
      projet figé, Catalogue, Mes documents, Contact ; textes sans « cuisine » par défaut.
- [x] P8 Site public : formulaire de devis et simulateur sur les 4 familles (lus du CRM), textes.
- [x] P9 Essais iPhone locaux (4 parcours), tests, lint, builds, déploiement CRM puis site, vérifs prod, rapport.

## Journal
- 22/09 : inventaire fait (voir Décisions) ; prod relevée en lecture seule (6 dossiers vivants, tous avec client
  pérenne ; 2 espaces : J. R. et F.).
- 22/09 (suite) : SERVEUR CRM ÉCRIT, non commité : `src/lib/prestations/{prestations,dossier,tarifs,deduction}.ts` ;
  schéma (Dossier.prestations*, PresetTarif.prestations, EspacePermanent, EspaceClient.permanentId/nomProjet) ;
  `espace/liens.ts` réécrit (accesDuJeton, permanent sans expiration, alias des codes de projet, confirmation
  90 j, régénérer = versions +1, lienPourLeProjet) ; `espace/projet.ts` v4 (familles au dossier, tailles par
  famille) ; `espace/projets.ts` (figé, pastilles, limite 2, nouveau projet → dossier ESPACE_CLIENT sans lead,
  demander / accorder un projet) ; `espace/compte.ts` (cartes, documents tous projets, message, visites) ;
  `espace/alertes.ts` ; service.ts (chargerProjet + etatEspace : code, nomProjet, fige, familles, mots,
  projetModifiable ; création : toutes les familles, celles du projet d'abord) ; route `/api/espace/<jeton>` réécrite
  (compte + projet `?projet=`, confirmation, projets, message, documents, gardes figé / signé) ; devis prérempli par
  sous-parties et tarifs ; vue CRM, Espaces clients PAR CLIENT (`listerClientsEspaces`), simulateur CRM, SMS
  (lien permanent), RGPD (EspacePermanent), fusion de clients (espaces fusionnés), archivage (projet qui
  réapparaît), cohérence (PROJET_FIGE_MODIFIE, PROJETS_AU_DELA_DE_LA_LIMITE), migration
  `espaces-permanents-22-09` (J. R. = 3 familles « dits par Lucas »). Suite existante 376/376 verte.
- 22/09 (suite) : CRM FINI côté serveur et écrans, commit LOCAL `fc725aa` (non poussé) : routes `/api/clients/[id]/espace`,
  `/api/espaces/[id]` (regenerer + SMS relu, desactiver, accorder-projet), `/api/dossiers/[id]/prestations` (PATCH),
  `/api/prestations/tarifs`, `/api/site/prestations` (publique, liste blanche) ; écrans : familles du dossier
  (`FamillesDossier.tsx`, puces sur la carte du kanban), bloc Espace du dossier (lien du client, autres projets, taille
  et note), fiche client (`EspaceClientFiche.tsx`), Espaces clients PAR CLIENT, tarifs par sous-partie
  (GestionTarifs), `NouveauLien.tsx` partagé. Tests : `src/lib/espace/permanent.test.ts` (13) ; suite 389/389, eslint OK.
  SUIVANT : le site (P7, P8).
- 22/09 (suite) : SITE ÉCRIT (commit local, non poussé) : `components/espace/EspaceClient.tsx` réécrit (compte + projet,
  `?p=` du lien, Mes projets, barre d'onglets dans un projet, « ‹ Mes projets », confirmation, projet figé),
  `EspaceCompte.tsx` (confirmation 4 chiffres, Mes projets, Nouveau projet + limite, Mes documents, Contact + message,
  Catalogue + favoris, ProjetConsultation), `EtapeProjet.tsx` (4 familles dessinées → sous-parties dépliées, taille
  par famille, note, lecture seule si signé), `EtapePhotos.tsx` (guide par famille, jamais la cuisine par défaut),
  création (familles du projet d'abord), `Illustrations.tsx` (salle de bain, mobilier, local), files hors ligne par
  projet ; site public : `lib/prestations.ts` (lu du CRM, repli), formulaire de devis et cartes des simulateurs sur
  les 4 familles, titre des pages villes. tsc + eslint OK. SUIVANT : essais locaux (P9).
- 22/09 (suite) : ESSAIS LOCAUX FAITS sur la base d'essai (captures iPhone dans le bloc-notes de la session) : J. R.
  (3 familles en lecture seule « signé », devis 3 460 €, acompte payé, solde), Meta (première question → salle de
  bain, guide et textes sans cuisine, projet validé, surfaces de la salle de bain en tête), retour après 100 jours
  (4 chiffres, factures, projet terminé consultable, nouveau projet → dossier Qualification ESPACE_CLIENT sans lead,
  alerte), troisième projet → « Demander à CoverSwap ». Corrigé en route : un seul projet terminé ne s'ouvre plus
  seul (accueil Mes projets), onglets Photos/Projet cochés quand le devis est signé, nom de projet par défaut
  « Cuisine, salle de bain et mobilier », familles du client d'abord dans l'onglet Projet, « Voir mon devis ».
  Montée de schéma + migration rejouées sur une copie fraîche de la base d'avant mission : aucune perte, mêmes
  compteurs. Suite 389/389, eslint + tsc OK (CRM et site), builds de prod OK (CRM construit sans la garde locale).
  SUIVANT : commit, push CRM, vérifs prod en lecture, push site, rapport.
- 22/09 10h18 : INCIDENT au déploiement (907bf80) : le volume Railway (500 Mo) est plein à 99 % — les sauvegardes
  d'avant migration s'y accumulaient sans fin. La copie d'avant schéma a échoué (« database or disk is full »), le
  garde-fou a annulé la migration (base intacte) mais le CRM ne démarrait plus (502). Correctif `sauvegarde.mjs` :
  copie sous nom provisoire retirée si elle échoue, copies inachevées du 22/09 retirées (seulement si non intègres),
  anciennes sauvegardes archivées en .db.gz (empreinte SHA-256 relue avant de retirer l'original : rien de perdu),
  arrêt sans rien toucher s'il n'y a toujours pas la place ; bilan d'occupation dans les journaux. Répété sur une
  copie de la base d'avant mission. Reste à Lucas : agrandir le volume ou changer d'offre (décision payante).
- 22/09 10h39 : 2e essai (f5e7319) : copies inachevées retirées, mais volume toujours à 0 octet → même la première
  archive ne s'écrivait pas (ENOSPC). 3e essai (4469ed8) : archive préparée en mémoire puis écrite à la place de
  l'original. EN LIGNE à 10h47. Journal : volume = uploads 225,7 Mo + sauvegardes 184,9 Mo + base 10,4 Mo, 0 libre ;
  après : 28 archives (39,4 Mo), ~144 Mo libres. Migration de prod : permanents 2, projets 2, J. R. « dits par
  Lucas » 1, F. d'après ses zones 1, laissés vides 4. Vérifs prod (lecture) : santé 200 (4469ed8) ; J. R. = CUISINE
  façades hautes + plan de travail + crédence, SDB plan vasque + crédence, MEUBLES portes de dressing ; devis 2026-037
  3 460 € signé, acompte 1 038 € payé (18/09, virement), solde 2 422 € à régler ; F. = CUISINE façades hautes +
  basses ; cohérence 0 incohérence ; /api/site/prestations 4 familles. Aucun mail de secours du site ce jour ; aucun
  lead depuis la coupure. Site poussé (c404d19).
- 22/09 10h51 : site en ligne (c404d19) : formulaire de devis et simulateur sur les 4 familles ; espace de J. R. vérifié
  en production par l'aperçu (même code de lien, 3 familles en lecture seule, devis 2026-037, acompte, solde).
  Rapport avec captures iPhone : https://claude.ai/artifact/NZAHfhctaybp1mEMsnUCfu
  MISSION 5 TERMINÉE. Reste à Lucas : volume Railway (agrandir = payant), tarifs des sous-parties sans tarif,
  familles des 4 dossiers vivants vides, coup d'œil aux leads Meta entre 10h18 et 10h47.

# Mission 6 (22/09/2026, après-midi) — Coordonnées, « qui a la main », alertes à compléter

Énoncé de Lucas : « Trois ajustements — espace client et Dossiers » (mémoire privée `project_mission6_coordonnees_main`).
Mêmes règles permanentes. Vérification demandée : sur une copie de la base, prénom corrigé + adresse ajoutée par le
client → le devis généré les reprend ; simulation publiée → « chez le client » partout ; alerte masquée → ne revient pas.
iPhone, déploiement CRM puis site, rapport court.

## Décisions

- **Qui a la main = UNE règle** : `src/lib/dossiers/main.ts`. Pure : `mainSelonFaits` lit les derniers événements
  du dossier (table `EVENEMENTS_MAIN` : type → vers le client / vers moi) et le dernier changement d'étape (défaut
  = responsable de l'étape) ; le plus récent l'emporte (un passage de main dans la minute qui précède un changement
  d'étape l'a causé et l'emporte). Stockée sur le dossier (`main`, `mainLe`, `mainMotif`) par `recalculerMain(id)`,
  appelée après chaque geste (publication, devis, lien, SMS/mail reçus, gestes du client, changement d'étape).
  `mainDe` (kanban, liste, panneau), Espaces clients (`attente.qui`), /commercial et Leads lisent ce champ.
  Cohérence : `MAIN_DECALEE` (champ ≠ recalcul) → Corriger = recalculer.
- **Coordonnées** : au CLIENT prénom, nom, email, téléphone (fiche client : prénom/nomFamille/nom, email et
  téléphone principaux ajoutés, les anciens gardés) + copiés sur ses dossiers en cours ; au PROJET l'adresse
  (dossier). Événement avec avant → après. Téléphone changé → alerte forte à Lucas. `PUT coordonnees` accepte
  l'ancien format (site pas encore redéployé).
- **Alertes à compléter** : `pointsACompleter` rend chaque point avec `attenteClient` (le client peut le fournir
  par son espace actif) et `masque` (croix, `Dossier.completudeMasquee` JSON). Comptes et cartes : seulement les
  vraies alertes.

## Lots

- [x] M1 Schéma (Dossier.main*, completudeMasquee) + `main.ts` + branchements + migration d'initialisation + cohérence.
- [x] M2 Coordonnées côté CRM (service, route, prénom lu sur la fiche client, alerte téléphone).
- [x] M3 Alertes à compléter (neutre / masquer / réafficher) : panneau, carte, liste, synthèse.
- [x] M4 Affichage de la main partout (kanban, panneau, Espaces clients, Leads, /commercial).
- [x] M5 Site : carte « Vérifiez vos coordonnées », pastille dans la progression, rappels doux.
- [x] M6 Tests + parcours sur copie de base (iPhone), déploiement CRM puis site, rapport.

## Journal
- 22/09 (après-midi) : CRM ÉCRIT, non commité. `dossiers/main.ts` (règle + recalcul, branché : route de l'espace après
  chaque geste, SMS tracés, mails rangés, effets de changement d'étape, devis émis, publication, brouillon, simulation du
  client, espace ouvert, lien régénéré, simulations accordées) ; lu par `mainDe` (kanban/liste/panneau + motif), Espaces
  clients (`attente.qui` = la règle, le geste nomme l'action), /commercial (groupes réconciliés), Leads (pastille).
  Cohérence `MAIN_DECALEE`. Migration `main-des-dossiers-22-09`. `espace/coordonnees.ts` (lecture + enregistrement,
  historique avant → après, alerte téléphone). Complétude : `attenteClient` / `masque` + route `PATCH
  /api/dossiers/[id]/completude` + bloc du panneau (croix, « en attente du client », réafficher). Décidé en route :
  « espace ouvert » et « simulation créée par le client » passent la main au client, « brouillon » me la rend.
  Tests `dossiers/main.test.ts` (11) ; deux anciens essais nourris d'événements réels ; suite 406/406, eslint propre.
  SUIVANT : site (M5).
- 22/09 (après-midi) : SITE ÉCRIT (non commité) : `components/espace/Coordonnees.tsx` (écran « Vos coordonnées »,
  pastille « À compléter » / coche verte dans la barre du projet, rappel doux), carte sur l'accueil du projet, rappels
  après validation d'une simulation et à l'ouverture du devis. Parcours local (CRM + site d'essai, `prisma/dev.db`
  sauvegardée dans le bloc-notes `m6/dev-avant-m6.db`, migration main : moi 62 / client 43 / personne 1) : espace
  ouvert → client ; photos → moi ; publication → CLIENT partout (carte, fiche, Espaces, Leads, /commercial) ; validation
  → moi partout + rappel ; prénom Jaen → Jean + adresse → dossier, fiche, historique. Corrigé en route : pastille trop
  large (en-tête sur 2 lignes), numéro de rue perdu sur une rue proposée sans numéro (gardé côté CRM), « ajoutée »,
  téléphone réécrit en +33 sans changement. Outils : bloc-notes `m6/scenario.mjs`, `m6/plan-corps.mjs`.
- 22/09 15h07 : DÉPLOYÉ. CRM 1a85581 (15h02) puis f991dc0 (pastille d'Espaces clients qui passe à la ligne), site
  56f9685 (15h05). Démarrage rejoué avant sur une copie de la base d'avant mission (aucune perte : seuls le journal et
  le registre des migrations grandissent). Prod (journaux Railway) : schéma +4 colonnes, sauvegarde vérifiée,
  migration main : moi 2 / client 4 / personne 1 ; volume 128 Mo libres. Cohérence en prod : 0. Espace de J. R. en
  aperçu : pastille « coordonnées complètes ». Devis d'essai 2026-043 (copie locale) au nom de « Jean Petit, 12 Impasse
  des Lilas ». Trouvé en route : `.gitignore` ne couvrait pas `*.db.gz` (corrigé) ; commit initial e65c219 (15/04)
  avec `prisma/dev.db` dans l'historique public (63 leads) : purge = décision de Lucas.
  MISSION 6 TERMINÉE.


# Mission 7 (22/09/2026, soir) — Onglet Mail, SMS retiré, notifications par mail, séquences

> **Changement de périmètre (Lucas, en cours de mission) : la section 7, le RÉCAP AUDIO, est ABANDONNÉE.** Ni synthèse
> vocale, ni bouton Récap, ni historique audio. Ce qui avait été commencé (modèles `Recap` et `CampagnePublicitaire`,
> recherche web dans `ia/modele.ts`) a été retiré avant tout commit. Le reste de la mission ne change pas.

Énoncé complet : mémoire privée `project_mission7_mail_recap` (message de Lucas « Mission autonome — L'onglet Mail
et le récap audio »). Mêmes règles permanentes. Envoi automatique permis SEULEMENT pour les 4 notifications de
l'espace (simulation publiée, devis disponible, paiement reçu, projet terminé + avis) et UN mail de test à
l'adresse personnelle de Lucas ; tout le reste part au clic de Lucas.

## État trouvé (22/09, soir)
- Prod : Google connecté le 22/09 12:20 UTC (gmail.modify + gmail.send + drive.file ; expire le 29/09, mode Test).
  Agent mail actif (relevé toutes les 5 min, `messages/taches.ts`), 48 « à trier », 90 reçus en 7 jours.
  **ANTHROPIC_API_KEY présente sur Railway** (etatIa.cleApi = vrai) ; réglages IA vides (modèle, prix, budget,
  interrupteur : Paramètres → Agent mail et IA).
- Existant réutilisé : `google/connexion.ts` (OAuth, `appelGoogle`), `messages/gmail.ts` (lister, lire, libellés,
  envoyer), `messages/mime.ts` (MIME + fil), `messages/stockage.ts` (enregistrer, pièces), `mail/envoi.ts`
  (envoyeur isolé Gmail/Resend), `ia/modele.ts` (seul point d'appel Anthropic, budget, registre `AppelIa`),
  file de tâches (`taches/`), `dossiers/main.ts` (MAIL_RECU → moi).
- Échecs de l'ancienne section Messages : tri trop prudent (tout inconnu « à trier » → bruit visible), actions en
  propositions à valider. Jeton Google expiré = tâches en ÉCHEC DÉFINITIF (actions perdues).
- Pas de dépense publicitaire dans le CRM (Meta : leads + conversions seulement). Campagne connue : 500 € / 21 j.

## Décisions
- **Relevé** : synchro incrémentale par l'historique Gmail (`history.list`) toutes les 60 s (+ à l'ouverture de
  l'onglet) ; repli sur le relevé par recherche si l'historique a expiré. Push Pub/Sub : non (demande une config
  GCP) ; possible plus tard.
- **Tri** (`mail/tri.ts`, pur) : règles d'expéditeur (Lucas) > contact connu (client, lead, prospect, fil d'un client)
  > administratif (domaines + mots) > bruit (domaines techniques/plateformes, listes, noreply, catégories Gmail) >
  humain inconnu (reste visible ; demande de devis → lead source MAIL). Dans le doute : visible.
- **États** sur Message : classe (CLIENT | ADMINISTRATIF | HUMAIN | BRUIT), rangeLe/rangeMotif, traiteLe (archivé),
  lu, dansBoite, reponduLe. Vues calculées : À traiter / Clients / Administratif ; Rangé replié.
- **Gmail** : rangé = libellé `CoverSwap/Rangé` + lu + hors boîte ; archivé = hors boîte ; lu/non lu = UNREAD ;
  remonter = boîte + retrait du libellé + expéditeur « jamais rangé ». Une tâche « synchro boîte » applique l'état
  voulu (rejouable). Google coupé → la tâche ATTEND (pas d'échec) + alerte (`AttenteConnexion`).
- **IA** : `appelerModele` (budget, registre) ; rédaction par outil structuré + garde déterministe (tout montant,
  date, délai du brouillon doit venir du contexte, sinon `[à compléter]`). Guide de style tiré des mails envoyés,
  modifiable (Paramètres). Brouillon IA + version envoyée + contexte gardés (`BrouillonMail`).
- **Notifications** (`mail/notifications.ts`) : table `EnvoiMail` à clé unique (jamais deux fois), HTML sobre + texte,
  modèles modifiables, événement MAIL_NOTIFICATION dans le dossier (ne change pas la main).
- **Séquences** : modèles + moteur + écran, tout INACTIF ; désinscription définitive (`Desinscription`).
- ~~Récap audio~~ : abandonné (décision de Lucas).

## Lots
- [x] R1 Schéma (Message + classe/lu/dansBoite/rangé/traité/répondu, RegleExpediteur, EnvoiMail, BrouillonMail,
      ReglageTexte, EtatBoiteMail, Sequence*, Desinscription ; source de lead MAIL).
- [x] R2 Attente de connexion Google (exécuteur : `AttenteExterne`, sans perdre d'essai) + alerte + réveil à la reconnexion.
- [x] R3 Synchro Gmail par l'historique + tri + actions Gmail + vues + actions (lu, archiver, ne plus montrer,
      tout nettoyer, remonter) + sans réponse 5 j.
- [x] R4 Rattachement (auto + manuel en 2 gestes), lead depuis un mail, pièces jointes → dossier + Drive,
      événements dossier + main (MAIL_ENVOYE → client), cohérence MAIL_SANS_REPONSE.
- [x] R5 Rédaction IA (contexte, garde, guide de style, apprentissage, envoi dans le fil).
- [x] R6 Notifications automatiques (4 événements), modèles, SMS remplacés par le mail.
- [x] R7 Séquences (inactives) + désinscription.
- ~~R8 Récap audio~~ : abandonné.
- [x] R9 Écrans : onglet Mail (mobile d'abord), Paramètres, navigation sans SMS.
- [x] R10 Site : politique de confidentialité (Anthropic) + page de désinscription.
- [x] R11 Tests, essais iPhone sur copie, vérifs prod (boîte en lecture, brouillon réel, mail de test aller-retour),
      déploiement, rapport.

## Journal
- 22/09 (soir) : SERVEUR ÉCRIT en partie (non commité) : `mail/tri.ts` (pur), `mail/boite.ts` (synchro historique Gmail,
  classement, état Gmail, gestes), `mail/vues.ts` (À traiter / Clients / Administratif / Rangé, Tout nettoyer, bilan),
  `mail/rattachement.ts` (dossier + main, lead source MAIL, pièces → dossier/Drive, rattachement à la main),
  `mail/envoi-crm.ts` (EnvoiMail à clé unique, Gmail exigé, trace), `mail/notifications.ts` (4 événements, branchés :
  publication, devis émis, paiements, FACTURE/ENCAISSE), `mail/sequences.ts` (inactives, désinscription HMAC),
  `mail/contexte.ts`, `mail/taches.ts` (synchro 60 s ; ancien relevé 5 min retiré). main.ts : MAIL_ENVOYE → client ;
  cohérence MAIL_SANS_REPONSE. ia/modele.ts : interrupteur IA_REDACTION. SUIVANT : mail/redaction.ts (IA + garde +
  guide de style), routes API, écrans, migration de données, tests.
- 22/09 (nuit) : TOUT ÉCRIT, NON COMMITÉ, suite verte (422/422), tsc + eslint propres (CRM et site).
  - Rédaction IA (`mail/redaction.ts`) : faits du CRM seulement, garde déterministe (montants, %, dates, jours, délais,
    heures, LIENS) → `[à compléter]` ; guide de style (Paramètres → Mail) ; brouillon + version envoyée + contexte.
  - Écrans : onglet Mail (`/mail`, `?client=|lead=|dossier=` ouvre un nouveau mail, `?consigne=` proposée à l'IA sans
    l'appeler), écran Séquences (`/mail/sequences` : activer avec confirmation, mode, plafond, textes, aperçu avec un
    vrai client, « À valider » → Relire → Envoyer), Paramètres → Mail (guide, 4 mails automatiques, décisions sur les
    expéditeurs).
  - SMS → mail partout : « Nouveau lien » (mail relu), lien de l'espace par mail (`LienParMail`, `/api/mail/lien-espace` :
    ouvre l'espace si besoin, relu, un clic) après un appel (Leads, Commercial), depuis Espaces clients et le dossier ;
    boutons « écrire » des cartes → onglet Mail. Liens envoyés par mail comptés comme « lien envoyé » (suivi espaces).
  - Séquences : REACTIVATION seulement avec l'accord aux e-mails commerciaux ; désinscription → `ConsentementMail`
    RETIRE sur la fiche (une fois) ; une étape en attente de validation s'arrête aussi si le client répond.
  - Tri : `icloud.com` retiré des plateformes (adresses de particuliers !) ; confirmation automatique sans facture →
    rangée ; demande envoyée par une adresse noreply → visible, sans lead d'office ; facture de plateforme → Administratif.
  - RGPD : EnvoiMail, BrouillonMail, InscriptionSequence dans la carte + le périmètre d'anonymisation (Message par lead aussi).
  - Site : `/desinscription` (un clic, jamais à l'ouverture ; hors mesure d'audience comme /e/), politique de
    confidentialité (Anthropic, Google Gmail/Drive, section « Nos échanges par e-mail »), textes de l'espace SMS → e-mail.
  - SUIVANT : essai de bout en bout sur une copie de dev.db (iPhone), builds, commit (jamais proxy.ts), déploiement
    CRM puis site, réglages IA en prod, vérifs prod (bilan du tri en lecture, brouillon réel, mail de test aller-retour).
- 22/09 (nuit, suite) : ESSAI DE BOUT EN BOUT sur une copie de dev.db (Google coupé, faux Anthropic local, iPhone 390 × 844) :
  boîte synthétique passée par le vrai tri → À traiter 5 / Clients 5 / Administratif 2 / Rangés 5 ; lead « mail » créé ;
  main revenue chez moi au mail du client ; brouillon IA : prix et date inventés → `[à compléter]`, Envoyer grisé ;
  notification : 2 publications → 1 seul mail (tâche en attente tant que Google est coupé, puis envoyée) ; lien de
  l'espace par mail ; séquences (aperçu avec un vrai contact, activation confirmée) ; désinscription site → CRM.
  CORRIGÉ grâce à l'essai : `orange.fr` / `free.fr` / `sfr.fr` retirés de l'administratif (adresses de particuliers !) ;
  publication depuis le bloc Espace du dossier (PATCH) : événement + main + mail, comme le bouton Publier ; geste retour
  sur le volet Client ne ferme plus le mail ; doublons de la liste « À compléter » ; marges de l'onglet Mail ; « Close »
  → « Fermer » (lecteurs d'écran) ; accords (« Date … absente »). Suite 422/422, tsc, eslint, builds CRM et site OK.
- 22/09 (nuit) : DÉPLOYÉ ad69153 (CRM) + bff3c58 (site). Premier contrôle prod, lecture seule (`/api/mail/bilan`) :
  181 mails sur 120 j, 95 dans la boîte (73 non lus) → À traiter 22, Clients 13, Administratif 6, Rangés 52.
  DEUX BOGUES TROUVÉS ET CORRIGÉS (commit suivant) :
  1. Interrupteur « rangement Gmail » coupé → les mails rangés d'office restaient dans la boîte Gmail sans libellé, et
     la synchro y voyait un « remonté par Lucas » : 13 règles « jamais rangé » posées à tort (hubspot, anthropic,
     resend, tiktok, make…). Correctif : « remonté » seulement si le CRM avait vraiment sorti le mail de la boîte
     (`dansBoite` faux) ; migration `mail-remontes-fantomes-22-09` archive ces règles (par = LUCAS:gmail) et retrie
     les mails. Une seule règle visait un humain (le cabinet Bautes) : archivée aussi, sans effet (jamais du bruit).
  2. La tâche « Gmail suit le CRM » marquait LU dans Gmail un mail rangé d'office alors que l'interrupteur est coupé
     (30 tâches terminées avant le quota : jusqu'à 30 mails de bruit ont pu être marqués lus dans Gmail ; rien d'autre —
     ni libellé, ni archivage). Correctif : rangement non permis → aucun appel à Gmail (`etatGmailVoulu`, pur, testé).
  3. Quota Gmail par seconde dépassé par la relève initiale (une lecture par message connu) : remplacée par trois listes
     (INBOX, UNREAD, libellé), pause de 120 ms entre deux lectures ; rattrapage par paquets de 20 quand l'interrupteur
     passe à Actif ; le libellé n'est plus créé pour lire.
- 22/09 (nuit, fin) : CORRECTIF DÉPLOYÉ (d411534 puis b1bf665 : toute adresse « noreply » de Google = notification).
  MISSION 7 TERMINÉE. Vérifications prod, après correctif :
  - synchro : SUCCÈS, mode historique, plus aucune erreur de quota ; migration passée (0 règle fantôme restante) ;
    bilan : 184 mails / 120 j, 128 conversations → À traiter 29, Clients 18, Administratif 8, Rangés 84.
  - réglages IA posés (Sonnet 5, 1,9 / 9,5 €/MTok, 10 €/mois, rédaction ACTIVE, lecture IA EN_PAUSE) ;
    brouillon réel sur un vrai dossier : Anthropic répond `401 invalid x-api-key` → la clé Railway est INVALIDE
    (rien dépensé) : à régénérer par Lucas. Le circuit est vérifié en local avec le faux modèle (garde OK).
  - mail de test unique (fiche « Lucas », adresse personnelle) parti de Gmail ; réponse depuis cette adresse revenue
    en 3 s dans la même conversation, sur la même fiche, « attend votre réponse » ✓.
  - `MAIL_RANGEMENT_GMAIL` = ACTIF à 18:06 : rattrapage par paquets de 20 ; boîte de réception Gmail passée de 87 à
    28 mails (les rangés sont sous « CoverSwap/Rangé », lus, hors boîte ; rien supprimé). Cohérence : 0 incohérence.
  - SUIVANT (mission 8, énoncé en mémoire `project_mission8_mcp_directeur_general`) : serveur MCP « directeur général ».

# Mission 8 (22/09/2026, nuit) — Claude, directeur général : serveur MCP « piloter et conseiller »

Énoncé complet : mémoire privée `project_mission8_mcp_directeur_general` (message de Lucas « Mission autonome —
Claude, directeur général de CoverSwap : piloter et conseiller depuis l'app »). Mêmes règles permanentes. Deux
usages : PILOTER (dictée dans l'application Claude → actions dans le CRM) et CONSEILLER (données du CRM croisées
avec le web ; chaque domaine répondu par un « manager » d'analyse en un appel).

## État trouvé (22/09, soir)
- Chaque action existe déjà en code (`lib/prospects`, `lib/dossiers`, `lib/encaissements`, `lib/espace`, `lib/mail`,
  `lib/synthese`, `lib/finances`, `lib/meta`…) ; aucune intégration Google Calendar (`Planification` = cron).
- Doc Anthropic (connecteurs personnalisés, sept. 2026) : Streamable HTTP ; OAuth DCR + CIMD pris en charge ; jeton
  porteur statique en bêta limitée → OAuth choisi ; 401 doit porter `WWW-Authenticate … resource_metadata=` ;
  Claude sonde `/.well-known/oauth-protected-resource/api/mcp` puis la racine ; `/token` en form-urlencoded ;
  résultat d'outil ≤ ~150 k caractères ; appel d'outil ≤ 240 s. SDK `@modelcontextprotocol/sdk` 1.30.0 ajouté.

## Décisions
- **Couche d'outils indépendante du transport** (`src/lib/assistant/`) : `DefinitionOutil` (nom, titre, description
  française, niveau, schéma zod, masse, sensible, aperçu, executer) ; `executerOutil` (moteur : validation,
  confirmation des actions sensibles par jeton 15 min lié à l'empreinte des paramètres, masse > 3, plafond 60
  écritures/h + alerte, journal `AppelOutil`/`SessionAssistant`, acteur `ASSISTANT:claude` avec la commande dictée).
  Un outil n'a AUCUNE logique métier : il appelle `src/lib` et met le résultat en mots.
- **Catalogue** (`catalogue.ts`) : 10 lecture + point du jour + 5 managers + 20 écriture = 36 outils. Sensibles :
  générer/envoyer un document, lien d'espace, renouveler le lien, publier une simulation, encaissement (saisie et
  annulation), envoyer un mail ; « signé / facturé / encaissé / perdu » sensibles par l'entrée. « supprimer » = archiver.
- **Analyses** (`analyses/`) : commercial (cohorte des leads reçus, entonnoir, temps par étape via `parcoursEtapes`,
  pertes, effet du délai de rappel, devis en attente, panier), finances (`calculerFinances` pur, marge par chantier,
  projection 30/60/90, seuils via `chargerTableauFinances`, versable = règle du plancher lue dans les consignes),
  marketing (dépense = dépenses « Publicité » saisies sinon prorata de la campagne ; jamais la dépense réelle Meta,
  dit dans les définitions ; qualité par source ; géographie par zone d'intervention), clients (état, à réactiver
  > 180 j, avis, espaces), opérations (charge par semaine vs capacité des consignes, actions, rappels, relances dues,
  retards, santé). Chaque résultat porte ses définitions et un avertissement « données minces » (< 10).
- **Consignes** : `ReglageTexte` `CONSIGNES_ASSISTANT` + `POSITIONNEMENT_ASSISTANT` (défauts dans `consignes.ts`,
  section Conseil avec capacité 8 chantiers/mois, réinvestissement 20 % plafonné 500 €/21 j, plancher 2 000 € —
  « à ajuster » par Lucas), exposées en ressources MCP `coverswap://consignes` et `coverswap://positionnement`.
- **Campagne** : paramètres `CAMPAGNE_DEBUT/BUDGET/DUREE_JOURS` (groupe Publicité) ; jour + règle lue dans la section
  Protocole des consignes (`regleDuJour`).
- **Google Calendar** : portée `calendar.events` ajoutée à `PORTEES_GOOGLE.AGENDA` (accordée à la prochaine
  reconnexion) ; sans le droit, l'outil `planifier` écrit dans le CRM et le dit.
- **OAuth 2.1 auto-hébergé** (`src/lib/oauth/serveur.ts`) : découverte RFC 9728/8414 (routes réelles sous
  `src/app/.well-known/`), enregistrement dynamique RFC 7591 (`/api/oauth/register`, limité), documents d'identité
  (client_id https, gardés 24 h), consentement sur `/oauth/autoriser` DERRIÈRE la session du CRM (POST
  `/api/oauth/autoriser`, origine vérifiée), PKCE S256 obligatoire, codes et jetons hachés SHA-256, accès 12 h,
  renouvellement 90 j avec rotation et détection de réutilisation (toute la famille tombe), révocation par jeton,
  par client ou totale (Paramètres). Aucun secret à recopier : la session de Lucas est la clé.
- **Serveur MCP** (`src/lib/mcp/serveur.ts`, `/api/mcp`) : sans état, un `McpServer` par requête, réponses JSON ;
  jeton vérifié à chaque requête, 401 + `WWW-Authenticate` sinon ; GET = 405 ; nom du client MCP lu sur la requête
  `initialize`. Outils = catalogue (description préfixée du niveau, `readOnlyHint`), ressources, prompt
  `point_du_matin`. Réponse = texte + liens + JSON exact (tronqué à 60 k).
- **Écrans** : Paramètres → Assistant Claude (adresse, marche à suivre, connexions révocables, consignes et
  positionnement modifiables, catalogue plié) ; Tâches de fond → Sessions de l'assistant (journal par jour).
- **RGPD** : `CodeOAuth`/`JetonOAuth` (clientId = application, utilisateur = Lucas) et `AppelOutil` déclarés
  « conservés » dans la carte.

## Lots
- [x] A1 Schéma (ClientOAuth, CodeOAuth, JetonOAuth, SessionAssistant, AppelOutil, ConfirmationAssistant),
      acteur ASSISTANT, paramètres de campagne, portée agenda, routes publiques.
- [x] A2 Couche d'outils : définition, moteur, recherche tolérante, périodes, consignes, agenda, lecture,
      point du jour, écriture, 5 managers, catalogue.
- [x] A3 OAuth (lib + routes + page de consentement) et serveur MCP (`/api/mcp`).
- [x] A4 Écrans Paramètres et Tâches de fond ; API privées `/api/assistant/{acces,consignes,sessions}`.
- [x] A5 Tests : `assistant.test.ts` (21 : refus, journal, plafond, dates dictées, calculs purs vs indépendants,
      managers sur base), `oauth.test.ts` (12), `mcp.test.ts` (7 : client SDK réel sur la route, 401, 5 exemples du
      mandat). Suite complète 465/465 après mise à jour de `routes-publiques` et de la carte RGPD.
- [x] A6 Essai HTTP réel sur la copie de base (serveur `crm-essai-m8`, scratchpad `m8/flux-oauth.mjs`) : 401 →
      découverte → consentement → code → jetons → 36 outils, 2 ressources, managers sur données réelles ; rotation
      du jeton : l'ancien accès rend 401.
- [ ] A7 Build, commit (jamais proxy.ts), déploiement Railway, vérifications prod (répond, refuse sans jeton,
      n'expose rien), rapport (outils + niveaux, connexion, 8 commandes, fragilités).

## Journal
- 22/09 (nuit) : TOUT ÉCRIT ; 40 tests de la mission verts, suite 465/465, tsc + eslint propres ; essai HTTP de bout en
  bout réussi en local. Reste : build, commit, déploiement, contrôle prod, rapport.
