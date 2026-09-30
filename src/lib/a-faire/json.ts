/**
 * Mission 17 (partie A) : lecture et écriture des champs JSON d'une tâche (`raccourci`, `donnees`, `precedent`). Pur.
 */

/** Un objet JSON lu sans jamais lever : `{}` pour un texte vide, illisible ou qui n'est pas un objet. */
export function lireObjet(texte: string | null | undefined): Record<string, unknown> {
  if (!texte) return {};
  try {
    const valeur: unknown = JSON.parse(texte);
    return valeur && typeof valeur === "object" && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function trier(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(trier);
  if (valeur instanceof Date) return valeur.toISOString();
  if (valeur && typeof valeur === "object") {
    return Object.fromEntries(
      Object.keys(valeur as Record<string, unknown>)
        .sort()
        .filter((cle) => (valeur as Record<string, unknown>)[cle] !== undefined)
        .map((cle) => [cle, trier((valeur as Record<string, unknown>)[cle])])
    );
  }
  return valeur;
}

/** JSON aux clés triées : deux passages qui voient la même chose écrivent le même texte (le moteur compare avant d'écrire). */
export function jsonStable(valeur: unknown): string {
  return JSON.stringify(trier(valeur ?? {}));
}

/** Une chaîne non vide, ou null. */
export function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur : null;
}

/** Les identifiants de messages mail d'une tâche : `raccourci.messageId`, `donnees.messageId`, `donnees.messageIds`. */
export function messagesDeLaTache(raccourci: Record<string, unknown>, donnees: Record<string, unknown>): string[] {
  const liste = [raccourci.messageId, donnees.messageId, ...(Array.isArray(donnees.messageIds) ? donnees.messageIds : [])];
  return [...new Set(liste.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * Mission 17 (partie A, relecture) : l'occurrence du besoin, dans `donnees.occurrence` (posée par les détecteurs, lue
 * par le moteur › besoinNouveau et la vue des espaces) ; null si elle manque.
 */
export const CLE_OCCURRENCE = "occurrence";

export function occurrenceDe(donnees: Record<string, unknown> | null | undefined): string | null {
  const valeur = donnees?.[CLE_OCCURRENCE];
  return typeof valeur === "string" && valeur ? valeur : null;
}
