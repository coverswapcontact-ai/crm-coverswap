# Couverture MCP — tout ce que l'interface du CRM sait faire, le MCP doit savoir le faire aussi

## 1. En-tête

- **Objet** : audit de couverture de la mission 17, partie C. Pour chaque écran du CRM, chaque bouton, formulaire,
  réglage ou geste est rapproché de l'outil MCP qui fait la même chose, **paramètres compris**. Le document donne
  ensuite la liste des manques et l'outillage qui les ferme tous.
- **Date** : 30/09/2026. Code audité : branche de la mission 17, commit `62e73bc` (fin de la partie B : `/taches`,
  `/taches-de-fond`, `/analytique` ; `/publicite` et `/synthese` redirigés ; `/finances` allégé ; blocs retirés de
  Leads (entonnoir), Clients (« D'où viennent les clients ») et Dépenses (tuiles par catégorie)).
- **Catalogue audité** : **84 outils**, empreinte du registre **`3db5c223f5bb`**. Valeur relevée par
  `registreOutils()` (`src/lib/assistant/couverture.ts`) avec un petit script `tsx`. C'est la même empreinte que celle
  de `/api/health` et de `lister_outils`.
- **Règle** : **zéro action manquante**. Toute action de l'interface a son outil MCP, avec les mêmes paramètres, la
  même fonction de service et la même sensibilité. Les seules exceptions sont les gestes « sans objet » listés comme
  tels : appel téléphonique `tel:`, presse-papiers, tri local, consentement OAuth dans le navigateur, abonnement push de
  l'appareil, file hors ligne.
- **Maintenance** : ce document se met à jour **à chaque changement d'écran ou d'outil**, dans le même commit. On
  ajoute ou corrige la ligne de l'écran et l'outil qui la couvre, puis on relève la nouvelle empreinte. La mission 18
  (retrait de l'onglet Espaces, Dépenses dans Finances, Tâches de fond et Tarifs dans Paramètres) devra mettre ces
  tableaux à jour, comme le prévoit `docs/MISSION-18.md`.
- **Sources** : inventaires de travail faits avant les parties A et B, puis vérifiés et complétés sur le code actuel
  (`src/app/(pilotage)/**`, `src/app/api/**`, `src/components/pilotage/**`). Schémas des 84 outils relus un par un :
  nom, niveau, description et paramètres, sortis du catalogue au format JSON Schema.

### Légendes

- **Nature** :
  - `L` : lecture.
  - `R` : écriture réversible.
  - `S-client` : sensible, part chez le client (mail, espace, site public, trace d'un SMS envoyé).
  - `S-€` : sensible, argent (encaissement, facture, coût d'IA ou d'images).
  - `S-suppr` : sensible, suppression logique (archivage, retrait, anonymisation).
  - `S-param` : sensible, paramètres et réglages globaux.
  - `S-sécu` : sensible, accès et connexions.
  - `—` : geste local, sans serveur.
- **Statut** :
  - `couvert` : l'outil fait la même chose, avec les mêmes paramètres.
  - `partiel : …` : l'outil existe, mais il manque ce qui est dit.
  - `manquant` : aucun outil ne le fait.
  - `sans objet` : geste qu'un assistant ne fait pas (voir la règle ci-dessus).

## 2. Inventaire par écran

Chaque ligne porte un repère (T1, L3…), repris dans les sections 3 et 4.

### 2.1 Tâches (`/taches`, partie A)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| T1 | Liste « Aujourd'hui » : les 10 du jour, titre, raison, durée, geste prêt, compteurs, minutes du jour | GET /api/a-faire | L | taches (AUJOURDHUI) | couvert |
| T2 | Relecture automatique (20 s, retour sur l'onglet, après un geste) | GET /api/a-faire | L | taches | couvert |
| T3 | « Actualiser » : une passe de tous les détecteurs, avec les tâches nouvelles et celles cochées par le CRM | POST /api/a-faire/detecter | R | — | manquant |
| T4 | « J'ai N minutes » : le plan regroupé (« 3 appels · 10 min ») | GET /api/a-faire/minutes?m= | L | taches (MINUTES, minutes) | couvert |
| T5 | « Commencer » / lancer un groupe du plan : série plein écran, Passer, Quitter | — | — | taches (l'ordre suffit) | sans objet |
| T6 | Bouton principal APPEL (`tel:`, puis fin d'appel) | tel: ; POST /api/commercial/appels | R | taches (numéro) + noter_appel | couvert |
| T7 | Bouton principal SMS : écran SMS, texte prêt, « Copier » | POST /api/sms/copie | S-client | taches (texte prêt) + noter_sms | couvert |
| T8 | Bouton principal MAIL : panneau du fil ouvert sur « Répondre » | GET /api/mail/:id ; POST /api/mail/envoyer | S-client | lire_mail + deposer_brouillon / envoyer_mail | couvert |
| T9 | Bouton principal ESPACE : fil des messages de l'espace, réponse | POST /api/dossiers/:id/espace {geste:repondre} | S-client | repondre_espace | couvert |
| T10 | Bouton principal DEVIS : générateur prérempli d'après l'espace, ou dépôt d'un PDF | GET /api/dossiers/:id/devis-propose ; POST …/documents | S | generer_document / deposer_document | partiel : les lignes préremplies (`devisProposeDuDossier`) ne sont pas exposées |
| T11 | Bouton principal ENCAISSER | POST /api/dossiers/:id/encaissements | S-€ | saisir_encaissement | partiel : ni pièce réglée, ni payeur, ni date de crédit (voir DP9) |
| T12 | PLANIFIER : les jours libres des 10 prochains jours ouvrés (agenda Google) | GET /api/a-faire/creneaux?dossierId= | L | — | manquant |
| T13 | PLANIFIER : poser la date du chantier | PATCH /api/dossiers/:id {dateChantier} | R | modifier_dossier (date_chantier) | couvert |
| T14 | Bouton principal SIMULATEUR | nav /simulateur | R | preparer_simulation | couvert |
| T15 | RELANCE_MAIL : relire, corriger, valider le mail de relance | POST /api/validation/:id/valider {corrections} | S-client | valider_proposition / relancer | partiel : seule la correction `valeur` passe ; l'objet et le texte du mail ne se corrigent pas |
| T16 | « Valider » dans la ligne (proposition non sensible) | POST /api/a-faire/:id/reponse {FAIT} | R | repondre_tache (FAIT) | couvert |
| T17 | « Relire et valider » (proposition sensible → `/validation?proposition=`) | GET/POST /api/validation | S | repondre_tache (aperçu) / valider_proposition | partiel : valider_proposition ne calcule pas la sensibilité du type (voir V4) |
| T18 | COHERENCE : « Corriger » | POST /api/coherence/corriger {cle} | R / S | — | manquant |
| T19 | Toucher la ligne : fiche du dossier ou du contact | GET /api/dossiers/:id, /api/prospects/entrants/:id | L | lire_fiche | couvert |
| T20 | PAGE : lien vers un écran du CRM ou une page externe | — | — | — | sans objet |
| T21 | « Fait » (bouton, balayage à droite, mode Commencer) | POST /api/a-faire/:id/reponse {FAIT} | R (S si l'effet part chez le client ou touche l'argent) | repondre_tache (FAIT) | couvert |
| T22 | « Plus tard » : Ce soir / Demain / Lundi / Dans une semaine, raison facultative (dont « J'attends le client ») | … {PLUS_TARD, quand, raison} | R | repondre_tache (PLUS_TARD, quand, raison) | couvert |
| T23 | « Plus tard » › « Une date… » | … {PLUS_TARD, date} | R | repondre_tache (quand = date dictée) | couvert |
| T24 | « Pas à faire » : raison selon le type (déjà fait, le client le fait, pas pertinent, pas de réponse à faire…) | … {PAS_A_FAIRE, raison} | R | repondre_tache (PAS_A_FAIRE, raison) | couvert |
| T25 | « Pas à faire » › « Client perdu » : motif, précision si Autre | … {raison CLIENT_PERDU, motifPerte, precisionPerte} | S (perte) | repondre_tache (motif_perte, precision) | couvert |
| T26 | « Pas à faire » › « Autre » : texte | … {raison AUTRE, texte} | R | repondre_tache (AUTRE, texte) | couvert |
| T27 | « Ignorer » dans la ligne (proposition) | … {PAS_A_FAIRE, PAS_PERTINENT} | R | repondre_tache | couvert |
| T28 | « Annuler » dans le message (5 s) | POST /api/a-faire/:id/annuler | R | repondre_tache (ANNULER) | couvert |
| T29 | Section « Plus tard » : les reportées et leur date de retour | GET /api/a-faire | L | taches (PLUS_TARD) | couvert |
| T30 | Section « Fait aujourd'hui » | GET /api/a-faire | L | taches (FAIT) | couvert |
| T31 | « Demain : N » (ce qui revient) | GET /api/a-faire | L | taches (demain) | couvert |
| T32 | Lots de ménage : la liste | GET /api/a-faire | L | taches (LOTS) | couvert |
| T33 | Lot › « Revoir un par un » : les tâches du lot | GET /api/a-faire/lots/:lot | L | — | manquant (LOTS ne rend que le libellé et la clé) |
| T34 | Lot › « Tout classer » | POST /api/a-faire/lots/:lot/classer | R (masse) | — | manquant |
| T35 | Lot › « Annuler » ce classement | POST /api/a-faire/lots/:lot/annuler {le} | R | — | manquant |
| T36 | Ajouter une tâche : titre, date facultative, « pour qui ? » (recherche dossier, lead, client) | POST /api/a-faire/ajouter | R | ajouter_tache (titre, quand, cible, raison) | couvert |
| T37 | Mesure « commencer » (temps réel passé) | POST /api/a-faire/:id/commencer | — | — | sans objet |
| T38 | Hors ligne : liste servie depuis le cache | service worker | — | — | sans objet |

### 2.2 Leads (`/leads`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| L1 | En-tête › « Nouveau » : prénom, nom, téléphone, e-mail, ville, code postal, source, projet, notes | POST /api/prospects/entrants | R | creer_contact | couvert (le MCP ajoute l'anti-doublon et `ouvrir_dossier`) |
| L2 | Rafraîchir | GET /api/leads | L | leads_a_appeler / leads_a_rappeler | couvert |
| L3 | Puce « À appeler » (compteur, pages) | GET /api/leads?vue=A_APPELER&page= | L | leads_a_appeler (limite ≤ 50) | partiel : ni page, ni source, ni recherche |
| L4 | Puce « À rappeler » (« dont N en retard ») | GET /api/leads?vue=A_RAPPELER | L | leads_a_rappeler (limite, page) | partiel : ni source, ni recherche |
| L5 | Puce « Sans suite » | GET /api/leads?vue=SANS_SUITE | L | — | manquant |
| L6 | Puce « Archivés » | GET /api/leads?vue=ARCHIVES | L | — | manquant (`chercher` exclut aussi les archivés) |
| L7 | Filtre « Source » | GET /api/leads?source= | L | — | manquant |
| L8 | Recherche « Nom, téléphone, ville, campagne » | GET /api/leads?q= | L | chercher | partiel : pas de recherche par campagne, clients, leads et dossiers mélangés |
| L9 | « Enchaîner les appels · N » (la file) | GET /api/leads/suivant?apres= | L | leads_a_rappeler + leads_a_appeler | couvert |
| L10 | Mode appels › « Passer » / « Quitter » | — | — | — | sans objet |
| L11 | Mode appels › « Noter sans appeler » | POST /api/commercial/appels | R | noter_appel | couvert |
| L12 | Mode appels › « Ouvrir son dossier sans noter d'appel » | POST /api/leads/:id/dossier | R | ouvrir_dossier | couvert |
| L13 | Ligne › téléphone (`tel:`) | — | — | — | sans objet |
| L14 | Ligne › puce du rappel : déplacer | PATCH /api/prospects/entrants/:id {rappelLe} | R | planifier | partiel : crée en plus un événement Google Calendar, avec un texte d'action imposé |
| L15 | Ligne › puce du rappel : « Sans date » | PATCH … {rappelLe:null} | R | — | manquant |
| L16 | « Sélectionner » / « Tout (n) » / désélectionner | — | — | — | sans objet |
| L17 | Sélection › « Archiver » + motif (Test, Doublon, Hors cible, Autre) | POST /api/leads/actions {ARCHIVER} | S-suppr (masse) | archiver (leads, motif) | couvert |
| L18 | Sélection (Archivés) › « Restaurer » | POST /api/leads/actions {RESTAURER} | R | restaurer (leads) | partiel : le MCP ne trouve pas les identifiants des archivés (aucune liste ne les donne) |
| L19 | Message « Annuler » (action inverse) | POST /api/leads/actions | R | archiver / restaurer | couvert |
| L20 | Ligne du jour : « N rappels aujourd'hui · N en retard » | GET /api/leads | L | leads_a_rappeler | couvert |
| L21 | Ligne du jour › « N relances proposables » → feuille Relances | GET /api/relances | L | voir_relances | couvert |
| L22 | Relances › « SMS » (texte modifiable) → « Copier » | POST /api/sms/proposition ; POST /api/sms/copie | S-client | voir_relances + noter_sms | couvert |
| L23 | Relances › « Relire le mail » → corriger → valider | POST /api/validation/:id/valider | S-client | valider_proposition / relancer | partiel : l'objet et le texte ne se corrigent pas |
| L24 | Sur le site › simulations des 7 derniers jours, avec images | SSR `simulationsSiteRecentes(7)` | L | simulations_site | couvert |
| L25 | Sur le site › générations en cours ou en échec, avec la raison | SSR `travauxSiteRecents(7)` | L | — | manquant |
| L26 | Sur le site › ouvrir le lead | — | L | lire_fiche | couvert |
| L27 | Notifications de l'appareil : activer, désactiver | POST /api/push/abonnement | — | — | sans objet (PushManager du navigateur) |
| L28 | Notification d'essai | POST /api/push/essai | R | — | manquant |

#### Fiche d'un lead (`PanneauEntrant`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| LF1 | Ouvrir la fiche (et la marquer vue) | GET /api/prospects/entrants/:id | L | lire_fiche (leadId) | partiel : ne rend ni les notes, ni le code postal, ni campagne / publicité / formulaire, ni le prix simulé, le style, les réponses au formulaire, le doublon, les tentatives, le dernier appel, l'archivage, l'ancien CRM |
| LF2 | Doublon › « Fusionner avec X » | POST /api/leads/:id/doublon {fusionner} | S-suppr | — | manquant |
| LF3 | Doublon › « Ce n'est pas la même personne » | POST /api/leads/:id/doublon {ecarter} | R | — | manquant |
| LF4 | « Ouvrir un dossier » | POST /api/leads/:id/dossier | R | ouvrir_dossier | couvert |
| LF5 | Liens « Dossier · étape » / « Fiche client » | — | L | lire_fiche | couvert |
| LF6 | Téléphone (`tel:`) | — | — | — | sans objet |
| LF7 | « Noter l'appel » → feuille de fin d'appel | POST /api/commercial/appels | R | noter_appel | couvert |
| LF8 | « Lien espace client » : ouvre le dossier et l'espace, copie le lien | POST /api/prospects/entrants/:id/espace | R | lien_espace | partiel : `lien_espace` note « lien communiqué par SMS » et passe la main au client ; il ne sait pas ouvrir l'espace sans rien noter |
| LF9 | « SMS avec le lien » → « Copier » | POST /api/sms/proposition ; POST /api/sms/copie | S-client | lien_espace + noter_sms | couvert |
| LF10 | « Écrire un mail » | écran Mail | S-client | rediger_mail / deposer_brouillon / envoyer_mail | couvert |
| LF11 | Rappel › poser ou déplacer | PATCH … {rappelLe} | R | planifier | partiel : crée en plus un événement dans l'agenda |
| LF12 | Rappel › « Retirer la date » | PATCH … {rappelLe:null} | R | — | manquant |
| LF13 | Notes d'appel › saisie (enregistrée à la frappe) et étiquettes | POST / PUT /api/leads/:id/notes-appel | R | noter_appel (texte, etiquettes) | partiel : l'issue est obligatoire (le MCP note aussi un appel) ; une note existante ne se complète pas |
| LF14 | Notes d'appel › « Nouvel appel » | POST /api/leads/:id/notes-appel | R | noter_appel | partiel : mêmes limites que LF13 |
| LF15 | Notes d'appel › historique | GET /api/leads/:id/notes-appel | L | lire_fiche | couvert |
| LF16 | Priorité de rappel : Prioritaire, Standard, Secondaire, À écarter, « Recalculer » | PATCH … {priorite} | R | — | manquant |
| LF17 | Statut : Nouveau, Devis demandé, Contacté | PATCH … {statut} | R | — | manquant |
| LF18 | « Classer sans suite » (motif, précision) et retour du « sans suite » | PATCH … {statut PERDU, motifPerte, motif} | R | noter_appel (PAS_INTERESSE) / repondre_tache (CLIENT_PERDU) | partiel : passe forcément par un appel ou une tâche ; un « sans suite » ne se rouvre pas |
| LF19 | « Noter un échange » : Appel, SMS, E-mail ou Note, avec un texte | POST /api/prospects/entrants/:id/echanges | R | ajouter_note / noter_sms / noter_appel | partiel : un e-mail, ou un appel sans issue, ne se note pas |
| LF20 | Échanges (liste) | GET entrant | L | lire_fiche | couvert |
| LF21 | Sa demande, photos jointes (visionneuse) | GET entrant | L | voir_photos (leadId) | couvert |
| LF22 | Simulations du lead : avant, après, PDF | GET entrant | L | simulations_site (lead_id) / voir_simulations | partiel : le PDF de la simulation n'est pas lisible |
| LF23 | Demande › « Corriger » : prénom, nom, téléphone, e-mail, ville, code postal, projet | PATCH /api/prospects/entrants/:id | R | proposer_mise_a_jour (LEAD) + valider_proposition | partiel : exige un mail source |
| LF24 | Notes › « Enregistrer les notes » | PATCH … {notes} | R | — | manquant |
| LF25 | Ancien CRM : devis, factures PDF, chantier | GET entrant | L | — | manquant |
| LF26 | « Archiver le contact » (motif libre) | POST /api/prospects/entrants/:id/archiver | S-suppr | archiver (leads, motif) | partiel : le motif libre est ramené à quatre codes |
| LF27 | « Restaurer le contact » | POST /api/prospects/entrants/:id/restaurer | R | restaurer (leads) | couvert |

#### Feuille de fin d'appel (`FinAppel`, montée partout)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| FA1 | Contexte : nom, source, tentatives | GET /api/commercial/appels/contexte | L | lire_fiche | couvert |
| FA2 | « Intéressé » (dossier et espace ouverts, SMS proposé) | POST /api/commercial/appels {INTERESSE} | R | noter_appel | couvert |
| FA3 | « À rappeler » : raccourcis, Autre…, Sans date | … {A_RAPPELER, rappelLe} | R | noter_appel (rappel) | couvert |
| FA4 | « Pas de réponse » et rappel (demain 18 h par défaut) | … {PAS_DE_REPONSE} | R | noter_appel | couvert |
| FA5 | « Classer sans suite — plus de réponse » (3ᵉ tentative) | … {PAS_INTERESSE, SANS_REPONSE} | R | noter_appel | couvert |
| FA6 | « Pas intéressé » + motif (+ précision) | … {PAS_INTERESSE, motifPerte} | R | noter_appel | couvert |
| FA7 | « Plus tard » | — | — | — | sans objet |
| FA8 | SMS proposé → « Copier » | POST /api/sms/copie | S-client | noter_sms | couvert |
| FA9 | Carte « Suivant » | GET /api/leads/suivant | L | leads_a_rappeler / leads_a_appeler | couvert |

### 2.3 Dossiers (`/dossiers`) — liste, création, reprise

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| D1 | Liste « En cours » et compteurs (à faire, en retard, sorties, inactifs) | GET /api/dossiers?page&vue&q&inactifs | L | dossiers_par_etape | partiel : ni pages, ni recherche, ni compteurs |
| D2 | Onglet « À faire » (la main est à Lucas) | GET /api/dossiers?vue=A_FAIRE | L | taches / ce_qui_m_attend | couvert |
| D3 | Kanban / Liste, tri | — | — | — | sans objet |
| D4 | Recherche « Client, ville, objet » | GET /api/dossiers?q= | L | chercher | partiel : la recherche par objet n'est pas garantie |
| D5 | « Perdus et en pause » | GET /api/dossiers?vue=TOUS | L | dossiers_par_etape (PERDU, EN_PAUSE) | couvert |
| D6 | « Masquer les inactifs » | ?inactifs=0 | L | — | manquant |
| D7 | « Archivés » (les 200 derniers) | GET /api/dossiers/archives | L | — | manquant |
| D8 | Archivés › « Restaurer » | POST /api/dossiers/:id/archivage {restaurer} | R | restaurer (dossiers) | partiel : le MCP ne trouve pas les identifiants des archivés |
| D9 | « Légende » | — | — | — | sans objet |
| D10 | Pastille « N à valider » | GET /api/validation?statut=EN_ATTENTE | L | ce_qui_m_attend (nombre) | couvert |
| D11 | Raccourcis de carte (photos, messages, devis, encaisser, étape suivante) | — | — | voir le panneau (DP) | sans objet |
| D12 | Création › « Depuis un lead » : recherche | GET /api/dossiers/leads?q= | L | chercher | couvert |
| D13 | Création › formulaire prérempli (lead, client ou prospect) : nom, téléphone, e-mail, adresse, code postal, ville, objet, source, montant estimé, prochaine action et date, étape de départ, date de chantier, photos (au moins une) | POST /api/dossiers (multipart) ; POST /api/dossiers/:id/photos | R | ouvrir_dossier / creer_contact (ouvrir_dossier) | partiel : aucun de ces champs, ni étape de départ, ni date de chantier, ni photos ; pas de dossier depuis une fiche client |
| D14 | Création › « Direct » : même formulaire + type de client (particulier ou entreprise, SIRET, sous-traitance) | POST /api/dossiers | R | creer_contact (ouvrir_dossier) | partiel : mêmes limites que D13, plus catégorie et SIRET |
| D15 | Création › annuaire des entreprises | GET /api/clients/annuaire?q= | L | — | manquant |
| D16 | « Reprise » d'un dossier commencé avant le CRM : fiche, étape actuelle, dates des jalons, date d'ouverture, documents émis (numéro, date, montant, statut, registre), paiements reçus, puis les PDF un par un | GET /api/numeros?libres=1 ; POST /api/dossiers/reprise ; POST …/documents/:docId/pdf | S-€ | — | manquant (le détour creer_contact + changer_etape + deposer_document + saisir_encaissement n'est pas atomique et perd les dates des jalons) |

### 2.4 Dossier — le panneau et ses rubriques (`PanneauDossier`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| DP1 | Ouverture, relue toutes les 30 s | GET /api/dossiers/:id | L | lire_fiche (dossierId) | partiel : manquent la source, la date d'ouverture, `mainLe`, les points masqués, la perte détaillée, les photos, les délais, l'historique complet |
| DP2 | En-tête › téléphone → feuille de fin d'appel sur le dossier | POST /api/commercial/appels {dossierId} | R | noter_appel (dossierId) | couvert |
| DP3 | En-tête › e-mail (`mailto:`), « Contact : lead » | — | — | envoyer_mail / lire_fiche | sans objet |
| DP4 | À compléter › croix « masquer ce point pour ce dossier » | PATCH /api/dossiers/:id/completude {code, masque:true} | R | — | manquant |
| DP5 | À compléter › « Réafficher » un point masqué | PATCH … {masque:false} | R | — | manquant |
| DP6 | Prochaine action : texte et date (Aujourd'hui, Demain, Dans 3 j, Dans 1 sem.) › « Enregistrer » ou vider | PATCH /api/dossiers/:id {prochaineAction, prochaineActionDate} | R | modifier_dossier (prochaine_action, prochaine_action_date) / planifier | couvert |
| DP7 | Relance proposable › « SMS » relance n/2 → « Copier » | GET /api/relances?dossierId= ; POST /api/sms/copie | S-client | voir_relances + noter_sms | couvert |
| DP8 | Relance proposable › « Relire le mail » → valider | POST /api/validation/:id/valider | S-client | valider_proposition / relancer | partiel : l'objet et le texte ne se corrigent pas |
| DP9 | Encaisser l'acompte ou le solde : montant, date, moyen, référence, pièce réglée (automatique ou choisie) | POST /api/dossiers/:id/encaissements {paiement, numeroDocumentId} | S-€ | saisir_encaissement | partiel : ni pièce réglée, ni date de crédit, ni payeur |
| DP10 | Étape › bouton d'étape suivante, « Reprendre en … » | POST /api/dossiers/:id/etape {vers} | R ; S vers Signé, Facturé, Encaissé, Perdu | changer_etape | couvert |
| DP11 | « Mettre en pause » | … {vers:EN_PAUSE} | R | changer_etape | couvert |
| DP12 | « Passer à une autre étape… » (avancer, revenir, sortir) | … {vers} | R | changer_etape | couvert |
| DP13 | Fenêtre › « Date du passage » (jour réel, passé) | … {survenuLe} | R | — | manquant |
| DP14 | Fenêtre › « Marquer perdu » : motif, « Remporté par », « Son prix », précision | … {motifPerte, perteConcurrent, perteMontantConcurrent, perteCommentaire} | S | changer_etape (motif_perte, commentaire) | partiel : ni le concurrent, ni son prix |
| DP15 | → Signé : case « bon pour accord » (hors espace) | … {confirmations} | S | changer_etape (accord_confirme) | couvert |
| DP16 | → Signé : choix du devis accepté (plusieurs devis) | … {devisAccepteId} | S | — | manquant |
| DP17 | → Signé : acompte reçu, dans la même transaction | … {acompte} (`changerEtapeAvecPaiement`) | S-€ | changer_etape + saisir_encaissement | partiel : deux appels, non atomique (l'outil appelle `changerEtape`) |
| DP18 | → Signé : « sans acompte » + motif + précision | … {sansAcompte} | S | — | manquant |
| DP19 | → Planifié : date de chantier | … {dateChantier} | R | changer_etape (date_chantier) | couvert |
| DP20 | → Encaissé : « solde reçu » + paiement | … {solde} | S-€ | saisir_encaissement + changer_etape | partiel : deux appels, non atomique |
| DP21 | Photos › voir, visionneuse (avant, après) | GET /api/dossiers/:id/photos/:photoId | L | voir_photos | couvert |
| DP22 | Photos › « Ajouter » / « Prendre une photo » (avant) | POST /api/dossiers/:id/photos | R | — | manquant |
| DP23 | Photos › « Photos après » (portfolio) | POST … {apres:1} | R | — | manquant |
| DP24 | Photos › visionneuse › « Supprimer la photo » | DELETE /api/dossiers/:id/photos/:photoId | S-suppr | — | manquant |
| DP25 | Historique › liste et « Voir les N plus anciens » | GET /api/dossiers/:id | L | lire_fiche | partiel : 5 événements en texte, 10 en données, pas de page |
| DP26 | Historique › « Lire le mail » de l'événement | GET /api/messages/:id | L | lire_mail | couvert |
| DP27 | Espace client › la vue : les 5 étapes du client, reste à faire, visites, projet, choix, favoris, avis, paiement vu, gestes, photos retirées | GET /api/dossiers/:id/espace | L | espaces_clients / messages_espace / voir_simulations | partiel : aucune vue de l'espace d'un dossier |
| DP28 | Espace › « Ouvrir l'espace client » | POST /api/dossiers/:id/espace {ouvrir} | R | lien_espace / envoyer_lien_espace | partiel : ces deux outils ouvrent l'espace en notant un envoi |
| DP29 | Espace › « Copier » le lien | — | L | espaces_clients (donnees.lien) | couvert |
| DP30 | Espace › « Voir comme le client » | lien d'aperçu signé | L | — | manquant |
| DP31 | Espace › « Envoyer le lien par mail » (à, objet, phrase) | POST /api/mail/lien-espace | S-client | envoyer_lien_espace (code, phrase, a) | partiel : l'objet ne se modifie pas |
| DP32 | Espace › « SMS avec le lien » → « Copier » | POST /api/sms/proposition ; /api/sms/copie | S-client | lien_espace + noter_sms | couvert |
| DP33 | Espace › « Désactiver le lien » (tous ses projets) | POST /api/dossiers/:id/espace {revoquer} | S | — | manquant |
| DP34 | Espace › « Nouveau lien », avec ou sans mail, avec un texte | POST /api/espaces/:permanentId {regenerer, mail, texte} | S-client | renouveler_lien (envoyer_par_mail) | partiel : le texte du mail ne se personnalise pas |
| DP35 | Espace › photos retirées par le client : les voir | GET /api/dossiers/:id/espace/photos-retirees/:photoId | L | — | manquant |
| DP36 | Espace › « Remettre » une photo retirée | POST …/espace {geste:remettre-photo} | R | — | manquant |
| DP37 | Espace › Projet › « Valider à sa place » | … {geste:valider-projet} | R | — | manquant |
| DP38 | Espace › Projet › « Dévalider » | … {geste:devalider-projet} | R | — | manquant |
| DP39 | Espace › Projet › « Modifier taille et note » | … {geste:modifier-projet} | R | modifier_dossier (dimensions, notes_projet) | couvert |
| DP40 | Espace › Projet › « Réinitialiser » l'étape | … {geste:reinitialiser, PROJET} | R (efface la saisie du client) | — | manquant |
| DP41 | Espace › Simulations › « Retirer la demande » | … {geste:retirer-demande} | R | — | manquant |
| DP42 | Espace › Simulations › « Valider » à sa place | … {geste:valider-simulation} | R | — | manquant |
| DP43 | Espace › Simulations › « Dévalider » | … {geste:devalider-simulation} | R | — | manquant |
| DP44 | Espace › Simulations › « Masquer » | PATCH /api/dossiers/:id/simulations/:sid {masquer} | R | masquer_simulation | couvert |
| DP45 | Espace › Simulations › « Afficher » (republier, mail automatique) | … {afficher} | S-client | publier_simulation | couvert |
| DP46 | Espace › Simulations › « Accorder 3 simulations » | … {geste:accorder, nombre} | S-€ (≈ 0,20 $ l'image) | accorder_simulations | couvert |
| DP47 | Espace › Simulations › « Réinitialiser » l'étape | … {geste:reinitialiser, SIMULATIONS} | R | — | manquant |
| DP48 | Espace › Devis › interrupteur « visible dans l'espace client » | PATCH /api/dossiers/:id/documents/:docId {visibleEspace} | R / S-client | presenter_devis (visible_espace) | couvert |
| DP49 | Espace › Devis › « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » | générateur / dépôt | S | generer_document / deposer_document | couvert |
| DP50 | Espace › Devis › « Retirer son accord » | … {geste:retirer-accord} | S | retirer_accord | couvert |
| DP51 | Espace › Paiement (ce qu'il voit), « Son avis » (note, texte, publication) | GET …/espace | L | manager_clients (agrégé) | partiel : rien par dossier |
| DP52 | Espace › Messages › le fil | GET …/espace | L | messages_espace | couvert |
| DP53 | Espace › Messages › « Répondre dans son espace » | … {geste:repondre} | S-client | repondre_espace | couvert |
| DP54 | Espace › « Ses derniers gestes » | GET …/espace | L | — | manquant |
| DP55 | Documents › « Générer un devis » | POST /api/dossiers/:id/documents | S | generer_document | partiel : les lignes SECTION ne se dictent pas |
| DP56 | Documents › « Générer une facture » | … {type:FACTURE} | S-€ | generer_document (FACTURE, depuis_devis) | couvert |
| DP57 | Documents › « Enregistrer un document existant » : type, numéro (suggestions du registre), date, montant, objet, statut, acompte, libellé, visibilité, PDF facultatif, inscription au registre | GET /api/numeros?libres=1 ; POST …/documents/existant ; POST …/pdf | S-€ | deposer_document | partiel : le PDF est obligatoire ; les numéros libres ne sont pas lisibles |
| DP58 | Documents › ouvrir ou télécharger le PDF | GET …/documents/:docId/pdf | L | — | manquant |
| DP59 | Documents › document repris › « Corriger » (date, montant, objet, statut, acompte, libellé, visibilité), « importer le PDF » | PATCH …/documents/:docId ; POST …/pdf | S-€ | presenter_devis (libellé, visibilité) | partiel : ni date, ni montant, ni objet, ni statut, ni acompte, ni PDF |
| DP60 | Documents › « Envoyer par mail » (à, objet, texte relus, PDF joint) | GET/POST …/documents/:docId/mail | S-client | envoyer_document | couvert |
| DP61 | Documents › « Refaire ce devis » (remplace) | POST …/documents {remplaceDocumentId} | S | generer_document (remplace) | couvert |
| DP62 | Documents › « Annuler par un avoir » (motif, précision) | POST …/documents/:docId/avoir | S-€ | annuler_document (motif_avoir) | couvert |
| DP63 | Documents › « Annuler ce devis » (motif) | POST …/documents/:docId/annulation | S | annuler_document | couvert |
| DP64 | Générateur › tarifs disponibles (presets) | GET /api/dossiers/presets | L | tarifs | partiel : ne rend pas la liste des presets avec leur identifiant |
| DP65 | Générateur › lignes préremplies d'après l'espace (choix, mètres, tarifs) | GET /api/dossiers/:id/devis-propose | L | — | manquant |
| DP66 | Générateur › numéro à venir | GET /api/dossiers/numerotation?type= | L | voir_parametres (numérotation) | couvert |
| DP67 | Générateur › lignes : prestation ou section, monter, descendre, supprimer, choisir un tarif | — | — | generer_document (lignes) | partiel : pas de SECTION |
| DP68 | Générateur › objet, acompte %, mention ml, libellé de variante, « prévenir le client » | POST …/documents | S | generer_document (objet, acompte_pct, note_ml, libelle_variante, notifier) | couvert |
| DP69 | Générateur › paramètres légaux manquants → saisie | POST /api/parametres | S-param | modifier_parametres | couvert |
| DP70 | Tarifs › modifier un tarif (désignation, unité, prix) | PATCH /api/dossiers/presets/:id | S-param | modifier_tarifs (sous_partie) | partiel : par sous-partie, pas par tarif |
| DP71 | Tarifs › « Nouveau tarif » | POST /api/dossiers/presets | S-param | modifier_tarifs | partiel : crée seulement pour une sous-partie sans tarif |
| DP72 | Tarifs › « Retirer » un tarif | DELETE /api/dossiers/presets/:id | S-suppr | — | manquant |
| DP73 | Tarifs › attribuer un tarif à une sous-partie, ou « automatique » | POST /api/prestations/tarifs {cle, presetId} | S-param | — | manquant |
| DP74 | Paiements › liste, reste dû | GET /api/dossiers/:id | L | lire_fiche | couvert |
| DP75 | Paiements › « Ajouter un paiement » | POST /api/dossiers/:id/encaissements | S-€ | saisir_encaissement | partiel : ni pièce, ni date de crédit, ni payeur |
| DP76 | Paiements › « Corriger » (montant, date, moyen, référence) | PATCH /api/encaissements/:id | S-€ | — | manquant |
| DP77 | Paiements › « Chèque crédité » (date du relevé) | POST /api/encaissements/:id/credit | S-€ | — | manquant |
| DP78 | Paiements › « Chèque rejeté » (date, motif, précision) | POST /api/encaissements/:id/rejet | S-€ | — | manquant |
| DP79 | Paiements › « Annuler ce paiement » (motif, précision) | POST /api/encaissements/:id/annulation | S-€ | annuler_encaissement | couvert |
| DP80 | Simulations › liste, visionneuse (avant, après, direction artistique, prompt) | GET /api/dossiers/:id/simulations | L | voir_simulations | couvert |
| DP81 | Simulations › « Préparer » (→ simulateur) | nav | R | preparer_simulation | couvert |
| DP82 | Simulations › « Déposer une simulation » : image, titre, description, préparation liée, source | POST /api/dossiers/:id/simulations (multipart) | R (brouillon) | — | manquant |
| DP83 | Simulations › « Publier » (sélection ou tous les brouillons) | POST …/simulations/publier | S-client | publier_simulation | couvert |
| DP84 | Simulations › « Masquer » / « Afficher » | PATCH …/simulations/:sid | R / S-client | masquer_simulation / publier_simulation | couvert |
| DP85 | Simulations › « Repasser en brouillon » | … {brouillon} | R | — | manquant |
| DP86 | Simulations › « Retirer » (archivée) | … {retirer, motif} | S-suppr | — | manquant |
| DP87 | Simulations › modifier titre et description (route sans bouton) | … {modifier} | R | — | manquant |
| DP88 | Le reste › Familles : cocher ou décocher familles et sous-parties | PATCH /api/dossiers/:id/prestations | R | modifier_dossier (familles, sous-parties) | couvert |
| DP89 | Le reste › Délais et écarts : corriger la date réelle d'un passage d'étape | PATCH /api/dossiers/:id/evenements/:evenementId {survenuLe} | R | — | manquant |
| DP90 | Le reste › Délais et écarts : lecture | GET /api/dossiers/:id | L | manager_commercial (agrégé) | partiel : rien par dossier |
| DP91 | Le reste › Dépenses : liste, total, justificatif | GET /api/dossiers/:id/depenses | L | lire_fiche / depenses | partiel : le justificatif n'est pas lisible |
| DP92 | Le reste › « Nouvelle dépense » | → /depenses/nouvelle?dossier= | R | rattacher_depense | partiel : sans justificatif |
| DP93 | Le reste › Étapes et notes : note à une étape choisie | POST /api/dossiers/:id/notes {etape, contenu} | R | ajouter_note | partiel : toujours l'étape courante |
| DP94 | Le reste › Coordonnées : nom du client, téléphone, e-mail, adresse, code postal, ville, objet, source, montant estimé, dates (chantier, souhaitée, fin) | PATCH /api/dossiers/:id | R (S pour montant, dates de chantier, adresse) | modifier_dossier | partiel : ni le nom du client, ni la source |
| DP95 | Le reste › Coordonnées › « Changer de fiche client » | GET /api/clients ; PATCH /api/dossiers/:id {clientId} | S | — | manquant |
| DP96 | Le reste › Chronologie du client : familles filtrables, « tout voir » | GET /api/chronologie | L | lire_mail (chronologie) | partiel : seulement en partant d'un mail, sans filtre par famille |
| DP97 | Le reste › « Archiver le dossier » (motif) | POST /api/dossiers/:id/archivage {archiver} | S-suppr | archiver (dossiers, motif) | couvert |

### 2.5 Espaces clients (`/espaces`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| E1 | Charger, rafraîchir, pages de 50 clients | GET /api/espaces?page= | L | espaces_clients | partiel : pas de page ; au-delà de 50 clients, invisibles |
| E2 | Onglets À moi / Chez le client / Signaux / Tous / Désactivés (compteurs) | filtre local | L | espaces_clients | partiel : aucun filtre |
| E3 | Sélecteur « Étape », tri (main, activité, lien récent) | filtre local | L | espaces_clients | partiel : ni filtre par étape, ni tri |
| E4 | Déplier la carte : lien, visites, projets, faits, signaux | données chargées | L | espaces_clients | partiel : ni les faits par projet, ni l'aperçu |
| E5 | Raccourcis Photos / Messages / Devis / Encaisser | nav | — | voir_photos, messages_espace, lire_fiche, saisir_encaissement | couvert |
| E6 | « Accorder un projet de plus » | POST /api/espaces/:permanentId {accorder-projet} | R | — | manquant |
| E7 | « Voir comme le client » | lien d'aperçu signé | L | — | manquant |
| E8 | « Copier son lien » | — | L | espaces_clients (donnees.lien) | couvert |
| E9 | « Nouveau lien… » (case « Envoyer par mail », phrase modifiable) | POST /api/espaces/:permanentId {regenerer, mail, texte} | S-client | renouveler_lien | partiel : la phrase ne se modifie pas |
| E10 | « Désactiver » | POST /api/espaces/:permanentId {desactiver} | R | — | manquant |
| E11 | « Accorder 3 simulations » | POST /api/dossiers/:id/espace {accorder} | S-€ léger | accorder_simulations | couvert |
| E12 | « Faire le devis » / « Ajouter un devis » | nav | S | generer_document | couvert |
| E13 | « Déposer un devis PDF » | nav | S | deposer_document | couvert |
| E14 | « Simulateur » | nav | R | preparer_simulation | couvert |
| E15 | Geste « Publier » | nav | S-client | publier_simulation | couvert |
| E16 | Geste « Appeler » (`tel:`) | — | — | noter_appel ensuite | sans objet |
| E17 | « Dossier » | nav | L | lire_fiche | couvert |
| E18 | « Ce projet, comme lui » (aperçu par projet) | lien d'aperçu signé | L | — | manquant |
| E19 | « Envoyer le lien par mail » : À, Objet, Phrase ; code LIEN_ESPACE à l'étape Photos, sinon LIEN_ESPACE_RAPPEL | POST /api/mail/lien-espace | S-client | envoyer_lien_espace | partiel : l'objet ne se modifie pas ; le code n'est pas choisi selon l'étape |
| E20 | « SMS avec le lien » → « Copier » | POST /api/sms/proposition ; /api/sms/copie | S-client | lien_espace + noter_sms | couvert |

### 2.6 Mail (`/mail`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| M1 | Relire la boîte (à l'ouverture et bouton « Relire ») | POST /api/mail/synchroniser | R | — | manquant |
| M2 | Onglets À traiter, Clients, Administratif (compteurs) | GET /api/mail?vue= | L | mails_a_traiter | couvert |
| M3 | « Rangés » (repli en bas de page) | GET /api/mail?vue=RANGES | L | mails_a_traiter | partiel : la vue `RANGES` n'est pas dans l'enum |
| M4 | Recherche « Nom, adresse, objet… » dans la vue | GET /api/mail?vue&recherche | L | rechercher_mails | partiel : autre moteur, qui ne filtre pas dans une vue |
| M5 | Bloc « Messages de l'espace client » | GET /api/mail | L | messages_espace | couvert |
| M6 | « Tout nettoyer » (confirmation) | POST /api/mail/nettoyer | R (masse) | — | manquant |
| M7 | Lu / Non lu | POST /api/mail/:id/action {LU, NON_LU} | R | — | manquant |
| M8 | Archiver / Désarchiver (sort d'« À traiter ») | … {ARCHIVER, DESARCHIVER} | R | repondre_tache (quand le fil est une tâche) | partiel : seulement par une tâche ; `ranger_mail` range, il n'archive pas |
| M9 | « Remonter » un mail rangé (l'expéditeur ne sera plus rangé) | … {REMONTER} | R | ranger_mail (annuler) + proposer_regle + valider_proposition | partiel : trois appels ; ni `remonteLe` ni reclassement |
| M10 | « Ne plus me montrer cet expéditeur » | … {NE_PLUS_MONTRER} | R (pour toujours) | ranger_mail (expediteur) + proposer_regle | partiel : trois appels, sans la garde « adresse d'un client » |
| M11 | « Ranger » | … {RANGER} | R | ranger_mail | couvert |
| M12 | « Déranger » (route) | … {DERANGER} | R | ranger_mail (annuler) | couvert |
| M13 | Classer à la main CLIENT / ADMINISTRATIF / HUMAIN (route sans bouton) | … {CLASSER} | R | — | manquant |
| M14 | Ouvrir un mail : fil, pièces, contexte, cartes, brouillons, envois | GET /api/mail/:id | L | lire_mail | couvert |
| M15 | Pièce jointe (image, fichier) | GET /api/messages/:id/pieces/:pieceId | L | lire_mail | partiel : les noms seulement, pas le contenu |
| M16 | Lien « Gmail » | nav externe | L | lire_mail (lienGmail) | couvert |
| M17 | Intention et « ce qui est attendu » | POST /api/mail/:id/intention | R | classer_mail | couvert |
| M18 | Résumé du fil | — | L | lire_mail / resumer_fil | couvert |
| M19 | Carte « Ce que ce mail change » › « Valider » | POST /api/mail/propositions/:id {valider} | R / S | valider_proposition | couvert |
| M20 | Carte › « Ignorer » | … {ignorer} | R | ignorer_proposition | couvert |
| M21 | Date extraite › « Planifier » | POST /api/mail/:id/planifier | R | planifier | partiel : cible le contact, pas le mail |
| M22 | « Plus tard » (Demain 9 h, Lundi 9 h, Dans une semaine, Une autre date), « annuler » | POST /api/mail/:id/snooze | R | snoozer_mail | couvert |
| M23 | « Qui est-ce ? » : chercher un client, « Rattacher » | GET /api/clients ; POST /api/mail/:id/rattacher | R | chercher + rattacher_mail | couvert |
| M24 | « C'est une nouvelle demande : créer un lead » | POST /api/mail/:id/lead | R | creer_contact + rattacher_mail | partiel : les coordonnées sont à recopier ; ni la source « mail », ni le fil, en un geste |
| M25 | Reprendre un brouillon déposé par Claude | — | — | envoyer_mail (brouillonId) | couvert |
| M26 | « Rédiger avec l'IA » / « Réécrire » (consigne) | POST /api/mail/brouillon | S-€ (≈ 0,015 €) | rediger_mail | couvert |
| M27 | « Envoyer » (À, Objet, texte) | POST /api/mail/envoyer | S-client | envoyer_mail | couvert |
| M28 | Nouveau mail pour un contact (`?client=`, `?lead=`, `?dossier=`) | GET /api/mail/contexte | L | lire_fiche + rediger_mail | couvert |
| M29 | Contexte › Appeler, Fiche, Dossier | nav | — | lire_fiche | couvert |
| M30 | Bilan du tri (route sans écran) | GET /api/mail/bilan | L | — | manquant |

### 2.7 Clients (`/clients`, fiche, fusion)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| C1 | Liste paginée (50), recherche « Nom, ville, e-mail, téléphone… » | GET /api/clients?recherche&page | L | chercher | partiel : pas de liste ni de pages (20 au plus, tout mélangé) |
| C2 | Filtres Catégorie, Source, « Fiches archivées » | GET /api/clients?categorie&source&archives | L | — | manquant |
| C3 | Nombre total de clients (la provenance est partie dans l'Analytique) | SSR | L | analytique (qualité par source) / manager_clients | couvert |
| C4 | « Chercher les doublons » | POST /api/clients/doublons | R (propose seulement) | — | manquant |
| C5 | « Nouveau client » / « Nouveau client pro » : prénom, nom ou raison sociale, SIRET, sous-traitance, téléphone, e-mail, adresse, code postal, ville, source et précision, recommandé par | POST /api/clients | R | creer_contact | partiel : crée un lead qui entre dans « À appeler » ; ni catégorie, ni raison sociale, SIRET, adresse, source client, recommandeur |
| C6 | « Créer quand même » (doublon) | POST /api/clients {forcer} | R | creer_contact (forcer) | couvert (dans les limites de creer_contact) |
| C7 | Annuaire des entreprises (nom, SIREN, SIRET) | GET /api/clients/annuaire | L | — | manquant |
| C8 | Choisir le recommandeur | GET /api/clients?recherche | L | chercher | couvert |
| C9 | Lire la fiche : identité, catégorie, SIRET, provenance, recommandations, coordonnées (archivées comprises), consentements, dossiers, leads, passif, historique, fusion, anonymisation, propositions | GET /api/clients/:id | L | lire_fiche (clientId) | partiel : manquent catégorie, SIRET, adresse, provenance, recommandations, passif, consentements, historique, état (archivé, fusionné, anonymisé), identifiants des coordonnées |
| C10 | « Ouvrir un dossier » (→ `/dossiers?client=`) | POST /api/dossiers {clientId} | R | ouvrir_dossier | partiel : seulement en partant d'un lead |
| C11 | « Modifier » : catégorie, prénom, nom, raison sociale, SIRET, adresse, code postal, ville, source, précision, campagne, publicité, formulaire, premier contact, recommandeur | PATCH /api/clients/:id | R | proposer_mise_a_jour (CLIENT) + valider_proposition | partiel : exige un mail et ne couvre que prénom, nom, raison sociale, adresse, code postal, ville, notes, e-mail, téléphone |
| C12 | « Archiver » (motif ; dossiers en cours signalés) | POST /api/clients/:id/archiver | S-suppr | — | manquant |
| C13 | « Restaurer » | POST /api/clients/:id/restaurer | R | — | manquant |
| C14 | « Anonymiser » (RGPD) : aperçu (effacé, gardé, bloquants), motif, confirmation | GET / POST /api/clients/:id/anonymisation | S-suppr (irréversible) | — | manquant |
| C15 | Coordonnées › « + Téléphone » / « + E-mail » (valeur, libellé) | POST /api/clients/:id/coordonnees | R | rattacher_mail / proposer_mise_a_jour | partiel : pas d'ajout direct |
| C16 | Coordonnées › « Corriger » (valeur, libellé) | POST …/coordonnees/:id {modifier} | R | — | manquant |
| C17 | Coordonnées › « Rendre principale » | … {principale} | R | — | manquant |
| C18 | Coordonnées › « Archiver » (motif) | … {archiver} | S-suppr | — | manquant |
| C19 | Mails commerciaux › enregistrer une réponse : statut, moyen, date, preuve | POST /api/clients/:id/consentements | R (preuve légale) | — | manquant (ni lecture ni écriture) |
| C20 | Passif › « Enregistrer » | PATCH /api/clients/:id {notes} | R | proposer_mise_a_jour (notes) | partiel : seulement à partir d'un mail |
| C21 | Espace client de la fiche : lien, visites, projets, SMS prêt | GET /api/clients/:id/espace | L | espaces_clients / lien_espace | partiel : pas de lecture pour un client donné |
| C22 | Espace › « Permettre un projet de plus » | POST /api/espaces/:permanentId {accorder-projet} | R | — | manquant |
| C23 | Chronologie du contact (familles, « tout voir ») | GET /api/chronologie?client= | L | lire_mail (nom, chronologie) | partiel : seulement en partant d'un mail, sans filtre |
| C24 | Messages du client (30, tous statuts) | GET /api/messages?clientId= | L | rechercher_mails / lire_mail (nom) | partiel : seulement le dernier fil |
| C25 | Historique de la fiche (résumé, date, auteur) | GET /api/clients/:id | L | — | manquant |
| C26 | Bandeau « proposition en attente » → `/validation` | nav | L | lire_fiche (propositionsEnAttente) | couvert |

Les boutons « Copier », « Voir comme le client », « Nouveau lien… » et « Désactiver » de la fiche client sont ceux
de l'écran Espaces (E7 à E10). Ils ne sont pas comptés deux fois.

### 2.8 Simulateur (`/simulateur`), banc (`/simulateur/banc`), prompts (`/simulateur/prompts`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| S1 | En-tête : coût et solde OpenAI | GET /api/simulateur/consommation | L | voir_parametres (SIMULATEUR) | partiel : ni coût par nombre d'échantillons, ni état de la clé |
| S2 | 1. Client › chercher un dossier | GET /api/simulateur/dossiers?q= | L | chercher | couvert |
| S3 | 1. Client › choisir (photos avant, type suggéré, goûts, préparations récentes) | GET /api/simulateur/dossiers/:id | L | voir_photos + lire_fiche | partiel : ni type suggéré, ni préparations récentes |
| S4 | 2. Photo › choisir la photo avant | — | — | preparer_simulation (photo_id) | couvert |
| S5 | 3. Type de surface | — | — | preparer_simulation (type_surface) | couvert |
| S6 | 4. Teintes › catalogue (goûts, famille, recherche) et échantillons | GET /api/simulateur/catalogue ; GET …/echantillons/:ref | L | preparer_simulation (résolution par mots) | partiel : le catalogue ne se liste pas, les échantillons ne se voient pas |
| S7 | 4. Teintes › une teinte par zone | — | — | preparer_simulation (teintes) | couvert |
| S8 | « Préparer pour ChatGPT » | POST /api/simulateur/preparations {mode:CHATGPT} | R | preparer_simulation | couvert |
| S9 | « Générer par l'API » (image OpenAI) | POST /api/simulateur/preparations {mode:API} | S-€ | — | manquant (l'outil force CHATGPT) |
| S10 | Suivre la génération | GET /api/simulateur/preparations/:id | L | voir_simulations (après coup) | partiel : pas l'état d'une préparation en cours |
| S11 | Rouvrir une préparation (`?preparation=`) | GET /api/simulateur/preparations/:id | L | preparer_simulation (lien) | partiel : lien seulement |
| S12 | Partager, télécharger la photo et la planche, copier le prompt, ouvrir ChatGPT | GET …/photo, …/planche | — | — | sans objet |
| S13 | « Déposer l'image de ChatGPT » (brouillon, préparation reprise) | POST /api/dossiers/:id/simulations | R | — | manquant |
| S14 | Voir le rendu, aller au dossier | GET /api/dossiers/:id/simulations/:sid/image | L | voir_simulations | couvert |
| S15 | Banc › état : cas, variantes V1/V2, rendus, estimation du coût | GET /api/simulateur/banc | L | — | manquant |
| S16 | Banc › lancer la campagne, une variante ou un cas (fenêtre de coût) | POST /api/simulateur/banc | S-€ | — | manquant |
| S17 | Banc › voir un rendu, la photo, copier le prompt | GET /api/simulateur/banc/:id/image | L | — | manquant |
| S18 | Prompts › lister par type | GET /api/simulateur/prompts | L | — | manquant |
| S19 | Prompts › un type : version en service et historique | GET /api/simulateur/prompts/:type | L | — | manquant |
| S20 | Prompts › lire une ancienne version | GET …/:type?version=N | L | — | manquant |
| S21 | Prompts › « Vérifier » (contrôles, aperçu du rendu ; rien n'est écrit) | POST …/:type {verifier} | L | — | manquant |
| S22 | Prompts › « Enregistrer » (nouvelle version en service, note) | POST …/:type {enregistrer} | S-param | — | manquant |
| S23 | Prompts › « Restaurer » une version | POST …/:type {restaurer} | R | — | manquant |
| S24 | Prompts › annuler la saisie | — | — | — | sans objet |

### 2.9 Site (`/site` — réalisations et avis publiés sur coverswap.fr)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| W1 | Liste des publications et des dossiers qui ont des photos après | GET /api/publications | L | — | manquant (`simulations_site` parle d'autre chose) |
| W2 | Fenêtre › choisir le dossier → photos proposées | GET /api/publications/_?dossier= | L | voir_photos (apres) | partiel : ne rend pas les chemins que demandent `photoAvant` / `photoApres` |
| W3 | « Nouvelle publication » : type (réalisation ou avis), titre, ville, type de projet, auteur, note, texte, photos avant et après, accord du client et sa date | POST /api/publications | R (brouillon) | — | manquant |
| W4 | « Modifier » | PATCH /api/publications/:id {contenu} | R ; S-client si déjà publiée | — | manquant |
| W5 | « Publier » (exige l'accord écrit, une photo après ou un texte) | PATCH … {publier} | S-client (site public) | — | manquant |
| W6 | « Retirer » du site | PATCH … {retirer} | R | — | manquant |

### 2.10 Finances (`/finances`, allégé en partie B)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| F1 | Tableau de l'année : factures à encaisser (numéro, retard), chèques à créditer, points à corriger ; année −1 / +1 | GET /api/finances?annee= | L | manager_finances / analytique (argent) | partiel : ni la liste des factures à encaisser, ni les chèques avec leur identifiant, ni les points qualité |
| F2 | Lien « les chiffres sont dans l'Analytique » | nav | L | analytique (argent) | couvert |
| F3 | « Renseigner » les paramètres manquants (en lot) | POST /api/parametres {saisies[]} | S-param | modifier_parametres (un par un) | couvert |
| F4 | Encours › « + » paiement reçu pour la facture N : montant, moyen, date, référence, date de crédit, note ; pièce = cette facture ; payeur = le client | POST /api/encaissements {paiement, numeroDocumentId, payeur} | S-€ | saisir_encaissement | partiel : ni pièce, ni payeur, ni date de crédit ; exige un dossier (une facture hors CRM est impossible) |
| F5 | Chèques › « Crédité » (date) | POST /api/encaissements/:id/credit | S-€ | — | manquant |
| F6 | Chèques › « Rejeté » (date, motif, précision) | POST /api/encaissements/:id/rejet | S-€ | — | manquant |
| F7 | Qualité › liens vers les points à corriger | nav | — | — | sans objet |
| F8 | Livre des recettes de l'année (par mois, mouvements) | GET /api/finances?annee= | L | — | manquant |
| F9 | « Exporter (CSV) » | GET /api/finances/livre?annee= | L | — | manquant |
| F10 | Lien vers le dossier d'une facture | nav | L | lire_fiche | couvert |

### 2.11 Dépenses (`/depenses`, `/depenses/nouvelle`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| X1 | Liste de l'année (« à traiter » : sans chantier, sans justificatif), année −1 / +1 | GET /api/depenses?annee= | L | depenses | couvert (par période ; les dépenses retirées n'apparaissent pas) |
| X2 | File hors ligne › « Abandonner cette saisie » | IndexedDB | — | — | sans objet |
| X3 | Fiche › voir le justificatif | GET /api/depenses/:id/justificatif | L | — | manquant |
| X4 | Fiche › « Modifier » : montant, date, fournisseur, catégorie, moyen, libellé, note, chantier ou hors chantier | PATCH /api/depenses/:id | R | — | manquant (impossible de rattacher une dépense existante à un chantier) |
| X5 | Fiche › remplacer le justificatif | POST /api/depenses/:id/justificatif | R | — | manquant |
| X6 | Fiche › « Retirer » (motif) | POST /api/depenses/:id/archive | S-suppr | — | manquant |
| X7 | Nouvelle › suggestions (chantiers en cours, chantier proposé, fournisseurs récents) | GET /api/depenses/suggestions | L | chercher / dossiers_par_etape | partiel : ni chantier proposé, ni fournisseurs récents |
| X8 | Nouvelle › photo du ticket (caméra, galerie) | — | — | — | sans objet (la photo part avec X9) |
| X9 | Nouvelle › « Enregistrer la dépense » (justificatif, reprise hors ligne) | POST /api/depenses (multipart) | R | rattacher_depense | partiel : ni justificatif, ni note, ni `forcer` |
| X10 | « Enregistrer quand même » (justificatif déjà reçu) | POST /api/depenses {forcer} | R | — | manquant |

### 2.12 Analytique (`/analytique`, partie B)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| A1 | Onglet « Vue d'ensemble » : tuiles, tunnel, publicité, SEO, fiche Google, qualité par source, argent | GET /api/analytique?onglet=ensemble | L | analytique (ensemble) | couvert |
| A2 | Onglet « Publicité » : par campagne et par publicité, verdict du protocole | … onglet=publicite | L | analytique (publicite) | couvert |
| A3 | Onglet « SEO et Google » | … onglet=seo | L | analytique (seo) | couvert |
| A4 | Onglet « Site » | … onglet=site | L | analytique (site) | couvert |
| A5 | Onglet « Argent » (règle des 20 %, carnet, TVA, URSSAF) | … onglet=argent | L | analytique (argent) | couvert |
| A6 | Période : 7 j, 30 j, 90 j, mois, 12 mois | ?p= | L | analytique (p) | couvert |
| A7 | Dates libres (du, au) | ?du&au | L | analytique (du, au) | couvert |
| A8 | Filtre par source (famille) de la vue d'ensemble | ?source= | L | analytique (source) | couvert |
| A9 | Panneau des sources : état, dernière synchronisation, erreur, « à faire » | GET /api/analytique | L | analytique (Sources) / sante_systeme | couvert |
| A10 | « Relancer » la synchronisation d'une source (Meta, Google Ads, Search Console, fiche Google) | POST /api/analytique/synchro {source} | R (tâche de fond) | — | manquant |
| A11 | Résumé du jour et alertes | GET /api/analytique | L | analytique | couvert |
| A12 | Liens de détail (indicateur → onglet, carnet → dossier, → Finances) | nav | — | — | sans objet |
| A13 | Onglet Publicité › chaîne des leads Meta, lue en base | SSR `santeMeta` | L | voir_publicite | couvert |
| A14 | Chaîne Meta › « Vérifier » (interroge Meta) | GET /api/meta/sante | L (réseau) | voir_publicite (interroger_meta) | couvert |
| A15 | Chaîne Meta › « Lancer un essai » (faux lead ESSAI, avec notification) | POST /api/meta/essai {notifier:true} | R (crée un contact ESSAI) | — | manquant |
| A16 | Chaîne Meta › « Refaire sans notification » | POST /api/meta/essai {notifier:false} | R | — | manquant |
| A17 | Chaîne Meta › « Tester la notification » | POST /api/meta/notification | R (vers Lucas) | — | manquant |
| A18 | Chaîne Meta › « Tout rejouer » | POST /api/meta/rejouer {} | R masse (peut envoyer un SMS d'accusé : S-client) | — | manquant |
| A19 | Chaîne Meta › « Rejouer » un `leadgen_id` | POST /api/meta/rejouer {leadgenId} | R | — | manquant |
| A20 | Chaîne Meta › « Détail » (dépli) | — | — | — | sans objet |
| A21 | Vue d'ensemble › courbe : choix de la série (leads, devis) | local | — | analytique (données) | sans objet |
| A22 | Site › « Entonnoir du simulateur » : les étapes, les abandons, le choix de la source | local, données de l'écran | L | analytique (site : `simulateur` dans le JSON de l'écran) | couvert |
| A23 | Argent › fiscal › « Renseigner » les paramètres manquants | POST /api/parametres | S-param | modifier_parametres | couvert |
| A24 | Argent › « Mois figés et export » › « Pseudonymes » (anonymiser) | GET /api/synthese?anonyme=1 | L | — | manquant |
| A25 | Argent › export « Texte » / « Données » de la période | GET /api/synthese/export?format= | L | synthese | partiel : chiffres de `calculerSynthese` seulement ; ni le texte d'export, ni les pseudonymes, ni l'agent et la qualité |
| A26 | Argent › « Version rédigée » (à copier) | GET /api/synthese (rédaction) | L | — | manquant |
| A27 | Argent › mois figés : la liste | GET /api/synthese/instantanes | L | — | manquant |
| A28 | Argent › ouvrir un mois figé (figé le, intégrité, écarts avec un recalcul) | GET /api/synthese/instantanes/:mois | L | — | manquant |
| A29 | Argent › guide de lecture | texte fixe | — | — | sans objet |
| A30 | Vue d'ensemble › « Agent et qualité des données » : alertes de la synthèse, propositions de l'agent par auteur (acceptation, délai de décision, motifs de rejet, agent mail), points de qualité | GET /api/synthese | L | — | manquant (`synthese` ne rend ni l'agent ni la qualité) |

Les anciennes adresses `/publicite` et `/synthese` redirigent vers l'Analytique. Les outils `synthese`, `campagne` et
`voir_publicite` restent au catalogue, mais leurs chiffres sont ceux de l'Analytique (voir 4.14).

Les lignes A21 à A30 viennent de la relecture de la partie B, **en cours et pas encore commitée** au moment de
l'audit (`OutilsSynthese.tsx`, `EntonnoirSimulateur.tsx`, `CourbeEnsemble.tsx`, `FiscalArgent.tsx`). Elles ramènent
dans l'Analytique les outils de l'ancien écran Synthèse. Si la relecture les retire, retirer aussi ces lignes.

### 2.13 Paramètres (`/parametres`), par onglet

#### Activité

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| PA1 | Changer d'onglet (mémorisé ; ancres `#mail`, `#sms`…) | — | — | — | sans objet |
| PA2 | Lire les groupes Pilotage, Suivi commercial (dont la **zone d'intervention** `ZONE_DEPARTEMENTS(_PROCHES)` et les délais de relance), Campagne publicitaire, Simulateur, RGPD : valeur en vigueur, valeurs futures, source | GET /api/parametres | L | voir_parametres (groupe) | couvert |
| PA3 | « Historique » d'un paramètre | page | L | voir_parametres (5 dernières valeurs) | partiel : historique tronqué |
| PA4 | « Nouvelle valeur » / « Renseigner » : valeur, valable du, source | POST /api/parametres {saisies[]} | S-param | modifier_parametres (cle, valeur, valable_du, source) | couvert (une clé par appel) |
| PA5 | Connexions › « Connecter » / « Reconnecter » le compte Google | GET /api/google/connexion | S-sécu | — | sans objet (consentement dans le navigateur) |
| PA6 | Connexions › Google › « Déconnecter » | POST /api/google/deconnexion | S-sécu | — | manquant |
| PA7 | Connexions › état Google, miroir Drive, agent mail | GET /api/connexions | L | sante_systeme | partiel : ni le miroir Drive, ni l'agent mail |
| PA8 | Drive › « Synchroniser maintenant » | POST /api/drive/synchroniser {} | R (tâche de fond) | — | manquant |
| PA9 | Drive › « Vérifier Drive » | POST /api/drive/synchroniser {verifier:true} | R | — | manquant |
| PA10 | Agent mail › « Relever maintenant » | POST /api/messages/relever | R | — | manquant |
| PA11 | Marque de l'espace client (rien à régler) | — | L | — | sans objet |

#### Facturation

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| PF1 | « Nouvelle valeur » : encaissements, factures aux professionnels ; Avancé : seuils fiscaux, cotisations | POST /api/parametres | S-param | modifier_parametres | couvert |
| PF2 | Déplier « Avancé » | — | — | — | sans objet |
| PF3 | Numérotation › prochain numéro de devis et de facture | GET /api/numeros/compteurs | L | voir_parametres | couvert |
| PF4 | Numérotation › « Faire repartir à… » | PATCH /api/numeros/compteurs {serie, prochain} | S-param | modifier_parametres (COMPTEUR_DEVIS / COMPTEUR_FACTURE) | couvert |

#### Mail

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| PM1 | Lire le guide de style, les modèles de notification, les règles d'expéditeur, les règles proposées | GET /api/mail/reglages | L | voir_parametres (NOTIF_* : actif seulement) | partiel : ni guide, ni textes des modèles, ni règles |
| PM2 | Guide › « Enregistrer » / « Annuler » | PATCH /api/mail/reglages {guide} | S-param | — | manquant |
| PM3 | Guide › « Tirer de mes mails envoyés » (IA) | POST /api/mail/reglages/guide | S-param + S-€ | — | manquant |
| PM4 | **Modèle de mail** › « Couper » / « Réactiver » | PATCH /api/mail/reglages {modele…actif} | S-param | modifier_parametres (automatisme NOTIF_<EVT>) | couvert |
| PM5 | **Modèle de mail** › Objet, Phrase, Bouton › « Enregistrer » | PATCH /api/mail/reglages {modele} | S-param (texte envoyé aux clients) | — | manquant |
| PM6 | Règles proposées › « Valider » / « Ignorer » | POST /api/mail/propositions/:id | S-param | valider_proposition / ignorer_proposition | couvert |
| PM7 | « Ajouter la règle » (adresse ou @domaine ; RANGER, NE_JAMAIS_RANGER, ADMINISTRATIF) | PATCH /api/mail/reglages {regle} | S-param | proposer_regle + valider_proposition | partiel : en deux temps, jamais directement |
| PM8 | « Retirer » une règle | PATCH /api/mail/reglages {archiverRegle} | S-param | — | manquant (et les règles posées ne se lisent pas) |

#### SMS

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| PS1 | Fournisseur, expéditeur, variables à poser | page (`etatFournisseur`) | L | — | manquant |
| PS2 | Catalogue par groupe (texte, usage, longueur) | page (`listerCatalogue`) | L | voir_parametres (groupe SMS) | couvert |
| PS3 | **Modèle de SMS** › « Enregistrer » un texte | PATCH /api/sms/modeles/:id {texte} | S-param | modifier_parametres (sms_code, sms_texte) | couvert |
| PS4 | **Modèle de SMS** › « Couper l'envoi automatique » / « Réactiver » (accusés) | PATCH … {actif} | S-param | modifier_parametres (automatisme SMS_ACCUSE_*) | couvert |
| PS5 | **Modèle de SMS** › « Revenir au texte de départ » | PATCH … {texte} | S-param | modifier_parametres | partiel : le texte de départ n'est pas lisible |
| PS6 | « Simplifier les accents », « Annuler » | local | — | — | sans objet |

#### Assistant

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| PC1 | Adresse MCP › « Copier » | — | — | — | sans objet |
| PC2 | Applications et jetons connectés | GET /api/assistant/acces | L | — | manquant |
| PC3 | « Tout révoquer » | DELETE /api/assistant/acces {tout} | S-sécu | — | manquant |
| PC4 | « Révoquer l'application » | DELETE … {clientId} | S-sécu | — | manquant |
| PC5 | « Révoquer » un jeton | DELETE … {jetonId} | S-sécu | — | manquant |
| PC6 | **Consignes** / Positionnement : lire le texte et les versions | GET /api/assistant/consignes | L | ressource coverswap://consignes + versions_consignes | couvert |
| PC7 | Consignes › « Enregistrer » (texte entier) | PATCH /api/assistant/consignes | S-param | modifier_consignes | couvert |
| PC8 | Consignes › « Revenir au défaut » | PATCH {consignes: défaut} | S-param | modifier_consignes | partiel : le texte par défaut n'est pas lisible |
| PC9 | Consignes › « Restaurer » une version | PATCH {restaurer} | R | restaurer_consignes | couvert |
| PC10 | Outils par famille et niveau | page (`catalogueVue`) | L | lister_outils | couvert |
| PC11 | Groupe « Agent mail et IA » (IA_*, MAIL_*, budget) | POST /api/parametres | S-param | modifier_parametres | couvert |

### 2.14 À valider (`/validation`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| V1 | Onglets « À valider », « En cours ou en échec », « Historique » | GET /api/validation?statut=&limite= | L | ce_qui_m_attend (nombre), voir_relances, lire_mail, lire_fiche (morceaux) | manquant (aucune liste générale) |
| V2 | Filtre par type | filtre local | L | — | manquant |
| V3 | Ouvrir une proposition précise (`?proposition=`, depuis Tâches) | SSR | L | — | manquant (hors cartes de mail, le contenu d'une proposition ne se lit pas) |
| V4 | « Valider » telle quelle | POST /api/validation/:id/valider | selon le type : R, S-client (mail, SMS), S-€ (étape), S-suppr (fusion, anonymisation) | valider_proposition | partiel : la sensibilité ne tient compte que des cartes MAJ_DEPUIS_MAIL |
| V5 | « Corriger » puis valider (champs du type : fiche à conserver, texte du mail, date…) | … {corrections} | selon le type | valider_proposition (corrections.valeur) | partiel : seule la clé `valeur` passe |
| V6 | « Rejeter » (motif de la liste, commentaire) | POST /api/validation/:id/rejeter | R | ignorer_proposition | couvert |
| V7 | « Réessayer » une exécution en échec | POST /api/validation/:id/reessayer | selon le type | — | manquant |
| V8 | « Tout valider (n) » (seulement les types en lot) | POST /api/validation/lot | R masse | valider_proposition (≤ 20) | partiel : ne respecte pas `validationGroupee` |
| V9 | Fusion de clients › « Valider » | POST /api/validation/:id/valider | S-suppr (pas de « défusion ») | valider_proposition | partiel : pas de confirmation |
| V10 | Fusion de clients › choisir la fiche à conserver (A ou B) | … {corrections:{conserver}} | S-suppr | — | manquant |
| V11 | Liens de la carte (fiches, dossier, message) | nav | — | — | sans objet |

### 2.15 Tâches de fond (`/taches-de-fond`)

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| B1 | État des tâches : compteurs, file, planifications ; « Recharger », pages | GET /api/taches | L | sante_systeme | partiel : ni identifiants, ni file complète |
| B2 | Tâche en échec › « Relancer » | POST /api/taches/:id/relancer | R | — | manquant |
| B3 | Tâche en attente ou en échec › « Annuler » | POST /api/taches/:id/annuler | S (un envoi peut ne jamais partir) | — | manquant |
| B4 | Cohérence › rapport, « Relancer le contrôle » | GET /api/coherence | L | sante_systeme | partiel : ni clé, ni correction proposée |
| B5 | Cohérence › « Corriger » | POST /api/coherence/corriger {cle} | R / S selon la correction | — | manquant |
| B6 | Audit des connexions › « Relancer » | GET /api/audit/connexions | L | — | manquant |
| B7 | Sessions de l'assistant et appels d'outils › « Rafraîchir » | GET /api/assistant/sessions | L | — | manquant |

### 2.16 Navigation et application

| # | Action | Route | Nature | Outil MCP | Statut |
|---|---|---|---|---|---|
| N1 | Barre : Tâches, Leads, Dossiers, Espaces, Simulateur, Mail, Clients, Analytique, Finances ; Site, Tâches de fond, Dépenses, Paramètres ; menu « Plus » | — | — | — | sans objet |
| N2 | Compteurs de la barre : tâches du jour, leads en retard, mails à traiter, tâches de fond en échec | GET /api/pilotage/compteurs | L | point_du_jour / taches / sante_systeme | couvert |
| N3 | Accueil `/` → `/taches` ; `/publicite` et `/synthese` redirigés | — | — | — | sans objet |
| N4 | Retour d'appel « Comment ça s'est passé ? » | POST /api/commercial/appels | R | noter_appel | couvert |
| N5 | Écran SMS commun (« Copier » vaut envoi) | POST /api/sms/copie | S-client | noter_sms | couvert |
| N6 | Bandeau « Reconnecter Google » | nav /api/google/connexion | S-sécu | — | sans objet |
| N7 | Pastille des propositions en attente | GET /api/validation?statut=EN_ATTENTE | L | ce_qui_m_attend | couvert |
| N8 | Connexion (identifiant, mot de passe) | NextAuth | S-sécu | — | sans objet (le MCP a son propre OAuth) |
| N9 | `/oauth/autoriser` › « Accorder » / « Refuser » | POST /api/oauth/autoriser | S-sécu | — | sans objet |
| N10 | Hors ligne (service worker) | — | — | — | sans objet |

### 2.17 Bilan chiffré

Comptes faits sur les tableaux ci-dessus (une ligne = une action). Détail par écran :

| Écran | Actions | Couvert | Partiel | Manquant | Sans objet |
|---|---|---|---|---|---|
| Tâches | 38 | 24 | 4 | 6 | 4 |
| Leads (liste) | 28 | 12 | 6 | 6 | 4 |
| Leads (fiche) | 27 | 9 | 10 | 7 | 1 |
| Fin d'appel | 9 | 8 | 0 | 0 | 1 |
| Dossiers (liste, création, reprise) | 16 | 4 | 5 | 4 | 3 |
| Dossier (panneau et rubriques) | 97 | 37 | 26 | 33 | 1 |
| Espaces clients | 20 | 9 | 6 | 4 | 1 |
| Mail | 30 | 17 | 8 | 5 | 0 |
| Clients | 26 | 4 | 10 | 12 | 0 |
| Simulateur, banc, prompts | 24 | 6 | 5 | 11 | 2 |
| Site | 6 | 0 | 1 | 5 | 0 |
| Finances | 10 | 3 | 2 | 4 | 1 |
| Dépenses | 10 | 1 | 2 | 5 | 2 |
| Analytique | 30 | 14 | 1 | 11 | 4 |
| Paramètres › Activité | 11 | 2 | 2 | 4 | 3 |
| Paramètres › Facturation | 4 | 3 | 0 | 0 | 1 |
| Paramètres › Mail | 8 | 2 | 2 | 4 | 0 |
| Paramètres › SMS | 6 | 3 | 1 | 1 | 1 |
| Paramètres › Assistant | 11 | 5 | 1 | 4 | 1 |
| À valider | 11 | 1 | 4 | 5 | 1 |
| Tâches de fond | 7 | 0 | 2 | 5 | 0 |
| Navigation et application | 10 | 4 | 0 | 0 | 6 |
| **Total** | **439** | **168** | **98** | **136** | **37** |

Hors gestes sans objet, **402 actions** relèvent du MCP :

- 168 sont couvertes (42 %) ;
- 98 sont partielles (24 %) ;
- 136 manquent (34 %).

Les écrans neufs des parties A et B sont les mieux couverts : Tâches, 24 lignes sur 34 ; Analytique, 14 sur 26.
Les trous se concentrent dans le panneau du dossier, les clients, le simulateur, le site, les dépenses et le
système.

## 3. Les manques, par domaine

Un manque est une ligne `manquant`, ou ce qui manque à une ligne `partiel`. Pour chacun : les repères du tableau,
puis l'outil qui le ferme (section 4).

### 3.1 Entités et champs non modifiables

- **Lead** (LF16, LF17, LF18, LF23, LF24, L15, LF12, L14, LF11) : priorité, statut, « sans suite » sans appel et son
  retour, corrections de la demande sans mail source, notes, effacement du rappel, rappel sans événement d'agenda.
  → `modifier` LEAD.
- **Dossier** (DP94, DP95, DP4, DP5, DP89, DP13, DP93) : nom du client, source, changement de fiche client, date
  d'ouverture, points « à compléter » masqués ou réaffichés, date réelle d'un passage d'étape, note sur une étape
  choisie. → `modifier` DOSSIER, `creer` NOTE.
- **Client** (C11, C20, C15–C18, C19) : tous les champs de la fiche sans mail source, coordonnées (ajouter,
  corriger, rendre principale, archiver), consentement aux mails commerciaux. → `modifier` / `creer` CLIENT,
  COORDONNEE, CONSENTEMENT.
- **Note d'appel** (LF13, LF14) : une note sans issue, et compléter une note existante. → `creer` / `modifier`
  NOTE_APPEL.
- **Échange typé** (LF19) : e-mail, ou appel sans issue. → `creer` NOTE (lead : type).
- **Simulation** (DP85, DP86, DP87) : repasser en brouillon, retirer (archiver), titre et description. → `modifier`
  SIMULATION, `archiver` SIMULATION.
- **Document repris** (DP59) : date, montant, objet, statut, acompte. → `modifier` DOCUMENT.

### 3.2 Création

- Dossier complet, depuis un lead, une fiche client ou directement : tous les champs, étape de départ, date de
  chantier, catégorie, SIRET (D13, D14, C10). → `creer` DOSSIER, puis `ajouter_fichier` pour les photos.
- Reprise d'un dossier d'avant le CRM (D16). → `creer` REPRISE.
- Fiche client seule (particulier, pro, donneur d'ordre), sans lead dans « À appeler » (C5). → `creer` CLIENT.
- Lead créé depuis un mail, en un geste (M24). → `creer` LEAD (message_id).
- Annuaire des entreprises (D15, C7). → `lister` ENTREPRISES.

### 3.3 Étapes et argent

- `changer_etape` passe par `changerEtape`, là où l'écran passe par `changerEtapeAvecPaiement`. Il manque :
  - le devis accepté (DP16) ;
  - l'acompte ou le solde dans la même transaction (DP17, DP20) ;
  - « sans acompte » avec son motif (DP18) ;
  - le concurrent et son prix (DP14) ;
  - la date réelle du passage (DP13).

  → `changer_etape` étendu.
- `saisir_encaissement` ne connaît ni la pièce réglée (`numeroDocumentId`), ni le payeur, ni la date de crédit, et il
  exige un dossier : une facture hors CRM est impossible (DP9, DP75, F4, T11). → `saisir_encaissement` étendu.
- Corriger un encaissement (DP76), créditer un chèque (DP77, F5), rejeter un chèque (DP78, F6). → `modifier`
  ENCAISSEMENT, `annuler_encaissement` avec la nature REJETER.

### 3.4 Devis ligne par ligne

- Lignes SECTION (DP55, DP67). Lignes préremplies d'après l'espace (DP65, T10). Presets avec leur identifiant
  (DP64). Numéros libres du registre (DP57). → `generer_document` étendu, `lister` TARIFS, `etat_crm` NUMEROTATION.

### 3.5 Factures et documents

- Lire le PDF d'un devis, d'une facture ou d'un avoir (DP58) ; PDF de simulation d'un lead (LF22) ; ancien CRM
  (LF25). → `voir_fichiers` DOCUMENT.
- Document existant sans PDF, et PDF importé ensuite (DP57, DP59). → `ajouter_fichier` (DEVIS / FACTURE, voie
  facultative ; rôle PDF_DOCUMENT).
- Liste des factures à encaisser, chèques à créditer, points qualité, livre des recettes et CSV (F1, F8, F9).
  → `lister` ENCOURS, CHEQUES, QUALITE_FINANCES, LIVRE.

### 3.6 Tarifs

- Modifier un tarif par son identifiant (DP70), en créer un (DP71), le retirer (DP72), attribuer un tarif à une
  sous-partie ou revenir à « automatique » (DP73). → `modifier` / `creer` TARIF, `modifier` SOUS_PARTIE, `archiver`
  TARIF.

### 3.7 Réalisations et avis du site

- Tout l'écran Site (W1–W6) : lire, créer, modifier, publier, retirer, photos proposées. → `lister` PUBLICATIONS,
  `creer` / `modifier` PUBLICATION, `publier` PUBLICATION, `ajouter_fichier` (photos d'une publication).

### 3.8 Paramètres

- Historique complet (PA3) ; saisie en lot (F3, PA4 : aujourd'hui une clé par appel) ; défauts illisibles (PS5,
  PC8). → `etat_crm` PARAMETRES / SMS / CONSIGNES, `modifier` PARAMETRE (lot).
- **Zone d'intervention** (`ZONE_DEPARTEMENTS`, `ZONE_DEPARTEMENTS_PROCHES`) : couverte aujourd'hui par
  `modifier_parametres`. Reprise telle quelle par `modifier` PARAMETRE.
- **Consignes** : le texte par défaut n'est pas lisible (PC8). → `etat_crm` CONSIGNES (défaut) et
  `modifier` CONSIGNES (`defaut: true`).

### 3.9 Modèles de SMS et de mail

- Mail : objet, phrase et bouton des modèles de notification (PM5) ; guide de style, à enregistrer ou à tirer des
  mails envoyés (PM2, PM3) ; lecture complète (PM1). → `modifier` MODELE_MAIL et GUIDE_STYLE, `etat_crm` MAIL.
- SMS : texte de départ (PS5), fournisseur, expéditeur et variables (PS1). → `etat_crm` SMS, `modifier` MODELE_SMS
  (`defaut: true`).
- Règles d'expéditeur : poser directement (PM7), lire les règles posées, retirer (PM8). → `creer` REGLE_EXPEDITEUR,
  `etat_crm` MAIL, `archiver` REGLE_EXPEDITEUR.

### 3.10 Agenda (rendez-vous)

Le CRM n'a pas d'entité « rendez-vous ». L'agenda, ce sont les rappels des leads, la prochaine action des dossiers et
la date du chantier, reflétés dans Google Calendar.

- Jours libres pour fixer un chantier (T12). → `lister` CRENEAUX.
- Effacer un rappel (L15, LF12). Rappel posé sans événement d'agenda, comme l'écran (L14, LF11). Lever une prochaine
  action. → `modifier` LEAD (`rappel_le: null`), `modifier` DOSSIER (`prochaine_action: null`).
- Planifier depuis la date extraite d'un mail (M21). → `planifier` (`message_id`).

### 3.11 Tâches (liste de Lucas)

- « Actualiser » (T3). → `agir_systeme` DETECTER_TACHES.
- Lots : revoir un par un (T33), tout classer (T34), annuler le classement (T35). → `taches` (`lot`) et
  `repondre_tache` (`tache: "lot:<clé>"`).
- Jours libres du chantier (T12). → `lister` CRENEAUX.
- Correction d'une incohérence (T18). → `agir_systeme` CORRIGER_INCOHERENCE.

### 3.12 Tâches de fond, système et connexions

- Relancer ou annuler une tâche de fond (B2, B3), avec la file et ses identifiants (B1). → `agir_systeme`
  RELANCER_TACHE / ANNULER_TACHE, `etat_crm` TACHES_DE_FOND.
- Cohérence : clé et correction (B4, B5). Audit des connexions (B6). Sessions de l'assistant (B7). → `etat_crm`
  COHERENCE / AUDIT / SESSIONS, `agir_systeme` CORRIGER_INCOHERENCE.
- Connexions : déconnecter Google (PA6), état du miroir Drive et de l'agent mail (PA7), synchroniser ou vérifier
  Drive (PA8, PA9), relever les mails (PA10), relire la boîte Gmail (M1). → `etat_crm` CONNEXIONS, `agir_systeme`,
  `traiter_mail` RELIRE_BOITE.
- Accès de l'assistant : lire (PC2), révoquer une application, un jeton, tout (PC3–PC5). → `etat_crm` ACCES,
  `agir_systeme` REVOQUER_ACCES.
- Notification d'essai de l'appareil (L28). → `agir_systeme` TESTER_NOTIFICATION.

### 3.13 Réglages de l'Analytique et chaîne Meta

- Relancer la synchronisation d'une source (A10). → `agir_systeme` RELANCER_SYNCHRO.
- Essai Meta avec ou sans notification (A15, A16), tester la notification (A17), rejouer un lead Meta ou tous
  (A18, A19). → `agir_systeme` ESSAI_META / TESTER_NOTIFICATION / REJOUER_META.
- Synthèse historique, rapatriée dans l'Analytique (A24–A28, A30) : pseudonymes, export texte et données, version
  rédigée, mois figés (liste, ouverture, intégrité, écarts), agent et qualité des données. → `analytique` étendu
  (`synthese`).

### 3.14 Dépenses avec justificatif

- Voir le justificatif (X3, DP91). Le joindre à la création (X9, DP92). Le remplacer (X5). « Enregistrer quand même »
  (X10).
- Modifier la dépense, notamment la rattacher à un chantier (X4). La retirer (X6). Suggestions de saisie (X7).
- `rattacher_depense` porte mal son nom : il **crée** une dépense. Or l'outil `depenses` conseille de s'en servir pour
  rattacher une dépense existante, ce qui crée un doublon.
- → `creer` DEPENSE (avec justificatif et `forcer`), `modifier` DEPENSE, `archiver` DEPENSE, `voir_fichiers`
  JUSTIFICATIF, `ajouter_fichier` JUSTIFICATIF, `lister` DEPENSES.

### 3.15 Fusion de doublons

- Leads : fusionner, ou « ce n'est pas la même personne » (LF2, LF3).
- Clients : chercher les doublons (C4), choisir la fiche à conserver (V10). La fusion validée sans confirmation (V9)
  est irréversible en pratique.
- → `doublon`, et la sensibilité par type dans `valider_proposition`.

### 3.16 Photos et documents : les voies et les cibles

- Aucune photo ne s'ajoute à un dossier, ni avant ni après (DP22, DP23), et aucune ne se retire (DP24).
- Aucune image de simulation ne se dépose (DP82, S13). Aucun justificatif (X5, X9). Aucune photo de publication (W3).
  Aucun PDF de document repris (DP59).
- Les photos retirées par le client ne se voient pas et ne se remettent pas (DP35, DP36).
- Le contenu d'une pièce jointe de mail ne se lit pas (M15).
- Aujourd'hui, seul `deposer_document` accepte un fichier, par trois voies : `fichier_id`, `message_id + piece_id`,
  `contenu_base64`. Il n'a **ni lien de dépôt** (Lucas dépose depuis son téléphone) **ni URL**.
- → `ajouter_fichier` : toutes les cibles, cinq voies. `lien_depot`. `ranger_fichier`. `voir_fichiers`.

### 3.17 Espace client

- Vue de l'espace d'un dossier (DP27), derniers gestes (DP54), paiement vu et avis (DP51), aperçu comme le client
  (DP30, E7, E18).
- Gestes de Lucas : valider ou dévalider le projet et une simulation, retirer la demande, réinitialiser une étape
  (DP37, DP38, DP40–DP43, DP47).
- Désactiver le lien (DP33, E10). Accorder un projet de plus (E6, C22). Ouvrir l'espace sans rien noter (DP28, LF8).
- Texte du nouveau lien (DP34, E9). Objet du mail du lien et code choisi selon l'étape (DP31, E19).
- Pages, filtres, tri et faits par projet de la liste (E1–E4). Lecture pour un client donné (C21).
- → `geste_espace`, `lire_fiche` (espace), `lister` ESPACES, `envoyer_lien_espace` étendu.

### 3.18 Simulateur

- Génération par l'API (S9), dépôt du rendu ChatGPT (S13), suivi d'une préparation (S10, S11, S3).
- Catalogue des teintes et échantillons (S6). Coût et état de la clé (S1).
- Bibliothèque de prompts : lister, lire, vérifier, enregistrer, restaurer (S18–S23).
- Banc : état, lancer, rendus (S15–S17).
- → `preparer_simulation` (mode API), `ajouter_fichier` SIMULATION, `voir_fichiers`, `lister` TEINTES, `etat_crm`
  PROMPTS / BANC / CONSOMMATION, `modifier` PROMPT_SIMULATION, `restaurer` PROMPT_SIMULATION, `agir_systeme`
  LANCER_BANC.

### 3.19 Mail : la boîte

- Lu ou non lu (M7). Archiver ou désarchiver (M8). Remonter (M9). Ne plus montrer (M10). Classer (M13).
- Tout nettoyer (M6). Relire la boîte (M1). Vue « Rangés » et recherche dans une vue (M3, M4). Bilan du tri (M30).
- → `traiter_mail`, `lister` MAILS, `etat_crm` MAIL (bilan).

### 3.20 Listes et lectures

- Leads : sans suite, archivés, filtre par source, recherche, pages (L3–L8, L18).
- Dossiers : pages, recherche, compteurs, inactifs, archivés (D1, D4, D6, D7, D8).
- Clients : liste et filtres (C1, C2).
- Propositions : toute la file (V1–V3).
- Générations du site en cours ou en échec (L25).
- Fiches complètes :
  - lead (LF1) ;
  - dossier (DP1, DP25, DP90) ;
  - client (C9, C25) ;
  - chronologie (DP96, C23) ;
  - messages d'un client (C24).
- → `lister`, `lire_fiche` étendu, `voir_fichiers`, `chercher` (`archives: true`).

### 3.21 Validation

- Sensibilité calculée pour tous les types (V4, V9, T17). Corrections libres selon les champs du type (V5, V10, T15,
  L23, DP8). Réessayer (V7). Respect de `validationGroupee` en lot (V8).
- → `valider_proposition` étendu, `lister` PROPOSITIONS.

### 3.22 Archivage, restauration, RGPD

- Fiche client : archiver, restaurer (C12, C13). Anonymiser (C14).
- Motif libre pour un seul lead (LF26).
- → `archiver` / `restaurer` étendus, `anonymiser_client`.

### 3.23 Pièges relevés en passant (à corriger avec les outils)

1. `rattacher_depense` crée une dépense (voir 3.14), et son lien mène à `/finances` au lieu de `/depenses`.
2. `annuler_encaissement` affiche l'identifiant du dossier comme un message, et son lien mène à `/finances`.
3. `lien_espace` écrit « lien communiqué par SMS » et passe la main au client, même si rien n'est envoyé.
4. `publier_simulation` republie aussi les simulations **masquées** (filtre `statut !== "PUBLIEE"`), ce qui envoie un
   mail.
5. `valider_proposition` : sensibilité limitée aux cartes MAJ ; corrections limitées à `valeur` ; lot sans garde.
6. `messages_espace` annonce un paramètre `marquer_lus` qui n'existe pas dans son schéma.
7. `ranger_mail` n'est pas « archiver ». Il nourrit l'apprentissage des règles quand Lucas voulait seulement sortir le
   mail d'« À traiter ».
8. `creer_contact` n'est pas « Nouveau client ». Il crée un lead qui entre dans « À appeler ».
9. `chercher`, `resoudreCible` et `nomsDe` ne voient pas les archivés (filtre `archiveLe: null` implicite de
   `lib/journal/extension.ts`). `restaurer` n'est donc utilisable qu'avec un identifiant déjà connu.
10. `planifier` coupe la prochaine action à 120 caractères ; l'écran en accepte 140.
11. `envoyer_document` revalide une proposition déjà validée : erreur 409, et mail en double à la nouvelle tentative.
    Déjà inscrit dans la mission 18, partie B, point 2.
12. `noter_appel` sur un lead fait deux écritures (note d'appel, puis appel). L'écran permet la note seule.

## 4. Proposition d'outillage : tous les manques fermés, 53 outils au lieu de 84

### 4.1 Principes

1. **Jamais d'écriture brute.** Chaque cas appelle la **même fonction de service que la route de l'écran**,
   avec le même schéma zod.
   - Le schéma MCP est la traduction en `snake_case` du schéma du service.
   - Un champ absent du schéma du service n'existe pas dans l'outil.
   - Le seul `prisma.*.update` trouvé dans une route (retrait d'une règle d'expéditeur) descend d'abord dans la
     bibliothèque.
2. **Une entité, un vocabulaire.** Les entités sont LEAD, DOSSIER, CLIENT, COORDONNEE, CONSENTEMENT, NOTE, NOTE_APPEL,
   DOCUMENT, ENCAISSEMENT, DEPENSE, SIMULATION, TARIF, SOUS_PARTIE, PUBLICATION, REGLE_EXPEDITEUR, TACHE, PARAMETRE,
   COMPTEUR, AUTOMATISME, MODELE_SMS, MODELE_MAIL, GUIDE_STYLE, CONSIGNES, POSITIONNEMENT, PROMPT_SIMULATION.
   - Elles sont définies une seule fois, dans `src/lib/assistant/entites.ts` (nouveau).
   - Chaque entité y porte son résolveur (identifiant ou cible, candidats en cas de doute), sa fonction de service et
     la sensibilité de chaque champ.
3. **Sensibilité par cas, pas par outil.**
   - Le `niveau` d'un outil générique est REVERSIBLE, sauf `anonymiser_client` (SENSIBLE).
   - `sensible(e)` renvoie vrai quand le cas touche le client, l'argent ou un paramètre, ou quand il est
     irréversible. On a alors un aperçu, puis une confirmation par jeton.
   - `masse > 3` reste sensible (`SEUIL_MASSE`).
   - Une **suppression logique réversible** (archiver) reste REVERSIBLE, comme aujourd'hui, avec son inverse
     `restaurer`. Une suppression sans retour est SENSIBLE.
4. **Trace et annulation.** Tout `modifier` trace « avant → après », comme `ModificationDossier` aujourd'hui.
   `annuler_modification` défait n'importe quelle entité tracée. Il faut pour cela généraliser la table (colonne
   `entite`), ou en créer une commune.
5. **Archivés visibles.** `lister`, `chercher (archives: true)` et les résolveurs lisent avec `AVEC_ARCHIVES`. Sans
   cela, `restaurer` reste inutilisable.
6. **Paramètres communs** inchangés : `commande` (la phrase de Lucas), `confirmation` (jeton), journal `AppelOutil`.

### 4.2 Les nouveaux outils génériques

| Outil | Niveau | Rôle | Remplace |
|---|---|---|---|
| `lister` | LECTURE | Toute liste d'écran, avec les vues, filtres et pages de l'écran (4.6) | leads_a_appeler, leads_a_rappeler, dossiers_par_etape, espaces_clients, mails_a_traiter, mails_non_classes, messages_espace, voir_relances, depenses, tarifs |
| `etat_crm` | LECTURE | L'état du système et de la configuration, par partie (4.7) | sante_systeme, voir_parametres, versions_consignes, lister_outils, voir_publicite |
| `voir_fichiers` | LECTURE | Tout fichier comme une vraie image ou un vrai document, par genre (4.8) | voir_photos, voir_simulations, simulations_site |
| `creer` | REVERSIBLE (sensible par cas) | Créer une entité (4.4) | creer_contact, ouvrir_dossier, ajouter_note, rattacher_depense, ajouter_tache, proposer_regle |
| `modifier` | REVERSIBLE (sensible par cas) | Changer des champs d'une entité (4.3) | modifier_dossier, changer_teinte, presenter_devis, modifier_tarifs, modifier_parametres, modifier_consignes |
| `ajouter_fichier` | REVERSIBLE (sensible par cas) | Déposer un fichier sur une cible, par l'une des cinq voies (4.8) | deposer_document |
| `ranger_fichier` | REVERSIBLE | Retirer ou remettre un fichier (4.8) | — |
| `lien_depot` | REVERSIBLE | Lien de dépôt signé, court, pour que Lucas dépose depuis son téléphone (4.8) | — |
| `publier` | REVERSIBLE (PUBLIER sensible) | Publier ou retirer une simulation (espace client) ou une publication (site) | publier_simulation, masquer_simulation |
| `traiter_mail` | REVERSIBLE (sensible par geste) | Tous les gestes de la boîte (4.10) | ranger_mail, snoozer_mail, rattacher_mail |
| `geste_espace` | REVERSIBLE (sensible par geste) | Tous les gestes de Lucas sur un espace (4.11) | renouveler_lien, accorder_simulations, marquer_messages_lus, retirer_accord |
| `doublon` | REVERSIBLE (fusion sensible) | Doublons de leads et de clients (4.12) | — |
| `anonymiser_client` | SENSIBLE | Anonymisation RGPD d'une fiche client | — |
| `agir_systeme` | REVERSIBLE (sensible par action) | Gestes techniques : tâches de fond, cohérence, synchronisations, Meta, banc, accès (4.13) | — |

### 4.3 `modifier` : entités, fonctions de service, champs permis, niveau

Schéma : `{ entite, id? | cible?, champs: {…}, commande }`. Seuls les champs donnés changent. `null` efface un champ
effaçable.

| Entité | Fonction de service (fichier › fonction) | Champs permis | Niveau | Ferme |
|---|---|---|---|---|
| LEAD | `prospects/entrants.ts › modifierEntrant` (`schemaModificationEntrant`) | prenom, nom_famille, telephone, email, ville, code_postal, type_projet, notes, statut (NOUVEAU, DEVIS_DEMANDE, CONTACTE, PERDU) + motif_perte + motif, priorite (PRIORITAIRE, STANDARD, SECONDAIRE, A_ECARTER, AUTO), rappel_le (date ou `null`) | R ; S pour statut PERDU (perte comptée, même règle que `repondre_tache`) | L14, L15, LF11, LF12, LF16, LF17, LF18, LF23, LF24 |
| DOSSIER | `dossiers/modification-assistant.ts › modifierDossierAssistant` (tracé, annulable) | objet, montant_estime, date_souhaitee, date_chantier, date_fin_chantier, adresse {adresse, code_postal, ville}, email, telephone, prochaine_action (+ date ; `null` la lève), familles, ajouter_sous_parties, retirer_sous_parties, teintes, teinte {meuble, teinte} (ex-`changer_teinte`), dimensions, notes_projet | R ; S pour montant_estime, date_chantier, date_fin_chantier, adresse | T13, DP6, DP39, DP88 (déjà couverts : repris) |
| DOSSIER (suite) | `dossiers/dossiers.ts › modifierDossier` (`schemaModification`) | client_nom, source, ouvert_le, client_id (changer de fiche client : documents et paiements suivent) | R ; S pour client_id | DP94, DP95 |
| DOSSIER (suite) | `dossiers/dossiers.ts › masquerPointACompleter` | points_masques[], points_reaffiches[] (codes `CODES_COMPLETUDE`) | R | DP4, DP5 |
| DOSSIER (suite) | `dossiers/dossiers.ts › modifierDateEvenement` | passage {evenement_id, survenu_le} | R | DP89 |
| CLIENT | `clients/fiches.ts › modifierClient` (`schemaModificationClient`) | categorie, prenom, nom_famille, raison_sociale, siret, adresse, code_postal, ville, source, source_detail, campagne, publicite, formulaire, premier_contact_le, recommande_par_id, recommande_par_texte, notes (le passif) | R | C11, C20 |
| COORDONNEE | `clients/fiches.ts › modifierCoordonnee` ; `definirPrincipale` | client, nature (email, telephone), coordonnee_id, valeur, libelle, principale: true | R | C16, C17 |
| DOCUMENT | `dossiers/presentation-devis.ts › modifierPresentationDevis` | libelle_variante, visible_espace (ex-`presenter_devis`) | R ; S quand un devis masqué devient visible (vaut envoi) | DP48 (repris) |
| DOCUMENT (repris) | `dossiers/documents-existants.ts › modifierDocumentExistant` (`schemaModificationDocumentExistant`) | date_emission, montant, objet, statut, acompte_pct, libelle_variante, visible_espace | S-€ | DP59 |
| ENCAISSEMENT | `encaissements/service.ts › modifierEncaissement` (`schemaCorrectionEncaissement`) ; `crediterCheque` quand seul credite_le est donné | montant, recu_le, moyen, reference, credite_le | S-€ | DP76, DP77, F5 |
| DEPENSE | `depenses/service.ts › modifierDepense` (`schemaModificationDepense`) | montant, payee_le, fournisseur, categorie, moyen, libelle, note, dossier_id, hors_chantier | R (comme aujourd'hui pour les dépenses) | X4 |
| SIMULATION | `simulations/dossier.ts › modifierSimulation` ; `changerStatutSimulation(…, "brouillon")` | titre, description, statut: BROUILLON | R | DP85, DP87 |
| NOTE_APPEL | `commercial/notes-appel.ts › modifierNoteAppel` | note_id, texte, etiquettes | R | LF13, LF14 (compléter une note) |
| TARIF (preset) | `dossiers/presets.ts › modifierPreset` (`schemaPreset`) | designation, unite, prix_unitaire, prestations | S-param | DP70 |
| SOUS_PARTIE | `prestations/tarifs.ts › modifierTarifSousPartie` (ex-`modifier_tarifs`) ; `attribuerTarif` | prix_unitaire, unite, designation ; preset_id (ou `null` = automatique) | S-param | DP70, DP73 |
| PUBLICATION | `site/publications.ts › modifierPublication` (`schemaPublication`) | type, titre, texte, ville, type_projet, note, auteur, dossier_id, client_id, photo_avant, photo_apres, accord_client_le, ordre | R en brouillon ; S-client si déjà publiée | W4 |
| PARAMETRE | `parametres/service.ts › enregistrerParametre` | cle, valeur, valable_du, source ; ou `saisies[]` (lot, comme `POST /api/parametres`) | S-param | PA4, F3 (en lot) |
| COMPTEUR | `dossiers/compteurs.ts › poserCompteur` | serie (DEVIS, FACTURE), prochain | S-param | PF4 (repris) |
| AUTOMATISME | `automatismes/interrupteurs.ts › reglerAutomatisme` | code (NOTIF_*, SMS_ACCUSE_*, SEQUENCE_*, IA_CRM, MAIL_RANGEMENT_GMAIL…), actif | S-param | PM4, PS4 (repris) |
| MODELE_SMS | `sms/modeles.ts › modifierModele` | code, texte, actif, libelle ; `defaut: true` (revient au texte de départ) | S-param | PS3, PS5 |
| MODELE_MAIL | `mail/notifications.ts › enregistrerModeleNotification` (le modèle entier est relu puis réécrit ; `actif` est gardé) | evenement, objet, phrase, bouton, actif | S-param (texte envoyé aux clients) | PM5 |
| GUIDE_STYLE | `mail/redaction.ts › enregistrerGuideStyle` ; `genererGuideStyle` | texte ; ou `tirer_des_mails: true` (coût d'IA) | S-param | PM2, PM3 |
| CONSIGNES, POSITIONNEMENT | `assistant/consignes.ts › enregistrerConsignes` / `enregistrerPositionnement` | mode (remplacer_section, completer_section, ajouter_section, remplacer_tout), section, contenu ; `defaut: true` | S-param | PC7, PC8 |
| PROMPT_SIMULATION | `simulateur/bibliotheque.ts › enregistrerVersion`. L'aperçu vient de `simulateur/rendu.ts › verifierModele` + `rendrePrompt` : c'est le bouton « Vérifier » de l'écran | type, texte, note | S-param | S21, S22 |

### 4.4 `creer` : entités, fonctions de service, champs permis, niveau

| Entité | Fonction de service | Champs permis | Niveau | Ferme |
|---|---|---|---|---|
| LEAD | `prospects/creation-assistant.ts › creerContactAssistant` (anti-doublon) ; avec `message_id` : `mail/rattachement.ts › creerLeadDepuisMail` | prenom, nom, telephone, email, ville, code_postal, source, type_projet, projet, ouvrir_dossier, forcer ; message_id | R | L1, M24 |
| DOSSIER | Depuis un lead : `dossiers/depuis-lead.ts › ouvrirDossierDuLead` (ex-`ouvrir_dossier`). Sinon : `dossiers/dossiers.ts › creerDossier` (`schemaCreation`) | lead_id, ou client_id, ou rien ; client_nom, client_adresse, client_cp, client_ville, client_telephone, client_email, objet, source, montant_estime, prochaine_action, prochaine_action_date, etape, date_chantier, client_categorie, client_siret. Photos ensuite par `ajouter_fichier` | R ; S si etape ≥ SIGNE | D13, D14, C10 |
| REPRISE | `dossiers/reprise.ts › reprendreDossier` (`schemaReprise`) | fiche client, étape actuelle, dates des jalons, ouvert_le, documents émis (numéro, date, montant, statut, registre), paiements reçus ; les PDF ensuite par `ajouter_fichier` (PDF_DOCUMENT) | S-€ | D16 |
| CLIENT | `clients/fiches.ts › creerClientManuel` (`schemaCreationClient`) ; le 409 doublon rend les candidats | champs de `champsClient` + telephone, email, forcer | R | C5, C6 |
| COORDONNEE | `clients/fiches.ts › ajouterCoordonnee` | client, nature, valeur, libelle | R | C15 |
| CONSENTEMENT | `clients/fiches.ts › enregistrerConsentement` (`schemaConsentement`) | client, statut (ACCORDE, REFUSE, RETIRE), moyen, recueilli_le, preuve | R (historisé ; preuve légale) | C19 |
| NOTE | Dossier : `dossiers/dossiers.ts › ajouterNote` (`schemaNote`). Lead : `prospects/entrants.ts › ajouterEchange`. Défaut actuel : `commercial/appels.ts › noterRapidement` | cible, texte ; etape (dossier, l'étape courante par défaut) ; type APPEL, SMS, EMAIL, NOTE (lead) | R | DP93, LF19 |
| NOTE_APPEL | `commercial/notes-appel.ts › creerNoteAppel` (sans issue ; pour un appel avec issue, `noter_appel`) | lead, texte, etiquettes, appel_le | R | LF13, LF14 (note sans issue) |
| DEPENSE | `depenses/service.ts › creerDepense` (`schemaCreationDepense`, justificatif) | montant, payee_le, fournisseur, categorie, moyen, libelle, note, dossier_id, hors_chantier, forcer ; justificatif par les voies de `ajouter_fichier` | R | X9, X10, DP92 |
| TARIF (preset) | `dossiers/presets.ts › creerPreset` (`schemaPreset`) | designation, unite, prix_unitaire, prestations ; attribuer_a (sous-partie) | S-param | DP71 |
| PUBLICATION | `site/publications.ts › creerPublication` (brouillon, jamais publié à la création) | champs de `schemaPublication` ; photos choisies dans `photosDuDossierPourPublication` ou déposées par `ajouter_fichier` | R | W3 |
| REGLE_EXPEDITEUR | `mail/boite.ts › poserRegle` (archive la règle contraire) | cible (adresse ou @domaine), action (RANGER, NE_JAMAIS_RANGER, ADMINISTRATIF), motif | S-param (la confirmation de Lucas remplace la carte de l'ancien `proposer_regle`) | PM7 |
| TACHE | `a-faire/reponses.ts › ajouterTache` (`schemaAjout`) | titre, quand, cible, raison | R | T36 (repris) |

### 4.5 `archiver`, `restaurer`, `supprimer`

- **`archiver`** (niveau R ; au-delà de 3 éléments, S) passe de `{leads, dossiers, motif}` à
  `{elements: [{entite, id}], motif}`, en gardant `leads` et `dossiers` comme raccourcis.

  | Entité | archiver | restaurer | Ferme |
  |---|---|---|---|
  | LEAD | lot : `prospects/menage.ts › appliquerActionLeads` ; un seul, motif libre : `prospects/entrants.ts › archiverEntrant` | `appliquerActionLeads` (RESTAURER) / `restaurerEntrant` | L17, L18, LF26, LF27 |
  | DOSSIER | `dossiers/archivage.ts › archiverDossier` | `restaurerDossier` | DP97, D8 |
  | CLIENT | `clients/fiches.ts › archiverClient` | `restaurerClient` | C12, C13 |
  | COORDONNEE | `clients/fiches.ts › archiverCoordonnee` | à écrire (`restaurerCoordonnee`, même module) | C18 |
  | DEPENSE | `depenses/service.ts › archiverDepense` | à écrire (`restaurerDepense`) | X6 |
  | TARIF | `dossiers/presets.ts › archiverPreset` | à écrire (`restaurerPreset`) | DP72 |
  | REGLE_EXPEDITEUR | à déplacer de la route vers `mail/boite.ts › archiverRegle` | à écrire (`restaurerRegle`) | PM8 |
  | SIMULATION | `simulations/dossier.ts › changerStatutSimulation(…, "retirer", motif)` | `changerStatutSimulation(…, "brouillon")` | DP86 |

- **`restaurer`** reçoit aussi les **versions** : `{entite: CONSIGNES | POSITIONNEMENT, numero}` passe par
  `assistant/consignes.ts › restaurerVersion` (ex-`restaurer_consignes`) ; `{entite: PROMPT_SIMULATION, type, numero}`
  passe par `simulateur/bibliotheque.ts › restaurerVersion` (ferme S23). Niveau R : une restauration crée elle-même une
  version.
- **`supprimer`** est **gardé tel quel** (leads, dossiers, corbeille, `definitif`).

### 4.6 `lister` : les listes des écrans

Schéma : `{ liste, vue?, filtres…, recherche?, page?, par_page? }`. Chaque liste rend les identifiants utiles aux
outils d'écriture.

| Liste | Fonction de service | Vues et filtres (ceux de l'écran) | Ferme |
|---|---|---|---|
| LEADS | `prospects/leads.ts › listerLeads` (+ `AVEC_ARCHIVES` pour ARCHIVES) | vue A_APPELER, A_RAPPELER, SANS_SUITE, ARCHIVES ; source ; recherche (campagne comprise) ; page | L3–L8, L18 |
| DOSSIERS | `dossiers/dossiers.ts › pageDossiers` ; `listerDossiers` (par étape) ; `dossiers/archivage.ts › dossiersArchives` | vue EN_COURS, A_FAIRE, TOUS, ARCHIVES ; etape ; recherche ; masquer_inactifs ; page ; compteurs | D1, D4, D6–D8 |
| CLIENTS | `clients/fiches.ts › pageClients` | recherche, categorie, source, archives, page | C1, C2 |
| ESPACES | `espace/suivi.ts › pageClientsEspaces` ; `relances/photos.ts › relancesPhotosProposables` | qui (MOI, CLIENT, SIGNAUX, TOUS, DESACTIVES), etape, tri, page, sans_photo_ni_simulation_depuis_jours ; faits par projet | E1–E4 |
| MAILS | `mail/vues.ts › listerVue` ; vue NON_CLASSES = ex-`mails_non_classes` | vue A_TRAITER, CLIENTS, ADMINISTRATIF, RANGES, NON_CLASSES ; recherche dans la vue | M3, M4 |
| MESSAGES_ESPACE | `espace/messages.ts › messagesEspace` | cible, tout, limite | (ex-`messages_espace`) |
| RELANCES | `relances/service.ts › listerRelances` + `relancesPhotosProposables` | dossier | (ex-`voir_relances`) |
| PROPOSITIONS | `validation/service.ts › listerPropositions` | statut (EN_ATTENTE, ECHEC, HISTORIQUE), type, dossier, client, message, proposition_id (lecture d'une seule) ; rend `sensible`, `validationGroupee`, champs corrigibles, motifs de rejet | V1–V3 |
| DEPENSES | `depenses/service.ts › listerDepenses` ; `suggestionsSaisie` | annee ou periode, categorie, rattachement, archivees ; suggestions | X1, X7 |
| ENCOURS, CHEQUES, QUALITE_FINANCES | `finances/tableau.ts › chargerTableauFinances` | annee ; identifiants de registre et d'encaissement | F1 |
| LIVRE | `finances/livre.ts › chargerLivre` (+ lien du CSV `/api/finances/livre`) | annee | F8, F9 |
| TARIFS | `prestations/tarifs.ts › tarifsDesPrestations` + `dossiers/presets.ts › listerPresets` | sous_partie ; presets avec identifiant | DP64 (ex-`tarifs`) |
| PUBLICATIONS | `site/publications.ts › listerPublications` + `dossiersAvecPhotosApres` + `photosDuDossierPourPublication` | dossier (photos proposées, avec leur chemin) | W1, W2 |
| CRENEAUX | `agenda/creneaux.ts › creneauxLibres` | dossier (date posée, date souhaitée) | T12 |
| TEINTES | `simulateur/catalogue.ts › catalogue` | styles, famille, recherche | S6 |
| ENTREPRISES | `clients/annuaire.ts › rechercherEntreprises` | q (nom, SIREN, SIRET) | D15, C7 |

### 4.7 `etat_crm` : le système et la configuration

Schéma : `{ partie, … }`. Lecture seule, jamais de secret.

| Partie | Fonction de service | Ferme |
|---|---|---|
| SANTE | ex-`sante_systeme` | — |
| META | ex-`voir_publicite` : `meta/sante.ts › santeMeta` (interroger_meta, jours) | — |
| PARAMETRES | `parametres/service.ts › parametresPourEcran` (historique complet) ; `automatismes/interrupteurs.ts › listerAutomatismes` | PA3 |
| NUMEROTATION | `dossiers/compteurs.ts › lireCompteurs` ; `dossiers/numerotation.ts › prochainNumero` ; `dossiers/registre.ts › numerosLibres` | DP57 |
| SMS | `sms/modeles.ts › listerCatalogue` (avec le texte de départ) ; `sms/fournisseurs › etatFournisseur` | PS1, PS5 |
| MAIL | `mail/reglages-vue.ts › reglagesMail` (guide, modèles complets, règles posées, règles proposées) ; `mail/vues.ts › bilanTri` | PM1, PM8, M30 |
| CONSIGNES | `assistant/vues-parametres.ts › vueConsignes` (versions, sections, **défauts**) | PC8 |
| OUTILS | ex-`lister_outils` (registre, empreinte) | — |
| TACHES_DE_FOND | `taches/lecture.ts › etatDesTaches` (avec les identifiants) | B1 |
| COHERENCE | `coherence/controle.ts › controlerCoherence` (avec `cle` et `correction`) | B4 |
| AUDIT | `audit/connexions.ts › auditerConnexions` | B6 |
| SESSIONS | `assistant/execution.ts › sessionsRecentes` | B7 |
| CONNEXIONS | état Google, miroir Drive, agent mail (route `/api/connexions`) | PA7 |
| ACCES | `assistant/vues-parametres.ts › vueAcces` | PC2 |
| PROMPTS | `simulateur/bibliotheque.ts › listerPrompts`, `lirePrompt`, `texteDeVersion` | S18–S20 |
| BANC | `simulateur/banc/banc.ts › etatBanc`, `estimerCampagne` | S15 |
| CONSOMMATION | `simulateur/consommation.ts › consommation` | S1 |

### 4.8 Fichiers : `ajouter_fichier`, `ranger_fichier`, `voir_fichiers`, `lien_depot`

**Les cinq voies**, les mêmes pour toutes les cibles : une fonction commune `fichiers/source.ts › lireSource`, tirée de
`dossiers/depot-document.ts` et étendue.

1. `fichier_id` : un fichier déjà conservé.
2. `message_id + piece_id` : une pièce jointe de mail, lue par `messages/consultation.ts › lirePieceMessage`.
3. `contenu_base64` (+ `nom`, `type_mime`).
4. **`url`** : https seulement, sans adresse privée (garde contre la falsification de requêtes côté serveur), 9 Mo au
   plus (`OCTETS_MAX_DEPOT`), type MIME vérifié.
5. **`depot`** : un fichier reçu par un lien de dépôt, désigné par l'identifiant rendu par `lien_depot`.

**`ajouter_fichier`** `{ cible: {entite, id|cible}, role, source, champs? }`. Les rôles par cible :

| Cible › rôle | Fonction de service | Niveau | Ferme |
|---|---|---|---|
| DOSSIER › PHOTO_AVANT, PHOTO_APRES | `dossiers/dossiers.ts › ajouterPhoto(dossierId, fichier, apres)` | R | DP22, DP23, D13 (photos) |
| DOSSIER › SIMULATION (titre, description, source MANUEL ou CHATGPT, preparation_id « auto ») | `simulations/dossier.ts › deposerSimulationDossier` (brouillon) | R | DP82, S13 |
| DOSSIER › DEVIS, FACTURE, AUTRE (champs de l'ex-`deposer_document`) | `dossiers/depot-document.ts › deposerDocument` ; sans fichier : `dossiers/documents-existants.ts › enregistrerDocumentExistant` | S (un devis visible vaut envoi) | DP57, DP49 (repris) |
| DOCUMENT › PDF_DOCUMENT (PDF d'un document repris) | `dossiers/documents-existants.ts › importerPdfDocument` | S-€ | DP59 |
| DEPENSE › JUSTIFICATIF | `depenses/service.ts › remplacerJustificatif` (à la création : `creer DEPENSE`) | R | X5, X9, DP92 |
| PUBLICATION › PHOTO_AVANT, PHOTO_APRES | `fichiers/stockage.ts › enregistrerFichier`, puis `site/publications.ts › modifierPublication` (chemin). Petite fonction `photoDePublication` à écrire | R (S-client si déjà publiée) | W3, W4 |

**`ranger_fichier`** `{ fichier, action }` :

- RETIRER une photo du dossier : `dossiers/dossiers.ts › supprimerPhoto`. Suppression logique « photo-retirée » ;
  S tant qu'aucune remise n'existe. Ferme DP24.
- RETIRER une photo de l'espace au nom de Lucas : `espace/vue-crm.ts › gesteDeLucas(retirer-photo)`. R.
- REMETTRE une photo retirée par le client : `gesteDeLucas(remettre-photo)`. R. Ferme DP36.

**`voir_fichiers`** `{ genre, cible?, id?, nombre, decalage, … }` rend de vraies images (comme `voir_photos`
aujourd'hui). Un PDF est rendu comme ressource embarquée (moins de 9 Mo), avec un lien de lecture court.

| Genre | Fonction de service | Ferme |
|---|---|---|
| PHOTOS (avant, après, retirées par le client) | `assistant/photos.ts › photosDuContact` ; `espace/vue-crm.ts › lirePhotoRetiree` | DP35 (et DP21, LF21 repris) |
| SIMULATIONS | `simulations/dossier.ts` (avec_prompt, simulation_id, sans_avant) | DP80 (repris), LF22 |
| SIMULATIONS_SITE | ex-`simulations_site`, + `simulations/travaux-lecture.ts › travauxSiteRecents` (en cours, en échec : ferme L25) | L25 (et L24 repris) |
| PREPARATION | `simulateur/preparation.ts › lirePreparation`, `photoDePreparation` | S10, S11 |
| DOCUMENT | `dossiers/documents.ts › lirePdfDocument` ; PDF de l'ancien CRM | DP58, LF22, LF25 |
| JUSTIFICATIF | `depenses/service.ts › justificatifDe` + `fichiers/stockage.ts › lireFichierConserve` | X3, DP91 |
| PIECE_MAIL | `messages/consultation.ts › lirePieceMessage` | M15 |
| FICHIER | `fichiers/stockage.ts › lireFichierConserve` | — |
| ECHANTILLON | `simulateur/catalogue.ts › imageEchantillon` | S6 |
| RENDU_BANC | `simulateur/banc/banc.ts › imageRenduBanc` | S17 |

**`lien_depot`** `{ cible, role, expire_dans? }` : un lien signé, court (24 h, usage limité), que Lucas ouvre sur son
téléphone pour prendre ou choisir des fichiers.

- À écrire :
  - `src/lib/fichiers/depot.ts` (jeton, cible, rôle, expiration) ;
  - la page publique `/depot/[jeton]` ;
  - la route `POST /api/depot/[jeton]`, à inscrire dans `lib/acces/routes-publiques.ts`.
- La route appelle **la même fonction de service** que `ajouter_fichier` pour la cible.
- Niveau R. Le lien est remis à Lucas ; l'envoyer à un client passe par `envoyer_mail` ou un SMS, qui restent
  sensibles.

### 4.9 Outils existants gardés et étendus

| Outil | Extension | Ferme |
|---|---|---|
| chercher | `archives: true` (`AVEC_ARCHIVES`) ; recherche dans l'objet des dossiers et dans les campagnes | L8, D4, L18, D8 |
| lire_fiche | **Lead** : tous les champs de la fiche (notes, code postal, campagne, publicité, formulaire, prix simulé, style, réponses, doublon, tentatives, dernier appel et contact, archive, ancien CRM). **Dossier** : historique paginé (`nombre`, `decalage`), `espace: true` (`espace/vue-crm.ts › vueEspaceCrm` : étapes du client, reste à faire, projet, choix, favoris, avis, paiement vu, gestes, photos retirées, **lien d'aperçu** `espace/liens.ts › lienApercu`), perte détaillée, source, ouverture, `mainLe`, points masqués, délais. **Client** : catégorie, SIRET, adresse, provenance, recommandations, passif, consentement en cours, historique, coordonnées avec leur identifiant, état, espace permanent (`espace/gestion.ts › espaceDuClient`). Option `chronologie` (familles) : `chronologie/chronologie.ts › chronologieDuContact` ; option `messages` : `messages/consultation.ts › listerMessages` | LF1, LF25, DP1, DP25, DP27, DP30, DP51, DP54, DP90, DP96, C9, C21, C23–C25, E7, E18, S3 |
| taches | vue `TOUT` (ex-`ce_qui_m_attend` : tâches, puis mails, propositions, messages d'espace) ; `lot` (`a-faire/lecture.ts › tachesDuLot`) | T33 |
| analytique | absorbe `synthese` et `campagne` (jour de campagne et règle du jour dans l'onglet publicite). Ajoute `synthese: {export: texte ou donnees, anonyme, redaction, agent_qualite, mois_figes, mois_fige: "AAAA-MM"}` → `synthese/requete.ts › lireSynthese(du, au, anonyme)`, `synthese/redaction.ts › redigerSynthese`, `synthese/instantanes.ts › listerInstantanes` / `lireInstantane` | A24–A28, A30 |
| repondre_tache | `tache: "lot:<clé>"` : FAIT = `a-faire/reponses.ts › classerLot`, ANNULER = `annulerLot(le)` | T34, T35 |
| changer_etape | passe par `encaissements/service.ts › changerEtapeAvecPaiement` ; ajoute devis_accepte_id, acompte {montant, moyen, recu_le, reference}, sans_acompte {motif, precision}, solde {…}, survenu_le, perte_concurrent, perte_montant_concurrent | DP13, DP14, DP16–DP18, DP20 |
| saisir_encaissement | piece (numéro de devis ou de facture → `numeroDocumentId` ; permet une facture hors CRM, sans dossier), payeur, credite_le | T11, DP9, DP75, F4 |
| annuler_encaissement | nature `REJETER` (le, motif SANS_PROVISION, OPPOSITION, IRREGULIER, AUTRE, precision) → `rejeterEncaissement` ; texte et lien corrigés | DP78, F6 |
| generer_document | lignes SECTION ; `depuis_espace: true` (`espace/devis-propose.ts › devisProposeDuDossier`, lignes relues dans l'aperçu) | T10, DP55, DP65, DP67 |
| preparer_simulation | `mode: API` (S-€ ; aperçu du coût par `consommation`) → `simulateur/preparation.ts › preparerSimulation` + `executerGenerationApi` ; rend l'état d'une préparation | S9–S11 |
| planifier | `message_id` (date extraite d'un mail, même logique que `/api/mail/[id]/planifier`) ; 140 caractères | M21 |
| envoyer_lien_espace | `objet` ; code par défaut selon l'étape (LIEN_ESPACE à l'étape Photos, sinon LIEN_ESPACE_RAPPEL) | DP31, E19 |
| valider_proposition | sensibilité = celle de la définition du type (FUSION_CLIENTS et ANONYMISATION_CLIENT toujours sensibles) ; `corrections` = les champs corrigibles du type (objet et texte d'un mail, `conserver` A ou B…) ; en lot, `validerEnLot` (garde `validationGroupee`) ; `reessayer: true` → `reessayerExecution` | T15, T17, L23, DP8, V4, V5, V7–V10 |
| ignorer_proposition | accepte les relances de devis (`annulerProposition`, ex-`annuler_relance`) | — |
| annuler_modification | toutes les entités tracées par `modifier` | — |

Gardés sans changement : point_du_jour, les cinq manager_*, lire_mail, rechercher_mails, rediger_mail, supprimer,
noter_appel, noter_sms, envoyer_document, annuler_document, relancer, lien_espace, repondre_espace, classer_mail,
resumer_fil, proposer_mise_a_jour, deposer_brouillon, envoyer_mail.

### 4.10 `traiter_mail` : les gestes de la boîte

`{ messageIds[] | expediteur, geste, … }`. Niveau R. S pour NE_PLUS_MONTRER (définitif), TOUT_NETTOYER, un rangement
par expéditeur, ou plus de 3 fils.

| Geste | Fonction de service | Ferme |
|---|---|---|
| LU, NON_LU | `mail/boite.ts › marquerLu` | M7 |
| ARCHIVER, DESARCHIVER | `mail/boite.ts › archiverFil` | M8 |
| RANGER, DERANGER (par identifiants ou par expéditeur) | `mail/v2.ts › rangerMail` / `derangerMail` (ex-`ranger_mail`) | M11, M12 |
| REMONTER | `mail/boite.ts › remonter` | M9 |
| NE_PLUS_MONTRER | `mail/boite.ts › nePlusMontrer` (refuse l'adresse d'un client) | M10 |
| CLASSER (classe CLIENT, ADMINISTRATIF, HUMAIN ; pour_l_expediteur) | `mail/boite.ts › classerALaMain` | M13 |
| SNOOZER, ANNULER_SNOOZE | `mail/v2.ts › snoozer` / `annulerSnooze` (ex-`snoozer_mail`) | M22 |
| RATTACHER (cible) | `mail/rattachement.ts › rattacherALaMain` (ex-`rattacher_mail`) | M23 |
| TOUT_NETTOYER | `mail/vues.ts › toutNettoyer` (aperçu du nombre) | M6 |
| RELIRE_BOITE | `mail/boite.ts › synchroniserBoite` | M1 |

### 4.11 `geste_espace` : les gestes de Lucas sur l'espace client

`{ cible, geste, … }`. Fonction : `espace/vue-crm.ts › gesteDeLucas`, sauf mention contraire.

| Geste | Fonction de service | Niveau | Ferme |
|---|---|---|---|
| OUVRIR (sans rien noter) | `espace/liens.ts › ouvrirEspace` / `ouvrirEspaceDuContact` | R | DP28, LF8 |
| DESACTIVER | `espace/gestion.ts › desactiverLien` ; pour un dossier : `espace/liens.ts › revoquerEspace` | S (coupe l'accès du client) | DP33, E10 |
| NOUVEAU_LIEN (mail, texte) | `espace/gestion.ts › regenererLien` (ex-`renouveler_lien`) | S si mail | DP34, E9 |
| ACCORDER_SIMULATIONS (nombre) | `espace/creation.ts › accorderSimulations` (ex-`accorder_simulations`) | R ; S au-delà de 3 | — |
| ACCORDER_PROJET (1 à 5) | `espace/projets.ts › accorderProjets` | R | E6, C22 |
| VALIDER_PROJET, DEVALIDER_PROJET | `gesteDeLucas` | R | DP37, DP38 |
| VALIDER_SIMULATION (simulation_id), DEVALIDER_SIMULATION | `gesteDeLucas` | R | DP42, DP43 |
| RETIRER_DEMANDE | `gesteDeLucas` | R | DP41 |
| REINITIALISER (PROJET, SIMULATIONS, DEVIS) | `gesteDeLucas` | S (efface la saisie du client) | DP40, DP47 |
| RETIRER_ACCORD (motif) | `espace/validations.ts › retirerAccord` (ex-`retirer_accord`) | S | — |
| MARQUER_LUS | `espace/messages.ts › marquerMessagesLus` (ex-`marquer_messages_lus`) | R | — |

### 4.12 `doublon`, `anonymiser_client`, `publier`

- **`doublon`** `{ nature, action, id }` :
  - LEAD FUSIONNER : `prospects/doublons.ts › fusionnerDoublon`. S.
  - LEAD ECARTER : `prospects/doublons.ts › ecarterDoublon`. R.
  - CLIENT CHERCHER : `clients/doublons.ts › proposerFusions`. R, ne fait que proposer.
  - CLIENT FUSIONNER {proposition_id, conserver: A ou B} : `validation/service.ts › validerProposition` →
    `clients/fusion.ts › fusionnerClients`. S.
  - CLIENT ECARTER {motif PERSONNES_DIFFERENTES ou MEME_FOYER} : `validation/service.ts › rejeterProposition`. R.
  - Ferme LF2, LF3, C4, V9, V10.
- **`anonymiser_client`** `{ client, motif (DEMANDE_PERSONNE, DUREE_ECOULEE, AUTRE), commentaire }`. SENSIBLE,
  toujours. L'aperçu vient de `rgpd/anonymisation.ts › apercuAnonymisation` (effacé, gardé, bloquants) ; l'exécution
  est `rgpd/conservation.ts › anonymiserClient`. Ferme C14. Outil distinct, pour laisser `supprimer` tel quel.
- **`publier`** `{ entite, action, id(s) }` :
  - SIMULATION PUBLIER : `simulations/dossier.ts › publierSimulations`. S-client. Il ne republie plus une simulation
    masquée sans le dire.
  - SIMULATION RETIRER : `changerStatutSimulation(…, "masquer")`. R. C'est l'ex-`masquer_simulation`.
  - PUBLICATION PUBLIER : `site/publications.ts › publierPublication`. S-client : il refuse sans accord écrit.
  - PUBLICATION RETIRER : `retirerPublication`. R.
  - Ferme W5, W6.

### 4.13 `agir_systeme` : les gestes techniques

`{ action, … }`. Niveau R, sensible par action.

| Action | Fonction de service | Niveau | Ferme |
|---|---|---|---|
| DETECTER_TACHES | `a-faire/detection.ts › passeComplete` | R | T3 |
| RELANCER_TACHE (id) | `taches/file.ts › relancerTache` | R | B2 |
| ANNULER_TACHE (id) | `taches/file.ts › annulerTache` | S (un envoi peut ne jamais partir) | B3 |
| CORRIGER_INCOHERENCE (cle) | `coherence/controle.ts › corrigerIncoherence` (aperçu = la correction) | S si la correction touche une étape ou un montant | T18, B5 |
| RELANCER_SYNCHRO (META, GOOGLE_ADS, SEARCH_CONSOLE, FICHE_GOOGLE) | `analytique/synchro.ts › relancerSynchro` | R | A10 |
| SYNCHRONISER_DRIVE, VERIFIER_DRIVE | `drive/synchronisation.ts › demanderSynchronisation(verifier)` | R | PA8, PA9 |
| RELEVER_MAILS | `messages/taches.ts › demanderReleve` | R | PA10 |
| ESSAI_META (notifier) | `meta/essai.ts › lancerEssaiMeta` | R (crée un contact ESSAI) | A15, A16 |
| TESTER_NOTIFICATION (canal : alertes ou appareil) | `alertes/canaux.ts › alerter` ; `alertes/pushweb.ts › envoyerPushWeb` | R | A17, L28 |
| REJOUER_META (leadgen_id, ou tous) | `meta/leads.ts › rejouerLeadMeta` | R ; S pour « tous » (des SMS d'accusé peuvent partir) | A18, A19 |
| LANCER_BANC (cas, variante) | `simulateur/banc/banc.ts › lancerBanc` (aperçu = `estimerCampagne`) | S-€ | S16 |
| REVOQUER_ACCES (application, jeton, tout) | `oauth/serveur.ts › revoquerClient` / `revoquerJeton` / `revoquerTout` | S-sécu (« tout » coupe aussi la session qui l'appelle : l'aperçu le dit) | PC3–PC5 |
| DECONNECTER_GOOGLE | `google/connexion.ts › deconnecterGoogle` | S-sécu | PA6 |

### 4.14 Fusions et retraits : correspondance ancien → nouveau

| Outil actuel (retiré) | Remplacé par |
|---|---|
| leads_a_appeler | `lister` LEADS (vue A_APPELER, maintenant paginée) |
| leads_a_rappeler | `lister` LEADS (vue A_RAPPELER) |
| dossiers_par_etape | `lister` DOSSIERS (etape) |
| espaces_clients | `lister` ESPACES |
| mails_a_traiter | `lister` MAILS |
| mails_non_classes | `lister` MAILS (vue NON_CLASSES) |
| messages_espace | `lister` MESSAGES_ESPACE |
| voir_relances | `lister` RELANCES |
| depenses | `lister` DEPENSES |
| tarifs | `lister` TARIFS |
| ce_qui_m_attend | `taches` (vue TOUT) |
| synthese | `analytique` (+ manager_*) |
| campagne | `analytique` (onglet publicite) |
| sante_systeme | `etat_crm` SANTE |
| voir_parametres | `etat_crm` PARAMETRES / NUMEROTATION / SMS |
| versions_consignes | `etat_crm` CONSIGNES |
| lister_outils | `etat_crm` OUTILS |
| voir_publicite | `etat_crm` META (chaîne) + `analytique` (chiffres) |
| voir_photos | `voir_fichiers` PHOTOS |
| voir_simulations | `voir_fichiers` SIMULATIONS |
| simulations_site | `voir_fichiers` SIMULATIONS_SITE |
| modifier_dossier | `modifier` DOSSIER |
| changer_teinte | `modifier` DOSSIER (teinte {meuble, teinte}) |
| presenter_devis | `modifier` DOCUMENT |
| modifier_tarifs | `modifier` SOUS_PARTIE |
| modifier_parametres | `modifier` PARAMETRE / COMPTEUR / AUTOMATISME / MODELE_SMS |
| modifier_consignes | `modifier` CONSIGNES / POSITIONNEMENT |
| restaurer_consignes | `restaurer` CONSIGNES / POSITIONNEMENT (numero) |
| creer_contact | `creer` LEAD |
| ouvrir_dossier | `creer` DOSSIER (lead_id) |
| ajouter_note | `creer` NOTE |
| rattacher_depense | `creer` DEPENSE (création) / `modifier` DEPENSE (rattachement) |
| ajouter_tache | `creer` TACHE |
| proposer_regle | `creer` REGLE_EXPEDITEUR (pose directe, sous confirmation) |
| deposer_document | `ajouter_fichier` (DOSSIER › DEVIS, FACTURE, AUTRE) |
| publier_simulation | `publier` SIMULATION PUBLIER |
| masquer_simulation | `publier` SIMULATION RETIRER |
| ranger_mail | `traiter_mail` RANGER / DERANGER |
| snoozer_mail | `traiter_mail` SNOOZER |
| rattacher_mail | `traiter_mail` RATTACHER |
| renouveler_lien | `geste_espace` NOUVEAU_LIEN |
| accorder_simulations | `geste_espace` ACCORDER_SIMULATIONS |
| marquer_messages_lus | `geste_espace` MARQUER_LUS |
| retirer_accord | `geste_espace` RETIRER_ACCORD |
| annuler_relance | `ignorer_proposition` |

**Conséquences à traiter dans le même lot :**

- **Consignes.** Les consignes par défaut (`assistant/consignes.ts`) et la version en service en base citent des
  outils retirés, par exemple `voir_relances`, `voir_parametres`, `ce_qui_m_attend`, `modifier_parametres`,
  `rattacher_depense`, `ranger_mail`, `snoozer_mail`. Il faut une nouvelle version, par `modifier` CONSIGNES, avec la
  table ci-dessus.
- **Descriptions.** Les descriptions des outils gardés qui citent un nom retiré sont à corriger (`noter_appel`,
  `archiver`, `point_du_jour`…).
- **Tests.** `assistant.test.ts` et le test SDK qui compare `tools/list` au registre sont à mettre à jour.
- **Connecteur.** L'empreinte change : Lucas devra reconnecter le connecteur de l'application Claude, comme l'explique
  déjà la description de `lister_outils`.

### 4.15 Compte final

- Aujourd'hui : **84** outils.
- Retirés par fusion : **45**, dont 21 de lecture et 24 d'écriture (table 4.14).
- Ajoutés : **14** : lister, etat_crm, voir_fichiers, creer, modifier, ajouter_fichier, ranger_fichier, lien_depot,
  publier, traiter_mail, geste_espace, doublon, anonymiser_client, agir_systeme.
- **Total : 84 − 45 + 14 = 53 outils**, sous la limite de 100. Il reste 46 places pour les écrans à venir, dont la
  mission 18.
- Les 53 :
  - **Lecture (16)** : chercher, lire_fiche, lister, voir_fichiers, etat_crm, taches, analytique, point_du_jour,
    manager_commercial, manager_finances, manager_marketing, manager_clients, manager_operations, lire_mail,
    rechercher_mails, rediger_mail.
  - **Écriture (37)** : creer, modifier, annuler_modification, archiver, restaurer, supprimer, anonymiser_client,
    ajouter_fichier, ranger_fichier, lien_depot, changer_etape, noter_appel, noter_sms, planifier, generer_document,
    envoyer_document, annuler_document, relancer, saisir_encaissement, annuler_encaissement, publier,
    preparer_simulation, geste_espace, lien_espace, envoyer_lien_espace, repondre_espace, traiter_mail,
    classer_mail, resumer_fil, proposer_mise_a_jour, valider_proposition, ignorer_proposition, deposer_brouillon,
    envoyer_mail, repondre_tache, doublon, agir_systeme.
- Une fois cet outillage en place, chaque ligne `manquant` ou `partiel` des tableaux de la section 2 renvoie à un cas
  des sections 4.3 à 4.13. **Zéro action manquante** ; restent les seuls gestes `sans objet`.

### 4.16 Ordre de réalisation proposé

1. **Argent et étapes** : `changer_etape` avec paiement, `saisir_encaissement` complet, `modifier` ENCAISSEMENT,
   `annuler_encaissement` REJETER.
2. **Socle générique** : `entites.ts`, `modifier` et `creer` (LEAD, DOSSIER, CLIENT, DEPENSE d'abord), trace
   généralisée, `lister`, archivés visibles.
3. **Fichiers** : `lireSource` commun, `ajouter_fichier`, `voir_fichiers`, `ranger_fichier`, puis `lien_depot` (page
   et route publiques).
4. **Espace, mail, validation** : `geste_espace`, `traiter_mail`, `valider_proposition` (sensibilité, corrections,
   lot).
5. **Configuration et système** : `etat_crm`, `agir_systeme`, modèles de mail, guide, prompts, tarifs, `publier`,
   Site.
6. **Retraits**, nouvelle version des consignes, tests, ce document (statuts et nouvelle empreinte).
