/**
 * Mission 18 (relecture) : depuis B7, un dossier signé peut porter plusieurs devis acceptés — le devis signé d'origine
 * et ses avenants (`espace/faits.ts › estAvenant`) — et plusieurs accords en cours. Les lecteurs qui prenaient « le »
 * devis accepté ou « le » dernier accord lisent ici, sans dépendre de l'ordre de leur requête :
 * - l'acompte, la date de l'accord, la référence du virement portent sur le devis signé d'origine (le plus ancien
 *   accepté, la règle de `faits.ts › devisEnVigueur`) ;
 * - les montants (signé, reste à encaisser, en jeu) additionnent l'origine et ses avenants signés (décision 8 : l'avenant
 *   est facturé avec le solde).
 * Fonctions pures.
 */

export type DevisSigneLu = { id: string; statut: string; createdAt: Date; totalHt: number };
export type AccordSigneLu = { documentId: string; createdAt: Date; totalHt: number };

/** Le devis signé d'origine : le plus ancien devis accepté ; null s'il n'y en a pas. */
export function devisSigneDOrigine<T extends Pick<DevisSigneLu, "statut" | "createdAt">>(devis: readonly T[]): T | null {
  return devis.filter((d) => d.statut === "ACCEPTE").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

/** L'accord en cours du devis signé d'origine ; sans devis accepté, le plus ancien accord en cours. */
export function accordDOrigine<A extends Pick<AccordSigneLu, "documentId" | "createdAt">>(devis: readonly Pick<DevisSigneLu, "id" | "statut" | "createdAt">[], accords: readonly A[]): A | null {
  const tries = [...accords].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const origine = devisSigneDOrigine(devis);
  return origine ? (tries.find((a) => a.documentId === origine.id) ?? null) : (tries[0] ?? null);
}

/**
 * Le montant signé (HT) : chaque devis accepté compté une fois (l'origine et ses avenants), plus les accords en cours
 * dont le devis n'est pas accepté (un accord d'avant B8 resté sans passage) ; null s'il n'y a rien de signé.
 */
export function montantSigneHt(devis: readonly Pick<DevisSigneLu, "id" | "statut" | "totalHt">[], accords: readonly Pick<AccordSigneLu, "documentId" | "totalHt">[]): number | null {
  const parDevis = new Map<string, number>();
  for (const d of devis) if (d.statut === "ACCEPTE") parDevis.set(d.id, d.totalHt);
  for (const a of accords) if (!parDevis.has(a.documentId)) parDevis.set(a.documentId, a.totalHt);
  if (parDevis.size === 0) return null;
  return Math.round([...parDevis.values()].reduce((somme, montant) => somme + montant, 0) * 100) / 100;
}
