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
- [ ] Lire dans les journaux Railway le constat de la migration `verifier-archiver-leads-essai-21-09`
      (compteurs 1/0 : ville, codePostal, campagne, ensemble, publicite…) — commit `7467f18`.
- [ ] Telegram en second canal : joignable depuis Railway (vérifié). Marche à suivre pour Lucas
      dans le rapport final (docs/META.md §6) : BotFather → TELEGRAM_BOT_TOKEN, getUpdates → TELEGRAM_CHAT_ID.

### Lots de la mission (ordre prévu)
- [ ] Lot 1 — Priorisation des leads + liste « à rappeler » triée
- [ ] Lot 2 — SMS : fournisseur (Brevo), envoi, réception, STOP, accusé automatique
- [ ] Lot 3 — Messagerie (conversations, fil, contexte, envoi optimiste, temps réel)
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
