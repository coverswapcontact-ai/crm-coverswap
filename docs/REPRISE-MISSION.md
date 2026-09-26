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
- [x] A7 Build, commit `90a8659` (+ `d1f817b` nom du client MCP après rotation, + docs), déploiement Railway,
      vérifications prod en lecture seule (découverte 200, `/api/mcp` 401 + `WWW-Authenticate` sans jeton et avec un
      faux jeton, `/oauth/autoriser` renvoyé vers la connexion, API privées 401, `/register` vide → 400 sans création),
      rapport publié (artefact « Directeur général Claude »).

## Journal
- 22/09 (nuit) : TOUT ÉCRIT ; 40 tests de la mission verts, suite 465/465, tsc + eslint propres ; essai HTTP de bout en
  bout réussi en local.
- 22/09 (nuit, fin) : DÉPLOYÉ `90a8659` puis `d1f817b`. Contrôle prod (lecture seule, aucune donnée créée) : OK sur
  tous les points. MISSION 8 TERMINÉE côté code. Reste pour Lucas : ajouter le connecteur dans l'application Claude
  (Paramètres → Assistant Claude explique) ; reconnexion Google avant le 29/09 (donne aussi le droit agenda) ;
  clé Anthropic et jeton Meta toujours invalides sur Railway ; ajuster les consignes (capacité, plancher de réserve,
  protocole de campagne) et poser les paramètres de campagne (Paramètres → Campagne publicitaire) et les dépenses
  « Publicité » pour que le manager marketing ait une dépense réelle.

# Mission 9 (23/09/2026) — Mail v2 : le mail piloté depuis l'assistant Claude (MCP)

Énoncé complet : mémoire privée `project_mission9_mail_v2_mcp` (message de Lucas « Mission autonome — Mail v2 : le
mail piloté depuis l'assistant Claude (MCP) »). Mêmes règles permanentes. PRINCIPE : aucune clé API Anthropic ; le
CRM stocke, structure, affiche, expose des outils ; Claude (app, abonnement de Lucas) lit, réfléchit, écrit par le
MCP ; Lucas valide. Le CRM garde seul : rangement du bruit par règles, notifications de l'espace, relances sans
réponse. L'ancien chemin API reste derrière `IA_CRM_ACTIVE` (en pause par défaut → « via l'assistant Claude »).

## État trouvé (23/09)
- Onglet Mail (mission 7) : `mail/vues.ts` (À traiter / Clients / Administratif / Rangés, par fil, 120 j),
  `mail/detail.ts` (fil, contexte, brouillons, envois, `envoyerDepuisLOnglet` bloque « [à compléter] »),
  `mail/boite.ts` (tri, règles `RegleExpediteur`, gestes lu/archiver/remonter/ne plus montrer/classer, état Gmail),
  `mail/rattachement.ts` (`rattacherALaMain`, `creerLeadDepuisMail`), `mail/redaction.ts` (IA du CRM),
  `messages/analyse.ts` (ancienne lecture IA, tâche ANALYSE_MESSAGE, gardée par `etatIa`).
- Propositions (`validation/`) : `Proposition` + catalogue de types (`definirProposition` : schéma, sensible, champs
  corrigeables, exécution IMMEDIATE/FILE, `pertinente`), `validerProposition`/`rejeterProposition`, écran « À valider ».
- MCP (mission 8) : 36 outils, `executerOutil` (confirmation, masse > 3, plafond), `lireDateDictee`.
- Seuls appelants du modèle : `mail/redaction.ts` (bouton Rédiger, `rediger_mail`) et `messages/analyse.ts`
  (tâche de fond), tous deux via `ia/modele.ts` → `etatIa`.

## Décisions
- **`IA_CRM_ACTIVE`** (paramètre, groupe Agent, EN_PAUSE par défaut = absent) : lu dans `lireReglages` ; en pause,
  `etatIa` est inactif pour TOUS les usages avec la raison `RAISON_VIA_ASSISTANT` → aucun appel modèle possible
  côté serveur (bouton Rédiger désactivé « via l'assistant Claude », `rediger_mail` refuse, tâche ANALYSE sautée).
- **Modèle** : sur `Message` → `intention` (REPONSE|ACTION|INFORMATION|null), `intentionAttendu`, `intentionPar/Le`,
  `datesExtraites` (JSON, chaque date avec son passage), `snoozeJusqua/Le/Par`. Nouveau `ResumeFil` (par fil :
  résumé, points en suspens JSON, par). `BrouillonMail.source` (IA_CRM | ASSISTANT). Propositions de mise à jour =
  type `MAJ_DEPUIS_MAIL` du système de validation existant (une carte = une proposition : cible, champ, valeur,
  passage cité ; sensible si montant / adresse / date de chantier ; exécution = `modifierDossier`, `modifierClient`,
  `enregistrerPrestations`, `enregistrerProjet` (espace), `modifierEntrant` — mêmes règles que la fiche/l'espace).
  Règles proposées = type `REGLE_TRI` (→ `poserRegle`). Traçabilité = journal existant (acteur + origine avec la
  commande) + colonnes `…Par/…Le`.
- **Priorité** (CRM, `mail/priorite.ts`, pur) : 0 snoozé revenu « Revenu » ; 1 réclamation (mots-clés) ; 2 devis en
  attente (par montant) ; 3 dossier actif ; 4 lead ; 5 administratif avec échéance ; 6 reste. Tri d'« À traiter ».
- **Règles apprises** (`mail/regles-apprises.ts`) : après un geste à la main, 3 gestes identiques sur la même adresse
  (rangé / classé) → proposition `REGLE_TRI` (clé d'unicité par cible+action). Rattacher : l'adresse va sur la
  fiche → reconnue seule, pas de règle. Paramètres → Mail : règles proposées (valider/ignorer), règles à la main.
- **Chronologie** (`chronologie/`) : une lecture par contact (mails, notes d'appel, événements du dossier dont
  espace, notes, propositions validées), filtrable ; rendue par `lire_mail`, la fiche client et le panneau dossier.
- **Outils** (`assistant/outils/mail.ts`) : lecture `lire_mail`, `mails_non_classes`, `rechercher_mails`
  (+ `mails_a_traiter` enrichi) ; réversibles `classer_mail` (masse), `resumer_fil`, `proposer_mise_a_jour`,
  `valider_proposition` (sensible selon le contenu, `sensible` async), `ignorer_proposition`, `deposer_brouillon`,
  `snoozer_mail`, `rattacher_mail`, `ranger_mail`, `proposer_regle` ; `envoyer_mail` inchangé (bloque « [à
  compléter] »). `planifier` extrait dans `agenda/planification.ts` (partagé avec le bouton Planifier du mail).
- **Consignes** : section « ## Mail » ajoutée aux consignes par défaut, et jointe à la lecture si un texte de Lucas
  ne la contient pas.

## Lots
- [x] B1 Schéma, `IA_CRM_ACTIVE`, `lireDateDictee` (heure par défaut, « dans une semaine »), `sensible` async.
- [x] B2 Lib mail v2 (`mail/v2.ts`, `mail/priorite.ts`, `mail/regles-apprises.ts`, `mail/propositions-maj.ts`,
      `mail/appliquer.ts`, `chronologie/chronologie.ts`, `agenda/planification.ts`) ; `validation/decideur` admet
      l'acteur ASSISTANT ; les cartes s'exécutent en FILE puis tout de suite (`appliquerProposition`) car le code de la
      fiche ouvre ses propres transactions.
- [x] B3 13 outils MCP (`assistant/outils/mail.ts`, famille MAIL), consignes : `SECTION_MAIL` jointe à la lecture,
      `mails_a_traiter` enrichi (priorité, intention, attendu, cartes, brouillon prêt, revenu), `rediger_mail` refuse
      quand l'IA du CRM est en pause.
- [x] B4 Écrans : liste (pastilles priorité / intention / cartes / brouillon prêt / remis, ligne « → attendu »),
      panneau (`MailV2.tsx` : intention corrigeable, résumé, cartes valider/ignorer, dates → Planifier, Plus tard,
      Ranger, brouillon déposé → Reprendre → Envoyer, bouton « Rédiger : via l'assistant Claude »), Paramètres → Mail
      (règles proposées valider/ignorer, règle à la main), `Chronologie.tsx` (fiche client, panneau dossier) ; API
      `/api/chronologie`, `/api/mail/[id]/{intention,snooze,planifier}`, `/api/mail/propositions/[id]`, action RANGER.
- [x] B5 Tests : `mail/mail-v2.test.ts` (12 : IA du CRM inactive même avec clé + réglages, priorité, règles apprises,
      classement, résumé, snooze lundi 9 h, ranger réversible + règle au 3e geste, recherche, cartes valider/ignorer/
      sensible/sans espace, brouillon bloqué) ; `mcp/mcp-mail.test.ts` (12 : les dix phrases par le client SDK,
      journal, fetch surveillé : 0 appel Anthropic). Suite complète 489/489 (`messages.test.ts` lève l'interrupteur
      général pour couvrir l'ancien chemin). Essai HTTP réel sur la copie (`m8/flux-mail.mjs` : 49 outils, classement,
      résumé, brouillon, snooze, À traiter par priorité) et onglet Mail contrôlé à 375 × 812 (liste, panneau : intention,
      résumé, date → Planifier, Plus tard, Ranger, brouillon déposé → Reprendre, « Rédiger : via l'assistant Claude »).
- [x] B6 Build OK, commit `0342388`, déployé (health = 0342388), contrôle prod en lecture seule : découverte OAuth 200,
      `/api/mcp` sans jeton 401 + `WWW-Authenticate`, routes mail privées (307 vers la connexion / 401), aucune
      donnée créée ; rapport publié (artefact « Mail piloté par Claude »).

## Journal
- 23/09 : inventaire fait, décisions posées ; B1 à B5 écrits, tsc + eslint propres, 24 tests de la mission verts.
- 23/09 (suite) : suite complète verte, essai iPhone fait ; constantes des écrans sorties des modules serveur
  (`mail/intentions.ts`, `chronologie/familles.ts` : un import serveur dans un composant client casse le bundle).
- 23/09 (fin) : DÉPLOYÉ `0342388`, contrôle prod OK. MISSION 9 TERMINÉE côté code. Reste pour Lucas : la clé
  ANTHROPIC_API_KEY de Railway peut être retirée (plus aucun appel serveur tant que `IA_CRM_ACTIVE` est en pause) ;
  reconnexion Google avant le 29/09 (rangement Gmail, agenda) ; jeton Meta ; dire à Claude « classe mes mails ».

---

# Mission 10 — MCP v2 : les actions qui manquent à l'assistant (23/09/2026)

Énoncé complet : mémoire privée `project_mission10_mcp_v2_actions` (message de Lucas « Mission autonome — MCP v2 : les
actions qui manquent à l'assistant »). Mêmes règles permanentes, même architecture que les missions 8 et 9 (niveaux
lecture / réversible / sensible avec aperçu et jeton, journal avec la phrase, plafond d'écritures, aucune clé Anthropic).

## État trouvé (23/09, après la mission 9)
- 49 outils au catalogue ; `ResultatOutil` = texte + données + liens + jeton (pas d'image) ; le serveur MCP ne rend que
  du texte. `modifierDossier` (champs du dossier, sans trace « avant/après » lisible hors journal), `enregistrerPrestations`
  (familles/sous-parties, événement PRESTATIONS), `enregistrerProjet` (espace : tailles, précisions, acteur CLIENT).
- Photos : `Dossier.photos` (chemins, id = base36 de l'horodatage), `PhotoLead` (origine), rendus du site dans les photos
  (`Simulation.photosDossier`), `photosDuClient` ; `sharp` déjà installé (simulateur). Simulations : `listerSimulationsDossier`,
  `imageSimulationDossier`.
- Espace : le client écrit (`envoyerMessage` → événement ESPACE_MESSAGE + alerte ; `commenterSimulation` ; `demanderProposition`)
  mais AUCUNE réponse de Lucas dans l'espace n'existe ; notifications automatiques (`mail/notifications.ts`, 4 événements).
- Simulateur : `preparerSimulation` (mode CHATGPT : prompt + planche + photo cadrée), page `/simulateur?dossier=` sans
  paramètre de préparation ; catalogue des teintes (`catalogue()`, `correspondRecherche`).
- Consignes : `ReglageTexte` (une valeur, écrasée), pas d'historique. Tarifs : `tarifsDesPrestations`, `attribuerTarif`,
  `modifierPreset`. Dépenses : `listerDepenses(annee)`. Lien d'espace : `proposerLienParMail` (phrases non exportées).
- Sauvegardes : au démarrage, avant migration, à la main ; jamais périodiques, jamais purgées (compressées seulement) ;
  disque : un seul seuil (« < 100 Mo ») dans `sante_systeme`.

## Décisions
- **Schéma** : `Dossier.dateSouhaitee`, `Dossier.dateFinChantier`, `Dossier.teintes` (JSON `{ "CUISINE.ilot": "chêne" }`,
  une teinte par sous-partie, affichée dans Familles du projet) ; `ModificationDossier` (champs JSON avant/après, par,
  commande, annuleeLe) ; `MessageEspace` (auteur CLIENT | LUCAS, source MESSAGE | COMMENTAIRE | PROPOSITION | REPONSE,
  luLe, notifieLe) ; `VersionTexte` (cle, numero, texte, par, commande).
- **`modifier_dossier`** (réversible ; sensible si montant, date de chantier/fin, adresse) : `dossiers/modification-assistant.ts`
  = une entrée par champ (objet, montant_estime, date_souhaitee, date_chantier, date_fin_chantier, adresse, email,
  telephone, prochaine_action(+date), familles, teintes, dimensions, notes_projet), lecture de l'avant, application par le
  code existant (`modifierDossier`, `enregistrerPrestations` auteur LUCAS, souhaits de l'espace), trace `ModificationDossier`
  + événement DOSSIER_MODIFIE, `recalculerMain`, devis émis signalé (« le devis 2026-037 ne correspond plus »).
  `annuler_modification` remet chaque champ à sa valeur d'avant (même chemin), marque `annuleeLe`.
- **Images MCP** : `ResultatOutil.images` (base64 JPEG ≤ 1024 px, qualité 72, via sharp) → blocs `image` du serveur MCP.
  `voir_photos` (dossier ou lead : 6 dernières par défaut, `nombre`/`decalage`, origine : client/site/simulateur/CRM,
  date de l'id) ; `voir_simulations` (avant/après, teintes, statut, vue par le client).
- **Espace** : `messages_espace` (non lus, par client) ; `repondre_espace` (sensible : « [à compléter] » bloque ; message
  LUCAS + événement ESPACE_REPONSE (SORTANT → main au client) + notification MESSAGE_LUCAS (mécanique existante,
  `{message}`) + messages du client marqués lus) ; migration de reprise des ESPACE_MESSAGE / COMMENTAIRE / PROPOSITION
  passés en `MessageEspace` ; site : fil « Vos échanges » dans Contact (`Compte.messages`), réponses marquées lues à la
  visite.
- **`preparer_simulation`** (réversible) : teintes par nom (catalogue, ambiguïté → candidats), zone par id ou libellé,
  photo = dernière du client à défaut, `preparerSimulation` mode CHATGPT ; lien `/simulateur?dossier=…&preparation=…`
  (l'écran recharge la préparation). Rien généré, rien publié.
- **`modifier_consignes`** (sensible, diff par section, versions) + `restaurer_consignes` (réversible) ; Paramètres →
  Assistant Claude : historique des versions avec « Restaurer ». **`modifier_tarifs`** (sensible) : tarif d'une
  sous-partie (preset explicite modifié, sinon créé et attribué) ; les devis émis ne bougent pas (figés).
- **`depenses`** (lecture : période, catégorie, rattachement) ; **`lien_espace`** (réversible : ouvre l'espace et le dossier,
  rend lien + SMS prêt à copier, événement ESPACE_LIEN_COMMUNIQUE → main au client, aucun envoi).
- **Sauvegardes** : `selectionnerAGarder` (pur : 7 quotidiennes + 4 hebdomadaires, tout le reste purgé), travail
  périodique « sauvegarde quotidienne » (une copie par jour civil, puis tâche PURGE_SAUVEGARDES journalisée dans Tâches
  de fond) ; `capaciteVolume` → `sante_systeme.disque { libreMo, totalMo, pourcent }` ; alertes ATTENTION ≥ 70 %,
  URGENT ≥ 85 % (`calculerAlertes`).
- **Compléments** : `ce_qui_m_attend` et `point_du_jour` comptent les messages d'espace non lus et les propositions en
  attente ; `chercher` accepte une adresse et un numéro de devis/facture ; section « ## Dossiers, photos, espace »
  jointe aux consignes à la lecture.

## Lots
- [x] C1 Schéma (`ModificationDossier`, `MessageEspace`, `VersionTexte`, `Dossier.dateSouhaitee/dateFinChantier/teintes`),
      `ResultatOutil.images` → blocs image MCP (`assistant/images.ts`, sharp ≤ 1024 px JPEG 72), `assistant/photos.ts`
      (inventaire : origine, date de l'id), `dossiers/modification-assistant.ts` (valeurs avant/après, application par le
      code existant, trace, devis signalé, annulation), `prestations/reperage.ts` (famille / sous-partie en mots),
      outils `modifier_dossier`, `annuler_modification`, `voir_photos`, `voir_simulations` ; teintes dans Familles du
      projet, dates dans le formulaire du dossier et `lire_fiche`.
- [x] C2 `espace/messages.ts` (messages client rangés depuis `envoyerMessage` / `commenterSimulation` /
      `demanderProposition`, `repondreDansLEspace` : message LUCAS + ESPACE_REPONSE + notification MESSAGE_LUCAS +
      lus + main au client), migration `2026-09-23-messages-espace` (reprise, marqués lus), `Compte.messages` +
      `POST /messages/vus` (site : fil « Vos échanges » dans Contact, « N réponses à lire » sur l'accueil), rubrique
      Messages + réponse dans le panneau du dossier, outils `messages_espace`, `marquer_messages_lus`, `repondre_espace`.
- [x] C3 `simulateur/preparation-assistant.ts` + `preparer_simulation` (zones et teintes en mots, candidats, conflit de
      zone bloquant, `?preparation=` rouvre la page), consignes versionnées (`VersionTexte`, v1 = état d'avant, sections,
      diff, `SECTION_ACTIONS`) + `modifier_consignes` / `versions_consignes` / `restaurer_consignes` + historique dans
      Paramètres → Assistant Claude, `prestations/tarifs.ts › modifierTarifSousPartie` + `tarifs` / `modifier_tarifs`,
      `depenses`, `mail/lien-espace.ts › proposerLienParSms` + `lien_espace` (ESPACE_LIEN_COMMUNIQUE → main au client).
- [x] C4 `sauvegarde.mjs` : `capaciteVolume`, `dateDuNom`, `selectionnerAGarder` (7 quotidiennes + 4 hebdomadaires des
      semaines d'avant), `purgerSauvegardes`, `sauvegardeDuJourExiste` ; `base/taches.ts` : travail « sauvegarde-quotidienne »
      (une copie par jour, puis tâche PURGE_SAUVEGARDES journalisée avec son bilan, visible dans Tâches de fond) ;
      `sante_systeme.disque` (pour cent, niveau 70 / 85), alertes DISQUE_70 / DISQUE_PLEIN dans `calculerAlertes`.
- [x] C5 `ce_qui_m_attend` et `point_du_jour` (messages d'espace non lus, propositions en attente, derniers messages) ;
      `chercher` par adresse (numéro compris) et numéro de devis / facture ; `lireDateDictee` comprend « 12 octobre » ;
      catalogue : 64 outils.
- [x] C6 Tests : `mcp/mcp-v2.test.ts` (15, client SDK : toutes les phrases du mandat, fetch surveillé : 0 appel Anthropic,
      0 réseau), `base/retention.test.ts` (5 : 15 copies fictives → 7 + 4 gardées, purge par la tâche journalisée) ;
      `rgpd/carte.ts` complété (ModificationDossier, MessageEspace) ; suite complète 509/509 ; tsc + eslint propres
      (CRM et site) ; essai HTTP réel sur la copie (`m8/flux-v2.mjs`, `m8/prep-v2.mjs` : 64 outils, photos en images
      45 Ko, messages repris, modification annulée, paquet ChatGPT, consignes v2, réponse à Olga sans e-mail → dit) ;
      écrans : `/simulateur?preparation=` rouvre le paquet, Paramètres → historique (2), Tâches de fond → purge
      journalisée (bilan lisible) + travail quotidien OK, panneau du dossier → rubrique Messages.
- [x] C7 Build OK (CRM et site, proxy local restauré), commit CRM `7d9a464`, site `b3f1f0f`, tous deux déployés (health
      CRM = 7d9a464, site = b3f1f0f) ; contrôle prod en lecture seule (`scratchpad/m10/controle-prod.sh`) : découverte
      OAuth 200, `/api/mcp` 401 + WWW-Authenticate, consignes GET/PATCH et geste d'espace 401 sans session, jeton
      d'espace invalide 404 sans écriture, écrans 307 vers la connexion ; aucune donnée créée ; rapport publié
      (artefact « Les actions qui manquaient ») ; mémoire à jour.

## Journal
- 23/09 : inventaire fait, décisions posées ; C1 à C5 écrits ; tsc et eslint propres (CRM et site) ; tests de la mission
  verts en isolation (mcp-v2 15/15, rétention 5/5) ; suite complète lancée.
- 23/09 (fin de matinée) : suite complète 509/509 (carte RGPD complétée), essai HTTP et écrans sur la copie, builds OK,
  DÉPLOYÉ (CRM `7d9a464`, site `b3f1f0f`), contrôle prod OK. MISSION 10 TERMINÉE côté code. Reste pour Lucas : agrandir
  le volume Railway (500 Mo → 5 Go, ≈ 0,25 $/Go/mois, engage de l'argent : non fait) ; les réponses d'espace ne
  préviennent que par mail (sans adresse, SMS ou appel à la main) ; ajouter « regarde ses photos » avant de demander
  une teinte à Claude.

---

# Mission 11 — Devis multiples dans l'espace client + libérer le MCP (25/09/2026)

Énoncé de Lucas (25/09/2026, collé dans la conversation) : « Devis multiples dans l'espace client + libérer le MCP ».
Mails et SMS automatiques : n'en ajouter aucun, rendre débrayables ceux qui existent. Ne pas toucher au calcul des
montants ni à la trame PDF. Tests exigés : deux devis visibles, validation de l'un, l'autre passe en non retenu ;
`creer_contact` refuse un doublon ; `tools/list` expose tous les outils. Mettre ce journal à jour à la fin.

## État trouvé (25/09)
- Cas réel Fawzi Fares (`cmugt1jhf07u2zd4dy3ldogaa`, lu en prod en lecture seule) : devis 2026-041 (1 725 €) et 2026-042
  (2 415 €), tous deux REPRIS (PDF déposés) et ENVOYE ; l'espace ne montre que le dernier (`devisEnVigueur` = accepté,
  sinon le plus récent) ; un seul `EtatEspace.devis`, un seul accord possible. Aucun libellé de variante, pas
  d'interrupteur de visibilité ; `Document` figé à l'émission (statut et pdfPath modifiables).
- Génération : `remplaceDocumentId` explicite (l'outil MCP ne remplaçait jamais, mais le nouveau devis cachait l'ancien) ;
  `emettre` envoie toujours la notification DEVIS_DISPONIBLE (débrayable seulement par le modèle dans Paramètres → Mail).
- « tool not registered » : les 13 outils mail répondent en prod depuis le connecteur de cette session (tools/list = 64) ;
  le défaut est la liste d'outils mise en cache par l'app Claude (connecteur ajouté à la mission 8). Les schémas JSON
  des outils mail n'ont rien de particulier (`anyOf` comme les outils d'écriture).
- Automatismes qui envoient au client : notifications de l'espace (modèle `actif` par événement), accusé de réception
  SMS d'un lead Meta (modèle SMS `actif`), séquences (inactives par défaut). Le reste est à la main ou proposé.
- Lead Meta : `normaliserLeadMeta` reconnaît nom, tél, mail, ville, CP, projet ; `qualification` déduit occupation et
  délai (écrits sur le lead) ; le « message » libre reste dans `notes`/réponses. Écran Publicité : « non connecté » si
  la config (signature, vérification) ou l'abonnement manque, même quand les leads arrivent.

## Décisions
- **Devis multiples** : `Document.libelleVariante`, `Document.visibleEspace` (défaut vrai) ; statut `NON_RETENU`.
  `faits.ts › devisProposes` (tous les devis en vigueur, du plus ancien au plus récent) ; `devisEnVigueur` inchangé
  (accepté, sinon le dernier : compatibilité). `EtatEspace.devisProposes` (visibles seulement) ; le site montre un
  choix côte à côte quand il y en a plusieurs, l'accord porte le devis choisi ; `accepterDevis` passe les autres en
  NON_RETENU (événement avec numéros et libellés) ; `retirerAccord` les rend (ENVOYE). Panneau du dossier (rubrique
  « Devis et accord ») : liste, interrupteur de visibilité, « Ajouter un devis » (générateur, libellé, sans
  remplacement), « Déposer un PDF » (document existant + libellé + visibilité) ; onglet Espaces : lien « Ajouter un
  devis ». `generer_document` : `libelle_variante`, `notifier` (défaut vrai), `remplace` explicite seulement,
  `avenant_de`, `depuis_devis` (facture depuis les lignes d'un devis), ligne de remise (prix négatif permis sur une
  ligne « Remise … » seulement : validation, pas calcul) ; `annuler_document` (devis → ANNULE, facture → avoir).
- **MCP** : `lister_outils` + `assistant/couverture.ts` (registre : actions de l'interface → outil) + test SDK
  `tools/list` = catalogue ; `/api/health` expose `outils { nombre, empreinte }` pour vérifier le déploiement sans
  jeton ; consigne : si l'app dit « tool not registered », reconnecter le connecteur (liste en cache).
- **Nouveaux outils** : `creer_contact` (lead + fiche client, refus si même tél/mail ; même nom + ville → refus sauf
  `forcer`), `deposer_document` (PDF externe : pièce de mail conservée ou base64 ; devis/facture = document repris,
  autre = pièce jointe du dossier), `simulations_site` (avec images), `voir_parametres` / `modifier_parametres`
  (paramètres + automatismes débrayables ; nouveaux paramètres CAPACITE_CHANTIERS_MOIS, TRESORERIE_RESERVE),
  `voir_relances` / `relancer` / `annuler_relance` (propositions ENVOI_MAIL motif RELANCE_DEVIS), `supprimer` =
  corbeille 30 jours (archivage motif CORBEILLE, purge quotidienne = anonymisation RGPD) et `definitif: true` (sensible
  : anonymisation immédiate), `changer_teinte` (une teinte par sous-partie, tracée), `voir_publicite` (voyant honnête :
  leads reçus / lecture des formulaires / notifications) + extraction du message libre Meta dans `Lead.message`.

## Lots
- [x] F1 Devis multiples : `Document.libelleVariante` / `visibleEspace`, statut `NON_RETENU` (ANNULEE → « Annulé »),
      déclencheurs (présentation modifiable), `faits.ts › devisProposes` + `LectureDevis.proposes`, espace
      (`EtatEspace.devisProposes` visibles, `accepterDevis` → les autres NON_RETENU avec événement nommé, refus d'un devis
      masqué, `retirerAccord` et retour d'étape les rendent ENVOYE), `documents.ts` (`libelleVariante`, `notifier`,
      remise = ligne « Remise … » négative par `refine`, `modifierPresentationDevis`, `annulerDevis`),
      `documents-existants.ts` (libellé, visibilité), `vue-crm.ts › devisProposes` (non retenus compris),
      PATCH `{visibleEspace, libelleVariante}` = présentation, route `POST …/documents/[documentId]/annulation`,
      `main.ts` (« Il a choisi le devis X (libellé) : fixer la date du chantier »), `lire_fiche`, `point_du_jour`,
      `suivi.ts › devisProposes` ; CRM : rubrique « Devis et accord » (liste, interrupteur, « Ajouter un devis »,
      « Déposer un devis PDF »), générateur (libellé, mail débrayable, « Ajouter un devis »), document existant
      (libellé, visibilité, dépôt), liste des documents (libellé, masqué, non retenu, « Annuler ce devis »), onglet
      Espaces (liens `devis=variante` / `devis=pdf`) ; site : `Devis` + `devisProposes`, choix côte à côte dans
      `EtapeDevis`, phrase d'accueil, carte « Mes projets ».
- [x] F2 `generer_document` étendu (`libelle_variante`, `notifier`, `remplace`, `depuis_devis`, `avenant_de`, `remise`,
      lignes reprises), `annuler_document` (devis → Annulé, facture → avoir), `deposer_document`
      (`dossiers/depot-document.ts` : pièce de mail conservée / fichier conservé / base64 ; devis-facture = document
      repris + PDF ; AUTRE = `Fichier` + événement DOCUMENT_DEPOSE + `GET /api/fichiers/[id]`), `creer_contact`
      (`prospects/creation-assistant.ts` : doublons par coordonnées, par nom + ville sur les leads ET les fiches
      client, `forcer`, `ouvrir_dossier`), `simulations_site` (`SimulationSite` avec images), `changer_teinte`
      (`repererSousPartie` + `modifierDossierAssistant`, candidats en cas de doute), `presenter_devis` (libellé et
      visibilité d'un devis émis = l'interrupteur du panneau) et `retirer_accord` (le geste du panneau, sensible).
- [x] F3 `automatismes/interrupteurs.ts` (notifications de l'espace ×5, SMS d'accusé, séquences ×4, IA_CRM,
      rangement Gmail) + `voir_parametres` / `modifier_parametres` (groupe PILOTAGE : `TRESORERIE_RESERVE`,
      `CAPACITE_CHANTIERS_MOIS` ; solde OpenAI relevé/estimé ; jamais de secret), `relances/service.ts` refondu
      (`listerRelances`, `relancerDevis` partagé avec la passe périodique) + `voir_relances` / `relancer` /
      `annuler_relance`, `prospects/corbeille.ts` (`supprimer` = corbeille 30 j, motif « Corbeille (effacement le …) »,
      `definitif` sensible, purge quotidienne = anonymisation, jamais un DELETE ; factures et paiements bloquent),
      `voir_publicite` + `SanteMeta.webhook.recoit` (OUI / PRET / NON) repris par l'écran Publicité,
      `Lead.message` depuis le formulaire Meta (`messageDesReponses`), `assistant/couverture.ts` (registre dérivé du
      catalogue, empreinte) + `lister_outils` + `/api/health › outils`, consignes `SECTION_MISSION11`.
- [ ] F4 Tests : `espace/devis-multiples.test.ts` (5), `mcp/mcp-v3.test.ts` (10, client SDK : tools/list = catalogue,
      doublon refusé, devis multiples sans mail, dépôt PDF, teintes, paramètres, relances, corbeille + purge, journal),
      suite complète 524/524, tsc et eslint OK (CRM et site), essai local sur la copie (`m8/flux-v3.mjs`, `m8/point-v3.mjs`
      : 76 outils, deux devis proposés à Olga, accord donné depuis le site → l'autre non retenu, panneau et outils
      cohérents). Reste : build, commit, déploiement CRM puis site, vérification Railway (health `outils`), rapport,
      journal.

## Pièges rencontrés
- Une séquence unicode échappée (antislash-u) tapée dans une commande arrive décodée : construire l'échappement avec
  `chr(92)` ; et dans un attribut JSX (`phrase="…"`) elle n'est PAS un échappement : passer par `{"…"}`.
- Le client Prisma cache les lignes archivées par défaut (`count` d'un lead à la corbeille = 0) : `findUnique` pour les
  relire, `AVEC_ARCHIVES` ailleurs.
- `rejeterProposition` exige un motif du catalogue de la proposition : « annuler une relance » = `annulerProposition`.
- L'exécution d'une proposition validée passe par la file des tâches : dans les tests (file coupée), le mail est
  programmé ou son exécution attend en file.
- Le panneau du dossier ne se rafraîchit pas seul après un geste du client dans son espace (recharger).
- Le volet navigateur de l'app est petit : les clics `computer` sur un viewport émulé manquent leur cible ; les
  interactions ont été jouées par `javascript_tool` (clics dispatchés, valeurs posées par le setter natif).

## Journal
- 25/09 : inventaire fait (prod en lecture seule), décisions posées ; F1, F2, F3 livrés ; tests et essai local OK ;
  builds OK ; commit CRM `573b20d` (76 outils) déployé (health = 573b20d), site `3847330` déployé (health = 3847330).
  Puis `presenter_devis` et `retirer_accord` (78 outils, `mcp-v3.test.ts` = 11) : commit `1028cb1`, déployé (health =
  1028cb1, `outils { nombre: 78, empreinte: b815b91b76be }`). Contrôle prod en lecture seule (`scratchpad/m11/controle-prod.sh`)
  : routes nouvelles 401 sans session, MCP 401 + WWW-Authenticate, découverte OAuth 200, espace invalide 404, site
  3847330 ; `lire_fiche` de Fawzi Fares : ses deux devis proposés, sans libellé (rien écrit en prod). Rapport :
  artefact « Plusieurs devis, un seul signé », https://claude.ai/artifact/H56RJenVEMrpQknUuPtbfP. Reste à Lucas :
  reconnecter le connecteur (liste d'outils en cache), libellés des devis de Fawzi (`presenter_devis`), paramètres
  PILOTAGE et DELAI_RELANCE_DEVIS, jeton Meta de page à renouveler (conversions refusées, code 190). Volume Railway :
  agrandi (4,4 Go).
- [x] F4 (fin) : déploiement CRM puis site vérifiés, rapport publié, journal et mémoire à jour.

# Mission 12 (26/09/2026) — Corrections autonomes, puis audit général

Énoncé de Lucas (26/09/2026) : « Corrections autonomes, puis audit général du CRM ». Phase 1 : corriger sans rien
demander (sécurité des dépôts, numérotation, valeurs déjà données, visionneuse d'images, motif de perte obligatoire,
ménage) ; phase 2 : auditer sans rien modifier (`docs/AUDIT-2026-09.md`).

## Phase 1 — fait
- **Historique git purgé** : `prisma/dev.db` et `dev.db` retirés de tout l'historique du CRM (`git filter-repo`,
  copie miroir de sauvegarde dans le scratchpad, force-push le 26/09). Les hachages ont changé : mission 11 =
  `17cc9ce` (ex `573b20d`), `09e7f35` (ex `1028cb1`), `9feaf2d` (ex `75e0a0f`). Le site n'avait aucune base dans
  son historique. `.gitignore` élargis (CRM : `*.sqlite*`, `/exports/` ; site : `*.db`, `*.db.gz`, `*.sqlite*`,
  `.env*` sauf `.env.example`, `/exports/`). **Dépôts toujours publics** : `gh` n'est pas installé ni authentifié
  sur le poste (« Si gh n'est pas authentifié, fais tout sauf le passage en privé »). GitHub garde les anciens
  commits joignables par leur hachage jusqu'à son ramassage : le passage en privé, puis une demande de purge du
  cache à GitHub, restent à faire par Lucas.
- **Secret des webhooks** : nouveau secret généré (32 octets hex) dans un fichier LOCAL ignoré par git,
  `crm-coverswap/.env.rotation-webhook.local` — pas dans ce journal tant que le dépôt est public. Railway : la CLI
  est installée mais non connectée (« Unauthorized ») : rien posé. Voir « À coller côté Vercel, n8n, Zapier ».
- **Numérotation** : les devis 2026-040 (Beites), 2026-041 et 2026-042 (Fares) étaient déjà rattachés en prod
  (documents repris, statut envoyé, 25/09) ; la migration `numerotation-devis-externes-26-09` les inscrit au registre
  s'ils manquent et pose le compteur des devis 2026 à 42 → prochain devis **2026-043**. `dossiers/compteurs.ts` :
  compteur lisible et modifiable (Paramètres → Numérotation des documents ; `GET/PATCH /api/numeros/compteurs` ;
  `voir_parametres` / `modifier_parametres` avec `COMPTEUR_DEVIS` / `COMPTEUR_FACTURE`), jamais derrière un numéro
  inscrit ; un devis externe inscrit avec un numéro plus grand fait avancer le compteur (`registre.ts ›
  inscrireNumeroManuel` → `avancerCompteur`).
- **Valeurs** : migration `valeurs-lucas-26-09` : TRESORERIE_RESERVE 3 000 €, CAPACITE_CHANTIERS_MOIS 15,
  CAMPAGNE_DEBUT 2026-09-22, CAMPAGNE_BUDGET 378 € (18 €/jour × 21 jours), CAMPAGNE_DUREE_JOURS 21 ; les deux
  lignes des consignes (« environ 8 chantiers », « garder 2 000 € ») réécrites (nouvelle version) ; les managers
  finances et opérations lisent d'abord les paramètres, les consignes en repli. Coordonnées : identiques partout
  (06 70 35 28 69, 73 rue Simone Veil 34470 Pérols, SIRET 94518036200010, APE 4334Z) sauf l'en-tête du devis PDF qui
  répétait le NIC (« 94518036200010 00010 ») : corrigé en « 945 180 362 00010 ». Mails : contact@coverswap.fr
  côté site, coverswap.contact@gmail.com côté devis (deux adresses réelles, pas une erreur).
- **Visionneuse** (`components/pilotage/Visionneuse.tsx`) : croix, Échap, toucher hors de l'image, geste retour
  (entrée d'historique), flèches / balayage / ← → entre les images du même ensemble, pincement et double toucher,
  lien « Ouvrir l'original » à part. Posée sur les photos du dossier (avec « Retirer »), les simulations du dossier
  (après puis avant), les photos vues depuis l'espace client (déposées, retirées), les photos jointes d'un lead. Plus
  aucun `target="_blank"` sur une image.
- **Motif de perte obligatoire** : liste courte (trop cher, a choisi un concurrent, plus de réponse, projet abandonné,
  hors zone, délai trop long, autre + précision) ; refusé sans motif dans `changerEtapeDansTransaction` (écran,
  assistant, code), dans `modifierEntrant` (lead « sans suite », `Lead.motifPerte / perteLe / perteCommentaire`),
  posé par la note d'appel « pas intéressé » (projet abandonné) ; `manager_commercial` cumule dossiers et leads.
- **Ménage** : migration `menage-archives-et-taches-26-09` : « motif à renseigner » sur les dossiers et leads
  archivés sans motif ; tâches en échec définitif depuis plus de 7 jours passées « Annulée » avec la raison en tête
  de la dernière erreur (« Abandonnée le … : … ne se relancera pas seule »).
- Tests : `base/migrations/mission-12.test.ts` (5), `dossiers/perte-motif.test.ts` (4) ; tests existants adaptés
  (perte sans motif refusée, libellé « Trop cher »).

## À coller côté Vercel, n8n, Zapier (rotation du secret des webhooks)
La valeur est dans `crm-coverswap/.env.rotation-webhook.local` (fichier local, jamais commité : le dépôt est public).
1. **Railway (service CRM)** : `WEBHOOK_SECRET` = la nouvelle valeur ; `WEBHOOK_SECRET_PRECEDENT` = l'ancienne
   (`coverswap-webhook-secret`) le temps de reporter partout ; la retirer ensuite (aucune coupure entre-temps :
   les deux sont acceptées).
2. **Vercel (coverswap.fr)** : `CRM_WEBHOOK_SECRET` = la nouvelle valeur, sans retour à la ligne, puis redéployer.
3. **n8n** : l'URL du webhook du CRM, avec l'en-tête `X-Webhook-Secret` = la nouvelle valeur (mission 13 : le
   paramètre `?secret=` reste accepté jusqu'au 26/10/2026, plus après).
4. **Zapier** : `https://crm.coverswap.fr/api/webhook/zapier` avec l'en-tête `X-Webhook-Secret` = la nouvelle valeur
   (idem : `?secret=` toléré jusqu'au 26/10/2026).
Puis retirer `WEBHOOK_SECRET_PRECEDENT` sur Railway.

## Journal
- 26/09 : purge de l'historique, poussée ; phase 1 codée (visionneuse, compteurs, motif de perte, migrations), suite
  complète 534/534, tsc, eslint, build OK ; essai local sur la copie (Paramètres → Numérotation et Pilotage,
  visionneuse photos et simulations : ouverture, Échap, geste retour, croix ; lead « sans suite » : motifs
  obligatoires). Commit CRM `7121b48` déployé (health = 7121b48, 78 outils) ; site `b1a5f8e` (.gitignore).
  Vérifié en prod (lecture seule) : `campagne` = « commencée le 22/09/2026, jour 5 sur 21, budget 378 € » (migration
  passée), routes nouvelles 401 sans session, `sante_systeme` : les 2 tâches Meta en échec ont moins de 7 jours
  (jeton de page expiré, code 190 : à renouveler par Lucas), 2 incohérences « prochaine action périmée » (Beites,
  Fares) relevées pour l'audit. Rapport de phase 1 dans la conversation ; puis phase 2 : `docs/AUDIT-2026-09.md`.

# Mission 13 (26/09/2026) — Exécution de l'audit du 26 septembre

Énoncé de Lucas (26/09/2026, collé dans la conversation) : « Mission 13 — Exécution de l'audit du 26 septembre ».
Sept lots, dans l'ordre ; chaque lot est commité, testé et déployé avant le suivant, « pour que je puisse arrêter à
tout moment avec un CRM cohérent ». Aucune question : les décisions sont dans l'énoncé (lot 7 : retirer /commercial,
/prospects, /journal, /numeros, /sms, /messagerie, /mail/sequences, l'agent mail v1, `IA_CRM_ACTIVE`,
`/api/cron/relance`, `prospects/demarchage`, `lib/agents` ; garder /synthese et /validation dans Plus). Contraintes :
tests, lint, build, déploiement vérifié et section ici à chaque lot ; rien de supprimé dans les données ; sauvegarde
avant chaque migration (automatique au démarrage) ; aucun mail ni SMS automatique ajouté. Le passage des dépôts en
privé et la rotation du secret des webhooks restent à Lucas (rappel à chaque rapport).

## Lot 1 — Bugs métier (26/09)
- **B1 prochaine action après un devis déposé** : constantes `PROCHAINE_ACTION_PREPARER_DEVIS` /
  `PROCHAINE_ACTION_APRES_DEVIS` (dossiers/constants.ts) ; `documents-existants.ts › rattacherDocumentExistant`
  (donc `enregistrerDocumentExistant` et l'outil `deposer_document`) fait comme `emettre` ; le contrôle de cohérence
  propose « Remplacer par « Attendre l'accord … » » quand le devis existe (sinon « Effacer ») et écrit un événement
  COHERENCE_CORRIGEE ; migration `prochaine-action-devis-depose-13-1` (Beites, Fares en prod).
- **B2 coordonnées de l'espace → fiche client** : `espace/coordonnees.ts › enregistrerCoordonnees` appelle
  `completerCoordonnees` (clients/identification.ts) même quand le client ne change rien (le cas vécu : fiche « sans
  e-mail, sans téléphone ») ; migration `coordonnees-dossier-vers-fiche-13-1` (dossiers en cours → fiche, rien retiré).
- **B3 dossier ouvert depuis l'espace** : `dossiers/objet.ts` (une table d'objets par famille, partagée avec
  `depuis-lead.ts`) ; `validations.ts › validerProjet` pose l'objet d'après la famille validée et la source
  « ESPACE_CLIENT » quand ils manquent (`complementDuDossier`, pure) ; migration `objet-et-source-depuis-projet-valide-13-1`.
- **B16 délai de relance** : `relances/service.ts › lireDelaiRelance` (paramètre, sinon 5 jours,
  `DELAI_RELANCE_DEFAUT_JOURS`) ; plus d'alerte « non renseigné » (synthese/alertes.ts) ; `voir_relances`, manager
  opérations et définition du paramètre disent le défaut ; migration `delai-relance-5-jours-13-1` pose 5 en prod.
- **B4/B5 jeton Meta** : `conversions.ts` nomme un refus de jeton (`jetonRefuse`, `codeMeta`, message lisible) ;
  la tâche META_CONVERSION est définitive dès la première tentative et `alerterJetonARenouveler` (taches.ts) prévient
  UNE fois par jour toutes origines confondues ; `faitsJeton` lit la base (conversions refusées, leads illisibles sur
  7 jours) et `verdictJeton(…, faits)` tranche sans appeler Meta (nouvel état `non_verifie`) ; `sante.ts › etatChaine`
  (pure) + `SanteMeta.chaine` : UNE phrase, la même dans Publicité, `sante_systeme` (`resumeChaineMeta`, sans réseau)
  et `voir_publicite` — en prod : « Leads reçus par le webhook ; lecture des formulaires et conversions impossibles
  (jeton à renouveler). » ; `leads.ts` préfixe « Jeton Meta refusé (code N) » sur un lead illisible.
- **B19 simulations du site** : `simulations/site.ts` (`simulationsSiteRecentes`, `imageSimulationSite`), route
  `GET /api/simulations-site/[id]/image|avant` (derrière la session), rubrique repliée « Sur le site cette semaine »
  dans Leads (`leads/_components/SurLeSite.tsx`) : nombres, puis une ligne par simulation (vignette → visionneuse,
  projet, teintes, quand, lead → fiche ou « anonyme », campagne).
- Migrations : `base/migrations/mission-13-lot-1.ts` (4), enregistrées après celles de la mission 12. Tests :
  `base/migrations/mission-13.test.ts` (13), `conversions.test.ts` (+1, réponse exacte de Meta code 190/467) ;
  `relances.test.ts`, `synthese.test.ts`, `mcp-v3.test.ts` adaptés au délai par défaut.
- Pièges : l'onglet du navigateur d'essai sert l'ANCIENNE version d'un écran depuis le cache du service worker
  (caches `application-v8`, `ecrans-v8`, `donnees-v8`) : désinscrire le SW et vider `caches` avant de juger un
  écran. Sous charge (suite complète + eslint + serveur dev en même temps), `encaissements.test.ts` dépasse le délai
  de 30 s de la transaction d'émission : rejouer le fichier seul (10/10).

## Lot 2 — Sécurité (26/09)
- **Secrets hors adresse** : `acces/secret-webhook.ts › secretDeLaRequete / secretRequeteValide` — l'en-tête
  `X-Webhook-Secret` d'abord ; `?secret=` accepté jusqu'au 26/10/2026 (`FIN_TOLERANCE_SECRET_ADRESSE`) avec un
  avertissement `[webhook] … toléré jusqu'au 26/10/2026` dans les journaux, refusé ensuite. Routes : diagnostic, zapier
  (POST et GET), sms ; `routes-publiques.ts` le dit. `/api/admin/backfill-meta-dates` retiré (secret dans l'adresse,
  usage unique du 17/09). Section « À coller » mise à jour (n8n, Zapier : en-tête).
- **Niveaux** : `accorder_simulations` devient sensible au-delà de 3 (`sensible`, `apercu` avec le coût ≈ 0,20 $ par
  image) ; `changer_etape` vers « signé » l'était déjà (`ETAPES_SENSIBLES` = signé, facturé, encaissé, perdu : l'audit se
  trompait sur ce point, rien à changer).
- **Plafond d'écritures** : `synthese/alertes.ts` : alerte `PLAFOND_ASSISTANT` (ATTENTION) quand un appel a été refusé
  « Plafond … » dans l'heure ; elle remonte dans Synthèse, `sante_systeme` et `point_du_jour` comme les autres alertes.
- **Révocation automatique** : `espace/revocation.ts` — un espace dont tous les projets sont clos, avec au moins un
  chantier encaissé depuis plus de 90 jours (passage à « Encaissé » dans l'historique, sinon dernière modification), a
  son lien désactivé (`gestion.ts › desactiverLien(permanentId, motif)` : événement ESPACE_LIEN_DESACTIVE avec le motif,
  rien d'effacé, un nouveau lien le rouvre). Travail périodique `revocation-espaces-termines` (toutes les 6 h) → une tâche
  `REVOCATION_ESPACES` par jour, journalisée avec la liste des espaces désactivés.
- **Sauvegarde hebdomadaire chiffrée vers Drive** : `base/chiffrement-sauvegarde.mjs` (AES-256-GCM, clé dérivée par
  HKDF de `SAUVEGARDE_CLE`, à défaut de `GOOGLE_TOKEN_KEY` : aucune variable nouvelle indispensable ; format « CSWB1 » +
  IV + étiquette + contenu) ; `base/sauvegarde-drive.ts › sauvegardeVersDrive` : copie vérifiée (`sauvegarderBase`,
  raison « drive »), gzip, chiffrement, envoi dans le dossier Drive « CoverSwap CRM — sauvegardes chiffrées » (identifiant
  gardé dans `ReglageTexte.SAUVEGARDE_DRIVE_DOSSIER_ID`, recréé s'il a disparu) ; la copie locale intermédiaire est
  retirée (les quotidiennes restent) ; rien n'est retiré de Drive. Travail `sauvegarde-drive-hebdomadaire` (actif si base
  locale + clé + Drive connecté) → une tâche `SAUVEGARDE_DRIVE` par semaine ISO (`sauvegarde-drive:2026-S39`), qui
  attend (AttenteExterne) si Google est coupé. Restaurer : `GOOGLE_TOKEN_KEY=… node scripts/dechiffrer-sauvegarde.mjs
  <fichier.db.gz.chiffre> [sortie.db]`.
- Tests : `base/mission-13-lot-2.test.ts` (7 : secret en-tête/adresse/date, alerte plafond, révocation 100 j / 10 j /
  signé / rejouée, format chiffré, sauvegarde vers un faux Drive relue et déchiffrée, semaine ISO).
- Reste à Lucas : passer les dépôts en privé, poser le nouveau secret (Railway, Vercel, n8n, Zapier — en en-tête),
  renouveler le jeton Meta ; la première sauvegarde Drive partira d'elle-même dans les 6 h suivant le déploiement si la
  connexion Google (Drive) est active.

## Lot 3 — Listes compactes (26/09)
Mesures à 390 × 660 sur la copie d'essai (100 dossiers « Kanban-Essai » de plus qu'en prod) : Leads 1 677 px
(8 872 avant), Espaces 2 378 px (14 518 avant), Dossiers 6 855 px pour 109 dossiers en lignes de 58 px (32 461 avant),
aucun débordement horizontal (390 px partout).
- **Espaces** (`EcranEspaces.tsx › LigneClientEspace`, `groupesDe`) : groupes « À toi », « Chez le client », « Rien en
  attente » (« Désactivés » à part) ; une ligne de 56 px — pastille rouge/ambre si signal, nom · ville, phrase d'état
  (`attente.libelle`), chevron ; le toucher ouvre la carte complète d'avant (`CarteClient`, désormais un `article`).
- **Dossiers** (`CarteDossier.tsx › LigneDossierCompacte`, `VueListe.tsx`) : sur téléphone la liste est une ligne par
  dossier — nom · ville, étape · montant, UN signal (retard N j / aujourd'hui / à moi / à relancer / N à compléter),
  chevron ; le kanban reste (ordinateur, ou choisi). `Indicateurs.tsx › BarreProgression` : la barre seule, plus de
  « Étape N sur 9 » ni « N étapes avant facturation » (aussi retirés du tableau bureau).
- **Leads** (`EcranLeads.tsx › Ligne`) : une ligne de 76 px — pastille de priorité (rouge/vert/gris/ambre), nom · ville ·
  source, le délai (attente / rappel / dernier appel), un seul bouton « Appeler » rond de 44 px, chevron. Cases à cocher
  seulement en mode « Sélectionner » (bouton à côté des filtres). Tout le reste dans `PanneauEntrant` : « Écrire un
  mail », « Traité / Reprendre » (props `ligne`, `onAction`), doublon probable (`leads/_components/SignalDoublon.tsx`,
  prop `onRecharger`), noter un échange, ouvrir le dossier, archiver. `FeuilleAppel` retirée de l'écran Leads.
- **Clients** (`ListeClients.tsx`) : nom (pastilles) · ville · N dossiers (N en cours) ; l'e-mail (ou le téléphone) en
  ligne entière (`break-all`) ; « Recommandé par » entier ; source et date à droite. Plus aucun `truncate`.
- **Tâches de fond** (`taches/page.tsx`, `EtatTaches.tsx`, `taches/lecture.ts`) : l'en-tête en haut ; « À voir »
  (échec, en cours, attente) d'abord, 50 par page ; « Travaux périodiques » et « Terminées et annulées » repliés
  (ouvert d'office si un travail est en échec), 50 par page, 200 finies chargées ; `TacheVue.abandonnee` → pastille
  « Abandonnée », raison en première ligne. Cohérence, audit des connexions et sessions à la suite (enfants).
- **Paramètres** (`parametres/page.tsx`, `OngletsParametres.tsx`, `EcranParametres.tsx` → `GroupesParametres`) :
  cinq onglets — Activité (pilotage, suivi commercial, campagne, simulateur, RGPD, connexions, marque), Facturation
  (encaissements, factures, numérotation, puis « Avancé : seuils fiscaux et cotisations » replié), Mail, SMS, Assistant
  (accès, consignes, réglages IA). Tout est lu par le serveur avec la page (`mail/reglages-vue.ts › reglagesMail`,
  `assistant/vues-parametres.ts › vueAcces / vueConsignes`, `lireCompteurs`, connexions, modèles SMS) : plus de
  « Chargement… ». Les ancres `#mail`, `#sms`, `#assistant` ouvrent l'onglet ; l'onglet choisi est mémorisé
  (`localStorage parametres-onglet`) ; le compteur « à renseigner » ne compte plus les seuils avancés ni l'IA.
- Pièges : un onglet lu au chargement passe par `useSyncExternalStore` (instantané serveur = « activite ») pour ne pas
  casser l'hydratation ; `.next/dev/types` (générés par `next dev`) sont inclus par tsconfig et gardent les routes
  retirées : les effacer avant un `next build` qui suit un retrait de route.

## Lot 4 — Raccourcis d'action (26/09)
- **Rubriques ciblées** : `dossiers/constants.ts › RUBRIQUES_DOSSIER` (photos, messages, devis, encaisser, historique,
  etape) ; `?dossier=<id>&rubrique=<x>` ouvre le panneau dessus (`dossiers/page.tsx` → `DossiersPilotage` →
  `PanneauDossier { demande }`) ; les notifications de l'espace y mènent (`espace/alertes.ts › lienDossier(id, rubrique)`,
  `prevenir({ rubrique })` : message, commentaire, autre proposition → « messages » ; photos → « photos »).
- **Panneau du dossier** (`PanneauDossier.tsx`) : 1. ce qui attend (à compléter, prochaine action, « Encaisser l'acompte
  X € » quand un paiement est attendu, l'étape avec ses boutons) ; 2. Photos ; 3. Historique (déplié, plus de repli
  interne) ; puis Espace client, Devis et factures, Paiements, Simulations en `SectionRepliable` (ouvertes d'office quand
  elles attendent un geste : espace avant signature, devis à faire ou facture à faire, paiement attendu, simulation en
  cours ; résumé quand elles sont fermées) ; « Le reste du dossier » replié (familles, délais et prix, dépenses, étapes et
  notes, coordonnées, chronologie, archivage). Les sections repliées reçoivent `sansTitre` (Photos, Espace, Documents,
  Paiements, Simulations) : leurs boutons restent, leur titre est celui de la section.
- **Encaisser en 3 gestes** : ligne → « Encaisser » (ou le bouton en tête du panneau) → `ModalePaiement` préremplie
  (acompte du devis en vigueur ou reste des factures, virement, aujourd'hui, `moyenParDefaut`) → Enregistrer.
- **Étape suivante en un bouton** : `CarteDossier.tsx › RaccourcisDossier` (Photos, Message, Devis, Encaisser quand
  signé/planifié/chantier/facturé, « → Étape suivante ») sous chaque ligne compacte ; l'étape ouvre la fenêtre de
  `ChangementEtape` (`demandeInitiale`) avec ses garde-fous (accord, acompte, motif de perte…). Espaces :
  `RaccourcisEspace` (liens `?rubrique=`) sous chaque ligne, sur le projet le plus pressé.
- **Note d'appel automatique** : `components/pilotage/RetourAppel.tsx` (monté dans le layout) — au retour dans l'app
  (visibilitychange, pageshow, focus) après un « Appeler » d'au moins 15 s, une feuille « Comment ça s'est passé ? » :
  4 issues, précision, Enregistrer (`POST /api/commercial/appels`, dossier si connu sinon lead) ou « Plus tard »
  (`marquerAppelPropose`). `noterDebutAppel(id, { nom, dossierId })` porte le nom et le dossier (Leads, panneau du lead,
  panneau du dossier).
- **Messages d'espace dans Mail** : `mail/vues.ts › listerVue` rend `messagesEspace` (non lus) pour « À traiter » ;
  `EcranMail` les affiche en tête (→ « Répondre dans son dossier », rubrique messages) ; le badge Mail de la navigation
  les compte (`/api/pilotage/compteurs`). Aucun mail ni SMS automatique ajouté.
- Tests : `base/mission-13-lot-4.test.ts` (2 : rubriques et liens ; message d'espace dans la boîte, lu il en sort).
