/**
 * Limite de fréquence en mémoire pour les routes OAuth publiques (enregistrement
 * d'un client, échange de jeton) : une adresse IP ne peut pas marteler ces
 * routes. Remise à zéro au redémarrage, comme celle du proxy : acceptable.
 */
const compteurs = new Map<string, { nombre: number; jusqua: number }>();

export function autoriserAppel(cle: string, maximum: number, fenetreMs: number, maintenant = Date.now()): boolean {
  if (compteurs.size > 5_000) for (const [k, v] of compteurs) if (v.jusqua < maintenant) compteurs.delete(k);
  const ligne = compteurs.get(cle);
  if (!ligne || ligne.jusqua < maintenant) {
    compteurs.set(cle, { nombre: 1, jusqua: maintenant + fenetreMs });
    return true;
  }
  if (ligne.nombre >= maximum) return false;
  ligne.nombre += 1;
  return true;
}

export function adresseIp(requete: Request): string {
  return requete.headers.get("x-forwarded-for")?.split(",")[0].trim() || requete.headers.get("x-real-ip") || "inconnue";
}

/** Pour les tests. */
export function remettreAZero(): void {
  compteurs.clear();
}
