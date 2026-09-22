/** Textes de l'espace partagés par le serveur et les écrans du CRM (aucune dépendance serveur). */

/** Le SMS proposé avec un nouveau lien ; « {lien} » est remplacé à l'envoi. */
export function texteNouveauLien(prenom: string): string {
  return `Bonjour${prenom ? ` ${prenom}` : ""}, voici le nouveau lien de votre espace CoverSwap (l'ancien ne fonctionne plus) : {lien}`;
}
