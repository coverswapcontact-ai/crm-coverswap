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
