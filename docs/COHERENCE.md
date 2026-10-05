# Cohérence entre les sections

Chaque section du CRM dit une partie de la vérité sur un client. Ce document dresse, action par action, ce que
chaque geste doit provoquer dans les autres sections — dans les deux sens — et où c'est vérifié.

Trois règles tiennent l'ensemble :

1. **Une seule lecture des faits.** Le devis en vigueur et ses montants (devis repris compris), l'accord, les
   paiements et le quota de simulations se lisent à UN endroit : `src/lib/espace/faits.ts`. L'espace du client,
   la colonne « Espace » de Dossiers (ex-onglet Espaces clients, mission 18), le bloc « Espace client » du dossier
   et le contrôle de cohérence y lisent tous. Deux écrans ne peuvent plus dire deux choses différentes (c'était la
   cause du « 0 € »).
2. **Tout geste se défait, par le client ou par Lucas, de la même façon.** `src/lib/espace/validations.ts` porte
   chaque geste avec son auteur (`CLIENT` ou `LUCAS`). Le mouvement du dossier porte une *raison* écrite dans
   l'événement : c'est elle qui permet de défaire exactement ce mouvement-là, et pas un autre que Lucas aurait
   fait à la main entre-temps.
3. **Rien ne s'efface.** Une photo retirée reste sur le disque (et se remet), un accord retiré garde sa preuve
   (annotée « retiré le … par … »), un dossier archivé se restaure. L'historique garde l'aller et le retour, avec
   qui et quand.

Légende de la colonne « Vérifié » : **T** = essai automatique (`src/lib/coherence/coherence.test.ts`, sauf mention),
**L** = parcours complet en local sur un écran d'iPhone, **P** = constaté en production (lecture seule).

## 1. Espace client → Dossier, colonne Espace de Dossiers (ex-Espaces clients), Leads, Finances

| Geste du client | Dossier | Colonne Espace de Dossiers (ex-Espaces clients) / bloc du dossier | Leads | Retour en arrière | Vérifié |
|---|---|---|---|---|---|
| Ouvre son espace pour la 1re fois | Événement « espace ouvert », alerte | Visites comptées, « jamais ouvert » disparaît | — | — | T (espace.test) |
| Dépose des photos | Événement (un par dépôt), prochaine action « préparer la simulation » si rien d'autre | Compteur de photos, vignettes | — | **Retire une photo** : elle sort de la liste du dossier, de son espace et du simulateur ; événement « photo retirée » ; le fichier reste, visible dans « photos retirées », bouton *Remettre* | T, L |
| Saisit son projet (enregistré à la frappe) | Événement « projet précisé » (un par heure, mis à jour) ; alerte unique différée | Résumé + note ENTIÈRE | — | Effacer ses choix = nouvelle saisie | T (espace-v2.test) |
| **Valide son projet** | `Qualification → Simulation` (raison « projet validé dans l'espace client ») ; prochaine action posée ; alerte | Pastille verte « Validé le … », étape de l'espace = Simulations | Statut du lead suit l'étape | **Le modifie ou le dévalide** : pastille retirée, événement, `Simulation → Qualification` *seulement si* le dossier n'avait avancé que pour ça ; revalider refait le chemin | T, L |
| Crée une simulation (quota : 5, celles du site comptent) | Événement avec zones et teintes, image dans le dossier et Drive, alerte | « n faites sur 5 (dont n sur le site) · n restantes » | — | — (elle a coûté : elle reste comptée même masquée) | T, L |
| Demande d'autres simulations | Événement, alerte | Signal rouge, bouton *Accorder 3* | — | Accorder clôt la demande | T (simulateur.test) |
| **Valide une simulation** (ou un mélange) | Prochaine action « Préparer le devis » ; événement avec les TEINTES zone par zone ; alerte forte | « Validée », teintes affichées ; onglet Devis déverrouillé | — | **Annule sa validation** (tant qu'aucun devis n'est émis) : choix vidé, événement, prochaine action retirée, onglet Devis reverrouillé. En valider une autre remplace la première. | T, L |
| Demande une autre proposition, avec un mot | Prochaine action « Préparer une autre proposition — « son mot » » ; événement ; alerte | **Son mot ENTIER** dans le bloc du dossier (et dans l'ex-onglet Espaces clients, retiré par la mission 18) (avant : seulement dans l'historique) | — | **Retire sa demande** : événement (le mot y reste), prochaine action rendue à l'état précédent | T, L |
| Complète ses coordonnées | Fiche du dossier mise à jour, événement | — | — | Se corrige en les ressaisissant | T (espace.test) |
| Lit son devis | Événement (compteur), alertes à la 1re et 3e lecture | « Devis lu n fois », signal « hésite » | — | — | T (espace-v2.test) |
| **Donne son bon pour accord** (+ signature) | `→ Signé`, devis « accepté », preuve (date, IP, navigateur, signature), alerte maximale | « Bon pour accord », onglet Paiement ouvert | Lead « SIGNE » ; conversion Meta | **Retire son accord** (tant que rien n'est encaissé et que le chantier n'est pas planifié) : preuve gardée et annotée, `Signé → Devis envoyé`, devis « émis », lead « DEVIS_ENVOYE », alerte maximale. Il peut resigner : nouvelle preuve. | T |
| Donne son avis | Événement, alerte ; publication en attente si accord écrit | Note et texte ENTIER | — | — | T (espace.test) |

## 2. Dossier (Lucas) → Espace client

| Geste de Lucas | Espace du client | Vérifié |
|---|---|---|
| Change l'étape | L'étape de l'espace est *calculée* à partir de l'étape du dossier et des faits : elle suit à la visite suivante | T |
| Recule le dossier avant « Signé » | Le devis redevient « émis » ET l'accord en ligne est retiré (annoté « par Lucas ») : l'espace redemande l'accord. *Avant : l'espace disait « signé » face à un dossier « devis envoyé ».* | T |
| Note un devis « accepté » / passe en « Signé » sans accord en ligne (signé sur papier, dossier repris) | L'espace le montre **signé** (source « CRM »), à la date réelle du passage en « Signé » ; Paiement s'ouvre. *Avant : Paiement restait verrouillé.* | T, L, P |
| Génère un devis | Onglet Devis ouvert ; la simulation validée ne se change plus d'un geste | T |
| Génère, dépose ou rend visible un devis (mission 14) | Le dossier passe à « Devis envoyé » (depuis Qualification, Simulation ou Relance), la main au client, le délai de relance court à partir du dépôt. L'étape de l'espace suit celle du dossier : « Devis à signer » seulement en « Devis envoyé » ou « Relance » ; un devis masqué n'est « le devis » que s'il est accepté (ni dans « Mes documents », ni en PDF). Masqué ou annulé ensuite (mission 18, B6) : s'il ne reste aucun autre devis en attente de sa réponse, le dossier revient à son étape d'avant le devis (Simulation ou Qualification), la main à Lucas (« refaire le devis »), « Refaire le devis », relances arrêtées ; sinon l'étape ne bouge pas et la main ne dit plus « en attente de sa réponse » sur ce devis | T (mission-14-partie-1.test, devis-retire.test) |
| Enregistre un **devis repris** (sans lignes) | Total, acompte et solde lus sur le montant du document. *Avant : « 0 € ».* | T, L, P |
| Publie / masque une simulation | Galerie du client à jour. **Masquer la simulation validée dévalide le choix** (tracé) | T |
| Valide / dévalide le projet, valide / dévalide une simulation, retire une demande ou un accord, modifie son projet, accorde des simulations, remet une photo, réinitialise une étape (bloc « Espace client ») | Mêmes fonctions que le client, auteur « Lucas » dans l'historique ; pas d'alerte sur son propre téléphone | T, L |
| Désactive / renouvelle le lien | Le client lit « lien désactivé » ; l'ancien lien meurt | T (espace.test) |
| **Archive le dossier** | Lien désactivé | T (depuis-lead.test) |

## 3. Finances ↔ Dossier ↔ Espace

| Geste | Dossier | Espace du client | Livre des recettes | Vérifié |
|---|---|---|---|---|
| Encaissement saisi (acompte) sur un dossier **Signé** | — | Paiement : « Acompte payé le … par virement », solde « dû à la fin des travaux » | Ligne à la date de réception | T, L |
| Encaissement saisi sur un dossier **Devis envoyé / Relance** | `→ Signé` automatique (raison « acompte encaissé »), devis « accepté » | Signé + acompte payé | idem | T |
| Encaissement **annulé ou chèque rejeté** | Si le dossier n'était passé « Signé » QUE par ce paiement, qu'il n'en reste aucun et qu'aucun accord n'existe : `Signé → Devis envoyé`. Prochaine action « réclamer un nouveau paiement » pour un chèque. | Ligne redevenue **« à régler »** avec le RIB | Ligne sortie du livre (statut, date, motif gardés) | T, L |
| Toutes les factures réglées | `Facturé → Encaissé` ; l'inverse si un paiement tombe | « Réglé, merci » | — | T (encaissements.test) |

## 4. Leads ↔ Dossiers

| Geste | Leads | Dossiers | Vérifié |
|---|---|---|---|
| Simulation, photos ou demande de devis venues du site (mission 18, A2 ; faits postérieurs au 03/10/2026) | Le lead, Prioritaire, reste dans « À appeler » jusqu'au premier appel (puis sort vers son dossier). Hors zone, lead Meta, simple message : il reste un lead, sans dossier | **Dossier ouvert tout seul** en Qualification, « Appeler : simulation faite sur le site » ou « Appeler : demande de devis » pour aujourd'hui (tâche « Appeler · Nom »), ou « Rappeler » à l'heure demandée ; images et photos rangées. Un contact qui a déjà un dossier vivant : tout y est rangé et rejoint son espace | T (depuis-lead.test, mission-18-a2.test) |
| « Ouvrir un dossier » (lead qualifié au téléphone) / envoi du lien de l'espace | Le lead sort de Leads | Dossier créé avec tout ce qu'on sait ; ses images et ses notes d'appel suivent | T |
| Dossier archivé | **Le lead revient**, ses simulations et photos détachées du dossier (rangées à nouveau s'il en rouvre un) | Sorti des listes ; restaurable (ce qui avait été détaché est rattaché) ; refusé s'il porte document, paiement, dépense ou accord | T |
| Dossier restauré | Le lead ressort | Revient ; refusé si le contact a un autre dossier vivant (jamais de doublon) | T |
| Changement d'étape du dossier | Statut du lead aligné (devis envoyé, signé, planifié, terminé, perdu), y compris en arrière | — | T |

## 5. Le contrôle automatique

`src/lib/coherence/controle.ts`, au démarrage (75 s après) et une fois par jour, et à la demande depuis **Paramètres ›
Système** (ex-Tâches de fond ; chaque incohérence avec son constat et, quand c'est possible, un bouton *Corriger* ;
sinon un lien vers le dossier), dans Tâches (« Corriger · Nom », un geste) et par l'assistant (`etat_crm` COHERENCE,
`agir_systeme` CORRIGER_INCOHERENCE). Une alerte part sur le téléphone seulement s'il y a quelque chose à lire.

Mission 18 (B13) : chaque correction laisse une trace `COHERENCE_CORRIGEE` (« Contrôle de cohérence : … », avec le code)
dans l'historique du dossier, pour tous les codes. Les corrections qui changent l'étape (liste figée par un essai :
`CORRECTIONS_QUI_CHANGENT_L_ETAPE`) et celles qui touchent un devis ou envoient un mail au client sont **sensibles**
(`CORRECTIONS_SENSIBLES` : l'assistant montre l'aperçu et demande confirmation ; une migration ne les applique jamais
d'office) — colonne « S » ci-dessous. `appliquerCorrection` corrige une incohérence déjà lue sans rejouer le contrôle ;
`controlerCoherence({ etendu: true })` lit aussi les dossiers perdus et archivés (les règles du lead et de la main
ne regardent jamais un dossier archivé ; celles des devis, seulement les dossiers vivants). Les corrections qui touchent
la phase du devis ou du chantier passent par le point d'entrée (`dossiers/synchro.ts`, événement `CORRECTION_COHERENCE` :
une prochaine action posée à la main n'est jamais écrasée).

Mise en route de la mission 18 (migration `mise-en-route-18`, docs/SYNCHRO.md § 7) : un contrôle étendu au démarrage,
les corrections non sensibles appliquées d'office (sauf `SIMULATIONS_HORS_DOSSIER`, laissé au filet des 15 minutes), le
reste au détecteur (dossiers vivants) ou en tâche à moi du lot « coherence-18 » (dossiers perdus ou archivés, que le
contrôle quotidien ne lit pas) ; le compte par règle dans le journal de démarrage et `etat_crm` SANTE.

| Code | Ce qui est comparé | Corriger | S |
|---|---|---|---|
| `DEVIS_MONTANT_NUL` | Devis en vigueur à 0 € (le client lirait « 0 € ») | À la main : corriger le document | |
| `ACCORD_SANS_SIGNATURE` | Accord en ligne ↔ dossier avant « Signé » (mission 18 B8 : l'accord et le passage sont d'une transaction, l'écart ne naît plus de l'espace ; un accord d'avant se termine aussi par la nouvelle tentative du client) | Passer en « Signé » (sur le devis de l'accord ; les autres variantes « non retenu », mission 18 B10) | S |
| `DEVIS_ACCEPTE_AVANT_SIGNE` | Devis « accepté » ↔ dossier avant « Signé » | Passer en « Signé », les autres devis « non retenus » (mission 18, B4 : un devis noté « accepté » vaut signature hors ligne ; le dépôt et la correction le font d'eux-mêmes depuis) | S |
| `SIGNE_SANS_DEVIS_ACCEPTE` | Dossier signé ↔ aucun devis accepté | Noter le dernier devis « accepté » | S |
| `PAIEMENT_AVANT_SIGNATURE` | Encaissement valide ↔ dossier avant « Signé » | Passer en « Signé » (sur le devis que règlent les acomptes ; les autres variantes « non retenu », mission 18 B10) | S |
| `ETAPE_ET_SOLDE` | Facturé / Encaissé ↔ factures réglées | Suivre le solde | S |
| `PROJET_VALIDE_INCOMPLET` | Pastille verte ↔ projet incomplet | Dévalider (peut ramener Simulation → Qualification : sensible depuis la mission 18, B13) | S |
| `PROJET_VALIDE_SANS_AVANCER` | Projet validé ↔ dossier en Qualification | Passer en « Simulation » | S |
| `CHOIX_SANS_SIMULATION` | Simulation validée ↔ plus visible du client | Dévalider le choix | |
| `PROCHAINE_ACTION_PERIMEE` | « Préparer le devis » / « autre proposition » ↔ faits de l'espace | Effacer l'action (ou « Attendre l'accord » si le devis est là) | |
| `STATUT_DU_LEAD` | Étape du dossier ↔ statut du lead (contrôle étendu : un dossier perdu n'impose « PERDU » que si le contact n'a pas d'autre dossier vivant) | Aligner le lead | |
| `LEAD_A_PLUSIEURS_DOSSIERS` | Un contact, plusieurs dossiers vivants | À la main : archiver le doublon | |
| `SIMULATIONS_HORS_DOSSIER` | Contact avec dossier ↔ simulations restées hors du dossier | Les ranger | |
| `PROJET_FIGE_MODIFIE` | Projet encaissé ou perdu ↔ geste du client dans son espace après la date où il s'est figé | À la main : lire ce qui a changé | |
| `PROJETS_AU_DELA_DE_LA_LIMITE` | Projets en cours d'un espace ↔ limite (2 + accordés) | Accorder ces projets (la limite suit) | |
| `MAIN_DECALEE` | Main affichée ↔ main que donnent les derniers gestes | Recalculer la main | |
| `MAIL_SANS_REPONSE` | Message du client sans réponse depuis 2 jours ↔ dossier « chez le client » | À la main : lui répondre (pas de tâche « Corriger » : « Répondre » la couvre) | |
| `DEVIS_ENVOYE_SANS_ENVOI` | Mission 18, écart 1 : Devis envoyé / Relance ↔ aucun devis parti chez le client (ni annoncé, ni mis en ligne, ni envoyé par mail ou Gmail, ni repris ; aucun visible dans un espace ouvert) | Revenir à l'étape d'avant le devis (RETOUR, pas de Meta), « Envoyer le devis au client », relances en attente annulées | S |
| `DEVIS_GMAIL_NON_ENREGISTRE` | Écart 3 : PDF parti de Gmail qui ressemble à un devis ↔ absent du dossier (`devis-gmail.ts › devisGmailNonEnregistres`) | Enregistrer comme devis envoyé (même fonction que la tâche), si le devis du CRM ou le registre donne le montant ; sinon la tâche « Enregistrer comme devis envoyé » (pas de seconde tâche « Corriger ») | S |
| `DEVIS_VISIBLE_NON_NOTIFIE` | Écart 5 : Devis envoyé / Relance ↔ devis visible dans un espace ouvert, jamais annoncé ni envoyé (interrupteur « Devis disponible » coupé : la mise en ligne vaut envoi, rien à signaler) | Le prévenir : mise en ligne datée d'aujourd'hui (relances depuis) et mail « Devis disponible » (automatisme existant, une fois par devis) ; sans adresse ou annonce en échec : à la main | S |
| `DEVIS_ENVOYE_SANS_DEVIS_ACTIF` | Écart 6 : Devis envoyé / Relance ↔ aucun devis émis, envoyé, non retenu ni accepté | Revenir à l'étape d'avant le devis, main à Lucas, « Refaire le devis », relances en attente annulées | S |
| `AVENANT_NON_PROPOSE` | Écart 7 : devis émis après la signature (Signé → Facturé), « Généré », visible, ni envoyé par mail ni en cours d'envoi, hors devis « à envoyer » (B1), et l'espace n'est pas ouvert (ouvert, il le propose et le fait signer depuis B7 ; masqué, il l'a été exprès) | Le lui envoyer par mail, texte type (le bouton « Envoyer par mail ») ; sans adresse : à la main | S |
| `ATTENTE_ACCORD_SANS_DEVIS` | Prochaine action « Attendre l'accord du client sur le devis » (pas posée à la main) ↔ aucun devis émis ou envoyé | L'effacer | |
| `DATE_CHANTIER_EN_SIGNE` | Dossier « Signé » ↔ date du chantier posée | Passer en « Planifié » (lead CHANTIER_PLANIFIE), « fixer la date du chantier » effacée | S |
| `ESPACE_ACTIF_DOSSIER_CLOS` | Dossier perdu ou archivé ↔ espace encore ouvert : projet d'un dossier archivé resté ouvert, ou lien actif alors que TOUS les projets de l'espace sont perdus ou archivés (un projet perdu à côté d'un projet vivant reste « non réalisé », par conception). Remplace `ESPACE_ACTIF_DOSSIER_ARCHIVE` (archivés d'avant la mission 5 seulement) | Fermer le projet (comme l'archivage), désactiver le lien si tous ses projets sont clos (rien n'est effacé ; un nouveau lien le rouvre ; aucun envoi) | |

## 6. Ce que la matrice a révélé de cassé (22/09/2026)

1. **Devis repris = « 0 € » dans l'espace** : l'espace recalculait le total depuis les lignes ; un devis repris
   n'en a pas. Trois endroits faisaient ce calcul chacun de leur côté (espace, Espaces clients, accord). → `faits.ts`.
2. **Devis signé hors de l'espace = « pas signé »** : l'espace ne connaissait que les accords donnés en ligne.
   Un dossier repris signé restait à « Devis à signer », Paiement verrouillé, acompte invisible.
3. **Encaissements invisibles du client** : seule une somme était lue ; ni date, ni moyen, ni solde.
4. **Recul du dossier avant « Signé »** : le devis redevenait « émis » mais l'accord en ligne restait valable →
   l'espace disait « signé ». Sens unique.
5. **Accord, validation, demande, photo : aucun retour possible côté client.** Sens unique partout.
6. **Masquer la simulation validée** laissait le client « validé » sur une image qu'il ne voyait plus.
7. **Le mot d'une demande d'autre proposition** n'existait que dans l'historique : invisible là où Lucas regarde.
8. **Acompte encaissé sur un devis envoyé** : le dossier restait « Devis envoyé » avec de l'argent dessus.
9. **Dossier archivé** : aucun geste n'existait ; et un lead dont le dossier aurait été archivé serait revenu
   dans Leads sans ses simulations (elles restaient attachées au dossier archivé).
10. **Quota de simulations** : celles du site n'étaient pas comptées ; une simulation retirée était « rendue ».
11. **Une simulation du site ouvrait un dossier d'office** : 26 dossiers jamais traités en Qualification.
