# Leads Meta en direct — ce qu'il faut faire côté Meta

Le CRM reçoit les leads Meta Lead Ads sans intermédiaire : Meta appelle le CRM à
chaque formulaire rempli, le CRM va lire les réponses, crée le contact, prévient
le téléphone, puis renvoie à Meta chaque étape franchie par le dossier.

Adresse du webhook (à recopier telle quelle) :

```
https://crm.coverswap.fr/api/webhook/meta
```

L'écran **Publicité** du CRM dit à tout moment si la chaîne fonctionne, et son
bouton « Lancer un essai » prouve le trajet complet sans toucher à Meta.

---

## 1. L'application Meta

Sur <https://developers.facebook.com/apps> : une application de type **Entreprise**,
rattachée au Business Manager qui possède la page et le compte publicitaire.

Produits à ajouter : **Webhooks**, **Marketing API**, **Connexion Facebook**.

À relever dans « Paramètres → Général » :

| Ce qu'on relève | Variable Railway |
|---|---|
| Identifiant de l'app | `META_APP_ID` |
| Clé secrète de l'app | `META_APP_SECRET` |

## 2. Les permissions (le point long)

| Permission | Pour quoi | Revue nécessaire |
|---|---|---|
| `leads_retrieval` | lire les réponses d'un formulaire | **oui — App Review** |
| `pages_manage_metadata` | abonner la page au webhook | non (page dont on est admin) |
| `pages_show_list`, `pages_read_engagement` | lister la page, lire son jeton | non |
| `ads_management` | noms de campagne, d'ensemble et de publicité ; conversions | oui pour un usage large |

**À savoir avant de lancer la campagne** : `leads_retrieval` ne fonctionne pas en
mode Développement, même pour sa propre page. Il faut passer l'App Review, et la
vérification d'entreprise (Business Verification) si elle n'est pas déjà faite.
Comptez plusieurs jours.

**En attendant, aucun lead n'est perdu** : le webhook enregistre chaque
formulaire rempli dès la première seconde (il ne demande aucune permission), le
téléphone est prévenu qu'un lead est arrivé, et l'écran Publicité les liste. Dès
que la permission est accordée, le bouton « Tout rejouer » les fait entrer dans
le CRM avec toutes leurs réponses. Les réponses restent aussi lisibles dans Meta
(Outils de publication → Formulaires instantanés → Télécharger).

## 3. Le webhook

Dans l'app : **Webhooks → Page → S'abonner à cet objet**.

- URL de rappel : `https://crm.coverswap.fr/api/webhook/meta`
- Jeton de vérification : une chaîne au hasard, la même que `META_VERIFY_TOKEN`
  sur Railway (à poser **avant** de valider, sinon Meta refuse)
- Champ à cocher : **`leadgen`**

Meta appelle l'adresse en GET pour la valider ; le CRM répond tout seul.

Puis abonner la page elle-même (les deux niveaux sont nécessaires), depuis
l'outil d'exploration de l'API Graph :

```
POST /v26.0/<META_PAGE_ID>/subscribed_apps?subscribed_fields=leadgen
```

Vérification : `GET /v26.0/<META_PAGE_ID>/subscribed_apps` doit lister `leadgen`.
L'écran Publicité affiche cette même vérification.

## 4. Le jeton de page

Dans l'outil d'exploration de l'API Graph :

1. jeton d'utilisateur avec les permissions ci-dessus ;
2. l'échanger contre un jeton longue durée :
   `GET /v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<JETON_COURT>` ;
3. `GET /v26.0/me/accounts` avec ce jeton longue durée : le jeton de la page
   CoverSwap est dans la réponse. **Ce jeton-là n'expire pas**, sauf changement
   de mot de passe, retrait de rôle ou révocation.

→ `META_PAGE_ACCESS_TOKEN`, et l'identifiant de la page → `META_PAGE_ID`.

Le CRM vérifie l'échéance deux fois par jour et prévient sept jours avant si une
expiration apparaît (l'accès aux données peut expirer même quand le jeton, lui,
n'expire pas). Aucun renouvellement automatique n'est possible sans une nouvelle
autorisation humaine : Meta ne délivre pas de jeton de rafraîchissement ici.

## 5. Les conversions

Dans le **Gestionnaire d'événements**, sur le jeu de données (pixel) utilisé par
les campagnes :

- identifiant du jeu de données → `META_PIXEL_ID` ;
- « Paramètres → API Conversions → Générer un jeton d'accès » → `META_CONVERSIONS_TOKEN`.

Le CRM envoie ces événements, rattachés au lead d'origine par son `leadgen_id` :

| Étape du dossier | Événement envoyé | Valeur |
|---|---|---|
| Devis envoyé | `Marketing Qualified Lead` | — |
| Signé | `Converted Lead` | montant du devis signé |
| Encaissé | `Purchase` | montant réellement encaissé |
| Perdu | `Disqualified Lead` | — |

Dans « Paramètres → Entonnoir de vente CRM », classer les trois premiers en
étapes **positives** et `Disqualified Lead` en étape **autre** : c'est ce qui
apprend à l'algorithme à chercher des gens qui signent.

Pour voir les événements arriver en direct pendant un essai : copier le code de
l'onglet « Événements de test » dans `META_TEST_EVENT_CODE`, puis l'enlever.

## 6. Les notifications

Deux canaux au moins, pour qu'une panne de l'un ne coûte pas un lead.

**Telegram** (3 minutes) : écrire à `@BotFather`, `/newbot`, relever le jeton
(`TELEGRAM_BOT_TOKEN`), écrire un premier message au bot, puis ouvrir
`https://api.telegram.org/bot<JETON>/getUpdates` et relever `chat.id`
(`TELEGRAM_CHAT_ID`).

**ntfy** (2 minutes) : installer l'application ntfy (Android, iOS), s'abonner à
un sujet inventé et difficile à deviner, par exemple
`coverswap-leads-7f3a9c2e`, et poser ce même sujet dans `NTFY_TOPIC`. Le sujet
vaut mot de passe : quiconque le connaît peut y publier.

**Mail** : `LEAD_NOTIFICATION_EMAIL`, avec `RESEND_API_KEY` déjà en place.

La notification porte le prénom, le téléphone en bouton d'appel, le projet, la
ville, la campagne et un lien vers la fiche. Si personne n'ouvre la fiche dans
les trente minutes, une relance part.

## 7. Récapitulatif des variables Railway

```
META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN,
META_PAGE_ACCESS_TOKEN, META_PAGE_ID,
META_PIXEL_ID, META_CONVERSIONS_TOKEN,
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NTFY_TOPIC, LEAD_NOTIFICATION_EMAIL
```

## 8. Vérifier avant de dépenser

1. Écran **Publicité** : aucune alerte en haut.
2. Bouton **Lancer un essai** : toutes les lignes cochées, notification reçue sur
   le téléphone.
3. Dans Meta, **Outils de publication → Formulaires instantanés → Aperçu →
   Créer un lead de test** : le contact doit apparaître dans Prospects en moins
   d'une minute, et le téléphone sonner.
4. Faire avancer ce contact de test jusqu'à « Devis envoyé » : l'événement doit
   apparaître dans « Événements de test » du Gestionnaire d'événements.
5. Archiver le contact de test.

## 9. Ce que le CRM garantit

- Chaque appel de Meta est signé et vérifié (`X-Hub-Signature-256`) ; le reste
  est refusé sans rien écrire.
- Meta reçoit sa réponse immédiatement ; le travail se fait en tâche de fond,
  donc pas de doublon né d'un traitement trop lent.
- Un `leadgen_id` déjà traité ne l'est jamais deux fois.
- Un lead qu'on ne parvient pas à lire est gardé, réessayé pendant une trentaine
  d'heures, listé dans l'écran Publicité et rejouable d'un clic.
- Un contact dont le téléphone ou l'e-mail existe déjà est rattaché à sa fiche,
  jamais dupliqué.
