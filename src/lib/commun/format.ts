/**
 * Mission 13 (26/09/2026), lot 5 — petits formats de texte partagés par les
 * écrans et par les outils de l'assistant. Les accords se calculent : plus de
 * « (s) », ni à l'écran ni dans ce que Claude lit.
 */

/** Le mot seul, accordé : « ouvert » / « ouverts » ; forme plurielle donnée quand un « s » ne suffit pas. */
export function accord(nombre: number, singulier: string, plurielForme = `${singulier}s`): string {
  return Math.abs(nombre) > 1 ? plurielForme : singulier;
}

/** « 1 lead », « 3 leads », « 2 photos reçues », « 0 relance ». */
export function pluriel(nombre: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${nombre} ${accord(nombre, singulier, plurielForme)}`;
}

/** « Beites Marie — Recouvrement de cuisine », ou le nom seul quand l'objet est vide (plus de tiret orphelin). */
export function titreDossier(dossier: { clientNom: string; objet?: string | null }): string {
  const objet = dossier.objet?.trim();
  return objet ? `${dossier.clientNom} — ${objet}` : dossier.clientNom;
}
