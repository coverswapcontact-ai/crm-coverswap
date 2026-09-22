/** Textes de l'espace partagés par le serveur et les écrans du CRM (aucune dépendance serveur). */

/** Le SMS proposé avec un nouveau lien ; « {lien} » est remplacé à l'envoi. */
export function texteNouveauLien(prenom: string): string {
  return `Bonjour${prenom ? ` ${prenom}` : ""}, voici le nouveau lien de votre espace CoverSwap (l'ancien ne fonctionne plus) : {lien}`;
}

/** Mission 7 : le mail proposé avec un nouveau lien. La phrase seule — « Bonjour {prénom}, » et le bouton « Ouvrir mon espace » s'ajoutent d'eux-mêmes. */
export const PHRASE_NOUVEAU_LIEN = "Voici le nouveau lien de votre espace CoverSwap : l'ancien ne fonctionne plus. Vos projets, simulations et documents y sont toujours.";
