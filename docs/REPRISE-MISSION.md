# Reprise de mission — tunnel de vente, SMS, application mobile

> Fichier de bord tenu par l'agent. À relire EN PREMIER à chaque reprise, puis
> continuer sans rien demander à Lucas (il dort, il ne relira pas en route).
> Aucun secret ici : le dépôt est public.

Mission lancée le 20/09/2026 au soir. Énoncé complet : message de Lucas
« Mission autonome — Tunnel de vente, messagerie SMS et application mobile »
(transcript de la session). Résumé des exigences en bas de ce fichier.

## Règles permanentes (rappel)

- Rien ne se supprime, tout s'archive. Sauvegarde avant migration (automatique au démarrage).
- Aucun secret en dur ; ne pas lire ni afficher les secrets de `.env.local` ni ceux de Railway.
- `src/proxy.ts` porte une garde de connexion locale : **ne jamais la commiter** (`git add` par chemins explicites).
- Aucun envoi automatique hors accusé de réception. Tout le reste passe par validation.
- Tests sur base d'essai, jamais sur la prod. Ne rien pousser qui ne tourne pas (`npm test`, eslint, build).
- Commits terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Vérifier la prod sans session : `/api/health` (commit + canaux), journaux Railway via GraphQL
  depuis un onglet Chrome connecté (voir mémoire `project_crm_meta_lead_ads_2026-09`).

## État d'avancement

### Priorité zéro — push en production
- [x] Diagnostic (sonde `/api/health?reseau=1`) : ntfy.sh (159.203.148.75) laisse SANS RÉPONSE les
      connexions TCP venant de Railway ; pas d'IPv6 chez Railway. Telegram, Pushover, Brevo,
      coverswap.fr répondent. Ni DNS, ni URL, ni en-têtes : filtrage côté ntfy.sh de l'adresse partagée.
- [x] Correction : passerelle `coverswap.fr/api/relais/ntfy` (site Vercel, commit `b7a05ab`), signée HMAC
      avec `SIMULATE_TOKEN_SECRET` (ou secret webhook) — aucune variable nouvelle. CRM : direct 4 s puis
      passerelle, chemin en panne mémorisé 1 h. PROUVÉ EN PROD : journaux Railway du 20/09 22:57 UTC
      « essai au démarrage — ntfy : envoyée ».
- [x] Bug annexe corrigé : libellé de bouton accentué → HTTP 400 de ntfy (en-têtes ASCII seulement).
- [x] Réglage global IPv4 d'abord + 2,5 s par adresse (`src/lib/base/reseau-sortant.ts`) : `fetch`
      échouait par moments vers Telegram (délai de 250 ms de la sélection de famille de Node).
- [x] Registre `AlerteEnvoi` + essai de push au démarrage tant qu'aucun push n'a réussi.
- [x] Contact `cmua6do0m00ab7eyqanajfoqc` vérifié (journaux Railway) puis archivé avec `cmu9seh…` :
      ville 1, source META_ADS 1, client rattaché 1 ; codePostal 0, campagne/ensemble/publicité 0,
      téléphone = 0 chiffre, pageId/formId/formNom 1, 3 réponses → lead de l'OUTIL DE TEST META
      (données factices, aucune publicité). La chaîne unifiée l'a bien traité. À dire à Lucas : le
      prochain vrai lead dira dans les journaux les clés reçues du Zap (`[meta] pont Zapier — clés reçues`).
- [ ] Telegram en second canal : joignable depuis Railway (vérifié). Marche à suivre pour Lucas
      dans le rapport final (docs/META.md §6) : BotFather → TELEGRAM_BOT_TOKEN, getUpdates → TELEGRAM_CHAT_ID.

### Lots de la mission (ordre prévu)
- [x] Lot 1 — Priorisation des leads + liste « à rappeler » triée (commit `e9ca016`, en prod : 236 contacts classés, zone 34 + 30/11/12/81 posée en paramètres)
- [x] Lot 2 (serveur) — SMS : `src/lib/sms/` (fournisseurs ovh/brevo/simulateur, envoi par file de tâches,
      réception idempotente, STOP, accusé automatique, messages types en base, flux SSE, contexte, suggestions),
      routes `/api/sms/*` et `/api/webhook/sms`, push web (`src/lib/alertes/pushweb.ts`, canal `pushweb`),
      liens signés de l'espace (`src/lib/espace/liens.ts`). Schéma : ConversationSms, Sms, ModeleSms, EspaceClient,
      SimulationEspace, AccordDevis, AbonnementPush, CleInterne. 283 essais au vert.
      RESTE pour le lot 2 : écran Paramètres → Messagerie SMS (état du fournisseur, messages types).
- [x] Lot 3 — Messagerie `/sms` : `src/components/sms/` (liste, fil en bulles, saisie avec compteur GSM-7 et
      « simplifier », envoi optimiste + file hors ligne dans le navigateur, flux SSE + relève de secours,
      brouillons, recherche, non-lus, contexte du dossier, actions rapides : lien espace, message type, fin
      d'appel, note, devis, étape). `src/lib/commercial/appels.ts` (issue d'appel → suite). ESSAYÉ EN LOCAL au
      simulateur, vue téléphone 375 px et ordinateur 1440 px : envoi, STOP ajouté, remise, SMS entrant en
      temps réel, coupure réseau puis reprise, lien d'espace pré-rempli. Captures d'écran impossibles
      (fenêtre en arrière-plan) : vérifié par lecture du DOM.
      RESTE : entrée `/messagerie` sans navigation pour l'icône « Messages » (lot 7).
- [ ] Lot 4 — Espace client (lien signé, photos, choix, simulations, devis, bon pour accord, acompte)
- [ ] Lot 5 — Relances proposées (file de validation, plafond 5 messages / 10 jours, perdu sans réponse)
- [ ] Lot 6 — Écran de pilotage commercial
- [ ] Lot 7 — Application mobile (2 manifestes, 2 icônes, push web, hors ligne, appareil photo)
- [ ] Lot 8 — Rapport final

## Journal (le plus récent en bas)

- 21/09 00:45 — Reprise après limite. Rien n'avait encore été modifié. Début de la priorité zéro.
- 21/09 01:00 — Priorité zéro résolue et prouvée en prod (voir ci-dessus). Commits CRM `aecaaf4`,
  `a3f0b7d`, `8f70c19`, `7467f18` ; site `b7a05ab`. Tâche planifiée de reprise : CronCreate `fdab723a`
  (toutes les 20 min, session seulement).

## Décisions prises

1. **Push** : ntfy reste le canal (déjà sur l'iPhone de Lucas), via la passerelle du site. Telegram
   en second, à poser par Lucas. Le push web (PWA) viendra en troisième au lot 7.
2. **SMS — fournisseur** : Brevo NE PERMET PAS de recevoir des réponses en France (doc Brevo). Depuis
   2023-2026 l'ARCEP interdit les 06/07 aux plateformes ; la voie conforme pour du bidirectionnel est
   un **numéro 09 « Time2Chat »** (OVHcloud : ~10 € HT/mois, 50 crédits inclus, API
   `/sms/{service}/virtualNumbers/{numero}/jobs|incoming`, réception par relève, pas de webhook).
   → Couche fournisseur abstraite : `ovh` (envoi + relève des réponses), `brevo` (envoi seul),
   `simulateur` (essais). Webhook générique `/api/webhook/sms` pour un fournisseur qui pousse.
3. **Modèle** : conversation par numéro (`ConversationSms`) + messages (`Sms`) dédiés, plutôt que de
   surcharger `Message` (tri des mails, contenu immuable). Chaque SMS écrit aussi un événement sur le
   dossier quand il y en a un.
4. **Ancrage du tunnel** : le dossier (`Dossier`) reste l'objet central ; l'espace client s'y rattache
   et l'ouvre au besoin (étape QUALIFICATION) à l'envoi du lien.
5. **Espace client** : page sur coverswap.fr `/e/<code>-<signature>` ; le navigateur parle directement
   à l'API publique du CRM (`/api/espace/...`, CORS coverswap.fr). Lien = code court + HMAC (secret
   dérivé de NEXTAUTH_SECRET si `ESPACE_CLIENT_SECRET` absent), expirable, révocable (version).
6. **Messages proposés** : type de proposition `ENVOI_SMS` dans la file de validation existante
   (contenu proposé vs contenu validé = trace des corrections, déjà prévue par `Proposition`).
7. **Push web** : clés VAPID générées au besoin et gardées en base (table hors journal), sauf si
   posées en variables.

## Testé / pas testé

(à remplir lot par lot)

## Blocages qui exigent Lucas

(aucun encore)
