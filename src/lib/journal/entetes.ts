// En-têtes posés par le middleware sur chaque requête, lus par la couche
// d'écriture pour dater et regrouper les écritures d'un même geste. Le
// middleware écrase toute valeur envoyée par le navigateur : ces en-têtes ne
// servent qu'à l'origine, jamais à l'identité (qui vient de la session).
// Fichier sans dépendance Node : il est importé par le middleware.

export const ENTETE_ORIGINE = "x-coverswap-origine";
export const ENTETE_REQUETE = "x-coverswap-requete";
