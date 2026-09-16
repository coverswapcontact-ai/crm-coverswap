/** Rien ne se supprime : un archivage porte une date et un motif. */

export const MOTIF_ARCHIVAGE_MIN = 3;
export const MOTIF_ARCHIVAGE_MAX = 500;

/** Motif lu dans le corps JSON { motif } d'une requête d'archivage, ou null s'il manque. */
export async function motifDArchivage(requete: Request): Promise<string | null> {
  const corps: unknown = await requete.json().catch(() => null);
  const brut = typeof corps === "object" && corps !== null ? (corps as { motif?: unknown }).motif : undefined;
  const motif = typeof brut === "string" ? brut.trim() : "";
  return motif.length >= MOTIF_ARCHIVAGE_MIN ? motif.slice(0, MOTIF_ARCHIVAGE_MAX) : null;
}

export const ERREUR_MOTIF_ARCHIVAGE = "Motif d'archivage obligatoire (rien ne se supprime, l'archivage se justifie).";
