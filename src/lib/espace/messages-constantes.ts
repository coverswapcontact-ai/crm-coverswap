/** Les sources d'un message de l'espace client (mission 10). Aucune dépendance serveur : importé par les écrans. */
export const SOURCES_MESSAGE_ESPACE = ["MESSAGE", "COMMENTAIRE", "PROPOSITION", "REPONSE"] as const;
export type SourceMessageEspace = (typeof SOURCES_MESSAGE_ESPACE)[number];
export const LIBELLES_SOURCE_MESSAGE: Record<SourceMessageEspace, string> = { MESSAGE: "message", COMMENTAIRE: "commentaire sur une simulation", PROPOSITION: "demande d'autre proposition", REPONSE: "réponse de CoverSwap" };
