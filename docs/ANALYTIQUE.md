# Analytique — tous les chiffres de CoverSwap au même endroit (mission 17, partie B)

Référence de conception. Maquettes validées le 30/09 : `docs/maquettes/analytique-ordinateur.html` (1 440 px) et
`analytique-telephone.html` (390 px) — spécification visuelle, reconstruite avec les composants du CRM.

## 1. Écran

- Adresse : **`/analytique`**, onglet principal (ordinateur et téléphone). Onglets : `?onglet=ensemble` (défaut),
  `publicite`, `seo`, `site`, `argent`. Période : `?p=7j|30j|90j|mois|12m` ou `?du=AAAA-MM-JJ&au=AAAA-MM-JJ` (heure de
  Paris). Chaque indicateur est comparé à la période précédente de même longueur (flèche, pourcentage, couleur selon le
  sens favorable : vert favorable, ambre défavorable, gris stable ; jamais de rouge vif).
- Filtre par source (Vue d'ensemble) : `?source=` parmi les familles ci-dessous.
- Anciennes adresses : `/publicite` → `/analytique?onglet=publicite`, `/synthese` → `/analytique`, `/analytics` →
  `/analytique`. `/finances` garde le travail (reste à encaisser et saisie, chèques, points à corriger, livre des
  recettes et son export) ; ses tuiles, seuils, URSSAF et graphiques partent dans l'onglet Argent. `/site` ne change pas.
- Graphiques : `recharts` (courbes pour le temps, barres horizontales pour comparer, tunnel en barres, sparklines dans
  les tuiles). Pas de camembert, pas de 3D, pas de dégradé criard. Infobulles à valeur exacte, nombres au format
  français (`1 234,5 €`). Chiffres en Space Grotesk (`font-heading`), texte en Inter (déjà chargées).
- État vide par source non branchée : ce qu'il faut faire pour la brancher (variables, accès), jamais un zéro trompeur.
  Source en échec : « dernière synchronisation réussie le … ».

## 2. Familles de source (une seule définition, `src/lib/analytique/sources.ts`)

`meta` (publicité Meta : `utm_source` meta/fb/ig/facebook/instagram avec medium payant, ou lead `META_ADS`),
`google-ads` (`gclid`, `utm_medium=cpc|ppc` avec google — vide tant que non branché), `seo` (moteurs de recherche
sans marqueur payant), `fiche-google` (`utm_source=gbp|google-business`, référent `business.google.com`,
`maps.google.*`), `ia` (chatgpt.com, chat.openai.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com,
meta.ai, chat.mistral.ai, chat.deepseek.com, grok.com, you.com, phind.com — testée AVANT meta et seo, sur l'hôte
complet), `reseaux` (facebook, instagram, linkedin, tiktok, pinterest, youtube, x/t.co sans marqueur payant), `direct`,
`autre`. Pour un lead : `Lead.source`, puis `canal`, puis le parcours du site.

## 3. Données

Toutes les synchronisations passent par la file de tâches (`src/lib/taches`) : une passe chaque nuit (et toutes les
3 h pour Meta), relançables à la main depuis l'écran ; historique quotidien en base, écrit par upsert (rien ne
s'efface) ; état par source dans `SourceAnalytique` (dernière réussite, dernier essai, erreur).

| Modèle | Contenu | Clé |
|---|---|---|
| `DepensePubJour` | plateforme (META, GOOGLE_ADS), jour, campagne / ensemble / publicité (ids et noms), dépense, impressions, clics, leads de la plateforme | `[plateforme, jour, publiciteId]` |
| `SeoJour` | jour, dimension (TOTAL, REQUETE, PAGE), clé, clics, impressions, position | `[jour, dimension, cle]` |
| `FicheGoogleJour` | jour, métrique (vues recherche/carte, appels, clics site, itinéraires…), valeur | `[jour, metrique]` |
| `SourceAnalytique` | source, état, dernière réussite, dernier essai, erreur | `source` |
| `InstantaneAnalytique` | écran pré-calculé (onglet × période standard) et résumé du jour | `cle` |
| `EvenementSite` (+ colonnes) | visiteur du jour, appareil, pays, référent | — |

- **Meta** : API Marketing (`/act_<id>/insights`, niveau publicité, `time_increment=1`, pagination), jeton `ads_read`.
  Leads Meta = `onsite_conversion.lead_grouped` sinon `lead`. Resynchronise les 3 derniers jours toutes les 3 h et la
  campagne entière chaque nuit (les chiffres Meta sont révisés). Sans jeton : prorata du budget, affiché « estimation ».
- **Search Console** : compte de service (JWT RS256 signé avec `node:crypto`, portée `webmasters.readonly`),
  `searchanalytics.query` sur `sc-domain:coverswap.fr`, 16 mois au premier passage puis les 5 derniers jours chaque
  nuit (les données Google arrivent avec 2 à 3 jours de retard).
- **Fiche Google** : même compte de service, portée `business.manage`, API Business Profile Performance
  (`fetchMultiDailyMetricsTimeSeries`) + avis (API My Business v4). « En attente d'accès » tant que les identifiants
  ou l'accès Google manquent.
- **Site** : mesure maison sans cookie. Le CRM calcule à la réception une clé de visiteur du jour
  `sha256(sel du jour ‖ IP tronquée ‖ navigateur)` (sel aléatoire gardé en mémoire et en base, remplacé chaque jour à
  minuit, heure de Paris ; l'IP et le navigateur ne sont jamais stockés), la classe d'appareil (téléphone, tablette,
  ordinateur ; robots écartés) ; le site envoie le référent et le fuseau horaire (pays déduit du fuseau, approximation
  volontaire, sans géolocalisation). Visite = même visiteur du jour, pause de moins de 30 minutes ; page d'entrée =
  première page de la visite. Conservation : 25 mois (purge). Opposition : lien « Ne pas compter mes visites » sur le
  site. Le lien visite → lead se fait dans le CRM seulement, par le parcours déjà utilisé pour les simulations.
- **CRM** (leads, devis, signatures, encaissements, dépenses) : lu en direct, mis en cache.

## 4. Calculs (`src/lib/analytique/`)

Une fonction par écran, pure autant que possible : `ecranEnsemble`, `ecranPublicite`, `ecranSeo`, `ecranSite`,
`ecranArgent` (période, comparaison, source) → JSON. Définitions uniques :
- **lead** : `Lead` créé dans la période (archivés compris pour les coûts, doublons fusionnés exclus) ;
- **lead joint** : lead avec au moins un appel abouti (issue ≠ pas de réponse) ou un échange écrit reçu ;
- **devis** : dossier avec un devis numéroté visible (émis) dans la période ;
- **signé** : bon pour accord non retiré, ou devis accepté (dossier passé Signé) dans la période ;
- **encaissé** : encaissements VALIDE reçus dans la période (livre des recettes) ;
- **marge estimée** : encaissé − dépenses de chantier rattachées (matière, fournitures, sous-traitance, déplacement) ;
- **carnet de commandes** : devis envoyés, visibles, non signés, non annulés, et leur montant ;
- **règle des 20 %** : dépense publicitaire du mois ≤ 20 % du chiffre encaissé du mois précédent.
Tunnel : visites → simulations → leads → leads joints → devis → signés → encaissé ; « l'étape qui perd le plus » =
le plus faible taux de passage (hors dernière étape).
Verdict par publicité (protocole de campagne, jours lus dans les consignes) : J1-7 garder ; J8-14 couper si coût par
lead > 2 × la meilleure sur au moins 5 leads, surveiller si > 2 × avec moins de 5 leads ; J15-21 juger au coût par
devis et par chantier signé (seuil 300 €).

## 5. Le côté intelligent

- **Résumé du jour** : calculé chaque matin (7 h) par des règles à partir des chiffres calculés, en trois phrases
  (ce qui monte, ce qui baisse, la chose à faire), chaque chiffre suivi de sa source. Aucun modèle n'est appelé
  (interrupteur `IA_CRM` en pause) ; l'outil MCP `analytique` le rend pour que Claude le reformule.
- **Alertes** : publicité au coût par lead > 2 × la meilleure (≥ 5 leads) ; chute de trafic > 40 % ; requête SEO qui
  décolle ; jeton expiré ou synchronisation en échec ; www et sans www indexés tous les deux. Dans l'écran, dans
  `sante_systeme`, et les pannes de synchronisation deviennent des tâches système (partie A).
- **MCP** : `analytique` (lecture : n'importe quel écran en JSON pour une période) ; `manager_marketing`,
  `voir_publicite` et `campagne` s'appuient sur les mêmes calculs.
