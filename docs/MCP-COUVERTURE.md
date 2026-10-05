# Couverture MCP — tout ce que l'interface du CRM sait faire, le MCP doit savoir le faire aussi

## 1. En-tête

- **Objet** : audit de couverture de la mission 17, partie C. Pour chaque écran du CRM, chaque bouton, formulaire,
  réglage ou geste est rapproché de l'outil MCP qui fait la même chose, **paramètres compris**. Le document donne
  ensuite la liste des manques et l'outillage qui les ferme tous.
- **Date** : 30/09/2026. Code audité : branche de la mission 17, commit `62e73bc` (fin de la partie B : `/taches`,
  `/taches-de-fond`, `/analytique` ; `/publicite` et `/synthese` redirigés ; `/finances` allégé ; blocs retirés de
  Leads (entonnoir), Clients (« D'où viennent les clients ») et Dépenses (tuiles par catégorie)).
- **Catalogue audité** : **84 outils**, empreinte du registre **`3db5c223f5bb`** (avant la partie C). Au début de la
  mission 17, le catalogue comptait **80 outils**, empreinte **`ef81342ae27b`**. Valeurs relevées par
  `registreOutils()` (`src/lib/assistant/couverture.ts`) avec un petit script `tsx`. C'est la même empreinte que celle
  de `/api/health` et de `etat_crm` OUTILS.
- **Après la partie C (01/10/2026)** : **53 outils**, empreinte **`040d6c7aa53c`** (16 de lecture, 27 d'écriture
  réversible, 10 sensibles). Les 45 outils retirés et leur remplaçant sont dans `src/lib/assistant/retraits.ts`
  (`OUTILS_RETIRES`) ; le catalogue refuse de démarrer s'il en expose un. **Toutes les lignes des tableaux de la
  section 2 sont couvertes** (0 partielle, 0 manquante), hors gestes `sans objet`. Chaque ligne cite le test qui la
  vérifie (colonne **Test** : fichier › nom du test).
- **Règle** : **zéro action manquante**. Toute action de l'interface a son outil MCP, avec les mêmes paramètres, la
  même fonction de service et la même sensibilité. Les seules exceptions sont les gestes « sans objet » listés comme
  tels : appel téléphonique `tel:`, presse-papiers, tri local, consentement OAuth dans le navigateur, abonnement push de
  l'appareil, file hors ligne.
- **Maintenance** : ce document se met à jour **à chaque changement d'écran ou d'outil**, dans le même commit. On
  ajoute ou corrige la ligne de l'écran et l'outil qui la couvre, puis on relève la nouvelle empreinte. La mission 18
  (retrait de l'onglet Espaces, Dépenses dans Finances, Tâches de fond et Tarifs dans Paramètres) devra mettre ces
  tableaux à jour, comme le prévoit `docs/MISSION-18.md`.
- **Mission 18, A1 (03/10/2026)** : l'onglet Espaces clients est retiré (`/espaces` redirige vers
  `/dossiers?espace=TOUS`). Ses lignes de liste E1–E4 sont en 2.3 (colonne et filtre « Espaces » de Dossiers) ; ses
  gestes E5–E20 n'existent plus que dans le bloc Espace du panneau et dans la fiche client (2.5 dit où) ; les boutons
  du lien de la fiche client deviennent C27–C30. `lister` gagne le filtre imbriqué `filtres.espace` (DOSSIERS) : les
  paramètres de premier niveau ne changent pas, l'empreinte reste **`040d6c7aa53c`** (53 outils). Des descriptions
  changent (`lister`, `geste_espace`) : reconnecter le connecteur.
- **Mission 18, A2 (03/10/2026)** : le dossier s'ouvre tout seul dès qu'un contact envoie des photos, fait une
  simulation ou demande un devis sur le site (webhook, fin d'une simulation du site, filet de 15 min :
  `dossiers/depuis-lead.ts › ouvrirDossierAutomatique`). Ce n'est pas un geste de l'interface : aucune ligne nouvelle.
  « Ouvrir un dossier » (L12, LF4) et `creer DOSSIER (lead_id)` ne servent plus qu'à un lead qualifié au téléphone ;
  la description de `creer` le dit. Paramètres inchangés, empreinte **`040d6c7aa53c`** (53 outils) : reconnecter le
  connecteur pour la nouvelle description.
- **Mission 18, A3 (03/10/2026)** : l'écran Dépenses devient la section « Dépenses » de Finances
  (`/finances?section=depenses`, où `/depenses` redirige) ; la saisie `/depenses/nouvelle` reste un écran (raccourci de
  l'application installée, file hors ligne) et le panneau du dossier garde ses dépenses (DP91, DP92). Les lignes X1–X10
  passent en 2.10 ; les liens des outils (`lister` DEPENSES, `creer` / `modifier` / `archiver` DEPENSE,
  `ajouter_fichier` sur une dépense) mènent à la section. Ni outil ni paramètre ne change : empreinte
  **`040d6c7aa53c`** (53 outils), rien à reconnecter pour ce lot.
- **Mission 18, A4 (03/10/2026)** : un seul système de relance. Les séquences de mails sont retirées (code,
  interrupteurs `SEQUENCE_*`, travail `sequences-mail`, paramètre `MAIL_EXPEDITEUR` ; lignes gardées en base) : la
  ligne AUTOMATISME de 4.3 ne les cite plus. La demande d'avis après chantier et la réactivation à 6 mois deviennent
  des types de relance : mêmes écrans (feuille Relances avec une section par type, fiche du dossier pour l'avis,
  tâches RELANCER_AVIS et REACTIVER), mêmes outils (`lister` RELANCES les rend, `noter_sms` DEMANDE_AVIS ou
  REACTIVATION les compte) : L21, L22, DP7, PA2 et 4.6 sont mis à jour, sans ligne nouvelle (bilan inchangé). Ni outil
  ni paramètre ne change : empreinte **`040d6c7aa53c`** (53 outils). Des descriptions changent (`lister`, `noter_sms`,
  `voir_parametres` via `etat_crm`, `manager_operations`) : reconnecter le connecteur.
- **Mission 18, A5 (03/10/2026)** : l'écran Tâches de fond devient l'onglet « Système » de Paramètres
  (`/parametres?section=systeme`, où `/taches-de-fond` redirige), lu à l'ouverture de l'onglet par les routes de ses
  blocs. Les lignes B1–B7 passent en 2.13 (sous « Système ») ; les liens des outils (`etat_crm` vue générale, SANTE,
  TACHES_DE_FOND, COHERENCE, AUDIT, SESSIONS ; `agir_systeme` ; `manager_operations`), des alertes et de la tâche
  « Relancer N tâches de fond en échec » mènent à l'onglet. Un seul compteur dans la barre (N2) : le badge des tâches
  de fond en échec disparaît, l'échec remonte comme tâche système dans Tâches. Ni outil, ni paramètre, ni description
  ne change : empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter pour ce lot.
- **Mission 18, A6 (03/10/2026)** : les tarifs des devis (presets, tarif de chaque prestation) ne sont plus un
  sous-mode du générateur de Dossiers mais l'onglet « Tarifs » de Paramètres (`/parametres?section=tarifs`) : DP64 et
  DP70–DP73 passent en 2.13 › Tarifs. Les liens de `lister` TARIFS, de l'outil des tarifs et des entités TARIF et
  SOUS_PARTIE (`creer`, `modifier`, `archiver`) mènent à l'onglet. Navigation à 10 onglets (N1), anciennes adresses
  vérifiées (N3). Ni outil, ni paramètre, ni description ne change : empreinte **`040d6c7aa53c`** (53 outils), rien à
  reconnecter pour ce lot.
- **Mission 18, B1 (03/10/2026)** : générer un devis n'est pas l'envoyer. `generer_document` (DP68) passe par la même
  fonction que l'écran (`documents.ts › emettre`) : le devis n'est « envoyé » (étape, main au client, relances) que s'il
  est annoncé par le mail « Devis disponible » (adresse valide, espace ouvert) ou, interrupteur du modèle coupé, mis en
  ligne dans un espace ouvert ; sinon il reste masqué en Qualification ou Simulation et la tâche `ENVOYER_DEVIS`
  (« Envoyer le devis · X ») le rappelle. L'aperçu de l'outil dit d'avance ce qui se passera, le résultat aussi
  (`donnees.envoye`, `donnees.visibleEspace`). Nouveau type de tâche `ENVOYER_DEVIS` (`taches` le rend comme les
  autres). Pas de ligne nouvelle : les gestes « Envoyer par mail » (DP60, `envoyer_document`) et « visible dans
  l'espace » (DP48, `modifier` DOCUMENT visible_espace) existent déjà. Ni outil ni paramètre ne change : empreinte
  **`040d6c7aa53c`** (53 outils). Des descriptions changent (`generer_document`, son paramètre `notifier`) :
  reconnecter le connecteur.
- **Mission 18, B2 (05/10/2026)** : devis envoyé par mail. `envoyer_document` (DP60) appelle le même service que le
  bouton « Envoyer par mail » (`mail/service.ts › envoyerDocumentParMail`) et ne revalide plus la proposition (défaut 11
  de la section 3 corrigé : plus de 409, plus de second mail à la nouvelle tentative). Le même envoi refait (même
  document, destinataire, objet, texte) dans la demi-heure est sans effet : le résultat le dit (`donnees.deja`,
  `donnees.statut`). Un devis envoyé ainsi a les effets d'un devis rendu visible : visible dans l'espace, « Devis
  envoyé », main au client, « Attendre l'accord », relances datées de l'envoi. Ni outil ni paramètre ne change :
  empreinte **`040d6c7aa53c`** (53 outils). La description de `envoyer_document` change : reconnecter le connecteur.
- **Mission 18, B3 (05/10/2026)** : devis envoyé depuis Gmail. Les PDF d'un mail parti de la boîte chez un client sont
  gardés dans le CRM ; la tâche `ENREGISTRER_DEVIS` (« Enregistrer comme devis envoyé · X », `taches` la rend comme les
  autres) ouvre la modale de dépôt préremplie (DP98). `ajouter_fichier` (DOSSIER › DEVIS, numero, montant, source
  `piece_mail`) passe par la même fonction que la modale (`depot-document.ts › deposerDocument` →
  `devis-gmail.ts › enregistrerDevisGmail`) : devis déposé avec le PDF du mail, « Devis envoyé » daté du mail
  (relances depuis le mail), étape, main, « Attendre l'accord » ; un devis du CRM de ce numéro passe « Envoyé » ;
  rejoué, sans effet. Claude peut lire la pièce avant (`voir_fichiers` piece_mail). Ni outil ni paramètre ne change :
  empreinte **`040d6c7aa53c`** (53 outils). La description de `ajouter_fichier` change : reconnecter le connecteur.
- **Mission 18, B4 (05/10/2026)** : dépôt d'un bloc. `ajouter_fichier` (DOSSIER › DEVIS, FACTURE) et la modale
  « Enregistrer un document existant » (DP57, le PDF part désormais dans la même requête) passent par la même fonction
  (`depot-document.ts › deposerDocument` → `documents-existants.ts › enregistrerDocumentExistant`) : PDF vérifié avant
  toute écriture (un faux PDF ne consomme aucun numéro, l'étape ne bouge pas, on peut réessayer), puis document, PDF et
  étape dans une transaction. Un devis déposé `statut: ACCEPTE` (signé hors ligne) sur un dossier pas encore signé le
  fait passer en « Signé » dans la même transaction, les autres devis proposés « non retenus », prochaine action d'un
  accord ; même règle pour `modifier` DOCUMENT `statut: ACCEPTE` (DP59, `modifierDocumentExistant`) et pour la
  correction de cohérence `DEVIS_ACCEPTE_AVANT_SIGNE` (`agir_systeme`, qui signe au lieu de remettre le devis
  « émis »). L'aperçu de `ajouter_fichier` et la note de `modifier` le disent d'avance. Ni outil ni paramètre ne change :
  empreinte **`040d6c7aa53c`** (53 outils). La description du paramètre `statut` de `ajouter_fichier` change :
  reconnecter le connecteur.
- **Mission 18, B5 (05/10/2026)** : devis rendu visible = mis en ligne. `modifier` DOCUMENT `visible_espace: true`
  (DP48) passe par la même fonction que l'interrupteur du bloc Espace (`presentation-devis.ts ›
  modifierPresentationDevis` → `devis-envoye.ts › mettreEnLigneDevis`) : visibilité, événement « Devis envoyé »
  (`canal: "ESPACE"`, il date la relance), étape, prochaine action et main dans une transaction ; puis le mail
  « Devis disponible » de l'automatisme existant (une fois par devis, interrupteur gardé ; pas pour un devis repris ni
  déjà envoyé par mail). La note de l'aperçu dit d'avance si le mail partira (`peutNotifier`), le résultat s'il est parti
  ou pourquoi pas. Même mise en ligne, sans mail, pour un devis repris corrigé visible (DP59). `lister` RELANCES dit
  « envoyé il y a N jours » depuis le dernier envoi (mail, Gmail, mise en ligne), plus depuis l'émission (champs
  `envoyeLe`, `joursDepuisEnvoi`). Ni outil, ni paramètre, ni description ne change : empreinte **`040d6c7aa53c`**
  (53 outils), rien à reconnecter pour ce lot.
- **Mission 18, B6 (05/10/2026)** : devis annulé ou masqué sans autre devis en attente. `annuler_document` (DP63) et
  `modifier` DOCUMENT `visible_espace: false` (DP48) passent par les mêmes fonctions que l'écran (`annulerDevis`,
  `modifierPresentationDevis` → `devis-retire.ts › retirerDevis`) : dans la même transaction, retour du dossier avant
  « Devis envoyé » (Simulation ou Qualification), main à Lucas (« Devis N annulé : refaire le devis »), prochaine action
  « Refaire le devis » (une action posée à la main reste, avec la tâche), mails de relance en attente annulés, lead
  CONTACTE. L'aperçu de `annuler_document` dit d'avance si c'est le seul devis en attente, le résultat dit le retour ;
  la note de `modifier` DOCUMENT le dit au masquage, et l'annulation partielle de « rendre visible » ne dit plus que
  l'étape reste. Même retour pour un devis repris corrigé masqué (DP59, `modifierDocumentExistant`). Ni outil, ni
  paramètre, ni description ne change : empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter pour ce lot.
- **Mission 18, relecture de B0 à B6 (05/10/2026)** : `modifier` DOCUMENT `visible_espace: true` (DP48) suit la règle
  unique de l'envoi (`devis-envoye.ts › annonceAboutit`, celle de `generer_document`) : un devis du CRM jamais parti,
  sans espace ouvert ou sans adresse (modèle actif), devient visible SANS être envoyé — la note de l'aperçu et le
  résultat le disent (`nonEnvoye`), la tâche « Envoyer le devis » reste (`envoyer_document` pour l'envoyer par mail).
  `generer_document` : une variante silencieuse (`notifier: false`) après Simulation est visible mais pas envoyée (le
  résultat le disait déjà : « visible dans son espace sans annonce : PAS encore envoyé »). `lister` RELANCES et
  `relancer` (mail, SMS) ne visent plus un devis pas encore envoyé. `ajouter_fichier` (DP98) : la pièce d'un mail parti
  de Gmail avec son `numero`, sans `montant`, s'enregistre comme devis envoyé quand c'est un devis du CRM (comme
  l'écran), sous confirmation. `manager_operations` : `joursDepuis` d'un devis à relancer compté depuis l'envoi
  (`envoyeLe` ajouté). Un devis déposé « accepté » sur un dossier en pause d'avant la signature le signe (aperçu de
  `ajouter_fichier` compris). Ni outil, ni paramètre, ni description ne change : empreinte **`040d6c7aa53c`**
  (53 outils), rien à reconnecter.
- **Mission 18, B7 (05/10/2026)** : avenant ou nouveau devis sur un dossier signé. L'espace du client le propose et le
  fait signer (`EtatEspace.devisASigner`, `prochainPas`, calculés par le CRM) à côté du devis d'origine, sans changer
  l'étape ; « le devis » de l'espace reste le devis signé d'origine (acompte, paiement). `geste_espace` RETIRER_ACCORD
  (DP50, `vue-crm.ts › gesteDeLucas` → `retirerAccord`, comme l'écran) retire l'accord du devis signé d'origine (le plus
  ancien en cours ; avant : le plus récent, le même tant qu'il n'y avait qu'un accord) ; l'accord d'un avenant se retire
  depuis l'espace du client (le site nomme le devis) sans recul d'étape. `etat_crm` COHERENCE : `AVENANT_NON_PROPOSE` ne
  vise plus qu'un avenant visible dont l'espace n'est pas ouvert. Ni outil, ni paramètre, ni description ne change :
  empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter.
- **Mission 18, B8 (05/10/2026)** : signature en une transaction. Le bon pour accord est un geste du client dans son
  espace (`accepterDevis`) : pas d'outil. Ce qui change pour l'assistant : un accord ne laisse plus de dossier en
  attente de « Signé » (`etat_crm` COHERENCE ne verra plus naître d'`ACCORD_SANS_SIGNATURE` par ce chemin ; ceux
  d'avant se corrigent toujours par `agir_systeme`, ou par la nouvelle tentative du client), et l'historique du
  passage (`lire_fiche`) dit « bon pour accord donné dans l'espace client sur le devis N ». Ni outil, ni paramètre,
  ni description ne change : empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter.
- **Mission 18, B10 (05/10/2026)** : paiement par carte et variantes retenues. `saisir_encaissement` (DP9, DP75, F4,
  T11) passe toujours par `enregistrerEncaissement`, désormais par le point d'entrée (`PAIEMENT_RECU`) : un acompte sur
  un devis encore envoyé signe le dossier sur le devis qu'il règle (la pièce choisie, ou celle de l'imputation), les
  autres variantes passent « non retenu », prochaine action « Appeler le client : fixer la date du chantier (acompte
  reçu) » (une action posée à la main reste, avec la tâche), statut du lead et main dans la même transaction ;
  l'imputation automatique ne vise plus un devis non retenu, remplacé ou annulé. `changer_etape` vers « Signé » (DP
  du changement d'étape, même fonction que l'écran) passe aussi les autres variantes « non retenu » ; la correction de
  cohérence `PAIEMENT_AVANT_SIGNATURE` / `ACCORD_SANS_SIGNATURE` (`agir_systeme`) signe sur le devis réglé ou accordé.
  Le paiement par carte lui-même est un geste du client dans son espace (Stripe, webhook) : pas d'outil, l'encaissement
  qu'il crée se lit comme les autres (`lire_fiche`, `manager_finances`). Ni outil, ni paramètre, ni description ne
  change : empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter.
- **Mission 18, B11 (05/10/2026)** : états en double. `manager_commercial` (devis en attente, « relus sans signature »)
  lit les lectures de CHAQUE devis (`Document.consultations`), plus la copie de l'espace (seul le dernier devis lu y
  comptait). `geste_espace` REINITIALISER DEVIS (même fonction que l'écran, `vue-crm.ts › gesteDeLucas`) remet aussi à
  zéro le compteur des devis du dossier (avant : celui de l'espace seulement, « lu N fois » et le signal restaient).
  `geste_espace` VALIDER_SIMULATION (`choisir`, comme le client) reporte les teintes de la simulation dans les teintes
  du dossier (`modifier` DOSSIER `teintes`, `lire_fiche`). Ni outil, ni paramètre, ni description ne change :
  empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter.
- **Mission 18, B13 (05/10/2026)** : cohérence. `etat_crm` COHERENCE montre les nouveaux codes (écarts 1, 3, 5, 6, 7 ;
  « Attendre l'accord » sans devis ; date du chantier posée en « Signé » ; `ESPACE_ACTIF_DOSSIER_CLOS`, qui remplace
  `ESPACE_ACTIF_DOSSIER_ARCHIVE` et voit aussi les dossiers perdus). `agir_systeme` CORRIGER_INCOHERENCE passe par la
  même fonction que le bouton « Corriger » (`corrigerIncoherence` → `appliquerCorrection`) ; sa sensibilité vient de
  `coherence/controle.ts › CORRECTIONS_SENSIBLES` (une seule liste : toute correction qui change l'étape — liste figée
  par un essai, `PROJET_VALIDE_INCOMPLET` compris —, touche un devis ou envoie un mail au client : « Devis disponible »
  d'un devis jamais annoncé, avenant envoyé par mail). Chaque correction laisse `COHERENCE_CORRIGEE` dans l'historique
  (`lire_fiche`). Ni outil ni paramètre ne change : empreinte **`040d6c7aa53c`** (53 outils) ; la description de
  `agir_systeme` change (« … ou envoie un mail au client ») : reconnecter le connecteur.
- **Mission 18, mise en route (05/10/2026)** : `etat_crm` SANTE ajoute une ligne
  « Dernières migrations » : les trois dernières migrations de données du démarrage, et pour `mise-en-route-18` le
  compte par règle (écarts trouvés, réparés, en tâche à moi, au détecteur) ; `donnees.dernieresMigrations`. Les tâches à
  moi du lot « coherence-18 » se lisent et se répondent comme les autres (`taches`). Ni outil, ni paramètre, ni
  description ne change : empreinte **`040d6c7aa53c`** (53 outils), rien à reconnecter pour ce lot.
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
- **Statut** (après la partie C ; les statuts de l'audit sont résumés en 2.17) :
  - `couvert` : l'outil fait la même chose, avec les mêmes paramètres.
  - `partiel : …` : l'outil existe, mais il manque ce qui est dit.
  - `manquant` : aucun outil ne le fait.
  - `sans objet` : geste qu'un assistant ne fait pas (voir la règle ci-dessus).
- **Test** : le test qui vérifie la ligne, en général en rejouant le geste de l'écran (sa route) sur un jumeau et en
  comparant l'état en base. Toute action sensible est en plus vérifiée par
  `src/lib/mcp/mcp-sensibles.test.ts` : aperçu, jeton, et **aucune écriture métier** tant que le jeton n'est pas
  rendu (journal des modifications vide hors tables mécaniques).

## 2. Inventaire par écran

Chaque ligne porte un repère (T1, L3…), repris dans les sections 3 et 4.

### 2.1 Tâches (`/taches`, partie A)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| T1 | Liste « Aujourd'hui » : les 10 du jour, titre, raison, durée, geste prêt, compteurs, minutes du jour | GET /api/a-faire | L | taches (AUJOURDHUI) | couvert | `mcp-taches.test.ts` › « aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant… » |
| T2 | Relecture automatique (20 s, retour sur l'onglet, après un geste) | GET /api/a-faire | L | taches | couvert | `mcp-taches.test.ts` › « aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant… » |
| T3 | « Actualiser » : une passe de tous les détecteurs, avec les tâches nouvelles et celles cochées par le CRM | POST /api/a-faire/detecter | R | agir_systeme (DETECTER_TACHES) | couvert | `mcp-gestes.test.ts` › « RELANCER_SYNCHRO met en file comme « Relancer » de l'Analytique… » |
| T4 | « J'ai N minutes » : le plan regroupé (« 3 appels · 10 min ») | GET /api/a-faire/minutes?m= | L | taches (MINUTES, minutes) | couvert | `mcp-taches.test.ts` › « « j'ai 15 minutes » : le plan du moteur, regroupé (« 2 appels · 6 min… » |
| T5 | « Commencer » / lancer un groupe du plan : série plein écran, Passer, Quitter | — | — | taches (l'ordre suffit) | sans objet | — |
| T6 | Bouton principal APPEL (`tel:`, puis fin d'appel) | tel: ; POST /api/commercial/appels | R | taches (numéro) + noter_appel | couvert | `mcp-taches.test.ts` › « aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant… » ; `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| T7 | Bouton principal SMS : écran SMS, texte prêt, « Copier » | POST /api/sms/copie | S-client | taches (texte prêt) + noter_sms | couvert | `mcp-taches.test.ts` › « aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant… » ; `mission-14-partie-8.test.ts` › « texte seul : noté en texte libre ; ni code ni texte : refusé par le… » |
| T8 | Bouton principal MAIL : panneau du fil ouvert sur « Répondre » | GET /api/mail/:id ; POST /api/mail/envoyer | S-client | lire_mail + deposer_brouillon / envoyer_mail | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| T9 | Bouton principal ESPACE : fil des messages de l'espace, réponse | POST /api/dossiers/:id/espace {geste:repondre} | S-client | repondre_espace | couvert | `mcp-v2.test.ts` › « « lister » MESSAGES_ESPACE (ex-« messages_espace ») puis «… » ; `mcp-sensibles.test.ts` › « repondre_espace — répondre dans l'espace : aperçu et jeton, aucune écriture » |
| T10 | Bouton principal DEVIS : générateur prérempli d'après l'espace, ou dépôt d'un PDF | GET /api/dossiers/:id/devis-propose ; POST …/documents | S | generer_document (depuis_espace) / ajouter_fichier (DOSSIER › DEVIS) | couvert | `mcp-partie-c.test.ts` › « une ligne de section se dicte ; le devis prérempli montre ses lignes… » ; `mcp-fichiers.test.ts` › « devis visible : aperçu + jeton (étape annoncée), puis document repris… » |
| T11 | Bouton principal ENCAISSER | POST /api/dossiers/:id/encaissements | S-€ | saisir_encaissement (piece, payeur, credite_le) | couvert | `mcp-partie-c.test.ts` › « saisir_encaissement : pièce réglée, payeur, chèque crédité ; une… » |
| T12 | PLANIFIER : les jours libres des 10 prochains jours ouvrés (agenda Google) | GET /api/a-faire/creneaux?dossierId= | L | lister CRENEAUX (dossier) | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| T13 | PLANIFIER : poser la date du chantier | PATCH /api/dossiers/:id {dateChantier} | R | modifier DOSSIER (date_chantier) | couvert | `mcp-v2.test.ts` › « « Décale la pose de Rousse au 12 octobre » : aperçu, confirmation… » |
| T14 | Bouton principal SIMULATEUR | nav /simulateur | R | preparer_simulation | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| T15 | RELANCE_MAIL : relire, corriger, valider le mail de relance | POST /api/validation/:id/valider {corrections} | S-client | valider_proposition (corrections : objet, texte) / relancer | couvert | `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » ; `mcp-v3.test.ts` › « « lister » RELANCES / « relancer » / « ignorer_proposition » (ex-«… » |
| T16 | « Valider » dans la ligne (proposition non sensible) | POST /api/a-faire/:id/reponse {FAIT} | R | repondre_tache (FAIT) | couvert | `mcp-taches.test.ts` › « réponse sensible : « Fait » sur une validation qui envoie un mail →… » |
| T17 | « Relire et valider » (proposition sensible → `/validation?proposition=`) | GET/POST /api/validation | S | repondre_tache (aperçu) / valider_proposition (sensibilité du type) | couvert | `mcp-taches.test.ts` › « réponse sensible : « Fait » sur une validation qui envoie un mail →… » ; `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » |
| T18 | COHERENCE : « Corriger » | POST /api/coherence/corriger {cle} | R / S | agir_systeme (CORRIGER_INCOHERENCE, cle) | couvert | `mcp-gestes.test.ts` › « RELANCER_SYNCHRO met en file comme « Relancer » de l'Analytique… » |
| T19 | Toucher la ligne : fiche du dossier ou du contact | GET /api/dossiers/:id, /api/prospects/entrants/:id | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| T20 | PAGE : lien vers un écran du CRM ou une page externe | — | — | — | sans objet | — |
| T21 | « Fait » (bouton, balayage à droite, mode Commencer) | POST /api/a-faire/:id/reponse {FAIT} | R (S si l'effet part chez le client ou touche l'argent) | repondre_tache (FAIT) | couvert | `mcp-taches.test.ts` › « FAIT par identifiant, puis ANNULER : l'effet (appel noté) est annulé… » |
| T22 | « Plus tard » : Ce soir / Demain / Lundi / Dans une semaine, raison facultative (dont « J'attends le client ») | … {PLUS_TARD, quand, raison} | R | repondre_tache (PLUS_TARD, quand, raison) | couvert | `mcp-taches.test.ts` › « PLUS_TARD DEMAIN (9 h, heure de Paris) ; PLUS_TARD « le 12 » (date… » |
| T23 | « Plus tard » › « Une date… » | … {PLUS_TARD, date} | R | repondre_tache (quand = date dictée) | couvert | `mcp-taches.test.ts` › « PLUS_TARD DEMAIN (9 h, heure de Paris) ; PLUS_TARD « le 12 » (date… » |
| T24 | « Pas à faire » : raison selon le type (déjà fait, le client le fait, pas pertinent, pas de réponse à faire…) | … {PAS_A_FAIRE, raison} | R | repondre_tache (PAS_A_FAIRE, raison) | couvert | `mcp-taches.test.ts` › « PAS_A_FAIRE exige une raison adaptée au type ; avec PAS_PERTINENT, la… » |
| T25 | « Pas à faire » › « Client perdu » : motif, précision si Autre | … {raison CLIENT_PERDU, motifPerte, precisionPerte} | S (perte) | repondre_tache (motif_perte, precision) | couvert | `mcp-taches.test.ts` › « réponse sensible : « client perdu » → aperçu (contact classé sans… » |
| T26 | « Pas à faire » › « Autre » : texte | … {raison AUTRE, texte} | R | repondre_tache (AUTRE, texte) | couvert | `mcp-taches.test.ts` › « PAS_A_FAIRE exige une raison adaptée au type ; avec PAS_PERTINENT, la… » |
| T27 | « Ignorer » dans la ligne (proposition) | … {PAS_A_FAIRE, PAS_PERTINENT} | R | repondre_tache | couvert | `mcp-taches.test.ts` › « PAS_A_FAIRE exige une raison adaptée au type ; avec PAS_PERTINENT, la… » |
| T28 | « Annuler » dans le message (5 s) | POST /api/a-faire/:id/annuler | R | repondre_tache (ANNULER) | couvert | `mcp-taches.test.ts` › « FAIT par identifiant, puis ANNULER : l'effet (appel noté) est annulé… » |
| T29 | Section « Plus tard » : les reportées et leur date de retour | GET /api/a-faire | L | taches (PLUS_TARD) | couvert | `mcp-taches.test.ts` › « taches TOUT lit la liste des tâches à l'instant du contexte (une tâche… » |
| T30 | Section « Fait aujourd'hui » | GET /api/a-faire | L | taches (FAIT) | couvert | `mcp-taches.test.ts` › « aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant… » |
| T31 | « Demain : N » (ce qui revient) | GET /api/a-faire | L | taches (demain) | couvert | `mcp-taches.test.ts` › « taches TOUT lit la liste des tâches à l'instant du contexte (une tâche… » |
| T32 | Lots de ménage : la liste | GET /api/a-faire | L | taches (LOTS) | couvert | `mcp-taches.test.ts` › « taches lot rend les tâches du lot une par une ; repondre_tache «… » |
| T33 | Lot › « Revoir un par un » : les tâches du lot | GET /api/a-faire/lots/:lot | L | taches (lot) | couvert | `mcp-taches.test.ts` › « taches lot rend les tâches du lot une par une ; repondre_tache «… » |
| T34 | Lot › « Tout classer » | POST /api/a-faire/lots/:lot/classer | R (masse) | repondre_tache (tache « lot:<clé> », FAIT) | couvert | `mcp-taches.test.ts` › « taches lot rend les tâches du lot une par une ; repondre_tache «… » |
| T35 | Lot › « Annuler » ce classement | POST /api/a-faire/lots/:lot/annuler {le} | R | repondre_tache (tache « lot:<clé> », ANNULER, le) | couvert | `mcp-taches.test.ts` › « taches lot rend les tâches du lot une par une ; repondre_tache «… » |
| T36 | Ajouter une tâche : titre, date facultative, « pour qui ? » (recherche dossier, lead, client) | POST /api/a-faire/ajouter | R | creer TACHE (titre, quand, cible, raison) | couvert | `mcp-taches.test.ts` › « creer TACHE avec une cible (nom) et une date dictée : une tâche… » |
| T37 | Mesure « commencer » (temps réel passé) | POST /api/a-faire/:id/commencer | — | — | sans objet | — |
| T38 | Hors ligne : liste servie depuis le cache | service worker | — | — | sans objet | — |

### 2.2 Leads (`/leads`)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| L1 | En-tête › « Nouveau » : prénom, nom, téléphone, e-mail, ville, code postal, source, projet, notes | POST /api/prospects/entrants | R | creer LEAD | couvert | `mcp-v3.test.ts` › « « creer » LEAD (ex-« creer_contact ») refuse un doublon (même numéro… » |
| L2 | Rafraîchir | GET /api/leads | L | lister LEADS | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » |
| L3 | Puce « À appeler » (compteur, pages) | GET /api/leads?vue=A_APPELER&page= | L | lister LEADS (vue A_APPELER, source, recherche, page) | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » ; `mcp-lister-etat.test.ts` › « LEADS : filtre source, recherche (campagne comprise) et pages, comme… » |
| L4 | Puce « À rappeler » (« dont N en retard ») | GET /api/leads?vue=A_RAPPELER | L | lister LEADS (vue A_RAPPELER, source, recherche, page) | couvert | `mission-14-partie-8.test.ts` › « en-tête, ordre (datés croissants, retards en tête, puis sans date)… » ; `mcp-lister-etat.test.ts` › « LEADS : filtre source, recherche (campagne comprise) et pages, comme… » |
| L5 | Puce « Sans suite » | GET /api/leads?vue=SANS_SUITE | L | lister LEADS (vue SANS_SUITE) | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » |
| L6 | Puce « Archivés » | GET /api/leads?vue=ARCHIVES | L | lister LEADS (vue ARCHIVES) ; chercher (archives: true) | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » ; `mcp-lister-etat.test.ts` › « « chercher » : archives: true rend le lead, le dossier et la fiche… » |
| L7 | Filtre « Source » | GET /api/leads?source= | L | lister LEADS (source) | couvert | `mcp-lister-etat.test.ts` › « LEADS : filtre source, recherche (campagne comprise) et pages, comme… » |
| L8 | Recherche « Nom, téléphone, ville, campagne » | GET /api/leads?q= | L | lister LEADS (recherche, campagne comprise) ; chercher | couvert | `mcp-lister-etat.test.ts` › « LEADS : filtre source, recherche (campagne comprise) et pages, comme… » ; `mcp-lister-etat.test.ts` › « « chercher » : archives: true rend le lead, le dossier et la fiche… » |
| L9 | « Enchaîner les appels · N » (la file) | GET /api/leads/suivant?apres= | L | lister LEADS (A_RAPPELER puis A_APPELER) | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » |
| L10 | Mode appels › « Passer » / « Quitter » | — | — | — | sans objet | — |
| L11 | Mode appels › « Noter sans appeler » | POST /api/commercial/appels | R | noter_appel | couvert | `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| L12 | Mode appels › « Ouvrir son dossier sans noter d'appel » (lead qualifié au téléphone : un lead du site a déjà le sien, mission 18 A2) | POST /api/leads/:id/dossier | R | creer DOSSIER (lead_id) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » |
| L13 | Ligne › téléphone (`tel:`) | — | — | — | sans objet | — |
| L14 | Ligne › puce du rappel : déplacer | PATCH /api/prospects/entrants/:id {rappelLe} | R | modifier LEAD (rappel_le) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| L15 | Ligne › puce du rappel : « Sans date » | PATCH … {rappelLe:null} | R | modifier LEAD (rappel_le: null) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| L16 | « Sélectionner » / « Tout (n) » / désélectionner | — | — | — | sans objet | — |
| L17 | Sélection › « Archiver » + motif (Test, Doublon, Hors cible, Autre) | POST /api/leads/actions {ARCHIVER} | S-suppr (masse) | archiver (leads, motif) | couvert | `mcp.test.ts` › « « Archive tous les leads de la file sauf Stella Estelle » : liste… » ; `mcp-generiques.test.ts` › « raccourcis leads / dossiers (comportement de l'ancien « archiver »)… » |
| L18 | Sélection (Archivés) › « Restaurer » | POST /api/leads/actions {RESTAURER} | R | lister LEADS (vue ARCHIVES) + restaurer (leads) | couvert | `mcp-lister-etat.test.ts` › « LEADS : chaque vue (À appeler, À rappeler, Sans suite, Archivés) rend… » ; `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| L19 | Message « Annuler » (action inverse) | POST /api/leads/actions | R | archiver / restaurer | couvert | `mcp-generiques.test.ts` › « raccourcis leads / dossiers (comportement de l'ancien « archiver »)… » |
| L20 | Ligne du jour : « N rappels aujourd'hui · N en retard » | GET /api/leads | L | lister LEADS (vue A_RAPPELER) | couvert | `mission-14-partie-8.test.ts` › « en-tête, ordre (datés croissants, retards en tête, puis sans date)… » |
| L21 | Ligne du jour › « N relances proposables » → feuille Relances (une section par type depuis la mission 18, A4 : devis, photos, demandes d'avis, réactivations) | GET /api/relances | L | lister RELANCES | couvert | `mcp-v3.test.ts` › « « lister » RELANCES / « relancer » / « ignorer_proposition » (ex-«… » ; `mission-18-a4.test.ts` › « relancesProposables : devis, photos, avis, réactivations, et le total ; la… » |
| L22 | Relances › « SMS » (texte modifiable) → « Copier » : devis, photos, demande d'avis (DEMANDE_AVIS), réactivation (REACTIVATION, tracée sur le lead) | POST /api/sms/proposition ; POST /api/sms/copie | S-client | lister RELANCES + noter_sms | couvert | `mcp-lister-etat.test.ts` › « MESSAGES_ESPACE et RELANCES : le texte des outils qu'ils remplacent » ; `mission-14-partie-8.test.ts` › « relance de devis : RELANCE_DEVIS_1 retrouve seul le devis du dossier et… » ; `mission-18-a4.test.ts` › « « lister » RELANCES rend les demandes d'avis et les réactivations, même… » |
| L23 | Relances › « Relire le mail » → corriger → valider | POST /api/validation/:id/valider | S-client | valider_proposition (corrections : objet, texte) / relancer | couvert | `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » ; `mcp-v3.test.ts` › « « lister » RELANCES / « relancer » / « ignorer_proposition » (ex-«… » |
| L24 | Sur le site › simulations des 7 derniers jours, avec images | SSR `simulationsSiteRecentes(7)` | L | voir_fichiers (site) | couvert | `mcp-v3.test.ts` › « « voir_fichiers » site (ex-« simulations_site ») liste les simulations… » |
| L25 | Sur le site › générations en cours ou en échec, avec la raison | SSR `travauxSiteRecents(7)` | L | voir_fichiers (site : générations en cours ou en échec, avec la raison) | couvert | `mcp-partie-c.test.ts` › « pièce jointe d'un mail (M15), rendu du banc (S17), générations du site… » |
| L26 | Sur le site › ouvrir le lead | — | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| L27 | Notifications de l'appareil : activer, désactiver | POST /api/push/abonnement | — | — | sans objet (PushManager du navigateur) | — |
| L28 | Notification d'essai | POST /api/push/essai | R | agir_systeme (TESTER_NOTIFICATION, canal APPAREIL) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |

#### Fiche d'un lead (`PanneauEntrant`)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| LF1 | Ouvrir la fiche (et la marquer vue) | GET /api/prospects/entrants/:id | L | lire_fiche (lead : tous les champs) | couvert | `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| LF2 | Doublon › « Fusionner avec X » | POST /api/leads/:id/doublon {fusionner} | S-suppr | doublon (LEAD, FUSIONNER) | couvert | `mcp-gestes.test.ts` › « LEAD : ECARTER et FUSIONNER (sensible) donnent le même état que les… » |
| LF3 | Doublon › « Ce n'est pas la même personne » | POST /api/leads/:id/doublon {ecarter} | R | doublon (LEAD, ECARTER) | couvert | `mcp-gestes.test.ts` › « LEAD : ECARTER et FUSIONNER (sensible) donnent le même état que les… » |
| LF4 | « Ouvrir un dossier » (lead qualifié au téléphone ; simulation, photos ou demande de devis du site : déjà ouvert tout seul, mission 18 A2) | POST /api/leads/:id/dossier | R | creer DOSSIER (lead_id) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » |
| LF5 | Liens « Dossier · étape » / « Fiche client » | — | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| LF6 | Téléphone (`tel:`) | — | — | — | sans objet | — |
| LF7 | « Noter l'appel » → feuille de fin d'appel | POST /api/commercial/appels | R | noter_appel | couvert | `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| LF8 | « Lien espace client » : ouvre le dossier et l'espace, copie le lien | POST /api/prospects/entrants/:id/espace | R | geste_espace (OUVRIR) ; lien_espace | couvert | `mcp-gestes.test.ts` › « OUVRIR sans rien noter ni envoyer : même espace que « Lien espace… » |
| LF9 | « SMS avec le lien » → « Copier » | POST /api/sms/proposition ; POST /api/sms/copie | S-client | lien_espace + noter_sms | couvert | `mission-14-partie-8.test.ts` › « intéressé : le SMS du lien est dans la réponse ; « noter_sms »… » ; `mcp-v2.test.ts` › « « lien_espace » sur un lead Meta sans e-mail : espace créé, lien et SMS… » |
| LF10 | « Écrire un mail » | écran Mail | S-client | rediger_mail / deposer_brouillon / envoyer_mail | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| LF11 | Rappel › poser ou déplacer | PATCH … {rappelLe} | R | modifier LEAD (rappel_le) ; planifier | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » ; `mcp.test.ts` › « « Planifie un rappel de Madame Piketty jeudi 14h » » |
| LF12 | Rappel › « Retirer la date » | PATCH … {rappelLe:null} | R | modifier LEAD (rappel_le: null) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF13 | Notes d'appel › saisie (enregistrée à la frappe) et étiquettes | POST / PUT /api/leads/:id/notes-appel | R | creer NOTE_APPEL / modifier NOTE_APPEL (texte, etiquettes) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » ; `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| LF14 | Notes d'appel › « Nouvel appel » | POST /api/leads/:id/notes-appel | R | creer NOTE_APPEL (sans issue) / noter_appel (avec issue) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » ; `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| LF15 | Notes d'appel › historique | GET /api/leads/:id/notes-appel | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| LF16 | Priorité de rappel : Prioritaire, Standard, Secondaire, À écarter, « Recalculer » | PATCH … {priorite} | R | modifier LEAD (priorite) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF17 | Statut : Nouveau, Devis demandé, Contacté | PATCH … {statut} | R | modifier LEAD (statut) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF18 | « Classer sans suite » (motif, précision) et retour du « sans suite » | PATCH … {statut PERDU, motifPerte, motif} | R | modifier LEAD (statut PERDU + motif_perte ; retour : statut) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF19 | « Noter un échange » : Appel, SMS, E-mail ou Note, avec un texte | POST /api/prospects/entrants/:id/echanges | R | creer NOTE (lead : type APPEL, SMS, EMAIL, NOTE) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| LF20 | Échanges (liste) | GET entrant | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| LF21 | Sa demande, photos jointes (visionneuse) | GET entrant | L | voir_fichiers (photos, lead) | couvert | `mcp-v2.test.ts` › « « voir_fichiers » photos (ex-« voir_photos ») : de vraies images MCP… » |
| LF22 | Simulations du lead : avant, après, PDF | GET entrant | L | voir_fichiers (site, simulations ; documents : PDF des simulations du lead) | couvert | `mcp-partie-c.test.ts` › « documents d'un lead : PDF de ses simulations du site (LF22) et devis de… » |
| LF23 | Demande › « Corriger » : prénom, nom, téléphone, e-mail, ville, code postal, projet | PATCH /api/prospects/entrants/:id | R | modifier LEAD (prenom, nom_famille, telephone, email, ville, code_postal, type_projet) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF24 | Notes › « Enregistrer les notes » | PATCH … {notes} | R | modifier LEAD (notes) | couvert | `mcp-generiques.test.ts` › « LEAD : champs, rappel dicté ; « sans suite » sensible (aperçu, jeton… » |
| LF25 | Ancien CRM : devis, factures PDF, chantier | GET entrant | L | voir_fichiers (documents, lead : devis et factures de l'ancien CRM) ; lire_fiche | couvert | `mcp-partie-c.test.ts` › « documents d'un lead : PDF de ses simulations du site (LF22) et devis de… » ; `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| LF26 | « Archiver le contact » (motif libre) | POST /api/prospects/entrants/:id/archiver | S-suppr | archiver (elements LEAD, motif libre) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| LF27 | « Restaurer le contact » | POST /api/prospects/entrants/:id/restaurer | R | restaurer (leads) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |

#### Feuille de fin d'appel (`FinAppel`, montée partout)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| FA1 | Contexte : nom, source, tentatives | GET /api/commercial/appels/contexte | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « lead : tous les champs de la fiche (campagne, tentatives, dernier… » |
| FA2 | « Intéressé » (dossier et espace ouverts, SMS proposé) | POST /api/commercial/appels {INTERESSE} | R | noter_appel | couvert | `mission-14-partie-8.test.ts` › « intéressé : le SMS du lien est dans la réponse ; « noter_sms »… » |
| FA3 | « À rappeler » : raccourcis, Autre…, Sans date | … {A_RAPPELER, rappelLe} | R | noter_appel (rappel) | couvert | `mission-14-partie-8.test.ts` › « un rappel de dossier noté au jour seul se dit par son jour (« jeudi »)… » |
| FA4 | « Pas de réponse » et rappel (demain 18 h par défaut) | … {PAS_DE_REPONSE} | R | noter_appel | couvert | `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| FA5 | « Classer sans suite — plus de réponse » (3ᵉ tentative) | … {PAS_INTERESSE, SANS_REPONSE} | S-perte (relecture adverse) | noter_appel | couvert | `mcp-relecture-c.test.ts` › « sans jeton rien n'est fait ; sans motif, pas d'aperçu… » ; `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| FA6 | « Pas intéressé » + motif (+ précision) | … {PAS_INTERESSE, motifPerte} | S-perte (relecture adverse) | noter_appel | couvert | `mcp-relecture-c.test.ts` › « sans jeton rien n'est fait ; sans motif, pas d'aperçu… » ; `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| FA7 | « Plus tard » | — | — | — | sans objet | — |
| FA8 | SMS proposé → « Copier » | POST /api/sms/copie | S-client | noter_sms | couvert | `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| FA9 | Carte « Suivant » | GET /api/leads/suivant | L | lister LEADS (A_RAPPELER / A_APPELER) | couvert | `mission-14-partie-8.test.ts` › « en-tête, ordre (datés croissants, retards en tête, puis sans date)… » |

### 2.3 Dossiers (`/dossiers`) — liste, création, reprise

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| D1 | Liste « En cours » et compteurs (à faire, en retard, sorties, inactifs) | GET /api/dossiers?page&vue&q&inactifs | L | lister DOSSIERS (vue EN_COURS ; compteurs, recherche, page) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » |
| D2 | Onglet « À faire » (la main est à Lucas) | GET /api/dossiers?vue=A_FAIRE | L | taches (TOUT) / lister DOSSIERS (vue A_FAIRE) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » ; `mcp-taches.test.ts` › « taches TOUT lit la liste des tâches à l'instant du contexte (une tâche… » |
| D3 | Kanban / Liste, tri | — | — | — | sans objet | — |
| D4 | Recherche « Client, ville, objet » | GET /api/dossiers?q= | L | lister DOSSIERS (recherche) ; chercher (objet) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » ; `mcp-lister-etat.test.ts` › « « chercher » : archives: true rend le lead, le dossier et la fiche… » |
| D5 | « Perdus et en pause » | GET /api/dossiers?vue=TOUS | L | lister DOSSIERS (vue PAR_ETAPE : PERDU, EN_PAUSE) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » ; `mission-14-partie-8.test.ts` › « un dossier perdu (main nulle) n'est ni « à toi » ni « chez le client »… » |
| D6 | « Masquer les inactifs » | ?inactifs=0 | L | lister DOSSIERS (filtres.masquer_inactifs) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » |
| D7 | « Archivés » (les 200 derniers) | GET /api/dossiers/archives | L | lister DOSSIERS (vue ARCHIVES) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » |
| D8 | Archivés › « Restaurer » | POST /api/dossiers/:id/archivage {restaurer} | R | lister DOSSIERS (vue ARCHIVES) + restaurer (dossiers) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS : En cours, À faire, Tous (inactifs masqués ou non) =… » ; `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| D9 | « Légende » | — | — | — | sans objet | — |
| D10 | Pastille « N à valider » | GET /api/validation?statut=EN_ATTENTE | L | lister PROPOSITIONS / taches (TOUT, nombre) | couvert | `mcp-lister-etat.test.ts` › « PROPOSITIONS : les onglets de « À valider », et une proposition lue en… » ; `mcp-v2.test.ts` › « « taches » TOUT (ex-« ce_qui_m_attend ») et « point_du_jour » comptent… » |
| D11 | Raccourcis de carte (photos, messages, devis, encaisser, étape suivante) | — | — | voir le panneau (DP) | sans objet | — |
| D12 | Création › « Depuis un lead » : recherche | GET /api/dossiers/leads?q= | L | chercher | couvert | `assistant.test.ts` › « « chercher » tolère une faute et rend les deux Rousse » |
| D13 | Création › formulaire prérempli (lead, client ou prospect) : nom, téléphone, e-mail, adresse, code postal, ville, objet, source, montant estimé, prochaine action et date, étape de départ, date de chantier, photos (au moins une) | POST /api/dossiers (multipart) ; POST /api/dossiers/:id/photos | R | creer DOSSIER (lead_id, client_id ou rien ; champs du formulaire, etape, date_chantier) + ajouter_fichier (photos) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » ; `mcp-fichiers.test.ts` › « dossier (par le nom), lead, client, dépense, réalisation non publiée » |
| D14 | Création › « Direct » : même formulaire + type de client (particulier ou entreprise, SIRET, sous-traitance) | POST /api/dossiers | R | creer DOSSIER (client_categorie, client_siret) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » |
| D15 | Création › annuaire des entreprises | GET /api/clients/annuaire?q= | L | lister ENTREPRISES | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| D16 | « Reprise » d'un dossier commencé avant le CRM : fiche, étape actuelle, dates des jalons, date d'ouverture, documents émis (numéro, date, montant, statut, registre), paiements reçus, puis les PDF un par un | GET /api/numeros?libres=1 ; POST /api/dossiers/reprise ; POST …/documents/:docId/pdf | S-€ | creer REPRISE + ajouter_fichier (PDF_DOCUMENT) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » ; `mcp-partie-c.test.ts` › « ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation »… » |

#### Colonne et filtre « Espaces » (ex-onglet Espaces clients, mission 18 A1)

Les dates affichées sont celles du projet (son espace dans l'espace permanent du client) ; « désactivé » = lien du
client révoqué ; les signaux du client (projet de plus demandé, nouveau projet, téléphone à confirmer) vont à son
projet le plus récent.

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| E1 | Colonne « Espace » (liste), ligne du téléphone, pastille du kanban : étape de l'espace, lien envoyé, dernière visite, photos, simulations, devis relu, signal | GET /api/dossiers | L | lister DOSSIERS (« espace : … » sur chaque ligne, `espace` dans les données) ; lire_fiche (espace) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS filtres.espace (ex-onglet Espaces) = pageDossiers({ espace }) : pastilles… » ; `espaces-colonne.test.ts` › « un dossier avec un espace porte son état (dates du projet, photos… » |
| E2 | « Espaces », puis pastilles À moi / Chez le client / Signaux / Tous / Désactivés, compteurs exacts sur tous les espaces, pages de 50 | GET /api/dossiers?espace=&page= | L | lister DOSSIERS (filtres.espace, page) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS filtres.espace (ex-onglet Espaces) = pageDossiers({ espace }) : pastilles… » ; `espaces-colonne.test.ts` › « À moi, Chez le client, Signaux, Désactivés, Tous : exacts au-delà de 50… » |
| E3 | Sélecteur « Étape de l'espace » | GET /api/dossiers?espace=&etapeEspace= | L | lister DOSSIERS (filtres.etape_espace) | couvert | `mcp-lister-etat.test.ts` › « DOSSIERS filtres.espace (ex-onglet Espaces) = pageDossiers({ espace }) : pastilles… » |
| E4 | Ordre du filtre : à moi d'abord, puis dernière activité ; perdus, en pause et terminés compris | GET /api/dossiers?espace= | L | lister DOSSIERS (filtres.espace : même ordre) | couvert | `espaces-colonne.test.ts` › « ordre : à moi d'abord, puis chez le client, puis personne (perdu)… » |

### 2.4 Dossier — le panneau et ses rubriques (`PanneauDossier`)

Mission 18 (A6) : les tarifs (DP64, DP70–DP73) ne sont plus un sous-mode du générateur mais l'onglet « Tarifs » de
Paramètres : leurs lignes sont en 2.13 › Tarifs. Le générateur garde la liste « Ajouter depuis un tarif… » (DP67) et
un lien « Gérer les tarifs » vers l'onglet.

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| DP1 | Ouverture, relue toutes les 30 s | GET /api/dossiers/:id | L | lire_fiche (dossier : source, ouverture, mainLe, points masqués, perte détaillée, délais) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP2 | En-tête › téléphone → feuille de fin d'appel sur le dossier | POST /api/commercial/appels {dossierId} | R | noter_appel (dossierId) | couvert | `mission-14-partie-8.test.ts` › « un rappel de dossier noté au jour seul se dit par son jour (« jeudi »)… » |
| DP3 | En-tête › e-mail (`mailto:`), « Contact : lead » | — | — | envoyer_mail / lire_fiche | sans objet | — |
| DP4 | À compléter › croix « masquer ce point pour ce dossier » | PATCH /api/dossiers/:id/completude {code, masque:true} | R | modifier DOSSIER (points_masques) | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP5 | À compléter › « Réafficher » un point masqué | PATCH … {masque:false} | R | modifier DOSSIER (points_reaffiches) | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP6 | Prochaine action : texte et date (Aujourd'hui, Demain, Dans 3 j, Dans 1 sem.) › « Enregistrer » ou vider | PATCH /api/dossiers/:id {prochaineAction, prochaineActionDate} | R | modifier DOSSIER (prochaine_action, prochaine_action_date) / planifier | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » ; `mcp.test.ts` › « « Planifie un rappel de Madame Piketty jeudi 14h » » |
| DP7 | Relance proposable › « SMS » relance n/2 → « Copier » ; « Demande d'avis proposable » › « SMS » (mission 18, A4) | GET /api/relances?dossierId= ; POST /api/sms/copie | S-client | lister RELANCES (dossier_id) + noter_sms | couvert | `mcp-lister-etat.test.ts` › « MESSAGES_ESPACE et RELANCES : le texte des outils qu'ils remplacent » ; `mission-14-partie-8.test.ts` › « relance de devis : RELANCE_DEVIS_1 retrouve seul le devis du dossier et… » ; `mission-18-a4.test.ts` › « « lister » RELANCES rend les demandes d'avis et les réactivations, même… » |
| DP8 | Relance proposable › « Relire le mail » → valider | POST /api/validation/:id/valider | S-client | valider_proposition (corrections : objet, texte) / relancer | couvert | `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » ; `mcp-v3.test.ts` › « « lister » RELANCES / « relancer » / « ignorer_proposition » (ex-«… » |
| DP9 | Encaisser l'acompte ou le solde : montant, date, moyen, référence, pièce réglée (automatique ou choisie) | POST /api/dossiers/:id/encaissements {paiement, numeroDocumentId} | S-€ | saisir_encaissement (montant, recu_le, moyen, reference, piece, payeur, credite_le) | couvert | `mcp-partie-c.test.ts` › « saisir_encaissement : pièce réglée, payeur, chèque crédité ; une… » |
| DP10 | Étape › bouton d'étape suivante, « Reprendre en … » | POST /api/dossiers/:id/etape {vers} | R ; S vers Signé, Facturé, Encaissé, Perdu | changer_etape | couvert | `assistant.test.ts` › « passer un dossier à « perdu » est sensible (aperçu puis confirmation)… » |
| DP11 | « Mettre en pause » | … {vers:EN_PAUSE} | R | changer_etape | couvert | `assistant.test.ts` › « passer un dossier à « perdu » est sensible (aperçu puis confirmation)… » |
| DP12 | « Passer à une autre étape… » (avancer, revenir, sortir) | … {vers} | R | changer_etape | couvert | `assistant.test.ts` › « passer un dossier à « perdu » est sensible (aperçu puis confirmation)… » |
| DP13 | Fenêtre › « Date du passage » (jour réel, passé) | … {survenuLe} | R | changer_etape (survenu_le) | couvert | `mcp-partie-c.test.ts` › « Signé sans acompte (motif), Encaissé avec le solde, jour réel du… » |
| DP14 | Fenêtre › « Marquer perdu » : motif, « Remporté par », « Son prix », précision | … {motifPerte, perteConcurrent, perteMontantConcurrent, perteCommentaire} | S | changer_etape (motif_perte, perte_concurrent, perte_montant_concurrent) | couvert | `mcp-partie-c.test.ts` › « Signé sans acompte (motif), Encaissé avec le solde, jour réel du… » |
| DP15 | → Signé : case « bon pour accord » (hors espace) | … {confirmations} | S | changer_etape (accord_confirme) | couvert | `mcp-partie-c.test.ts` › « Signé avec le devis accepté (plusieurs devis) et l'acompte reçu, dans… » |
| DP16 | → Signé : choix du devis accepté (plusieurs devis) | … {devisAccepteId} | S | changer_etape (devis_accepte_id) | couvert | `mcp-partie-c.test.ts` › « Signé avec le devis accepté (plusieurs devis) et l'acompte reçu, dans… » |
| DP17 | → Signé : acompte reçu, dans la même transaction | … {acompte} (`changerEtapeAvecPaiement`) | S-€ | changer_etape (acompte, dans la même opération) | couvert | `mcp-partie-c.test.ts` › « Signé avec le devis accepté (plusieurs devis) et l'acompte reçu, dans… » |
| DP18 | → Signé : « sans acompte » + motif + précision | … {sansAcompte} | S | changer_etape (sans_acompte : motif, precision) | couvert | `mcp-partie-c.test.ts` › « Signé sans acompte (motif), Encaissé avec le solde, jour réel du… » |
| DP19 | → Planifié : date de chantier | … {dateChantier} | R | changer_etape (date_chantier) | couvert | `mcp-partie-c.test.ts` › « Signé avec le devis accepté (plusieurs devis) et l'acompte reçu, dans… » |
| DP20 | → Encaissé : « solde reçu » + paiement | … {solde} | S-€ | changer_etape (ENCAISSE, solde) | couvert | `mcp-partie-c.test.ts` › « Signé sans acompte (motif), Encaissé avec le solde, jour réel du… » |
| DP21 | Photos › voir, visionneuse (avant, après) | GET /api/dossiers/:id/photos/:photoId | L | voir_fichiers (photos) | couvert | `mcp-v2.test.ts` › « « voir_fichiers » photos (ex-« voir_photos ») : de vraies images MCP… » |
| DP22 | Photos › « Ajouter » / « Prendre une photo » (avant) | POST /api/dossiers/:id/photos | R | ajouter_fichier (DOSSIER › PHOTO_AVANT) ; lien_depot | couvert | `mcp-fichiers.test.ts` › « dossier (par le nom), lead, client, dépense, réalisation non publiée » ; `mcp-fichiers.test.ts` › « rend un lien absolu, 30 minutes, rattaché au dossier ; le dépôt arrive… » |
| DP23 | Photos › « Photos après » (portfolio) | POST … {apres:1} | R | ajouter_fichier (DOSSIER › PHOTO_APRES) | couvert | `mcp-fichiers.test.ts` › « dossier (par le nom), lead, client, dépense, réalisation non publiée » |
| DP24 | Photos › visionneuse › « Supprimer la photo » | DELETE /api/dossiers/:id/photos/:photoId | S-suppr | ranger_fichier (retirer) | couvert | `mcp-fichiers.test.ts` › « une photo déjà dans le dossier (pas passée par un dépôt) se retire et… » |
| DP25 | Historique › liste et « Voir les N plus anciens » | GET /api/dossiers/:id | L | lire_fiche (dossier : historique paginé, nombre, decalage) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP26 | Historique › « Lire le mail » de l'événement | GET /api/messages/:id | L | lire_mail | couvert | `mcp-mail.test.ts` › « 4. « Qu'est-ce que le mail de Thimalu change dans son dossier ? »… » |
| DP27 | Espace client › la vue : les 5 étapes du client, reste à faire, visites, projet, choix, favoris, avis, paiement vu, gestes, photos retirées | GET /api/dossiers/:id/espace | L | lire_fiche (dossier, espace: true) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP28 | Espace › « Ouvrir l'espace client » | POST /api/dossiers/:id/espace {ouvrir} | R | geste_espace (OUVRIR) | couvert | `mcp-gestes.test.ts` › « OUVRIR sans rien noter ni envoyer : même espace que « Lien espace… » |
| DP29 | Espace › « Copier » le lien | — | L | lister ESPACES (lien) / lire_fiche (espace) | couvert | `mcp-lister-etat.test.ts` › « ESPACES : pageClientsEspaces, filtre et tri de l'écran ; l'ex-«… » |
| DP30 | Espace › « Voir comme le client » | lien d'aperçu signé | L | lire_fiche (dossier, espace: true : lien d'aperçu « comme le client ») | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP31 | Espace › « Envoyer le lien par mail » (à, objet, phrase) | POST /api/mail/lien-espace | S-client | envoyer_lien_espace (a, objet, phrase) | couvert | `mcp-partie-c.test.ts` › « objet remplacé ; code par défaut selon l'étape de l'espace ; l'aperçu… » |
| DP32 | Espace › « SMS avec le lien » → « Copier » | POST /api/sms/proposition ; /api/sms/copie | S-client | lien_espace + noter_sms | couvert | `mission-14-partie-8.test.ts` › « intéressé : le SMS du lien est dans la réponse ; « noter_sms »… » |
| DP33 | Espace › « Désactiver le lien » (tous ses projets) | POST /api/dossiers/:id/espace {revoquer} | S | geste_espace (DESACTIVER) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » |
| DP34 | Espace › « Nouveau lien », avec ou sans mail, avec un texte | POST /api/espaces/:permanentId {regenerer, mail, texte} | S-client | geste_espace (NOUVEAU_LIEN, mail, texte) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » ; `mcp-gestes.test.ts` › « ACCORDER_SIMULATIONS, ACCORDER_PROJET, NOUVEAU_LIEN sans mail… » |
| DP35 | Espace › photos retirées par le client : les voir | GET /api/dossiers/:id/espace/photos-retirees/:photoId | L | voir_fichiers (photos, retirees: true) | couvert | `mcp-fichiers.test.ts` › « une photo déjà dans le dossier (pas passée par un dépôt) se retire et… » |
| DP36 | Espace › « Remettre » une photo retirée | POST …/espace {geste:remettre-photo} | R | ranger_fichier (remettre) / geste_espace (REMETTRE_PHOTO) | couvert | `mcp-fichiers.test.ts` › « une photo déjà dans le dossier (pas passée par un dépôt) se retire et… » |
| DP37 | Espace › Projet › « Valider à sa place » | … {geste:valider-projet} | R | geste_espace (VALIDER_PROJET) | couvert | `mcp-gestes.test.ts` › « VALIDER_PROJET, DEVALIDER_PROJET, VALIDER_SIMULATION… » |
| DP38 | Espace › Projet › « Dévalider » | … {geste:devalider-projet} | R | geste_espace (DEVALIDER_PROJET) | couvert | `mcp-gestes.test.ts` › « VALIDER_PROJET, DEVALIDER_PROJET, VALIDER_SIMULATION… » |
| DP39 | Espace › Projet › « Modifier taille et note » | … {geste:modifier-projet} | R | modifier DOSSIER (dimensions, notes_projet) | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP40 | Espace › Projet › « Réinitialiser » l'étape | … {geste:reinitialiser, PROJET} | R (efface la saisie du client) | geste_espace (REINITIALISER, etape PROJET) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » |
| DP41 | Espace › Simulations › « Retirer la demande » | … {geste:retirer-demande} | R | geste_espace (RETIRER_DEMANDE) | couvert | `mcp-gestes.test.ts` › « VALIDER_PROJET, DEVALIDER_PROJET, VALIDER_SIMULATION… » |
| DP42 | Espace › Simulations › « Valider » à sa place | … {geste:valider-simulation} | R | geste_espace (VALIDER_SIMULATION, simulation_id) | couvert | `mcp-gestes.test.ts` › « VALIDER_PROJET, DEVALIDER_PROJET, VALIDER_SIMULATION… » |
| DP43 | Espace › Simulations › « Dévalider » | … {geste:devalider-simulation} | R | geste_espace (DEVALIDER_SIMULATION) | couvert | `mcp-gestes.test.ts` › « VALIDER_PROJET, DEVALIDER_PROJET, VALIDER_SIMULATION… » |
| DP44 | Espace › Simulations › « Masquer » (la simulation du choix du client : son choix est dévalidé d'un bloc, mission 18 B9) | PATCH /api/dossiers/:id/simulations/:sid {masquer} | R | publier (SIMULATION, retirer) | couvert | `mcp-gestes.test.ts` › « SIMULATION : une simulation masquée n'est pas republiée ; le brouillon… » |
| DP45 | Espace › Simulations › « Afficher » (republier, mail automatique ; mission 18 B9 : mêmes effets que « Publier », Qualification → Simulation, prochaine action, main) | … {afficher} | S-client | publier (SIMULATION) | couvert | `mcp-gestes.test.ts` › « SIMULATION : une simulation masquée n'est pas republiée ; le brouillon… » |
| DP46 | Espace › Simulations › « Accorder 3 simulations » | … {geste:accorder, nombre} | S-€ (≈ 0,20 $ l'image) | geste_espace (ACCORDER_SIMULATIONS) | couvert | `mcp-gestes.test.ts` › « ACCORDER_SIMULATIONS, ACCORDER_PROJET, NOUVEAU_LIEN sans mail… » |
| DP47 | Espace › Simulations › « Réinitialiser » l'étape | … {geste:reinitialiser, SIMULATIONS} | R | geste_espace (REINITIALISER, etape SIMULATIONS) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » |
| DP48 | Espace › Devis › interrupteur « visible dans l'espace client » | PATCH /api/dossiers/:id/documents/:docId {visibleEspace} (mission 18, B5 : rend `annonce`, le mail « Devis disponible » ; B6 : masqué, le seul devis en attente fait revenir le dossier avant « Devis envoyé ») | R / S-client | modifier DOCUMENT (visible_espace) | couvert | `mcp-v3.test.ts` › « « modifier » DOCUMENT (ex-« presenter_devis ») : libellé et visibilité… » ; `mise-en-ligne.test.ts` › « outil « modifier » DOCUMENT : l'aperçu annonce le mail « Devis disponible »… » |
| DP49 | Espace › Devis › « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » | générateur / dépôt | S | generer_document / ajouter_fichier (DOSSIER › DEVIS) | couvert | `mcp-v3.test.ts` › « « generer_document » : deux devis à libellés qui s'ajoutent (sans… » ; `mcp-v3.test.ts` › « « ajouter_fichier » (ex-« deposer_document ») : un BAT fournisseur en… » |
| DP50 | Espace › Devis › « Retirer son accord » | … {geste:retirer-accord} | S | geste_espace (RETIRER_ACCORD) | couvert | `mcp-v3.test.ts` › « « modifier » DOCUMENT (ex-« presenter_devis ») : libellé et visibilité… » |
| DP51 | Espace › Paiement (ce qu'il voit), « Son avis » (note, texte, publication) | GET …/espace | L | lire_fiche (dossier, espace: true : paiement vu, avis) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP52 | Espace › Messages › le fil | GET …/espace | L | lister MESSAGES_ESPACE | couvert | `mcp-v2.test.ts` › « « lister » MESSAGES_ESPACE (ex-« messages_espace ») puis «… » |
| DP53 | Espace › Messages › « Répondre dans son espace » | … {geste:repondre} | S-client | repondre_espace | couvert | `mcp-v2.test.ts` › « « lister » MESSAGES_ESPACE (ex-« messages_espace ») puis «… » |
| DP54 | Espace › « Ses derniers gestes » | GET …/espace | L | lire_fiche (dossier, espace: true : derniers gestes) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP55 | Documents › « Générer un devis » | POST /api/dossiers/:id/documents | S | generer_document (lignes SECTION) | couvert | `mcp-partie-c.test.ts` › « une ligne de section se dicte ; le devis prérempli montre ses lignes… » |
| DP56 | Documents › « Générer une facture » | … {type:FACTURE} | S-€ | generer_document (FACTURE, depuis_devis) | couvert | `mcp.test.ts` › « « Génère la facture de Monsieur Rousse, mets-la dans son dossier et son… » ; `assistant.test.ts` › « sur un dossier signé, la facture s'émet, puis l'encaissement (sensible)… » |
| DP57 | Documents › « Enregistrer un document existant » : type, numéro (suggestions du registre), date, montant, objet, statut, acompte, libellé, visibilité, PDF facultatif, inscription au registre | GET /api/numeros?libres=1 ; POST …/documents/existant (mission 18, B4 : le PDF dans la même requête, d'un bloc ; « accepté » signe un dossier pas encore signé) ; POST …/pdf (remplacer) | S-€ | ajouter_fichier (DOSSIER › DEVIS, FACTURE, sans fichier possible) ; etat_crm (NUMEROTATION : numéros libres) | couvert | `mcp-v3.test.ts` › « « ajouter_fichier » (ex-« deposer_document ») : un BAT fournisseur en… » ; `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » ; `depot-atomique.test.ts` › « l'écran : le PDF dans la même requête (formulaire) ; un faux PDF… » |
| DP58 | Documents › ouvrir ou télécharger le PDF | GET …/documents/:docId/pdf | L | voir_fichiers (documents, document_id : PDF joint) | couvert | `mcp-partie-c.test.ts` › « ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation »… » |
| DP59 | Documents › document repris › « Corriger » (date, montant, objet, statut, acompte, libellé, visibilité), « importer le PDF » | PATCH …/documents/:docId ; POST …/pdf | S-€ | modifier DOCUMENT (date_emission, montant, objet, statut, acompte_pct) ; ajouter_fichier (PDF_DOCUMENT) | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » ; `mcp-partie-c.test.ts` › « ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation »… » |
| DP98 | Tâches › « Enregistrer comme devis envoyé » (PDF parti de Gmail : modale de dépôt préremplie, numéro lu dans le nom, date du mail, montant du registre) | GET/POST /api/dossiers/:id/devis-gmail | S-€ | ajouter_fichier (DOSSIER › DEVIS, numero, montant, source piece_mail) ; voir_fichiers (piece_mail) ; taches | couvert | `devis-gmail.test.ts` › « outil « ajouter_fichier » avec la pièce du mail : le même enregistrement… » |
| DP60 | Documents › « Envoyer par mail » (à, objet, texte relus, PDF joint) | GET/POST …/documents/:docId/mail | S-client | envoyer_document | couvert | `mcp-sensibles.test.ts` › « envoyer_document — envoyer un devis par mail : aperçu et jeton, aucune écriture » ; `envoyer-par-mail.test.ts` › « outil « envoyer_document » confirmé, puis relancé : une seule validation… » |
| DP61 | Documents › « Refaire ce devis » (remplace) | POST …/documents {remplaceDocumentId} | S | generer_document (remplace) | couvert | `mcp-v3.test.ts` › « « generer_document » : deux devis à libellés qui s'ajoutent (sans… » |
| DP62 | Documents › « Annuler par un avoir » (motif, précision) | POST …/documents/:docId/avoir | S-€ | annuler_document (motif_avoir) | couvert | `mcp-sensibles.test.ts` › « annuler_document — annuler un devis : aperçu et jeton, aucune écriture » |
| DP63 | Documents › « Annuler ce devis » (motif) | POST …/documents/:docId/annulation (mission 18, B6 : sans autre devis en attente, retour avant « Devis envoyé », dit dans `avertissements`) | S | annuler_document | couvert | `mcp-v3.test.ts` › « « generer_document » : deux devis à libellés qui s'ajoutent (sans… » ; `devis-retire.test.ts` › « outil « annuler_document » : l'aperçu annonce le retour, le résultat le dit… » |
| DP65 | Générateur › lignes préremplies d'après l'espace (choix, mètres, tarifs) | GET /api/dossiers/:id/devis-propose | L | generer_document (depuis_espace: true) | couvert | `mcp-partie-c.test.ts` › « une ligne de section se dicte ; le devis prérempli montre ses lignes… » |
| DP66 | Générateur › numéro à venir | GET /api/dossiers/numerotation?type= | L | etat_crm (NUMEROTATION) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| DP67 | Générateur › lignes : prestation ou section, monter, descendre, supprimer, choisir un tarif | — | — | generer_document (lignes, dont SECTION) | couvert | `mcp-partie-c.test.ts` › « une ligne de section se dicte ; le devis prérempli montre ses lignes… » ; `mcp-v3.test.ts` › « « generer_document » : deux devis à libellés qui s'ajoutent (sans… » |
| DP68 | Générateur › objet, acompte %, mention ml, libellé de variante, « prévenir le client » | POST …/documents | S | generer_document (objet, acompte_pct, note_ml, libelle_variante, notifier) | couvert | `mcp-v3.test.ts` › « « generer_document » : deux devis à libellés qui s'ajoutent (sans… » |
| DP69 | Générateur › paramètres légaux manquants → saisie | POST /api/parametres | S-param | modifier PARAMETRE | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| DP74 | Paiements › liste, reste dû | GET /api/dossiers/:id | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP75 | Paiements › « Ajouter un paiement » | POST /api/dossiers/:id/encaissements | S-€ | saisir_encaissement (piece, payeur, credite_le) | couvert | `mcp-partie-c.test.ts` › « saisir_encaissement : pièce réglée, payeur, chèque crédité ; une… » |
| DP76 | Paiements › « Corriger » (montant, date, moyen, référence) | PATCH /api/encaissements/:id | S-€ | modifier ENCAISSEMENT (montant, recu_le, moyen, reference) | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » |
| DP77 | Paiements › « Chèque crédité » (date du relevé) | POST /api/encaissements/:id/credit | S-€ | modifier ENCAISSEMENT (credite_le) | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » |
| DP78 | Paiements › « Chèque rejeté » (date, motif, précision) | POST /api/encaissements/:id/rejet | S-€ | annuler_encaissement (nature REJETER : le, motif, precision) | couvert | `mcp-partie-c.test.ts` › « annuler_encaissement REJETER : chèque impayé, comme « Chèque rejeté »… » |
| DP79 | Paiements › « Annuler ce paiement » (motif, précision) | POST /api/encaissements/:id/annulation | S-€ | annuler_encaissement | couvert | `mcp-sensibles.test.ts` › « annuler_encaissement — annuler un paiement : aperçu et jeton, aucune écriture » |
| DP80 | Simulations › liste, visionneuse (avant, après, direction artistique, prompt) | GET /api/dossiers/:id/simulations | L | voir_fichiers (simulations) | couvert | `mcp-v2.test.ts` › « « voir_fichiers » simulations (ex-« voir_simulations ») : l'après en… » |
| DP81 | Simulations › « Préparer » (→ simulateur) | nav | R | preparer_simulation | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| DP82 | Simulations › « Déposer une simulation » : image, titre, description, préparation liée, source | POST /api/dossiers/:id/simulations (multipart) | R (brouillon) | ajouter_fichier (DOSSIER › SIMULATION : titre, description, origine_simulation, preparation_id) | couvert | `mcp-partie-c.test.ts` › « ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation »… » |
| DP83 | Simulations › « Publier » (sélection ou tous les brouillons) | POST …/simulations/publier | S-client | publier (SIMULATION, cible : tous les brouillons ou ids) | couvert | `mcp-gestes.test.ts` › « « publier » SIMULATION sur un dossier (ex-« publier_simulation ») : les… » |
| DP84 | Simulations › « Masquer » / « Afficher » | PATCH …/simulations/:sid | R / S-client | publier (SIMULATION, publier ou retirer) | couvert | `mcp-gestes.test.ts` › « SIMULATION : une simulation masquée n'est pas republiée ; le brouillon… » |
| DP85 | Simulations › « Repasser en brouillon » | … {brouillon} | R | modifier SIMULATION (statut BROUILLON) | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| DP86 | Simulations › « Retirer » (archivée) | … {retirer, motif} | S-suppr | archiver / restaurer (SIMULATION) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| DP87 | Simulations › modifier titre et description (route sans bouton) | … {modifier} | R | modifier SIMULATION (titre, description) | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| DP88 | Le reste › Familles : cocher ou décocher familles et sous-parties | PATCH /api/dossiers/:id/prestations | R | modifier DOSSIER (familles, ajouter_sous_parties, retirer_sous_parties) | couvert | `mcp-v2.test.ts` › « « Passe la salle de bain en sous-partie douche » : refusé avec les… » |
| DP89 | Le reste › Délais et écarts : corriger la date réelle d'un passage d'étape | PATCH /api/dossiers/:id/evenements/:evenementId {survenuLe} | R | modifier DOSSIER (passage : evenement_id, survenu_le) | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP90 | Le reste › Délais et écarts : lecture | GET /api/dossiers/:id | L | lire_fiche (dossier : délais et écarts) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP91 | Le reste › Dépenses : liste, total, justificatif | GET /api/dossiers/:id/depenses | L | voir_fichiers (documents : justificatif) ; lister DEPENSES | couvert | `mcp-fichiers.test.ts` › « voir_fichiers : justificatif d'une dépense en image ou en lien… » |
| DP92 | Le reste › « Nouvelle dépense » | → /depenses/nouvelle?dossier= | R | creer DEPENSE (avec justificatif, dossier_id) | couvert | `mcp-partie-c.test.ts` › « creer DEPENSE avec justificatif : comme « Enregistrer la dépense »… » |
| DP93 | Le reste › Étapes et notes : note à une étape choisie | POST /api/dossiers/:id/notes {etape, contenu} | R | creer NOTE (dossier, etape) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| DP94 | Le reste › Coordonnées : nom du client, téléphone, e-mail, adresse, code postal, ville, objet, source, montant estimé, dates (chantier, souhaitée, fin) | PATCH /api/dossiers/:id | R (S pour montant, dates de chantier, adresse) | modifier DOSSIER (client_nom, source, coordonnées) | couvert | `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP95 | Le reste › Coordonnées › « Changer de fiche client » | GET /api/clients ; PATCH /api/dossiers/:id {clientId} | S | modifier DOSSIER (client_id) | couvert | `mcp-sensibles.test.ts` › « modifier DOSSIER — changer de fiche client : aperçu et jeton, aucune écriture » ; `mcp-generiques.test.ts` › « DOSSIER : cœur (montant, objet) et suite (nom, source, point masqué) en… » |
| DP96 | Le reste › Chronologie du client : familles filtrables, « tout voir » | GET /api/chronologie | L | lire_fiche (chronologie : familles) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| DP97 | Le reste › « Archiver le dossier » (motif) | POST /api/dossiers/:id/archivage {archiver} | S-suppr | archiver (dossiers, motif) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |

### 2.5 Espaces clients (`/espaces`) — retiré par la mission 18 (A1)

L'onglet n'existe plus : `/espaces` redirige vers le filtre « Espaces » de Dossiers (E1–E4, en 2.3). Ses gestes E5–E20
ne sont plus des gestes d'écran ; chacun reste dans le bloc Espace du panneau du dossier (DP) ou dans la fiche client
(C), avec son outil et son test. La colonne « Aujourd'hui » dit où vit le geste (l'ancien tableau est dans
l'historique git) ; ces lignes ne sont plus comptées en 2.17. La liste par client reste pour l'assistant : `lister`
ESPACES.

| # | Action (ancien onglet) | Aujourd'hui |
|---|---|---|
| E5 | Raccourcis Photos / Messages / Devis / Encaisser | raccourcis de la ligne de Dossiers (D11) |
| E6 | « Accorder un projet de plus » | fiche client (C22) |
| E7 | « Voir comme le client » | fiche client (C28), panneau (DP30) |
| E8 | « Copier son lien » | fiche client (C27), panneau (DP29) |
| E9 | « Nouveau lien… » | fiche client (C29), panneau (DP34) |
| E10 | « Désactiver » | fiche client (C30), panneau (DP33) |
| E11 | « Accorder 3 simulations » | panneau (DP46) |
| E12, E13 | « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » | panneau (DP49) |
| E14 | « Simulateur » | écran Simulateur depuis le panneau (`/simulateur?dossier=`) |
| E15 | Geste « Publier » | panneau (DP45) |
| E16 | Geste « Appeler » (`tel:`) | sans objet (noter_appel ensuite) |
| E17 | « Dossier » | la ligne ouvre le panneau |
| E18 | « Ce projet, comme lui » | panneau (DP30) |
| E19 | « Envoyer le lien par mail » | panneau (DP31) |
| E20 | « SMS avec le lien » → « Copier » | panneau (DP32) |

### 2.6 Mail (`/mail`)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| M1 | Relire la boîte (à l'ouverture et bouton « Relire ») | POST /api/mail/synchroniser | R | traiter_mail (RELIRE_BOITE) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| M2 | Onglets À traiter, Clients, Administratif (compteurs) | GET /api/mail?vue= | L | lister MAILS | couvert | `mcp-lister-etat.test.ts` › « MAILS : listerVue par vue (rangés compris), recherche dans la vue… » ; `mcp-mail.test.ts` › « 2. « Qu'est-ce que j'ai à traiter ? » : par priorité, la réclamation en… » |
| M3 | « Rangés » (repli en bas de page) | GET /api/mail?vue=RANGES | L | lister MAILS (vue RANGES) | couvert | `mcp-lister-etat.test.ts` › « MAILS : listerVue par vue (rangés compris), recherche dans la vue… » |
| M4 | Recherche « Nom, adresse, objet… » dans la vue | GET /api/mail?vue&recherche | L | lister MAILS (recherche dans la vue) ; rechercher_mails | couvert | `mcp-lister-etat.test.ts` › « MAILS : listerVue par vue (rangés compris), recherche dans la vue… » ; `mcp-mail.test.ts` › « 9. « Retrouve le client qui voulait du marbre sur l'îlot » » |
| M5 | Bloc « Messages de l'espace client » | GET /api/mail | L | lister MESSAGES_ESPACE | couvert | `mcp-v2.test.ts` › « « lister » MESSAGES_ESPACE (ex-« messages_espace ») puis «… » |
| M6 | « Tout nettoyer » (confirmation) | POST /api/mail/nettoyer | R (masse) | traiter_mail (TOUT_NETTOYER) | couvert | `mcp-gestes.test.ts` › « RATTACHER à un client (même état que « Rattacher ») ; plus de trois… » |
| M7 | Lu / Non lu | POST /api/mail/:id/action {LU, NON_LU} | R | traiter_mail (LU, NON_LU) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » |
| M8 | Archiver / Désarchiver (sort d'« À traiter ») | … {ARCHIVER, DESARCHIVER} | R | traiter_mail (ARCHIVER, DESARCHIVER) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » |
| M9 | « Remonter » un mail rangé (l'expéditeur ne sera plus rangé) | … {REMONTER} | R | traiter_mail (REMONTER) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » |
| M10 | « Ne plus me montrer cet expéditeur » | … {NE_PLUS_MONTRER} | R (pour toujours) | traiter_mail (NE_PLUS_MONTRER) | couvert | `mcp-gestes.test.ts` › « NE_PLUS_MONTRER (définitif) : aperçu et jeton, puis le même état que… » |
| M11 | « Ranger » | … {RANGER} | R | traiter_mail (RANGER) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » ; `mcp-mail.test.ts` › « 10. « Range tout ce qui vient de TikTok pour toujours » : rangement par… » |
| M12 | « Déranger » (route) | … {DERANGER} | R | traiter_mail (DERANGER) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » |
| M13 | Classer à la main CLIENT / ADMINISTRATIF / HUMAIN (route sans bouton) | … {CLASSER} | R | traiter_mail (CLASSER : classe, pour_l_expediteur) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » |
| M14 | Ouvrir un mail : fil, pièces, contexte, cartes, brouillons, envois | GET /api/mail/:id | L | lire_mail | couvert | `mcp-mail.test.ts` › « 4. « Qu'est-ce que le mail de Thimalu change dans son dossier ? »… » |
| M15 | Pièce jointe (image, fichier) | GET /api/messages/:id/pieces/:pieceId | L | voir_fichiers (piece_mail : message_id, piece) | couvert | `mcp-partie-c.test.ts` › « pièce jointe d'un mail (M15), rendu du banc (S17), générations du site… » |
| M16 | Lien « Gmail » | nav externe | L | lire_mail (lienGmail) | couvert | `mcp-mail.test.ts` › « 4. « Qu'est-ce que le mail de Thimalu change dans son dossier ? »… » |
| M17 | Intention et « ce qui est attendu » | POST /api/mail/:id/intention | R | classer_mail | couvert | `mcp-mail.test.ts` › « 1. « Classe mes mails » : lecture, classement en lot, confirmation… » |
| M18 | Résumé du fil | — | L | lire_mail / resumer_fil | couvert | `mcp-mail.test.ts` › « 3. « Résume-moi le fil avec Rousse » : lecture par le nom, résumé posé » |
| M19 | Carte « Ce que ce mail change » › « Valider » | POST /api/mail/propositions/:id {valider} | R / S | valider_proposition | couvert | `mcp-mail.test.ts` › « 4. « Qu'est-ce que le mail de Thimalu change dans son dossier ? »… » |
| M20 | Carte › « Ignorer » | … {ignorer} | R | ignorer_proposition | couvert | `mcp-sensibles.test.ts` › « ignorer_proposition — plus de trois propositions : aperçu et jeton, aucune écriture » |
| M21 | Date extraite › « Planifier » | POST /api/mail/:id/planifier | R | planifier (message_id) | couvert | `mcp-partie-c.test.ts` › « planifier avec message_id : l'action va sur le lead du mail, comme le… » ; `mcp-mail.test.ts` › « 7. « Il dit qu'il est dispo mardi 14h, planifie » : rappel du lead un… » |
| M22 | « Plus tard » (Demain 9 h, Lundi 9 h, Dans une semaine, Une autre date), « annuler » | POST /api/mail/:id/snooze | R | traiter_mail (SNOOZER, ANNULER_SNOOZE) | couvert | `mcp-gestes.test.ts` › « LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER… » ; `mcp-mail.test.ts` › « 8. « Ce mail, remets-le-moi lundi » : lundi 9 h Paris, hors d'À traiter… » |
| M23 | « Qui est-ce ? » : chercher un client, « Rattacher » | GET /api/clients ; POST /api/mail/:id/rattacher | R | chercher + traiter_mail (RATTACHER) | couvert | `mcp-gestes.test.ts` › « RATTACHER à un client (même état que « Rattacher ») ; plus de trois… » |
| M24 | « C'est une nouvelle demande : créer un lead » | POST /api/mail/:id/lead | R | creer LEAD (message_id) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| M25 | Reprendre un brouillon déposé par Claude | — | — | envoyer_mail (brouillonId) | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| M26 | « Rédiger avec l'IA » / « Réécrire » (consigne) | POST /api/mail/brouillon | S-€ (≈ 0,015 €) | rediger_mail | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| M27 | « Envoyer » (À, Objet, texte) | POST /api/mail/envoyer | S-client | envoyer_mail | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| M28 | Nouveau mail pour un contact (`?client=`, `?lead=`, `?dossier=`) | GET /api/mail/contexte | L | lire_fiche + rediger_mail | couvert | `mcp-mail.test.ts` › « 5. « Réponds à Maud que la date de pose sera fixée dès réception des… » |
| M29 | Contexte › Appeler, Fiche, Dossier | nav | — | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| M30 | Bilan du tri (route sans écran) | GET /api/mail/bilan | L | etat_crm (MAIL : bilan du tri) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |

### 2.7 Clients (`/clients`, fiche, fusion)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| C1 | Liste paginée (50), recherche « Nom, ville, e-mail, téléphone… » | GET /api/clients?recherche&page | L | lister CLIENTS (recherche, page) | couvert | `mcp-lister-etat.test.ts` › « CLIENTS : pageClients, avec catégorie, source, recherche et fiches… » |
| C2 | Filtres Catégorie, Source, « Fiches archivées » | GET /api/clients?categorie&source&archives | L | lister CLIENTS (categorie, source, vue ARCHIVES) | couvert | `mcp-lister-etat.test.ts` › « CLIENTS : pageClients, avec catégorie, source, recherche et fiches… » |
| C3 | Nombre total de clients (la provenance est partie dans l'Analytique) | SSR | L | analytique (qualité par source) / manager_clients | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| C4 | « Chercher les doublons » | POST /api/clients/doublons | R (propose seulement) | doublon (CLIENT, CHERCHER) | couvert | `mcp-gestes.test.ts` › « CLIENT : CHERCHER (comme « Chercher les doublons »), LISTER, FUSIONNER… » |
| C5 | « Nouveau client » / « Nouveau client pro » : prénom, nom ou raison sociale, SIRET, sous-traitance, téléphone, e-mail, adresse, code postal, ville, source et précision, recommandé par | POST /api/clients | R | creer CLIENT (categorie, raison_sociale, siret, adresse, source…) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| C6 | « Créer quand même » (doublon) | POST /api/clients {forcer} | R | creer CLIENT / LEAD (forcer) | couvert | `mcp-v3.test.ts` › « « creer » LEAD (ex-« creer_contact ») refuse un doublon (même numéro… » |
| C7 | Annuaire des entreprises (nom, SIREN, SIRET) | GET /api/clients/annuaire | L | lister ENTREPRISES | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| C8 | Choisir le recommandeur | GET /api/clients?recherche | L | chercher | couvert | `assistant.test.ts` › « « chercher » tolère une faute et rend les deux Rousse » |
| C9 | Lire la fiche : identité, catégorie, SIRET, provenance, recommandations, coordonnées (archivées comprises), consentements, dossiers, leads, passif, historique, fusion, anonymisation, propositions | GET /api/clients/:id | L | lire_fiche (client : fiche complète) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C10 | « Ouvrir un dossier » (→ `/dossiers?client=`) | POST /api/dossiers {clientId} | R | creer DOSSIER (client_id) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » |
| C11 | « Modifier » : catégorie, prénom, nom, raison sociale, SIRET, adresse, code postal, ville, source, précision, campagne, publicité, formulaire, premier contact, recommandeur | PATCH /api/clients/:id | R | modifier CLIENT | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| C12 | « Archiver » (motif ; dossiers en cours signalés) | POST /api/clients/:id/archiver | S-suppr | archiver (CLIENT, motif) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| C13 | « Restaurer » | POST /api/clients/:id/restaurer | R | restaurer (CLIENT) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| C14 | « Anonymiser » (RGPD) : aperçu (effacé, gardé, bloquants), motif, confirmation | GET / POST /api/clients/:id/anonymisation | S-suppr (irréversible) | anonymiser_client (motif, commentaire) | couvert | `mcp-gestes.test.ts` › « « anonymiser_client » : toujours un aperçu (effacé, gardé, bloquants)… » |
| C15 | Coordonnées › « + Téléphone » / « + E-mail » (valeur, libellé) | POST /api/clients/:id/coordonnees | R | creer COORDONNEE (nature, valeur, libelle) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| C16 | Coordonnées › « Corriger » (valeur, libellé) | POST …/coordonnees/:id {modifier} | R | modifier COORDONNEE (valeur, libelle) | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| C17 | Coordonnées › « Rendre principale » | … {principale} | R | modifier COORDONNEE (principale: true) | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| C18 | Coordonnées › « Archiver » (motif) | … {archiver} | S-suppr | archiver / restaurer (COORDONNEE) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » ; `mcp-generiques.test.ts` › « restaurerCoordonnee (redevient principale s'il n'y en a plus)… » |
| C19 | Mails commerciaux › enregistrer une réponse : statut, moyen, date, preuve | POST /api/clients/:id/consentements | R (preuve légale) | creer CONSENTEMENT (statut, moyen, recueilli_le, preuve) ; lire_fiche (client) | couvert | `mcp-generiques.test.ts` › « LEAD, CLIENT, COORDONNEE, CONSENTEMENT, NOTE (dossier et lead)… » |
| C20 | Passif › « Enregistrer » | PATCH /api/clients/:id {notes} | R | modifier CLIENT (notes) | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » |
| C21 | Espace client de la fiche : lien, visites, projets, SMS prêt | GET /api/clients/:id/espace | L | lire_fiche (client : espace permanent) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C22 | Espace › « Permettre un projet de plus » | POST /api/espaces/:permanentId {accorder-projet} | R | geste_espace (ACCORDER_PROJET) | couvert | `mcp-gestes.test.ts` › « ACCORDER_SIMULATIONS, ACCORDER_PROJET, NOUVEAU_LIEN sans mail… » |
| C23 | Chronologie du contact (familles, « tout voir ») | GET /api/chronologie?client= | L | lire_fiche (chronologie : familles) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C24 | Messages du client (30, tous statuts) | GET /api/messages?clientId= | L | lire_fiche (messages) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C25 | Historique de la fiche (résumé, date, auteur) | GET /api/clients/:id | L | lire_fiche (client : historique) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C26 | Bandeau « proposition en attente » → `/validation` | nav | L | lire_fiche (propositionsEnAttente) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |

Mission 18 (A1) : les boutons du lien de la fiche client étaient comptés avec l'onglet Espaces (E7 à E10) ; l'onglet
retiré, ils ont leurs lignes.

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| C27 | Espace › « Copier » le lien du client | — | L | lister ESPACES (lien) / lire_fiche (client : espace permanent) | couvert | `mcp-lister-etat.test.ts` › « ESPACES : pageClientsEspaces, filtre et tri de l'écran ; l'ex-«… » |
| C28 | Espace › « Voir comme le client » | lien d'aperçu signé | L | lire_fiche (espace: true : lien d'aperçu) | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |
| C29 | Espace › « Nouveau lien… » (case « Envoyer par mail », phrase modifiable) | POST /api/espaces/:permanentId {regenerer, mail, texte} | S-client | geste_espace (NOUVEAU_LIEN, mail, texte) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » ; `mcp-gestes.test.ts` › « ACCORDER_SIMULATIONS, ACCORDER_PROJET, NOUVEAU_LIEN sans mail… » |
| C30 | Espace › « Désactiver le lien » | POST /api/espaces/:permanentId {desactiver} | R | geste_espace (DESACTIVER) | couvert | `mcp-gestes.test.ts` › « sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail… » |

### 2.8 Simulateur (`/simulateur`), banc (`/simulateur/banc`), prompts (`/simulateur/prompts`)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| S1 | En-tête : coût et solde OpenAI | GET /api/simulateur/consommation | L | etat_crm (CONSOMMATION) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| S2 | 1. Client › chercher un dossier | GET /api/simulateur/dossiers?q= | L | chercher | couvert | `assistant.test.ts` › « « chercher » tolère une faute et rend les deux Rousse » |
| S3 | 1. Client › choisir (photos avant, type suggéré, goûts, préparations récentes) | GET /api/simulateur/dossiers/:id | L | voir_fichiers (photos) + lire_fiche ; voir_fichiers (preparations : préparations récentes) | couvert | `mcp-partie-c.test.ts` › « mode API : l'aperçu dit le coût et n'écrit rien ; confirmé, la… » |
| S4 | 2. Photo › choisir la photo avant | — | — | preparer_simulation (photo_id) | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| S5 | 3. Type de surface | — | — | preparer_simulation (type_surface) | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| S6 | 4. Teintes › catalogue (goûts, famille, recherche) et échantillons | GET /api/simulateur/catalogue ; GET …/echantillons/:ref | L | lister TEINTES (styles, famille, recherche ; lien de l'échantillon) | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| S7 | 4. Teintes › une teinte par zone | — | — | preparer_simulation (teintes) | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| S8 | « Préparer pour ChatGPT » | POST /api/simulateur/preparations {mode:CHATGPT} | R | preparer_simulation | couvert | `mcp-v2.test.ts` › « « Prépare une simu de la cuisine de Thimalu, colonnes café latte, îlot… » |
| S9 | « Générer par l'API » (image OpenAI) | POST /api/simulateur/preparations {mode:API} | S-€ | preparer_simulation (mode API) | couvert | `mcp-partie-c.test.ts` › « mode API : l'aperçu dit le coût et n'écrit rien ; confirmé, la… » |
| S10 | Suivre la génération | GET /api/simulateur/preparations/:id | L | voir_fichiers (preparations : état d'une préparation) | couvert | `mcp-partie-c.test.ts` › « mode API : l'aperçu dit le coût et n'écrit rien ; confirmé, la… » |
| S11 | Rouvrir une préparation (`?preparation=`) | GET /api/simulateur/preparations/:id | L | voir_fichiers (preparations, preparation_id) ; preparer_simulation (lien) | couvert | `mcp-partie-c.test.ts` › « mode API : l'aperçu dit le coût et n'écrit rien ; confirmé, la… » |
| S12 | Partager, télécharger la photo et la planche, copier le prompt, ouvrir ChatGPT | GET …/photo, …/planche | — | — | sans objet | — |
| S13 | « Déposer l'image de ChatGPT » (brouillon, préparation reprise) | POST /api/dossiers/:id/simulations | R | ajouter_fichier (DOSSIER › SIMULATION, origine_simulation CHATGPT, preparation_id) | couvert | `mcp-partie-c.test.ts` › « ajouter_fichier SIMULATION : brouillon comme « Déposer une simulation »… » |
| S14 | Voir le rendu, aller au dossier | GET /api/dossiers/:id/simulations/:sid/image | L | voir_fichiers (simulations) | couvert | `mcp-v2.test.ts` › « « voir_fichiers » simulations (ex-« voir_simulations ») : l'après en… » |
| S15 | Banc › état : cas, variantes V1/V2, rendus, estimation du coût | GET /api/simulateur/banc | L | etat_crm (BANC) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| S16 | Banc › lancer la campagne, une variante ou un cas (fenêtre de coût) | POST /api/simulateur/banc | S-€ | agir_systeme (LANCER_BANC : cas, variante) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| S17 | Banc › voir un rendu, la photo, copier le prompt | GET /api/simulateur/banc/:id/image | L | voir_fichiers (banc : rendu, photo, prompt) | couvert | `mcp-partie-c.test.ts` › « pièce jointe d'un mail (M15), rendu du banc (S17), générations du site… » |
| S18 | Prompts › lister par type | GET /api/simulateur/prompts | L | etat_crm (PROMPTS) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| S19 | Prompts › un type : version en service et historique | GET /api/simulateur/prompts/:type | L | etat_crm (PROMPTS, type) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| S20 | Prompts › lire une ancienne version | GET …/:type?version=N | L | etat_crm (PROMPTS, type, numero) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| S21 | Prompts › « Vérifier » (contrôles, aperçu du rendu ; rien n'est écrit) | POST …/:type {verifier} | L | modifier PROMPT_SIMULATION (aperçu = « Vérifier », rien n'est écrit) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| S22 | Prompts › « Enregistrer » (nouvelle version en service, note) | POST …/:type {enregistrer} | S-param | modifier PROMPT_SIMULATION (texte, note) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| S23 | Prompts › « Restaurer » une version | POST …/:type {restaurer} | R | restaurer (PROMPT_SIMULATION, numero) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |
| S24 | Prompts › annuler la saisie | — | — | — | sans objet | — |

### 2.9 Site (`/site` — réalisations et avis publiés sur coverswap.fr)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| W1 | Liste des publications et des dossiers qui ont des photos après | GET /api/publications | L | lister PUBLICATIONS | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| W2 | Fenêtre › choisir le dossier → photos proposées | GET /api/publications/_?dossier= | L | lister PUBLICATIONS (dossier : photos proposées avec leur chemin) | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » |
| W3 | « Nouvelle publication » : type (réalisation ou avis), titre, ville, type de projet, auteur, note, texte, photos avant et après, accord du client et sa date | POST /api/publications | R (brouillon) | creer PUBLICATION ; ajouter_fichier (PUBLICATION › PHOTO_AVANT, PHOTO_APRES) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » ; `mcp-fichiers.test.ts` › « dossier (par le nom), lead, client, dépense, réalisation non publiée » |
| W4 | « Modifier » | PATCH /api/publications/:id {contenu} | R ; S-client si déjà publiée | modifier PUBLICATION | couvert | `mcp-generiques.test.ts` › « CLIENT, COORDONNEE (principale + libellé), NOTE_APPEL, SIMULATION… » ; `mcp-fichiers.test.ts` › « une réalisation déjà publiée : aperçu + jeton, rien n'est posé avant la… » |
| W5 | « Publier » (exige l'accord écrit, une photo après ou un texte) | PATCH … {publier} | S-client (site public) | publier (PUBLICATION) | couvert | `mcp-gestes.test.ts` › « PUBLICATION : publier sur le site (sensible) comme « Publier » de… » |
| W6 | « Retirer » du site | PATCH … {retirer} | R | publier (PUBLICATION, retirer) | couvert | `mcp-gestes.test.ts` › « PUBLICATION : publier sur le site (sensible) comme « Publier » de… » |

### 2.10 Finances (`/finances`, allégé en partie B ; section Dépenses depuis la mission 18, A3)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| F1 | Tableau de l'année : factures à encaisser (numéro, retard), chèques à créditer, points à corriger ; année −1 / +1 | GET /api/finances?annee= | L | lister ENCOURS, CHEQUES, QUALITE_FINANCES | couvert | `mcp-lister-etat.test.ts` › « ENCOURS, CHEQUES, QUALITE_FINANCES : chargerTableauFinances ; LIVRE… » |
| F2 | Lien « les chiffres sont dans l'Analytique » | nav | L | analytique (argent) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| F3 | « Renseigner » les paramètres manquants (en lot) | POST /api/parametres {saisies[]} | S-param | modifier PARAMETRE (saisies[], en lot) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| F4 | Encours › « + » paiement reçu pour la facture N : montant, moyen, date, référence, date de crédit, note ; pièce = cette facture ; payeur = le client | POST /api/encaissements {paiement, numeroDocumentId, payeur} | S-€ | saisir_encaissement (piece : numéro de facture, avec ou sans dossier ; payeur, credite_le) | couvert | `mcp-partie-c.test.ts` › « saisir_encaissement : pièce réglée, payeur, chèque crédité ; une… » |
| F5 | Chèques › « Crédité » (date) | POST /api/encaissements/:id/credit | S-€ | modifier ENCAISSEMENT (credite_le) | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » |
| F6 | Chèques › « Rejeté » (date, motif, précision) | POST /api/encaissements/:id/rejet | S-€ | annuler_encaissement (nature REJETER) | couvert | `mcp-partie-c.test.ts` › « annuler_encaissement REJETER : chèque impayé, comme « Chèque rejeté »… » |
| F7 | Qualité › liens vers les points à corriger | nav | — | — | sans objet | — |
| F8 | Livre des recettes de l'année (par mois, mouvements) | GET /api/finances?annee= | L | lister LIVRE (annee) | couvert | `mcp-lister-etat.test.ts` › « ENCOURS, CHEQUES, QUALITE_FINANCES : chargerTableauFinances ; LIVRE… » |
| F9 | « Exporter (CSV) » | GET /api/finances/livre?annee= | L | lister LIVRE (lien du CSV) | couvert | `mcp-lister-etat.test.ts` › « ENCOURS, CHEQUES, QUALITE_FINANCES : chargerTableauFinances ; LIVRE… » |
| F10 | Lien vers le dossier d'une facture | nav | L | lire_fiche | couvert | `mcp-lister-etat.test.ts` › « dossier : historique complet paginé, tâches, mails, devis, paiements… » |

#### Section « Dépenses » (ex-écran `/depenses`, mission 18 A3) et saisie (`/depenses/nouvelle`)

La liste de l'année est une section de Finances, sur la même année que le reste de l'écran ; `/depenses` redirige vers
`/finances?section=depenses` (la requête suit : `?annee=`), qui y descend. « Nouvelle dépense » ouvre la saisie
`/depenses/nouvelle`, restée un écran (raccourci de l'application installée, file hors ligne), dont les retours mènent
à la section. Le panneau du dossier garde ses dépenses (DP91, DP92).

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| X1 | Section « Dépenses » : liste de l'année de l'écran (« à traiter » : sans chantier, sans justificatif ; total), année −1 / +1 de Finances | /finances?section=depenses&annee= ; GET /api/depenses?annee= | L | lister DEPENSES (annee ou periode, categorie, rattachement ; vue ARCHIVEES) | couvert | `mcp-lister-etat.test.ts` › « DEPENSES : listerDepenses de l'année, les retirées à part, la période… » ; `mcp-v2.test.ts` › « « Qu'est-ce que j'ai dépensé en pub ce mois-ci ? » : par catégorie… » ; `mission-18-a3.test.ts` › « la page Finances charge les dépenses de l'année demandée comme l'ancien écran… » |
| X2 | File hors ligne › « Abandonner cette saisie » | IndexedDB | — | — | sans objet | — |
| X3 | Fiche › voir le justificatif | GET /api/depenses/:id/justificatif | L | voir_fichiers (documents, cible DEPENSE : justificatif) | couvert | `mcp-fichiers.test.ts` › « voir_fichiers : justificatif d'une dépense en image ou en lien… » |
| X4 | Fiche › « Modifier » : montant, date, fournisseur, catégorie, moyen, libellé, note, chantier ou hors chantier | PATCH /api/depenses/:id | R | modifier DEPENSE (montant, payee_le, fournisseur, categorie, moyen, libelle, note, dossier_id, hors_chantier) | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » |
| X5 | Fiche › remplacer le justificatif | POST /api/depenses/:id/justificatif | R | ajouter_fichier (DEPENSE › JUSTIFICATIF) | couvert | `mcp-fichiers.test.ts` › « dossier (par le nom), lead, client, dépense, réalisation non publiée » |
| X6 | Fiche › « Retirer » (motif) | POST /api/depenses/:id/archive | S-suppr | archiver / restaurer (DEPENSE) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » ; `mcp-generiques.test.ts` › « restaurerCoordonnee (redevient principale s'il n'y en a plus)… » |
| X7 | Nouvelle › suggestions (chantiers en cours, chantier proposé, fournisseurs récents) | GET /api/depenses/suggestions | L | lister DEPENSES (vue SUGGESTIONS) | couvert | `mcp-lister-etat.test.ts` › « DEPENSES : listerDepenses de l'année, les retirées à part, la période… » |
| X8 | Nouvelle › photo du ticket (caméra, galerie) | — | — | — | sans objet (la photo part avec X9) | — |
| X9 | Nouvelle › « Enregistrer la dépense » (justificatif, reprise hors ligne) | POST /api/depenses (multipart) | R | creer DEPENSE (justificatif, note, forcer) | couvert | `mcp-partie-c.test.ts` › « creer DEPENSE avec justificatif : comme « Enregistrer la dépense »… » ; `mcp-mail.test.ts` › « 6. « Le mail de la facture Meta, mets-le en dépense » : lecture… » |
| X10 | « Enregistrer quand même » (justificatif déjà reçu) | POST /api/depenses {forcer} | R | creer DEPENSE (forcer) | couvert | `mcp-partie-c.test.ts` › « creer DEPENSE avec justificatif : comme « Enregistrer la dépense »… » |

### 2.11 Dépenses — section de Finances depuis la mission 18 (A3)

L'écran n'existe plus : `/depenses` redirige vers la section « Dépenses » de Finances (`/finances?section=depenses`) ;
ses lignes X1–X10, saisie `/depenses/nouvelle` comprise, sont en 2.10, avec leurs outils et leurs tests (les liens des
outils vers la section : `mcp-lister-etat.test.ts` › « DEPENSES : listerDepenses de l'année… », `mcp-partie-c.test.ts`
› « creer DEPENSE avec justificatif… », `mission-18-a3.test.ts`). Elles ne sont plus comptées ici en 2.17.

### 2.12 Analytique (`/analytique`, partie B)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| A1 | Onglet « Vue d'ensemble » : tuiles, tunnel, publicité, SEO, fiche Google, qualité par source, argent | GET /api/analytique?onglet=ensemble | L | analytique (ensemble) | couvert | `mcp-analytique.test.ts` › « vue d'ensemble par défaut : JSON exact de l'écran, résumé du jour… » |
| A2 | Onglet « Publicité » : par campagne et par publicité, verdict du protocole | … onglet=publicite | L | analytique (publicite) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » ; `mcp-analytique.test.ts` › « avec la dépense réelle : un coût par lead par publicité et le verdict… » |
| A3 | Onglet « SEO et Google » | … onglet=seo | L | analytique (seo) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A4 | Onglet « Site » | … onglet=site | L | analytique (site) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A5 | Onglet « Argent » (règle des 20 %, carnet, TVA, URSSAF) | … onglet=argent | L | analytique (argent) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A6 | Période : 7 j, 30 j, 90 j, mois, 12 mois | ?p= | L | analytique (p) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A7 | Dates libres (du, au) | ?du&au | L | analytique (du, au) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A8 | Filtre par source (famille) de la vue d'ensemble | ?source= | L | analytique (source) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A9 | Panneau des sources : état, dernière synchronisation, erreur, « à faire » | GET /api/analytique | L | analytique (Sources) / etat_crm (SANTE) | couvert | `mcp-analytique.test.ts` › « vue d'ensemble par défaut : JSON exact de l'écran, résumé du jour… » |
| A10 | « Relancer » la synchronisation d'une source (Meta, Google Ads, Search Console, fiche Google) | POST /api/analytique/synchro {source} | R (tâche de fond) | agir_systeme (RELANCER_SYNCHRO) | couvert | `mcp-gestes.test.ts` › « RELANCER_SYNCHRO met en file comme « Relancer » de l'Analytique… » |
| A11 | Résumé du jour et alertes | GET /api/analytique | L | analytique | couvert | `mcp-analytique.test.ts` › « vue d'ensemble par défaut : JSON exact de l'écran, résumé du jour… » |
| A12 | Liens de détail (indicateur → onglet, carnet → dossier, → Finances) | nav | — | — | sans objet | — |
| A13 | Onglet Publicité › chaîne des leads Meta, lue en base | SSR `santeMeta` | L | etat_crm (META) | couvert | `mcp-analytique.test.ts` › « sans synchronisation : dépense estimée, aucun coût par publicité (plus… » |
| A14 | Chaîne Meta › « Vérifier » (interroge Meta) | GET /api/meta/sante | L (réseau) | etat_crm (META, interroger_meta) | couvert | `mcp-analytique.test.ts` › « sans synchronisation : dépense estimée, aucun coût par publicité (plus… » |
| A15 | Chaîne Meta › « Lancer un essai » (faux lead ESSAI, avec notification) | POST /api/meta/essai {notifier:true} | R (crée un contact ESSAI) | agir_systeme (ESSAI_META) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| A16 | Chaîne Meta › « Refaire sans notification » | POST /api/meta/essai {notifier:false} | R | agir_systeme (ESSAI_META, notifier: false) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| A17 | Chaîne Meta › « Tester la notification » | POST /api/meta/notification | R (vers Lucas) | agir_systeme (TESTER_NOTIFICATION) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| A18 | Chaîne Meta › « Tout rejouer » | POST /api/meta/rejouer {} | R masse (peut envoyer un SMS d'accusé : S-client) | agir_systeme (REJOUER_META, tous) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| A19 | Chaîne Meta › « Rejouer » un `leadgen_id` | POST /api/meta/rejouer {leadgenId} | S-client (un SMS d'accusé peut partir ; relecture adverse) | agir_systeme (REJOUER_META, leadgen_id) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| A20 | Chaîne Meta › « Détail » (dépli) | — | — | — | sans objet | — |
| A21 | Vue d'ensemble › courbe : choix de la série (leads, devis) | local | — | analytique (données) | sans objet | — |
| A22 | Site › « Entonnoir du simulateur » : les étapes, les abandons, le choix de la source | local, données de l'écran | L | analytique (site : `simulateur` dans le JSON de l'écran) | couvert | `mcp-analytique.test.ts` › « chaque onglet, une période, des dates libres, un filtre par source » |
| A23 | Argent › fiscal › « Renseigner » les paramètres manquants | POST /api/parametres | S-param | modifier PARAMETRE | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| A24 | Argent › « Mois figés et export » › « Pseudonymes » (anonymiser) | GET /api/synthese?anonyme=1 | L | analytique (synthese : anonyme) | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |
| A25 | Argent › export « Texte » / « Données » de la période | GET /api/synthese/export?format= | L | analytique (synthese : chiffres clés, texte et données, liens d'export) | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |
| A26 | Argent › « Version rédigée » (à copier) | GET /api/synthese (rédaction) | L | analytique (synthese : version rédigée) | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |
| A27 | Argent › mois figés : la liste | GET /api/synthese/instantanes | L | analytique (synthese : mois_figes) | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |
| A28 | Argent › ouvrir un mois figé (figé le, intégrité, écarts avec un recalcul) | GET /api/synthese/instantanes/:mois | L | analytique (synthese : mois_fige « AAAA-MM ») | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |
| A29 | Argent › guide de lecture | texte fixe | — | — | sans objet | — |
| A30 | Vue d'ensemble › « Agent et qualité des données » : alertes de la synthèse, propositions de l'agent par auteur (acceptation, délai de décision, motifs de rejet, agent mail), points de qualité | GET /api/synthese | L | analytique (synthese : agent et qualité des données) | couvert | `mcp-partie-c.test.ts` › « la synthèse de la période (chiffres clés et version rédigée), en… » |

Les anciennes adresses `/publicite` et `/synthese` redirigent vers l'Analytique. Les outils `synthese`, `campagne` et
`voir_publicite` restent au catalogue, mais leurs chiffres sont ceux de l'Analytique (voir 4.14).

Les lignes A21 à A30 viennent de la relecture de la partie B, **en cours et pas encore commitée** au moment de
l'audit (`OutilsSynthese.tsx`, `EntonnoirSimulateur.tsx`, `CourbeEnsemble.tsx`, `FiscalArgent.tsx`). Elles ramènent
dans l'Analytique les outils de l'ancien écran Synthèse. Si la relecture les retire, retirer aussi ces lignes.

### 2.13 Paramètres (`/parametres`), par onglet

#### Activité

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| PA1 | Changer d'onglet (mémorisé ; ancres `#mail`, `#sms`…, `?section=` depuis la mission 18, A5 ; onglet Tarifs depuis A6) | — | — | — | sans objet | — |
| PA2 | Lire les groupes Pilotage, Suivi commercial (dont la **zone d'intervention** `ZONE_DEPARTEMENTS(_PROCHES)` et les délais de relance, `DELAI_RELANCE_AVIS` compris depuis la mission 18, A4), Campagne publicitaire, Simulateur, RGPD : valeur en vigueur, valeurs futures, source | GET /api/parametres | L | etat_crm (PARAMETRES, groupe) | couvert | `mcp-v3.test.ts` › « « etat_crm » PARAMETRES / « modifier » PARAMETRE et AUTOMATISME (ex-«… » ; `mission-18-a4.test.ts` › « « etat_crm » PARAMETRES : plus d'interrupteur de séquence ; le délai… » |
| PA3 | « Historique » d'un paramètre | page | L | etat_crm (PARAMETRES : historique complet) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PA4 | « Nouvelle valeur » / « Renseigner » : valeur, valable du, source | POST /api/parametres {saisies[]} | S-param | modifier PARAMETRE (cle, valeur, valable_du, source ; ou saisies[]) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PA5 | Connexions › « Connecter » / « Reconnecter » le compte Google | GET /api/google/connexion | S-sécu | — | sans objet (consentement dans le navigateur) | — |
| PA6 | Connexions › Google › « Déconnecter » | POST /api/google/deconnexion | S-sécu | agir_systeme (DECONNECTER_GOOGLE) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| PA7 | Connexions › état Google, miroir Drive, agent mail | GET /api/connexions | L | etat_crm (CONNEXIONS : Google, miroir Drive, agent mail) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PA8 | Drive › « Synchroniser maintenant » | POST /api/drive/synchroniser {} | R (tâche de fond) | agir_systeme (SYNCHRONISER_DRIVE) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| PA9 | Drive › « Vérifier Drive » | POST /api/drive/synchroniser {verifier:true} | R | agir_systeme (VERIFIER_DRIVE) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| PA10 | Agent mail › « Relever maintenant » | POST /api/messages/relever | R | agir_systeme (RELEVER_MAILS) | couvert | `mcp-gestes.test.ts` › « SYNCHRONISER_DRIVE, VERIFIER_DRIVE, RELEVER_MAILS, ESSAI_META… » |
| PA11 | Marque de l'espace client (rien à régler) | — | L | — | sans objet | — |

#### Facturation

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| PF1 | « Nouvelle valeur » : encaissements, factures aux professionnels ; Avancé : seuils fiscaux, cotisations | POST /api/parametres | S-param | modifier PARAMETRE | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PF2 | Déplier « Avancé » | — | — | — | sans objet | — |
| PF3 | Numérotation › prochain numéro de devis et de facture | GET /api/numeros/compteurs | L | etat_crm (NUMEROTATION) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PF4 | Numérotation › « Faire repartir à… » | PATCH /api/numeros/compteurs {serie, prochain} | S-param | modifier COMPTEUR (serie, prochain) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |

#### Tarifs (ex-sous-mode du générateur de Dossiers, mission 18 A6)

`/parametres?section=tarifs` (ancre `#tarifs`) : les tarifs des devis et le tarif de chaque prestation
(`GestionTarifs.tsx`, déplacé de Dossiers). Les presets sont lus par la page avec les autres réglages ; le générateur
de documents les propose toujours ligne par ligne (DP67) et son lien « Gérer les tarifs » ouvre l'onglet. Les outils
rendent un lien vers l'onglet (`mission-18-a6.test.ts` › « lister TARIFS, l'outil des tarifs (une sous-partie ou toutes), et le… »). Pas d'ancienne adresse : c'était un sous-mode, sans URL.

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| DP64 | Lire les tarifs (presets : désignation, unité, prix) et le tarif de chaque prestation ; le générateur les propose | page (`listerPresets`) ; GET /api/dossiers/presets ; GET /api/prestations/tarifs | L | lister TARIFS (sous-parties et presets avec identifiant) | couvert | `mcp-lister-etat.test.ts` › « TARIFS (presets avec identifiant), PUBLICATIONS, CRENEAUX, TEINTES… » ; `mission-18-a6.test.ts` › « lister TARIFS, l'outil des tarifs (une sous-partie ou toutes), et le… » |
| DP70 | Modifier un tarif (désignation, unité, prix) › « Enregistrer » | PATCH /api/dossiers/presets/:id | S-param | modifier TARIF (designation, unite, prix_unitaire) / modifier SOUS_PARTIE | couvert | `mcp-generiques.test.ts` › « argent : DOCUMENT repris, ENCAISSEMENT, TARIF sensibles (rien sans… » ; `mcp-v2.test.ts` › « « modifier » SOUS_PARTIE (ex-« modifier_tarifs ») : aperçu avec… » ; `mission-18-a6.test.ts` › « les gestes de l'onglet (ajouter, modifier, retirer, attribuer) laissent… » |
| DP71 | « Ajouter » un tarif | POST /api/dossiers/presets | S-param | creer TARIF | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » ; `mission-18-a6.test.ts` › « les gestes de l'onglet (ajouter, modifier, retirer, attribuer) laissent… » |
| DP72 | « Retirer » un tarif (archivé, jamais effacé) | DELETE /api/dossiers/presets/:id | S-suppr | archiver / restaurer (TARIF) | couvert | `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » ; `mcp-generiques.test.ts` › « restaurerCoordonnee (redevient principale s'il n'y en a plus)… » ; `mission-18-a6.test.ts` › « les gestes de l'onglet (ajouter, modifier, retirer, attribuer) laissent… » |
| DP73 | « Tarif de chaque prestation » › attribuer un tarif à une sous-partie, ou « automatique » | POST /api/prestations/tarifs {cle, presetId} | S-param | modifier SOUS_PARTIE (preset_id, ou null = automatique) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » ; `mission-18-a6.test.ts` › « les gestes de l'onglet (ajouter, modifier, retirer, attribuer) laissent… » |

#### Mail

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| PM1 | Lire le guide de style, les modèles de notification, les règles d'expéditeur, les règles proposées | GET /api/mail/reglages | L | etat_crm (MAIL : guide, modèles complets, règles posées et proposées) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PM2 | Guide › « Enregistrer » / « Annuler » | PATCH /api/mail/reglages {guide} | S-param | modifier GUIDE_STYLE (texte) ; annuler_modification | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PM3 | Guide › « Tirer de mes mails envoyés » (IA) | POST /api/mail/reglages/guide | S-param + S-€ | modifier GUIDE_STYLE (tirer_des_mails: true) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PM4 | **Modèle de mail** › « Couper » / « Réactiver » | PATCH /api/mail/reglages {modele…actif} | S-param | modifier AUTOMATISME (code NOTIF_<EVT>, actif) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » ; `mcp-v3.test.ts` › « « etat_crm » PARAMETRES / « modifier » PARAMETRE et AUTOMATISME (ex-«… » |
| PM5 | **Modèle de mail** › Objet, Phrase, Bouton › « Enregistrer » | PATCH /api/mail/reglages {modele} | S-param (texte envoyé aux clients) | modifier MODELE_MAIL (evenement, objet, phrase, bouton) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » ; `mcp-sensibles.test.ts` › « modifier MODELE_MAIL — phrase d'un mail : aperçu et jeton, aucune écriture » |
| PM6 | Règles proposées › « Valider » / « Ignorer » | POST /api/mail/propositions/:id | S-param | valider_proposition / ignorer_proposition | couvert | `mcp-mail.test.ts` › « 10. « Range tout ce qui vient de TikTok pour toujours » : rangement par… » |
| PM7 | « Ajouter la règle » (adresse ou @domaine ; RANGER, NE_JAMAIS_RANGER, ADMINISTRATIF) | PATCH /api/mail/reglages {regle} | S-param | creer REGLE_EXPEDITEUR (cible, action, motif) | couvert | `mcp-generiques.test.ts` › « DOSSIER (depuis une fiche client ; « Signé » d'emblée : sensible)… » ; `mcp-sensibles.test.ts` › « creer REGLE_EXPEDITEUR — règle d'expéditeur : aperçu et jeton, aucune écriture » |
| PM8 | « Retirer » une règle | PATCH /api/mail/reglages {archiverRegle} | S-param | archiver / restaurer (REGLE_EXPEDITEUR) ; etat_crm (MAIL : règles posées) | couvert | `mcp-generiques.test.ts` › « restaurerCoordonnee (redevient principale s'il n'y en a plus)… » ; `mcp-generiques.test.ts` › « archiver puis restaurer huit entités en un appel (au-delà de trois… » |

#### SMS

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| PS1 | Fournisseur, expéditeur, variables à poser | page (`etatFournisseur`) | L | etat_crm (SMS : fournisseur, expéditeur, variables) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PS2 | Catalogue par groupe (texte, usage, longueur) | page (`listerCatalogue`) | L | etat_crm (SMS) | couvert | `mission-14-partie-8.test.ts` › « « groupe: SMS » rend le seul catalogue, par groupe, CODE — libellé : «… » |
| PS3 | **Modèle de SMS** › « Enregistrer » un texte | PATCH /api/sms/modeles/:id {texte} | S-param | modifier MODELE_SMS (code, texte) | couvert | `mission-14-partie-8.test.ts` › « modifier MODELE_SMS (ex-« modifier_parametres » sms_code + sms_texte)… » |
| PS4 | **Modèle de SMS** › « Couper l'envoi automatique » / « Réactiver » (accusés) | PATCH … {actif} | S-param | modifier AUTOMATISME (code SMS_ACCUSE_*, actif) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PS5 | **Modèle de SMS** › « Revenir au texte de départ » | PATCH … {texte} | S-param | modifier MODELE_SMS (defaut: true) ; etat_crm (SMS : texte de départ) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » ; `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PS6 | « Simplifier les accents », « Annuler » | local | — | — | sans objet | — |

#### Assistant

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| PC1 | Adresse MCP › « Copier » | — | — | — | sans objet | — |
| PC2 | Applications et jetons connectés | GET /api/assistant/acces | L | etat_crm (ACCES) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PC3 | « Tout révoquer » | DELETE /api/assistant/acces {tout} | S-sécu | agir_systeme (REVOQUER_ACCES, tout) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| PC4 | « Révoquer l'application » | DELETE … {clientId} | S-sécu | agir_systeme (REVOQUER_ACCES, application_id) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| PC5 | « Révoquer » un jeton | DELETE … {jetonId} | S-sécu | agir_systeme (REVOQUER_ACCES, jeton_id) | couvert | `mcp-gestes.test.ts` › « sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE… » |
| PC6 | **Consignes** / Positionnement : lire le texte et les versions | GET /api/assistant/consignes | L | ressource coverswap://consignes + etat_crm (CONSIGNES, CONSIGNES_VERSIONS) | couvert | `mcp-v2.test.ts` › « « modifier » CONSIGNES (ex-« modifier_consignes ») : diff en aperçu… » ; `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PC7 | Consignes › « Enregistrer » (texte entier) | PATCH /api/assistant/consignes | S-param | modifier CONSIGNES / POSITIONNEMENT | couvert | `mcp-v2.test.ts` › « « modifier » CONSIGNES (ex-« modifier_consignes ») : diff en aperçu… » ; `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |
| PC8 | Consignes › « Revenir au défaut » | PATCH {consignes: défaut} | S-param | modifier CONSIGNES (defaut: true) ; etat_crm (CONSIGNES : texte par défaut) | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » ; `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| PC9 | Consignes › « Restaurer » une version | PATCH {restaurer} | R | restaurer (CONSIGNES, numero) | couvert | `mcp-v2.test.ts` › « « modifier » CONSIGNES (ex-« modifier_consignes ») : diff en aperçu… » |
| PC10 | Outils par famille et niveau | page (`catalogueVue`) | L | etat_crm (OUTILS) | couvert | `mcp-v3.test.ts` › « « tools/list » expose exactement le catalogue (registre dérivé du code)… » |
| PC11 | Groupe « Agent mail et IA » (IA_*, MAIL_*, budget) | POST /api/parametres | S-param | modifier PARAMETRE / AUTOMATISME | couvert | `mcp-generiques.test.ts` › « réglages uniques (paramètre, compteur, automatisme, SMS, mail, guide… » |

#### Système (ex-écran `/taches-de-fond`, mission 18 A5)

`/parametres?section=systeme` (où `/taches-de-fond` redirige ; ancres `#systeme`, `#taches-de-fond`, `#coherence`,
`#audit`, `#sessions`). Chaque bloc se lit à l'ouverture de l'onglet par sa route (celle de son bouton) ; les outils
rendent un lien vers l'onglet (`mission-18-a5.test.ts` › « etat_crm (vue générale, SANTE, TACHES_DE_FOND, COHERENCE,
AUDIT, SESSIONS), agir_systeme et manager_operations »).

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| B1 | État des tâches : compteurs, file, planifications ; « Actualiser », pages | GET /api/taches | L | etat_crm (TACHES_DE_FOND) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| B2 | Tâche en échec › « Relancer » | POST /api/taches/:id/relancer | R | agir_systeme (RELANCER_TACHE) | couvert | `mcp-gestes.test.ts` › « RELANCER_TACHE (direct) et ANNULER_TACHE (sensible) : même état que les… » |
| B3 | Tâche en attente ou en échec › « Annuler » | POST /api/taches/:id/annuler | S (un envoi peut ne jamais partir) | agir_systeme (ANNULER_TACHE) | couvert | `mcp-gestes.test.ts` › « RELANCER_TACHE (direct) et ANNULER_TACHE (sensible) : même état que les… » |
| B4 | Cohérence › rapport, « Recontrôler » | GET /api/coherence | L | etat_crm (COHERENCE : clé, correction proposée) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| B5 | Cohérence › « Corriger » | POST /api/coherence/corriger {cle} | R / S selon la correction | agir_systeme (CORRIGER_INCOHERENCE, cle) | couvert | `mcp-gestes.test.ts` › « RELANCER_SYNCHRO met en file comme « Relancer » de l'Analytique… » |
| B6 | Audit des connexions › « Revérifier » | GET /api/audit/connexions | L | etat_crm (AUDIT) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |
| B7 | Sessions de l'assistant et appels d'outils › « Rafraîchir » | GET /api/assistant/sessions | L | etat_crm (SESSIONS) | couvert | `mcp-lister-etat.test.ts` › « chaque partie répond (SANTE, PARAMETRES, OUTILS, CONSIGNES_VERSIONS… » |

### 2.14 À valider (`/validation`)

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| V1 | Onglets « À valider », « En cours ou en échec », « Historique » | GET /api/validation?statut=&limite= | L | lister PROPOSITIONS (vue EN_ATTENTE, ECHEC, HISTORIQUE) | couvert | `mcp-lister-etat.test.ts` › « PROPOSITIONS : les onglets de « À valider », et une proposition lue en… » |
| V2 | Filtre par type | filtre local | L | lister PROPOSITIONS (type) | couvert | `mcp-lister-etat.test.ts` › « PROPOSITIONS : les onglets de « À valider », et une proposition lue en… » |
| V3 | Ouvrir une proposition précise (`?proposition=`, depuis Tâches) | SSR | L | lister PROPOSITIONS (proposition_id) | couvert | `mcp-lister-etat.test.ts` › « PROPOSITIONS : les onglets de « À valider », et une proposition lue en… » |
| V4 | « Valider » telle quelle | POST /api/validation/:id/valider | selon le type : R, S-client (mail, SMS), S-€ (étape), S-suppr (fusion, anonymisation) | valider_proposition (sensibilité du type) | couvert | `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » |
| V5 | « Corriger » puis valider (champs du type : fiche à conserver, texte du mail, date…) | … {corrections} | selon le type | valider_proposition (corrections : champs corrigibles du type) | couvert | `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » ; `mcp-gestes.test.ts` › « CLIENT : CHERCHER (comme « Chercher les doublons »), LISTER, FUSIONNER… » |
| V6 | « Rejeter » (motif de la liste, commentaire) | POST /api/validation/:id/rejeter | R | ignorer_proposition | couvert | `mcp-sensibles.test.ts` › « ignorer_proposition — plus de trois propositions : aperçu et jeton, aucune écriture » |
| V7 | « Réessayer » une exécution en échec | POST /api/validation/:id/reessayer | selon le type | valider_proposition (reessayer: true) | couvert | `mcp-partie-c.test.ts` › « en_lot : seules les propositions validables en lot passent (comme «… » |
| V8 | « Tout valider (n) » (seulement les types en lot) | POST /api/validation/lot | R masse | valider_proposition (en_lot: true, garde validationGroupee) | couvert | `mcp-partie-c.test.ts` › « en_lot : seules les propositions validables en lot passent (comme «… » |
| V9 | Fusion de clients › « Valider » | POST /api/validation/:id/valider | S-suppr (pas de « défusion ») | doublon (CLIENT, FUSIONNER) / valider_proposition (sensible) | couvert | `mcp-gestes.test.ts` › « CLIENT : CHERCHER (comme « Chercher les doublons »), LISTER, FUSIONNER… » ; `mcp-gestes.test.ts` › « un mail proposé hors d'une carte de mail, une fusion de clients… » |
| V10 | Fusion de clients › choisir la fiche à conserver (A ou B) | … {corrections:{conserver}} | S-suppr | doublon (CLIENT, FUSIONNER, conserver A ou B ; ECARTER, motif) | couvert | `mcp-gestes.test.ts` › « CLIENT : CHERCHER (comme « Chercher les doublons »), LISTER, FUSIONNER… » |
| V11 | Liens de la carte (fiches, dossier, message) | nav | — | — | sans objet | — |

### 2.15 Tâches de fond — onglet Système de Paramètres depuis la mission 18 (A5)

L'écran n'existe plus : `/taches-de-fond` redirige vers l'onglet « Système » de Paramètres
(`/parametres?section=systeme`) ; ses lignes B1–B7 sont en 2.13, avec leurs outils et leurs tests (redirection, onglet
et liens : `mission-18-a5.test.ts`). Elles ne sont plus comptées ici en 2.17, mais sous « Paramètres › Système ».

### 2.16 Navigation et application

| # | Action | Route | Nature | Outil MCP | Statut | Test |
|---|---|---|---|---|---|---|
| N1 | Barre à 10 onglets (mission 18, A6) : Tâches, Leads, Dossiers, Mail, Clients, Analytique ; Simulateur, Site, Finances, Paramètres. Téléphone : Tâches, Leads, Dossiers, Mail, Analytique, puis « Plus » (Clients, Simulateur, Site, Finances, Paramètres). Espaces clients retiré en A1, Dépenses en A3 (la saisie `/depenses/nouvelle` allume Finances), Tâches de fond en A5 (onglet Système de Paramètres), les tarifs dans Paramètres en A6 | — | — | — | sans objet | — |
| N2 | Compteurs de la barre : tâches du jour, leads en retard, mails à traiter (mission 18, A5 : plus de badge des tâches de fond en échec, un seul compteur : l'échec est une tâche système de Tâches ; la route garde la clé `tachesEnEchec`) | GET /api/pilotage/compteurs | L | point_du_jour / taches / etat_crm | couvert | `mcp-taches.test.ts` › « relecture : un seul compteur de mails — taches TOUT et point_du_jour… » |
| N3 | Accueil `/` → `/taches` ; `/publicite` et `/synthese` redirigés ; `/espaces` → `/dossiers?espace=TOUS`, `/depenses` → `/finances?section=depenses`, `/taches-de-fond` → `/parametres?section=systeme` (mission 18 ; 307 sans chaîne, vers un écran qui existe : `mission-18-a6.test.ts`) ; service worker en `v12` | — | — | — | sans objet | — |
| N4 | Retour d'appel « Comment ça s'est passé ? » | POST /api/commercial/appels | R | noter_appel | couvert | `mission-14-partie-8.test.ts` › « pas de réponse : le SMS A avec le rappel de demain 18 h, puis «… » |
| N5 | Écran SMS commun (« Copier » vaut envoi) | POST /api/sms/copie | S-client | noter_sms | couvert | `mission-14-partie-8.test.ts` › « texte seul : noté en texte libre ; ni code ni texte : refusé par le… » |
| N6 | Bandeau « Reconnecter Google » | nav /api/google/connexion | S-sécu | — | sans objet | — |
| N7 | Pastille des propositions en attente | GET /api/validation?statut=EN_ATTENTE | L | lister PROPOSITIONS / taches (TOUT) | couvert | `mcp-v2.test.ts` › « « taches » TOUT (ex-« ce_qui_m_attend ») et « point_du_jour » comptent… » |
| N8 | Connexion (identifiant, mot de passe) | NextAuth | S-sécu | — | sans objet (le MCP a son propre OAuth) | — |
| N9 | `/oauth/autoriser` › « Accorder » / « Refuser » | POST /api/oauth/autoriser | S-sécu | — | sans objet | — |
| N10 | Hors ligne (service worker) | — | — | — | sans objet | — |

### 2.17 Bilan chiffré

Comptes faits sur les tableaux ci-dessus (une ligne = une action). « Audit » : statuts relevés avant la partie C
(84 outils) ; « Après » : statuts après la partie C (53 outils).

| Écran | Actions | Audit : couvert | Audit : partiel | Audit : manquant | Après : couvert | Sans objet |
|---|---|---|---|---|---|---|
| Tâches | 38 | 24 | 4 | 6 | 34 | 4 |
| Leads (liste) | 28 | 12 | 6 | 6 | 24 | 4 |
| Leads (fiche) | 27 | 9 | 10 | 7 | 26 | 1 |
| Fin d'appel | 9 | 8 | 0 | 0 | 8 | 1 |
| Dossiers (liste, création, reprise) | 16 | 4 | 5 | 4 | 13 | 3 |
| Dossier (panneau et rubriques) | 92 | 37 | 23 | 31 | 91 | 1 |
| Espaces clients | 20 | 9 | 6 | 4 | 19 | 1 |
| Mail | 30 | 17 | 8 | 5 | 30 | 0 |
| Clients | 26 | 4 | 10 | 12 | 26 | 0 |
| Simulateur, banc, prompts | 24 | 6 | 5 | 11 | 22 | 2 |
| Site | 6 | 0 | 1 | 5 | 6 | 0 |
| Finances | 10 | 3 | 2 | 4 | 9 | 1 |
| Dépenses | 10 | 1 | 2 | 5 | 8 | 2 |
| Analytique | 30 | 14 | 1 | 11 | 26 | 4 |
| Paramètres › Activité | 11 | 2 | 2 | 4 | 8 | 3 |
| Paramètres › Facturation | 4 | 3 | 0 | 0 | 3 | 1 |
| Paramètres › Tarifs (ex-générateur de Dossiers) | 5 | 0 | 3 | 2 | 5 | 0 |
| Paramètres › Mail | 8 | 2 | 2 | 4 | 8 | 0 |
| Paramètres › SMS | 6 | 3 | 1 | 1 | 5 | 1 |
| Paramètres › Assistant | 11 | 5 | 1 | 4 | 10 | 1 |
| Paramètres › Système (ex-Tâches de fond) | 7 | 0 | 2 | 5 | 7 | 0 |
| À valider | 11 | 1 | 4 | 5 | 10 | 1 |
| Navigation et application | 10 | 4 | 0 | 0 | 4 | 6 |
| **Total** | **439** | **168** | **98** | **136** | **402** | **37** |

Hors gestes sans objet, **402 actions** relèvent du MCP.

- À l'audit : 168 couvertes (42 %), 98 partielles (24 %), 136 manquantes (34 %).
- Après la partie C : **402 couvertes (100 %)**, 0 partielle, 0 manquante. Les 37 gestes `sans objet` sont ceux de
  la règle de l'en-tête : `tel:`, presse-papiers, tri ou dépli local, consentement dans le navigateur, abonnement push
  de l'appareil, hors ligne, liens de navigation.
- **Après la mission 18, A1 (03/10/2026)** : l'onglet Espaces clients sort du compte (20 actions : 19 couvertes, 1
  sans objet) ; Dossiers passe à 20 actions (E1–E4 : 17 couvertes, 3 sans objet) ; Clients à 30 (C27–C30, 30
  couvertes). Total : **427 actions, 391 couvertes (100 % hors gestes sans objet), 36 sans objet**, 0 partielle, 0
  manquante.
- **Après la mission 18, A3 (03/10/2026)** : l'écran Dépenses devient la section « Dépenses » de Finances (X1–X10 en
  2.10) : la ligne Dépenses sort du compte, Finances passe à 20 actions (17 couvertes, 3 sans objet). Total inchangé :
  **427 actions, 391 couvertes, 36 sans objet**, 0 partielle, 0 manquante.
- **Après la mission 18, A4 (03/10/2026)** : les séquences n'avaient plus d'écran depuis la mission 13 ; l'avis et la
  réactivation passent par les gestes existants des relances (L21, L22, DP7). Total inchangé : **427 actions, 391
  couvertes, 36 sans objet**, 0 partielle, 0 manquante.
- **Après la mission 18, A5 (03/10/2026)** : Tâches de fond devient l'onglet « Système » de Paramètres (B1–B7 en
  2.13) : la ligne change de nom, pas de compte. Total inchangé : **427 actions, 391 couvertes, 36 sans objet**, 0
  partielle, 0 manquante.
- **Après la mission 18, A6 (03/10/2026)** : les tarifs passent dans Paramètres › Tarifs (DP64, DP70–DP73 en 2.13) :
  le panneau du dossier passe à 92 actions (91 couvertes, 1 sans objet), Paramètres › Tarifs compte 5 actions (5
  couvertes). Total inchangé : **427 actions, 391 couvertes, 36 sans objet**, 0 partielle, 0 manquante.

## 3. Les manques, par domaine

Un manque est une ligne `manquant`, ou ce qui manque à une ligne `partiel`, **à l'audit** (avant la partie C). Pour
chacun : les repères du tableau, puis l'outil qui le ferme (section 4). Cette section est gardée comme trace : tous
ces manques sont fermés, et la colonne « Outil MCP » de la section 2 dit par quel outil.

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

1. `rattacher_depense` crée une dépense (voir 3.14), et son lien mène à `/finances` au lieu de `/depenses`. (Mission 18,
   A3 : les dépenses sont une section de Finances ; `creer` DEPENSE, son remplaçant, mène à `/finances?section=depenses`.)
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
    **Corrigé** (mission 18, B2) : une seule validation, le même envoi refait est sans effet.
12. `noter_appel` sur un lead fait deux écritures (note d'appel, puis appel). L'écran permet la note seule.

## 4. Outillage : tous les manques fermés, 53 outils au lieu de 84

Cette section était la proposition de l'audit ; elle est **réalisée** (partie C). Les écarts avec la proposition sont
dits en 4.17.

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
| DOCUMENT | `dossiers/presentation-devis.ts › modifierPresentationDevis` | libelle_variante, visible_espace (ex-`presenter_devis`) | R ; S quand un devis masqué devient visible (vaut envoi ; mission 18 B5 : mis en ligne d'un bloc, mail « Devis disponible » d'un devis du CRM pas encore envoyé) | DP48 (repris) |
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
| AUTOMATISME | `automatismes/interrupteurs.ts › reglerAutomatisme` | code (NOTIF_*, SMS_ACCUSE_*, IA_CRM, MAIL_RANGEMENT_GMAIL…), actif. Mission 18 (A4) : plus de `SEQUENCE_*` (inconnu, 404) — `mission-18-a4.test.ts` › « les automatismes n'ont plus de séquence (aucune ligne SequenceMail créée)… » | S-param | PM4, PS4 (repris) |
| MODELE_SMS | `sms/modeles.ts › modifierModele` | code, texte, actif, libelle ; `defaut: true` (revient au texte de départ) | S-param | PS3, PS5 |
| MODELE_MAIL | `mail/notifications.ts › enregistrerModeleNotification` (le modèle entier est relu puis réécrit ; `actif` est gardé) | evenement, objet, phrase, bouton, actif | S-param (texte envoyé aux clients) | PM5 |
| GUIDE_STYLE | `mail/redaction.ts › enregistrerGuideStyle` ; `genererGuideStyle` | texte ; ou `tirer_des_mails: true` (coût d'IA) | S-param | PM2, PM3 |
| CONSIGNES, POSITIONNEMENT | `assistant/consignes.ts › enregistrerConsignes` / `enregistrerPositionnement` | mode (remplacer_section, completer_section, ajouter_section, remplacer_tout), section, contenu ; `defaut: true` | S-param | PC7, PC8 |
| PROMPT_SIMULATION | `simulateur/bibliotheque.ts › enregistrerVersion`. L'aperçu vient de `simulateur/rendu.ts › verifierModele` + `rendrePrompt` : c'est le bouton « Vérifier » de l'écran | type, texte, note | S-param | S21, S22 |

### 4.4 `creer` : entités, fonctions de service, champs permis, niveau

| Entité | Fonction de service | Champs permis | Niveau | Ferme |
|---|---|---|---|---|
| LEAD | `prospects/creation-assistant.ts › creerContactAssistant` (anti-doublon) ; avec `message_id` : `mail/rattachement.ts › creerLeadDepuisMail` | prenom, nom, telephone, email, ville, code_postal, source, type_projet, projet, ouvrir_dossier, forcer ; message_id | R | L1, M24 |
| DOSSIER | Depuis un lead (qualifié au téléphone ; mission 18 A2 : un lead du site a déjà le sien, ouvert par `ouvrirDossierAutomatique`) : `dossiers/depuis-lead.ts › ouvrirDossierDuLead` (ex-`ouvrir_dossier`). Sinon : `dossiers/dossiers.ts › creerDossier` (`schemaCreation`) | lead_id, ou client_id, ou rien ; client_nom, client_adresse, client_cp, client_ville, client_telephone, client_email, objet, source, montant_estime, prochaine_action, prochaine_action_date, etape, date_chantier, client_categorie, client_siret. Photos ensuite par `ajouter_fichier` | R ; S si etape ≥ SIGNE | D13, D14, C10 |
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
  | COORDONNEE | `clients/fiches.ts › archiverCoordonnee` | `restaurerCoordonnee` (écrit en partie C) | C18 |
  | DEPENSE | `depenses/service.ts › archiverDepense` | `restaurerDepense` (écrit en partie C) | X6 |
  | TARIF | `dossiers/presets.ts › archiverPreset` | `restaurerPreset` (écrit en partie C) | DP72 |
  | REGLE_EXPEDITEUR | `mail/boite.ts › archiverRegle` (descendu de la route) | `restaurerRegle` (écrit en partie C) | PM8 |
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
| DOSSIERS | `dossiers/dossiers.ts › pageDossiers` ; `listerDossiers` (par étape) ; `dossiers/archivage.ts › dossiersArchives` | vue EN_COURS, A_FAIRE, TOUS, ARCHIVES ; etape ; recherche ; masquer_inactifs ; page ; compteurs ; mission 18 (A1) : `espace` (MOI, CLIENT, SIGNAUX, TOUS, DESACTIVES) et `etape_espace` — le filtre « Espaces », état de l'espace par ligne (`espace/suivi.ts › espacesDesDossiers`) | D1, D4, D6–D8, E1–E4 |
| CLIENTS | `clients/fiches.ts › pageClients` | recherche, categorie, source, archives, page | C1, C2 |
| ESPACES | `espace/suivi.ts › pageClientsEspaces` ; `relances/photos.ts › relancesPhotosProposables` | qui (MOI, CLIENT, SIGNAUX, TOUS, DESACTIVES), etape, tri, page, sans_photo_ni_simulation_depuis_jours ; faits par projet. Mission 18 (A1) : plus d'écran, liste par client gardée pour l'assistant | C27 (lien) |
| MAILS | `mail/vues.ts › listerVue` ; vue NON_CLASSES = ex-`mails_non_classes` | vue A_TRAITER, CLIENTS, ADMINISTRATIF, RANGES, NON_CLASSES ; recherche dans la vue | M3, M4 |
| MESSAGES_ESPACE | `espace/messages.ts › messagesEspace` | cible, tout, limite | (ex-`messages_espace`) |
| RELANCES | `relances/service.ts › listerRelances` + `relancesPhotosProposables` ; mission 18 (A4) : `relances/avis.ts › relancesAvisProposables` et `relances/reactivation.ts › relancesReactivationProposables` (blocs rendus aussi sans devis en attente) | dossier (la réactivation porte sur un contact : aucune dans la liste d'un dossier) | (ex-`voir_relances`) |
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
| DOSSIER › DEVIS, FACTURE, AUTRE (champs de l'ex-`deposer_document`) | `dossiers/depot-document.ts › deposerDocument` ; sans fichier : `dossiers/documents-existants.ts › enregistrerDocumentExistant` | S (un devis visible vaut envoi ; « accepté » vaut signature, mission 18 B4) | DP57, DP49 (repris) |
| DOCUMENT › PDF_DOCUMENT (PDF d'un document repris) | `dossiers/documents-existants.ts › importerPdfDocument` | S-€ | DP59 |
| DEPENSE › JUSTIFICATIF | `depenses/service.ts › remplacerJustificatif` (à la création : `creer DEPENSE`) | R | X5, X9, DP92 |
| PUBLICATION › PHOTO_AVANT, PHOTO_APRES | `fichiers/stockage.ts › enregistrerFichier`, puis `site/publications.ts › modifierPublication` (chemin), dans `fichiers-depot/enregistrement.ts` | R (S-client si déjà publiée) | W3, W4 |

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

- Écrits :
  - `src/lib/fichiers-depot/` (jetons, types, source commune, enregistrement par cible) ;
  - la page publique `/depot/[jeton]` ;
  - la route `POST /api/depot/[jeton]`, inscrite dans `lib/acces/routes-publiques.ts` (30 minutes, usage unique).
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
| noter_sms | mission 18 (A4) : `code` DEMANDE_AVIS compte la demande d'avis du dossier, REACTIVATION la réactivation du contact (tracée sur le lead, refusée sans son accord), quand `lister` RELANCES les propose ; paramètres inchangés | L22, DP7 |
| annuler_modification | toutes les entités tracées par `modifier` | — |

Gardés sans changement : point_du_jour, les cinq manager_*, lire_mail, rechercher_mails, rediger_mail, supprimer,
noter_appel, envoyer_document, annuler_document, relancer, lien_espace, repondre_espace, classer_mail,
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
| NOUVEAU_LIEN (mail, texte), REACTIVER (sans mail) | `espace/gestion.ts › regenererLien` (ex-`renouveler_lien`) | S toujours (l'ancien lien meurt : le client perd l'accès, avec ou sans mail — comme l'ex-`renouveler_lien`) | DP34, E9 |
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
| CORRIGER_INCOHERENCE (cle) | `coherence/controle.ts › corrigerIncoherence` → `appliquerCorrection` (aperçu = la correction ; trace `COHERENCE_CORRIGEE`) | S si la correction change une étape, touche un devis ou envoie un mail au client (`CORRECTIONS_SENSIBLES`, mission 18 B13) | T18, B5 |
| RELANCER_SYNCHRO (META, GOOGLE_ADS, SEARCH_CONSOLE, FICHE_GOOGLE) | `analytique/synchro.ts › relancerSynchro` | R | A10 |
| SYNCHRONISER_DRIVE, VERIFIER_DRIVE | `drive/synchronisation.ts › demanderSynchronisation(verifier)` | R | PA8, PA9 |
| RELEVER_MAILS | `messages/taches.ts › demanderReleve` | R | PA10 |
| ESSAI_META (notifier) | `meta/essai.ts › lancerEssaiMeta` | R (crée un contact ESSAI) | A15, A16 |
| TESTER_NOTIFICATION (canal : alertes ou appareil) | `alertes/canaux.ts › alerter` ; `alertes/pushweb.ts › envoyerPushWeb` | R | A17, L28 |
| REJOUER_META (leadgen_id, ou tous) | `meta/leads.ts › rejouerLeadMeta` | S toujours (un SMS d'accusé peut partir, même pour un seul lead) | A18, A19 |
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

- Avant la partie C : **84** outils (empreinte `3db5c223f5bb`) ; au début de la mission 17 : 80 (`ef81342ae27b`).
- Retirés par fusion : **45**, dont 21 de lecture et 24 d'écriture (table 4.14).
- Ajoutés : **14** : lister, etat_crm, voir_fichiers, creer, modifier, ajouter_fichier, ranger_fichier, lien_depot,
  publier, traiter_mail, geste_espace, doublon, anonymiser_client, agir_systeme.
- **Total : 84 − 45 + 14 = 53 outils**, sous la limite de 100, relevé par `registreOutils()` : **53**, empreinte
  **`040d6c7aa53c`**. Il reste 47 places pour les écrans à venir, dont la mission 18.
- Les 53 :
  - **Lecture (16)** : analytique, chercher, etat_crm, lire_fiche, lire_mail, lister, manager_clients,
    manager_commercial, manager_finances, manager_marketing, manager_operations, point_du_jour, rechercher_mails,
    rediger_mail, taches, voir_fichiers.
  - **Écriture réversible (27, sensible par cas)** : agir_systeme, ajouter_fichier, annuler_modification, archiver,
    changer_etape, classer_mail, creer, deposer_brouillon, doublon, geste_espace, ignorer_proposition, lien_depot,
    lien_espace, modifier, noter_appel, noter_sms, planifier, preparer_simulation, proposer_mise_a_jour, publier,
    ranger_fichier, repondre_tache, restaurer, resumer_fil, supprimer, traiter_mail, valider_proposition.
  - **Sensibles (10)** : annuler_document, annuler_encaissement, anonymiser_client, envoyer_document,
    envoyer_lien_espace, envoyer_mail, generer_document, relancer, repondre_espace, saisir_encaissement.
- Cet outillage en place, chaque ligne `manquant` ou `partiel` de l'audit renvoie à un cas des sections 4.3 à 4.13,
  et la section 2 le dit ligne par ligne. **Zéro action manquante** ; restent les seuls gestes `sans objet`.

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

### 4.17 Réalisation (partie C) : ce qui a changé par rapport à la proposition

- **Retraits.** Les 45 outils de la table 4.14 sont retirés du catalogue. Leurs définitions ne restent que lorsqu'un
  nouvel outil les appelle (par exemple l'ex-`dossiers_par_etape` derrière `lister` DOSSIERS PAR_ETAPE, ou
  l'ex-`ranger_mail` derrière `traiter_mail`) ; le reste est supprimé. La table ancien → nouveau est dans
  `src/lib/assistant/retraits.ts` et dans une section « Outils (mission 17, partie C) » ajoutée à la lecture des
  consignes (jamais réécrite en base ; la version de Lucas reste la sienne).
- **Noms réels des parties et genres.** `etat_crm` : SANTE, META ou PUBLICITE, PARAMETRES, NUMEROTATION, SMS, MAIL,
  CONSIGNES, CONSIGNES_VERSIONS, OUTILS, TACHES_DE_FOND, COHERENCE, AUDIT, SESSIONS, CONNEXIONS, ACCES, PROMPTS, BANC,
  CONSOMMATION. `voir_fichiers` : photos, simulations, documents (dont le PDF joint d'un document, le justificatif, les
  documents d'un lead : PDF des simulations du site, devis et factures de l'ancien CRM), a_ranger, site (avec les
  générations en cours ou en échec), preparations, banc, piece_mail. Un PDF est rendu comme ressource embarquée.
- **Fonctions ajoutées pour ne jamais écrire en brut** : `agenda/depuis-mail.ts › planifierDepuisMail` (la route
  `/api/mail/[id]/planifier` l'appelle aussi), `mail/lien-espace.ts › apercuLienParMail` (aperçu sans rien ouvrir),
  `simulateur/preparation-assistant.ts › resoudrePreparation` (aperçu du mode API sans écrire), `restaurerCoordonnee`,
  `restaurerDepense`, `restaurerPreset`, `archiverRegle` / `restaurerRegle`.
- **Défauts corrigés au passage** : `geste_espace` RETIRER_ACCORD refuse sans accord en vigueur (l'ex-`retirer_accord`
  passait le dossier à « Devis envoyé » quand même) ; `annuler_encaissement` rend le bon dossier ; `valider_proposition`
  calcule la sensibilité par type ; l'anonymisation RGPD couvre aussi `FichierDepose`, `JetonDepot`,
  `ModificationAssistant`, `ModificationDossier` et `MessageEspace` (`src/lib/rgpd/carte.ts`, `anonymisation.ts`).
- **Tests.** `src/lib/mcp/mcp-partie-c.test.ts` (les extensions de la section 4.9), `src/lib/mcp/mcp-sensibles.test.ts`
  (chaque outil ou cas sensible du catalogue : aperçu, jeton, rien d'écrit sans le jeton ; un test échoue si un nouveau
  cas sensible n'y a pas son entrée), et des jumeaux ajoutés dans `mcp-gestes.test.ts` (projet, simulation et demande
  de l'espace ; Drive, relevé, relecture de la boîte, essai Meta) et `mcp-lister-etat.test.ts` (inactifs masqués).

### 4.18 Relecture adverse (01/10/2026)

Défauts confirmés après l'intégration du catalogue, corrigés, chacun avec son test (`src/lib/mcp/mcp-relecture-c.test.ts`,
`src/lib/mcp/mcp-sensibles.test.ts`, `src/lib/mcp/mcp-gestes.test.ts`, `src/lib/fichiers-depot/depot.test.ts`). Le
catalogue ne change pas : **53 outils**, mêmes paramètres, empreinte **`040d6c7aa53c`**.

- **Jeton de confirmation.** La consommation est atomique (`updateMany … utiliseLe: null`) : deux confirmations
  simultanées avec le même jeton n'exécutent plus deux fois. Un outil à portée implicite déclare `portee` : ce que
  l'aperçu a résolu entre dans l'empreinte du jeton et est revérifié à la confirmation — `annuler_modification` sans
  `modification_id` (« la dernière ») et `publier` sans `ids` (« les brouillons du dossier ») refusent si la cible a
  changé entre l'aperçu et le « oui » de Lucas.
- **Sensibilités manquantes.** `geste_espace` NOUVEAU_LIEN sans mail et REACTIVER (l'ancien lien meurt ; régression par
  rapport à l'ex-`renouveler_lien`, toujours sensible) ; `agir_systeme` REJOUER_META d'un seul lead (SMS d'accusé) ;
  `noter_appel` PAS_INTERESSE (perte : même règle que `changer_etape` PERDU, `modifier` LEAD PERDU et la tâche
  « client perdu ») ; `archiver` / `restaurer` d'un TARIF ou d'une REGLE_EXPEDITEUR (DP72 S-suppr, PM8 S-param, que le
  code ne suivait pas).
- **Écriture brute.** `traiter_mail` RATTACHER à un lead passe par `mail/rattachement.ts › rattacherAuLead` (la main
  des dossiers où le fil était tracé est relue), au lieu d'un `message.updateMany` dans l'outil.
- **Annulation de façade.** `annuler_modification` d'un prix posé sur une SOUS_PARTIE sans tarif retire (archive) le
  tarif que la modification avait créé ; avant, il restait actif et rattaché par mots-clés. Défaire « rendre un devis
  visible » dit ce qui reste (l'envoi au journal, l'étape « Devis envoyé ») : `annulationPartielle` du registre.
- **Lien de dépôt.** La page publique ne montre plus que le strict nécessaire de la cible (« Hélène G. », le
  fournisseur d'une dépense, le titre public d'une réalisation ; ni objet du projet, ni montant) ; la route vérifie le
  jeton et la clé d'envoi AVANT de lire le corps (9 Mo) ; un fichier refusé par le service après réservation rend sa
  place (le dépôt n'est plus clos à vide).
- **Choix du bon outil.** Les instructions du serveur ne disent plus « « supprimer » archive » (faux depuis la
  corbeille de la mission 11) : une demande de suppression devient `archiver`, `supprimer` seulement pour effacer ;
  `modifier` renvoie vers `changer_etape`, `noter_appel` et `geste_espace` ; `etat_crm` sans partie renvoie vers
  `point_du_jour` et `taches`. Le prompt « point du matin » et les instructions ne citent que des outils du catalogue
  (testé).
