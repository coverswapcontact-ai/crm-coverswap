# Cohérence entre les sections

Chaque section du CRM dit une partie de la vérité sur un client. Ce document dresse, action par action, ce que
chaque geste doit provoquer dans les autres sections — dans les deux sens — et où c'est vérifié.

Trois règles tiennent l'ensemble :

1. **Une seule lecture des faits.** Le devis en vigueur et ses montants (devis repris compris), l'accord, les
   paiements et le quota de simulations se lisent à UN endroit : `src/lib/espace/faits.ts`. L'espace du client,
   l'onglet Espaces clients, le bloc « Espace client » du dossier et le contrôle de cohérence y lisent tous. Deux
   écrans ne peuvent plus dire deux choses différentes (c'était la cause du « 0 € »).
2. **Tout geste se défait, par le client ou par Lucas, de la même façon.** `src/lib/espace/validations.ts` porte
   chaque geste avec son auteur (`CLIENT` ou `LUCAS`). Le mouvement du dossier porte une *raison* écrite dans
   l'événement : c'est elle qui permet de défaire exactement ce mouvement-là, et pas un autre que Lucas aurait
   fait à la main entre-temps.
3. **Rien ne s'efface.** Une photo retirée reste sur le disque (et se remet), un accord retiré garde sa preuve
   (annotée « retiré le … par … »), un dossier archivé se restaure. L'historique garde l'aller et le retour, avec
   qui et quand.

Légende de la colonne « Vérifié » : **T** = essai automatique (`src/lib/coherence/coherence.test.ts`, sauf mention),
**L** = parcours complet en local sur un écran d'iPhone, **P** = constaté en production (lecture seule).

## 1. Espace client → Dossier, Espaces clients, Leads, Finances

| Geste du client | Dossier | Espaces clients / bloc du dossier | Leads | Retour en arrière | Vérifié |
|---|---|---|---|---|---|
| Ouvre son espace pour la 1re fois | Événement « espace ouvert », alerte | Visites comptées, « jamais ouvert » disparaît | — | — | T (espace.test) |
| Dépose des photos | Événement (un par dépôt), prochaine action « préparer la simulation » si rien d'autre | Compteur de photos, vignettes | — | **Retire une photo** : elle sort de la liste du dossier, de son espace et du simulateur ; événement « photo retirée » ; le fichier reste, visible dans « photos retirées », bouton *Remettre* | T, L |
| Saisit son projet (enregistré à la frappe) | Événement « projet précisé » (un par heure, mis à jour) ; alerte unique différée | Résumé + note ENTIÈRE | — | Effacer ses choix = nouvelle saisie | T (espace-v2.test) |
| **Valide son projet** | `Qualification → Simulation` (raison « projet validé dans l'espace client ») ; prochaine action posée ; alerte | Pastille verte « Validé le … », étape de l'espace = Simulations | Statut du lead suit l'étape | **Le modifie ou le dévalide** : pastille retirée, événement, `Simulation → Qualification` *seulement si* le dossier n'avait avancé que pour ça ; revalider refait le chemin | T, L |
| Crée une simulation (quota : 5, celles du site comptent) | Événement avec zones et teintes, image dans le dossier et Drive, alerte | « n faites sur 5 (dont n sur le site) · n restantes » | — | — (elle a coûté : elle reste comptée même masquée) | T, L |
| Demande d'autres simulations | Événement, alerte | Signal rouge, bouton *Accorder 3* | — | Accorder clôt la demande | T (simulateur.test) |
| **Valide une simulation** (ou un mélange) | Prochaine action « Préparer le devis » ; événement avec les TEINTES zone par zone ; alerte forte | « Validée », teintes affichées ; onglet Devis déverrouillé | — | **Annule sa validation** (tant qu'aucun devis n'est émis) : choix vidé, événement, prochaine action retirée, onglet Devis reverrouillé. En valider une autre remplace la première. | T, L |
| Demande une autre proposition, avec un mot | Prochaine action « Préparer une autre proposition — « son mot » » ; événement ; alerte | **Son mot ENTIER** dans le bloc du dossier et dans Espaces clients (avant : seulement dans l'historique) | — | **Retire sa demande** : événement (le mot y reste), prochaine action rendue à l'état précédent | T, L |
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
| Simulation faite sur le site | **Un lead**, avec ses photos et simulations sur sa fiche, Prioritaire. *Plus de dossier ouvert d'office (règle du 22/09/2026).* | Rien — sauf si le contact a déjà un dossier vivant : la simulation y est rangée et rejoint son espace | T (depuis-lead.test) |
| « Ouvrir un dossier » / envoi du lien de l'espace | Le lead sort de Leads | Dossier créé avec tout ce qu'on sait ; ses images et ses notes d'appel suivent | T |
| Dossier archivé | **Le lead revient**, ses simulations et photos détachées du dossier (rangées à nouveau s'il en rouvre un) | Sorti des listes ; restaurable (ce qui avait été détaché est rattaché) ; refusé s'il porte document, paiement, dépense ou accord | T |
| Dossier restauré | Le lead ressort | Revient ; refusé si le contact a un autre dossier vivant (jamais de doublon) | T |
| Changement d'étape du dossier | Statut du lead aligné (devis envoyé, signé, planifié, terminé, perdu), y compris en arrière | — | T |

## 5. Le contrôle automatique

`src/lib/coherence/controle.ts`, au démarrage (75 s après) et une fois par jour, et à la demande depuis **Tâches de
fond** (chaque incohérence avec son constat et, quand c'est sans risque, un bouton *Corriger* ; sinon un lien vers le
dossier). Une alerte part sur le téléphone seulement s'il y a quelque chose à lire.

| Code | Ce qui est comparé | Corriger |
|---|---|---|
| `DEVIS_MONTANT_NUL` | Devis en vigueur à 0 € (le client lirait « 0 € ») | À la main : corriger le document |
| `ACCORD_SANS_SIGNATURE` | Accord en ligne ↔ dossier avant « Signé » | Passer en « Signé » |
| `DEVIS_ACCEPTE_AVANT_SIGNE` | Devis « accepté » ↔ dossier avant « Signé » | Remettre le devis « émis » |
| `SIGNE_SANS_DEVIS_ACCEPTE` | Dossier signé ↔ aucun devis accepté | Noter le dernier devis « accepté » |
| `PAIEMENT_AVANT_SIGNATURE` | Encaissement valide ↔ dossier avant « Signé » | Passer en « Signé » |
| `ETAPE_ET_SOLDE` | Facturé / Encaissé ↔ factures réglées | Suivre le solde |
| `PROJET_VALIDE_INCOMPLET` | Pastille verte ↔ projet incomplet | Dévalider |
| `PROJET_VALIDE_SANS_AVANCER` | Projet validé ↔ dossier en Qualification | Passer en « Simulation » |
| `CHOIX_SANS_SIMULATION` | Simulation validée ↔ plus visible du client | Dévalider le choix |
| `PROCHAINE_ACTION_PERIMEE` | « Préparer le devis » / « autre proposition » ↔ faits de l'espace | Effacer l'action |
| `STATUT_DU_LEAD` | Étape du dossier ↔ statut du lead | Aligner le lead |
| `LEAD_A_PLUSIEURS_DOSSIERS` | Un contact, plusieurs dossiers vivants | À la main : archiver le doublon |
| `ESPACE_ACTIF_DOSSIER_ARCHIVE` | Dossier archivé ↔ lien encore actif | Désactiver le lien |
| `SIMULATIONS_HORS_DOSSIER` | Contact avec dossier ↔ simulations restées hors du dossier | Les ranger |

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
