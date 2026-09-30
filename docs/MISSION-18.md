# Mission 18 (reçue le 30/09/2026 pendant la mission 17) — à démarrer APRÈS la fin complète de la mission 17

Consigne de Lucas : terminer entièrement la mission 17 (parties A, B, C, PR ouvertes ou fusionnées, rapport final de
5 lignes envoyé) sans en changer le plan ; ensuite seulement relire REPRISE et exécuter la mission 18, sur la même
branche, sans s'arrêter ni poser de question (décision la plus simple, notée dans REPRISE). Règles de la mission 17
valables : push sur la branche de session, une PR à la fin de chaque partie, « PR à fusionner » si impossible de
fusionner, vérifications en local si la production est injoignable. Pour chaque partie : tests, lint, build, commit,
PR, section dans REPRISE.

## Partie A : simplifier le CRM (six changements validés)
1. L'onglet Espaces clients disparaît : l'état de l'espace (lien envoyé, dernière visite, photos, simulations, devis
   relu, qui a la main) devient une colonne et un filtre de Dossiers. Le bloc Espace du panneau du dossier reste ; la
   fiche client garde un résumé. `/espaces` redirige vers Dossiers filtré sur les espaces. Signaux et pagination
   d'Espaces passent dans ce filtre.
2. Le dossier s'ouvre tout seul dès qu'un lead envoie des photos, fait une simulation ou demande un devis (site ou
   espace). « Ouvrir le dossier » ne sert plus que pour un lead qualifié au téléphone.
3. Dépenses passe dans Finances (section) ; le panneau du dossier garde ses dépenses, même composant.
4. Un seul système de relance : les 4 séquences de mails (`src/lib/mail/sequences.ts`, désactivées) sont retirées du
   code et des interrupteurs (lignes en base gardées) ; la demande d'avis après chantier et la réactivation à 6 mois
   deviennent des types de relance proposables.
5. Tâches de fond passe dans Paramètres, section « Système » (quel que soit son nom après la mission 17) ; un seul
   compteur (les échecs remontent déjà comme tâches système).
6. Les tarifs passent dans Paramètres, section « Tarifs » (`GestionTarifs`, aujourd'hui dans Dossiers).
Navigation cible, 10 onglets : principale Tâches, Leads, Dossiers, Mail, Clients, Analytique ; secondaires
Simulateur, Site, Finances, Paramètres. Barre du bas du téléphone adaptée. Anciennes adresses redirigées. Mettre à jour
les outils MCP dépendant des écrans retirés, `docs/MCP-COUVERTURE.md`, les tests.

## Partie B : dossier et espace client toujours synchronisés
Principe : un seul point d'entrée pour tout ce qui arrive à un dossier (événement client ou CRM) qui, dans la même
transaction, met à jour l'étape, la main (recalculée à chaque fois), la prochaine action, l'état de l'espace, les
relances, les tâches (mission 17), l'historique, le statut du lead ; puis déclenche les effets externes
(notifications des automatismes existants, agenda, Meta). Une prochaine action posée à la main n'est jamais écrasée :
un événement automatique crée une tâche à la place. Matrice « événement → effets » dans `docs/SYNCHRO.md`.
Écarts à corriger, chacun avec son test (déclencheur, puis état attendu des deux côtés : étape, main, prochaine action,
étape de l'espace, relances, tâches) :
1. Générer un devis n'est pas l'envoyer : « Devis envoyé » seulement si visible et notifié, ou envoyé par mail ; sinon
   tâche « Envoyer le devis à X » (aujourd'hui `emettre` passe en Devis envoyé et donne la main au client).
2. Devis envoyé par mail depuis le CRM (bouton ou `envoyer_document`) : mêmes effets qu'un devis rendu visible (étape,
   main, relances depuis la date d'envoi), le devis devient visible dans l'espace. Bug : `envoyer_document`
   (ecriture.ts l. 297) revalide la proposition déjà validée par `envoyerDocumentParMail` → 409 et mail en double à la
   nouvelle tentative. Test : un seul mail, nouvelle tentative sans effet.
3. Devis envoyé depuis Gmail : conserver les PDF sortants ; mail à un client connu avec un PDF qui ressemble à un
   devis → tâche en un geste « Enregistrer comme devis envoyé » (dépose, avance l'étape, lance les relances).
4. `deposerDocument` atomique (vérifier le PDF avant de changer l'étape) ; devis déposé « accepté » sur dossier non
   signé → Signé.
5. Devis rendu visible : notification « Devis disponible » (automatisme existant) ; relance comptée depuis la mise en
   ligne.
6. Devis annulé ou masqué sans autre devis actif : retour à l'étape d'avant (Simulation ou Qualification), main à
   Lucas, tâche « Refaire le devis », relances arrêtées, espace au bon état.
7. Nouveau devis ou avenant sur dossier signé : l'espace l'affiche et permet de le signer (`EtapeDevis.tsx` du site ne
   montre que l'accepté).
8. Signature : accord et passage en Signé dans une seule transaction ; nouvelle tentative sans effet.
9. « Publier » depuis le bloc Espace : mêmes effets que `publierSimulations` ; retirer une simulation choisie annule le
   choix ; simulation du client ou choix validé → Qualification → Simulation.
10. Paiement : créer `/paiement-carte` (appelée par `EtapePaiement.tsx`) avec Stripe Checkout (acompte ou solde) ;
    bouton masqué sans `STRIPE_SECRET_KEY` ; webhook Stripe → encaissement + avancée ; paiements en plusieurs fois
    (Alma, Klarna) sans changement de code ; `suivreAcompteDossier` marque les autres variantes non retenues ; « Mes
    documents » : facture « Réglée » d'après les encaissements.
11. États en double : consultations de devis → seule source `Document.consultations` (reprendre
    `EspaceClient.devisConsultations`, brancher `manager_commercial` et la réinitialisation) ; teintes → `Dossier.teintes`
    et `EspaceClient.choix` réconciliés.
12. Statut du lead ↔ étape : correspondance pour toutes les étapes (Qualification, Simulation, En pause, Perdu…) ;
    dossier ouvert sur un lead perdu ou « devis demandé » → statut mis à jour ; plusieurs dossiers → le vivant le plus
    avancé décide.
13. Cohérence : règles avec réparation en un clic pour les écarts 1, 3, 5, 6, 7 ; « Attendre l'accord » sans devis ;
    date de chantier posée en Signé ; dossiers perdus ou archivés avec un espace actif.
Mise en route : sauvegarde, contrôle de cohérence étendu sur tous les dossiers (perdus et archivés compris),
réparations sûres appliquées, le reste en tâches ; nombre d'écarts trouvés et réparés par règle.
Contraintes : rien de supprimé ; aucun nouvel envoi aux clients hors automatismes existants (interrupteurs gardés) ;
le site ne fait qu'afficher l'état calculé par le CRM.
Rapport final en 5 lignes : ce qui a été simplifié ; écarts corrigés ; nombre de dossiers réparés ; ce qui reste à
Lucas (dont les clés Stripe) ; outils MCP modifiés (rappeler de reconnecter le connecteur).
