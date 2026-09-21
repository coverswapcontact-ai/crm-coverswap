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
- [ ] P5 Rapport : signaler le droit de rétractation (signature à distance) — décision de Lucas, pas de l'agent.
- [ ] P6 Tests, lint, builds, déploiement CRM puis site, rapport mis à jour.

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
