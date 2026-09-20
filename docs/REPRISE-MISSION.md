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
- [ ] Diagnostiquer `ntfy : TypeError: fetch failed` depuis Railway (cause réelle)
- [ ] Corriger ou basculer (Telegram / passerelle), prouvé EN PRODUCTION
- [ ] Vérifier le contact `cmua6do0m00ab7eyqanajfoqc`, puis archiver celui-ci et `cmu9seh1s0035xiqqbmk9pvpr`

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

## Décisions prises

(aucune encore)

## Testé / pas testé

(à remplir lot par lot)

## Blocages qui exigent Lucas

(aucun encore)
