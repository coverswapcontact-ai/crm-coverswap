# Tâches — une seule liste de ce que Lucas a à faire (mission 17, partie A)

Référence de conception. À lire avant de toucher `src/lib/a-faire/`, l'écran `/taches` ou les outils MCP
`taches`, `repondre_tache`, `ajouter_tache`. Aucun nom de client ici : le dépôt est public.

## 0. Noms (collision évitée)

- Le modèle Prisma `Tache`, `src/lib/taches/` et `/api/taches` restent la **file des tâches de fond**.
- Le nouveau modèle s'appelle **`TacheAFaire`** ; son code vit dans **`src/lib/a-faire/`** ; ses routes d'API dans
  **`/api/a-faire/…`**.
- L'écran **`/taches`** devient la liste des tâches de Lucas (premier onglet, accueil de l'application).
  L'écran technique « Tâches de fond » déménage à **`/taches-de-fond`** (liens mis à jour).
- Acteur des écritures automatiques : `SYSTEME:taches-a-faire`.

## 1. Le modèle

```prisma
model TacheAFaire {
  id              String    @id @default(cuid())
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  cle             String    @unique // « TYPE:sujet » : REPONDRE:dossier:<id>, APPELER:lead:<id>, SYSTEME_JETON_META:systeme…
  type            String    // TypeTache (a-faire/types.ts)
  source          String    // SourceTache : le détecteur qui l'a écrite (MANUELLE pour Lucas)
  sujetType       String    // LEAD | DOSSIER | CLIENT | SYSTEME
  sujetId         String?
  leadId          String?   // liens personnels (RGPD, fusion de clients)
  dossierId       String?
  clientId        String?
  titre           String    // « Faire le devis · Bloch » : verbe + nom, sans code ni identifiant
  raison          String    // « simulation validée le 28/09 », quelques mots
  niveau          Int       // 1 argent · 2 chaud · 3 production · 4 système urgent · 5 ménage
  montant         Float?    // € en jeu (tri à niveau égal)
  depuis          DateTime  // origine du besoin (tri par ancienneté : le plus ancien d'abord)
  echeance        DateTime?
  dureeMin        Int       // temps estimé, en minutes (a-faire/durees.ts)
  raccourci       String    @default("{}") // JSON Raccourci : l'action prête à faire
  donnees         String    @default("{}") // JSON libre du détecteur (messageId, propositionId, texte prêt…)
  lot             String?   // clé de lot (« anciens-leads ») : hors « Aujourd'hui », une ligne par lot
  lotLibelle      String?
  statut          String    @default("A_FAIRE") // A_FAIRE | FAITE | PLUS_TARD | PAS_A_FAIRE
  reponse         String?   // FAIT | PLUS_TARD | PAS_A_FAIRE (la dernière réponse de Lucas ou du CRM)
  reponseRaison   String?   // code de raison (a-faire/types.ts RAISONS_*)
  reponseTexte    String?   // précision libre (« autre »), ou la raison lisible d'une coche du CRM
  reponduLe       DateTime?
  reponduPar      String?   // acteur complet : HUMAIN:…, ASSISTANT:claude, SYSTEME:taches-a-faire
  plusTardJusqua  DateTime?
  revenueLe       DateTime? // revenue d'un « Plus tard » : en tête de la liste
  precedent       String?   // JSON : l'état avant la dernière réponse (pour « Annuler »)
  commenceLe      DateTime? // raccourci ouvert : mesure du temps réel
  dureeReelleSec  Int?
  detecteLe       DateTime  @default(now()) // dernier passage d'un détecteur qui l'a vue
  archiveLe       DateTime?
  archiveMotif    String?
  ecriture        String?

  @@index([statut, niveau])
  @@index([dossierId])
  @@index([leadId])
  @@index([type, reponseRaison, reponduLe])
}

model RegleTache {           // « Pas à faire » qui apprend : règle proposée puis validée par Lucas
  id          String    @id @default(cuid())
  createdAt   DateTime  @default(now())
  type        String    // TypeTache visé
  raison      String    // la raison qui revenait
  effet       String    // ATTENDRE (delaiJours) | NE_PLUS_PROPOSER
  delaiJours  Int?
  libelle     String    // la règle en une phrase
  par         String
  archiveLe   DateTime?
  archiveMotif String?
  ecriture    String?
}
```

Ajouts ailleurs :
- `Lead.dernierContactLe DateTime?` : dernier contact **écrit** sortant (SMS copié, mail parti). Un lead ainsi
  contacté sort d'« À appeler » et entre dans « À rappeler » sans date (règle de `prospects/leads.ts`).
- `Dossier.prochaineActionManuelleLe DateTime?`, `Dossier.prochaineActionManuelle String?`,
  `Dossier.prochaineActionPar String?` : la prochaine action posée à la main (Lucas ou Claude) et son texte d'alors.

## 2. Détecteurs et moteur

Un détecteur = une fonction pure côté écriture : `detecter(contexte) → Detection[]`. Il ne touche jamais la base.
Le moteur (`a-faire/moteur.ts › reconcilier`) écrit :

1. Les détections sont fusionnées par `cle` (plusieurs sources peuvent voir la même tâche : REPONDRE par mail,
   par l'espace, par SMS → une seule tâche « Répondre · Nom », la source la plus récente fournit le raccourci).
2. Pour chaque détection :
   - pas de ligne → création `A_FAIRE` ;
   - `A_FAIRE` → mise à jour (titre, raison, niveau, montant, échéance, raccourci, données, `detecteLe`) ;
   - `PLUS_TARD` → mise à jour des champs ; si `plusTardJusqua ≤ maintenant` **ou** si un événement du client est
     arrivé après `reponduLe` → retour `A_FAIRE` avec `revenueLe = maintenant` (en tête) ;
   - `FAITE` ou `PAS_A_FAIRE` **par le CRM** (`reponduPar` commence par `SYSTEME:`) → la condition est revenue :
     retour `A_FAIRE` ;
   - `FAITE` ou `PAS_A_FAIRE` **par Lucas ou Claude** → rien, sauf si un événement du client est arrivé après
     `reponduLe` (alors retour `A_FAIRE`). Pour un sujet SYSTEME (pas de client) : retour `A_FAIRE` si la condition
     tient encore 24 h après la réponse.
3. Chaque tâche `A_FAIRE`/`PLUS_TARD` d'une source couverte par le passage, qui n'a pas été détectée :
   - sujet disparu (lead archivé ou perdu, dossier archivé ou perdu) → `PAS_A_FAIRE`, raison `SUJET_DISPARU` ;
   - sinon → `FAITE` par le CRM ; `reponseTexte` = « coché par le CRM : … » (preuve lue en base par
     `a-faire/achevement.ts`, ex. « devis 2026-043 déposé », « réponse partie le 29/09 ») ;
   - les tâches `MANUELLE` ne sont jamais cochées par absence (seulement par leur condition, s'il y en a une).
4. Règles apprises (`RegleTache` actives) : `NE_PLUS_PROPOSER` écarte le type ; `ATTENDRE n` ne crée la tâche que si
   `depuis + n jours ≤ maintenant`.

**Événement du client** (`a-faire/evenements-client.ts › dernierEvenementClient`) : pour un dossier, le plus récent
`DossierEvenement` ENTRANT parmi MAIL_RECU, SMS_RECU, WHATSAPP_RECU, ESPACE_MESSAGE, ESPACE_COMMENTAIRE,
ESPACE_NOUVELLE_PROPOSITION, ESPACE_PHOTOS, ESPACE_VISITE (première visite seulement), ESPACE_DEVIS_ACCEPTE,
ESPACE_SIMULATION_CHOISIE, ESPACE_SIMULATIONS_DEMANDEES, ESPACE_PROJET_VALIDE, ESPACE_NOUVEAU_PROJET,
ESPACE_PROJET_DEMANDE, ESPACE_ACCORD_RETIRE, DEMANDE_SITE, ESPACE_SIMULATION_CLIENT ; pour un lead, le plus récent
`Message` ENTRANT, `Sms` ENTRANT, `SimulationSite` ou `PhotoLead` rattachés. Les relectures du devis
(ESPACE_DEVIS_CONSULTE) et les visites suivantes ne comptent pas.

**Prochaine action manuelle en vigueur** (cas « j'attends sa modification visuelle ») : `prochaineActionManuelleLe`
posé, `prochaineAction` égale au texte retenu, et aucun événement du client après. Tant qu'elle est en vigueur :
aucun détecteur ne crée de tâche sur ce dossier (signaux, cohérence, étapes, messages plus anciens compris) ; une
seule tâche `PROCHAINE_ACTION` apparaît le jour de sa date. Posée à la main, elle écrit un événement
`PROCHAINE_ACTION_MANUELLE` qui compte comme une réponse pour la règle de la main (ce qui est plus ancien est traité)
et qui passe la main au client si le texte dit d'attendre (`/\battend|\battente\b/i` : « en attente de… » compris), sinon à
Lucas.

Passages : `a-faire/detection.ts › passeComplete(maintenant)` lance tous les détecteurs puis `reconcilier`.
- Travail périodique `taches-a-faire` toutes les 15 minutes (le contrôle de cohérence, coûteux, au plus une fois par
  heure : résultat gardé en mémoire).
- `signalerChangementTaches()` après chaque geste concerné : met en file `A_FAIRE_DETECTION` (clé unique, mode
  RECONCILIATION, dans 3 s) → une seule passe, rejouée une fois si d'autres gestes arrivent pendant.

## 3. Types de tâches

| Type | Titre | Niveau | Durée | Source | Raccourci |
|---|---|---|---|---|---|
| REPONDRE | Répondre · Nom | 1 | 5 | MAIL / ESPACE_MESSAGES / DOSSIERS (SMS) | conversation mail, fil de l'espace, SMS |
| LIRE_MAIL | Lire · Expéditeur | 5 | 1 | MAIL (administratif non lu) | conversation mail |
| DATE_CHANTIER | Fixer la date du chantier · Nom | 1 | 3 | DOSSIERS / SIGNAUX | créneaux libres de l'agenda |
| ENCAISSER | Encaisser l'acompte · Nom | 1 | 1 | DOSSIERS | encaissement prérempli |
| DEMANDE_CLIENT | Préparer une autre proposition · Nom (ou « Accorder des simulations », « Ouvrir un nouveau projet ») | 1 | 5 | SIGNAUX | dossier |
| RELANCER_DEVIS | Relancer le devis · Nom | 2 | 2 | RELANCES | aperçu du mail de relance, ou SMS à copier |
| HESITE | Appeler · Nom (devis relu 4 fois) | 2 | 3 | SIGNAUX | tel: |
| RAPPELER | Rappeler · Nom | 2 | 3 | LEADS / DOSSIERS | tel: puis fin d'appel |
| APPELER | Appeler · Nom | 2 (< 24 h) sinon 3 | 3 | LEADS | tel: puis fin d'appel |
| PROCHAINE_ACTION | (texte de l'action) · Nom | 2 | 3 | DOSSIERS | dossier |
| VALIDER | Valider · (titre de la proposition) | 2 relance, 3 carte, 5 règle | 1 | PROPOSITIONS | Valider / Ignorer dans la ligne |
| SIMULATION | Préparer la simulation · Nom | 3 | 10 | DOSSIERS | simulateur ouvert sur le dossier |
| PUBLIER | Publier la simulation · Nom | 3 | 1 | SIGNAUX | dossier, rubrique simulations |
| DEVIS | Faire le devis · Nom | 3 | 10 | DOSSIERS | devis prérempli, ou « déposer un PDF » |
| ENVOYER_LIEN | Envoyer le lien · Nom | 3 | 1 | SIGNAUX | SMS LIEN_ESPACE à copier |
| RELANCER_PHOTOS | Relancer pour les photos · Nom | 3 | 1 | RELANCES | SMS à copier |
| DECIDER | Décider · Nom (appelé, sans rappel daté) | 3 | 2 | LEADS | fiche du lead |
| MANUELLE | le texte de Lucas | 3 | 5 | MANUELLE | aucun (ou la cible) |
| SYSTEME | (verbe) · (quoi) | 4 si urgent, sinon 5 | 5 | SYSTEME | la bonne page + marche à suivre |
| COHERENCE | Corriger · Nom | 5 | 1 | COHERENCE | corriger en un geste / dossier |
| ECARTER | Classer · Nom (hors zone) | 5 | 1 | LEADS | fiche du lead |
| CLASSER_LEAD | Classer · Nom (ancien contact) | 5, lot `anciens-leads` | 1 | LEADS | fiche du lead |

Ordre : niveau, puis montant en jeu (le plus gros d'abord), puis ancienneté (`depuis`, le plus ancien d'abord).
Une tâche revenue d'un « Plus tard » passe en tête le jour de son retour.
« Aujourd'hui » : les 10 premières tâches `A_FAIRE` hors lot ; le reste va dans « Plus tard » (compteur), avec les
tâches reportées. « En lot » : une ligne par lot, « Tout classer » ou « Revoir un par un ».
Le badge de l'onglet compte les tâches d'« Aujourd'hui » (10 au plus).

Durées : valeurs de départ ci-dessus ; ensuite médiane des 20 dernières durées mesurées du type (ouverture du
raccourci → « Fait » ou coche du CRM dans l'heure), bornée entre la moitié et le triple de la valeur de départ.

## 4. Réponses

- **Fait** : `FAITE`. Effet sur la source : proposition → validée ; mail → fil archivé ; message d'espace → lu, et
  événement `REPONSE_INUTILE` (compte comme une réponse) ; lead « Appeler » → `dernierContactLe` posé.
- **Plus tard** : `PLUS_TARD` jusqu'à CE_SOIR (18 h), DEMAIN (9 h), LUNDI (9 h), SEMAINE (+7 j, 9 h) ou une date ;
  raison facultative (`ATTEND_CLIENT` « J'attends le client », …). Mail → fil reporté (snooze) jusqu'à la même date.
- **Pas à faire** : `PAS_A_FAIRE` + raison adaptée au type : CLIENT_LE_FAIT, DEJA_FAIT, CLIENT_PERDU (motif de perte
  obligatoire : lead → sans suite, dossier → perdu), PAS_PERTINENT, PAS_DE_REPONSE_A_FAIRE (mail), AUTRE (texte).
  Mail → fil archivé (ne demande pas de réponse) ; proposition → ignorée ; message d'espace → lu + `REPONSE_INUTILE`.
- Rien ne se supprime. Les effets sur la source partent dans la file (`A_FAIRE_EFFET`, dans 6 s) : « Annuler »
  (5 s à l'écran) remet l'état précédent (`precedent`) et annule l'effet encore en attente.
- **Apprentissage** : trois « Pas à faire » de même type et même raison en 30 jours → proposition `REGLE_TACHE`
  (mécanisme `proposer`, écran À valider, outil `valider_proposition`) : « Préparer la simulation : attendre 3 jours
  avant de la proposer ». Validée → une ligne `RegleTache`.

## 5. Coche automatique (achèvement)

| Type | Condition d'achèvement | Raison affichée |
|---|---|---|
| DEVIS | un devis visible (`estDevisEnvoye`) | « devis 2026-043 déposé » / « émis » |
| SIMULATION | une simulation PUBLIEE | « simulation publiée le 29/09 » |
| REPONDRE | réponse partie (mail sortant, réponse d'espace, SMS copié, appel abouti), fil archivé ou rangé | « réponse partie le 29/09 » |
| APPELER | lead contacté (appel, SMS copié, mail parti) | « SMS copié le 29/09 » |
| DATE_CHANTIER | `dateChantier` posée | « date posée au 12/10 » |
| ENCAISSER | un encaissement VALIDE | « encaissement de 1 200 € saisi » |
| VALIDER | proposition décidée | « proposition validée » |

## 6. Mise en route (migration `taches-a-faire-17-a`)

Sauvegarde (automatique avant toute migration), puis : première passe des détecteurs ; décisions du 29/09
(retrouvées par empreinte du nom normalisé, jamais par nom en clair ; un seul candidat ou rien) ; un lot pour les
anciens leads ; une tâche manuelle par point restant des missions 15 et 16 (lot `reprise`).
