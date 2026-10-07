/**
 * Mission 23 (L3) — la fidélité des teintes d'un rendu, telle qu'elle est enregistrée (JSON `fidelite` de
 * SimulationSite, SimulationEspace, PreparationSimulation, RenduBanc) et lue par la liste du CRM et `voir_fichiers`.
 * Sans dépendance (lisible côté navigateur) ; la mesure et la correction sont dans `correction-teintes.ts`.
 */

export type EtatFidelite = "corrigee" | "fidele" | "a_regenerer" | "mesuree";

export type FideliteSurface = {
  zone: string;
  ref: string;
  /** ΔE 2000 contre le hex du catalogue (après balance des blancs), avant et après la correction ; null : non mesurable. */
  deltaEAvant: number | null;
  deltaEApres: number | null;
  /** Le même à clarté égale (teinte et saturation seules). */
  deltaETeinteAvant: number | null;
  deltaETeinteApres: number | null;
  /** Texture relative de la surface (écart-type local de L* ramené à une clarté de 50) ; null pour un uni non mesuré. */
  texture: number | null;
  etat: EtatFidelite;
  raison?: string;
  /**
   * La scène n'a pas de vrai blanc (balance « dominante » ou « aucune ») : l'exposition n'est pas connue, la clarté
   * mesurée ne dit rien ; les seuils, le gain et le résumé se lisent alors sur le ΔE à clarté égale.
   */
  clarteIncertaine?: boolean;
};

const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export type ResumeFidelite = { etat: "fidele" | "a_regenerer" | "mesuree"; pire: number | null; texte: string };

/** Lit le JSON enregistré (`fidelite`) ; null s'il est absent ou illisible. */
export function lireFidelite(json: string | null | undefined): FideliteSurface[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as FideliteSurface[]).filter((x) => x && typeof x.ref === "string" && typeof x.etat === "string") : null;
  } catch {
    return null;
  }
}

const virgule = (n: number) => String(arrondi(n)).replace(".", ",");

/**
 * Le résumé d'une fidélité : « à régénérer » si une surface l'est ; sinon « teinte fidèle à 2,1 » (le pire ΔE après
 * correction des surfaces), ou « écart de teinte 6,2 (non corrigé) » si une surface n'a été que mesurée (réglage
 * inactif).
 */
export function resumerFidelite(surfaces: FideliteSurface[] | null | undefined): ResumeFidelite | null {
  if (!surfaces || surfaces.length === 0) return null;
  const valeurs = surfaces.map((s) => (s.clarteIncertaine ? s.deltaETeinteApres : s.deltaEApres)).filter((v): v is number => typeof v === "number");
  const pire = valeurs.length > 0 ? Math.max(...valeurs) : null;
  if (surfaces.some((s) => s.etat === "a_regenerer")) return { etat: "a_regenerer", pire, texte: "à régénérer" };
  if (pire === null) return null;
  if (surfaces.some((s) => s.etat === "mesuree")) return { etat: "mesuree", pire, texte: `écart de teinte ${virgule(pire)} (non corrigé)` };
  return { etat: "fidele", pire, texte: `teinte fidèle à ${virgule(pire)}` };
}

/** Le détail d'une zone : « ΔE 7,6 → 1,8 », « fidèle (ΔE 1,4) », « à régénérer : texture perdue… ». */
export function detailFidelite(s: FideliteSurface): string {
  const avant = s.clarteIncertaine ? s.deltaETeinteAvant : s.deltaEAvant;
  const apres = s.clarteIncertaine ? s.deltaETeinteApres : s.deltaEApres;
  const de = s.clarteIncertaine ? "ΔE à clarté égale" : "ΔE";
  const v = (n: number | null) => (n === null ? "—" : virgule(n));
  if (s.etat === "corrigee") return `${de} ${v(avant)} → ${v(apres)}`;
  if (s.etat === "fidele") return `fidèle (${de} ${v(avant)})`;
  if (s.etat === "mesuree") return `${de} ${v(avant)}, non corrigé`;
  return `à régénérer${s.raison ? ` : ${s.raison}` : ""}`;
}
