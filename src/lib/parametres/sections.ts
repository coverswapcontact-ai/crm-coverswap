// Sections de Paramètres qu'une adresse ouvre directement (`/parametres?section=…`), partagées par le serveur et
// l'interface. Aucune dépendance serveur.

/**
 * Mission 18 (A5) : l'ancien écran Tâches de fond est l'onglet « Système » de Paramètres (file des tâches de fond,
 * travaux périodiques, contrôle de cohérence, audit des connexions, sessions de l'assistant). L'ancienne adresse
 * /taches-de-fond y redirige (`next.config.ts`). Une requête plutôt qu'une ancre : le fragment n'est pas garanti à
 * travers une redirection du serveur.
 */
export const SECTION_SYSTEME = "systeme";
export const ADRESSE_SYSTEME = `/parametres?section=${SECTION_SYSTEME}`;

/**
 * Mission 18 (A6) : les tarifs des devis (presets et tarif de chaque prestation) ne sont plus un sous-mode du
 * générateur de Dossiers mais l'onglet « Tarifs » de Paramètres. Le lien « Gérer les tarifs » du générateur et ceux
 * de l'assistant (tarifs, `lister` TARIFS, `creer` / `modifier` / `archiver` TARIF et SOUS_PARTIE) y mènent.
 */
export const SECTION_TARIFS = "tarifs";
export const ADRESSE_TARIFS = `/parametres?section=${SECTION_TARIFS}`;
