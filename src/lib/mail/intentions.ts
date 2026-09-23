/** Les trois intentions d'un mail (mission 9), sans dépendance serveur : lisibles par les écrans. */
export const INTENTIONS = ["REPONSE", "ACTION", "INFORMATION"] as const;
export type Intention = (typeof INTENTIONS)[number];
export const LIBELLES_INTENTION: Record<Intention, string> = { REPONSE: "Réponse attendue", ACTION: "Action à faire", INFORMATION: "Pour information" };
