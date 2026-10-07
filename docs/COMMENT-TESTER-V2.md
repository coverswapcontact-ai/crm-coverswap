# Comment tester la v2 en local

1. **Base de démonstration** (fictive, neutre, rejouable) : dans PowerShell, `$env:DATABASE_URL="file:./essai-v2.db"` (chemin relatif au dossier `prisma/` : le fichier est `prisma/essai-v2.db`, ignoré par git), puis `npm run base:pousser` (schéma, déclencheurs, migrations), puis `node scripts/demo-v2.mjs` (10 contacts dont un à appeler et un rappel en retard, 7 dossiers de Qualification à Encaissé dont un chez le client avec un devis relu deux fois, une facture en retard, un chèque à créditer, une proposition à valider, un message d'espace non lu, une tâche de fond en échec, un appel noté). `node seed.mjs` avant la démo est facultatif (62 contacts et d'anciens chantiers, au hasard). Les tâches d'Aujourd'hui apparaissent au premier « Actualiser » (ou au passage automatique, 15 min).
2. **Copie des vraies données** à la place : `node scripts/dechiffrer-sauvegarde.mjs <fichier.db.gz.chiffre> prisma/essai-v2.db`, la clé posée dans le terminal juste avant (`$env:SAUVEGARDE_CLE="…"`, jamais dans un fichier) ; puis `npm run base:pousser` avec le même `DATABASE_URL`.
3. **`.env.local`** : `CRM_INTERFACE=v2` et `CRM_ESSAI_LOCAL=1` (bandeau « Base d'essai — rien ne part » : aucun mail, SMS, alerte ni appel payant ne part, même avec les vraies données).
4. **Lancer** : `$env:DATABASE_URL="file:./essai-v2.db"; npm run dev` (port 3001), puis `http://localhost:3001/taches`. Si l'écran a l'air d'un vieil essai : désinscrire le service worker et vider les caches (outils de développement › Application), puis recharger.
5. **Sur le téléphone** : même Wi-Fi que le poste, `http://<adresse-du-pc>:3001` ; l'adresse s'affiche par `(Get-NetIPAddress -AddressFamily IPv4 | Where-Object InterfaceAlias -notmatch 'Loopback').IPAddress`. Hors `localhost`, la connexion est demandée ; si elle boucle, poser `NEXTAUTH_URL=http://<adresse-du-pc>:3001` dans `.env.local` le temps de l'essai (à poser par le gérant), puis relancer.
6. **Comparer** : `?interface=v1` sur n'importe quelle adresse ramène l'ancienne interface (cookie 7 jours), `?interface=v2` la nouvelle ; le menu Plus a aussi « Retour à l'ancienne interface ».
7. **Le jour de la validation, sur Railway** : `CRM_INTERFACE=apercu` d'abord (la v1 pour tout le monde, la v2 pour le téléphone qui ouvre `?interface=v2`), puis `CRM_INTERFACE=v2` pour tout le monde. Rien d'autre ne change : mêmes adresses, même base, mêmes outils.

## Le scénario de validation (dix pas, à faire sur l'ordinateur puis à 390 px sur le téléphone)

1. Ouvrir Aujourd'hui et dire en 5 secondes ce qu'il y a à faire : la carte « Maintenant » et son seul bouton vert.
2. Faire la tâche « Maintenant » (Fait, ou le geste vert) : la ligne « Fait — … » s'écrit avec « Annuler » pendant 5 s ; annuler, la tâche revient.
3. Lire « Depuis ta dernière visite » (groupes par personne, « Voir les N autres », filtres Clients · Argent · Système) et ouvrir un dossier depuis une ligne du journal ; « Tout vu » répond « Tout est vu. » avec « Annuler », puis l'en-tête dit « Rien de nouveau depuis … ».
4. Dans le dossier, lire les trois lignes de l'en-tête (qui et quoi, où en est-on et depuis quand, prochaine action) et faire le geste principal ; « Autres gestes » déplie le reste ; une seule rubrique est ouverte, celle de l'étape.
5. Dossiers : les segments Chez moi · Chez le client · Tous · Archives ; chaque ligne porte la même situation en trois lignes et son geste en contour ; la recherche et les filtres sont sous les cinq premières lignes.
6. Personnes : retrouver quelqu'un par la recherche (ou Ctrl K), ouvrir sa fiche ; « Appeler » (vert sur la ligne la plus urgente) ouvre le téléphone, la fin d'appel se note au retour.
7. Noter un appel (issue, note, rappel) depuis la fiche ou « Enchaîner les appels ».
8. Relancer un devis : depuis Dossiers ou le panneau, « Relancer » ouvre le SMS prêt à copier (copier vaut relance, tracée dans le dossier).
9. Argent : les trois nombres (à encaisser, encaissé ce mois, dépensé ce mois), le rouge seulement sur une facture en retard, « Encaisser » vert sur la plus en retard, « Relancer » en contour, les chèques à créditer.
10. Plus : Boîte mail, Simulateur, Le site, Bilan, Réglages, À valider, Nouvelle dépense (écrans v1 sous l'en-tête v2) ; puis `?interface=v1` pour comparer et `?interface=v2` pour revenir.
