import { UNITES, type Unite } from "@/lib/dossiers/constants";
import { FAMILLES, type Famille, type IdFamille } from "@/lib/prestations/prestations";
import type { LigneTarifPrestation } from "@/lib/prestations/tarifs";

/**
 * Mission 16 (partie 4) — les tarifs PUBLICS, pour l'estimation affichée par le site après un rendu
 * (`GET /api/site/tarifs`). Par famille : chaque sous-partie avec son prix unitaire (celui que Lucas lui a
 * attribué, ou trouvé par mots-clés : `tarifsDesPrestations`), `null` quand aucun tarif ne la chiffre — rien n'est
 * inventé ; et les formats de pièce (« Petite ≈ 3 m »…) tirés des repères de taille du fichier des prestations.
 * Jamais une désignation interne, un identifiant de tarif, une marge ni un mot-clé.
 */

export type SousPartiePublique = { id: string; libelle: string; metrage: boolean; prixUnitaire: number | null; unite: Unite };
export type FormatPublic = { id: string; libelle: string; aide: string; metres: number };
export type FamilleTarifsPublics = { id: IdFamille; sousParties: SousPartiePublique[]; formats: FormatPublic[] };
export type TarifsPublics = { version: 1; familles: FamilleTarifsPublics[] };

/** Cuisine : trois des quatre repères (« En U » laissé de côté), nommés comme des tailles. */
const FORMATS_CUISINE: readonly { repere: string; libelle: string }[] = [
  { repere: "une-rangee", libelle: "Petite" },
  { repere: "en-l", libelle: "Moyenne" },
  { repere: "ilot", libelle: "Grande" },
];

/** Au plus trois formats par famille ; seulement des mètres (une taille comptée en portes ne se multiplie pas par un prix au mètre). */
export function formatsDeLaFamille(famille: Famille): FormatPublic[] {
  if (famille.taille.unite !== "m") return [];
  if (famille.id === "CUISINE") {
    return FORMATS_CUISINE.flatMap(({ repere, libelle }) => {
      const r = famille.taille.reperes.find((x) => x.id === repere);
      return r ? [{ id: r.id, libelle, aide: `${r.libelle}, ${r.aide}`, metres: r.valeur }] : [];
    });
  }
  return famille.taille.reperes.slice(0, 3).map((r) => ({ id: r.id, libelle: r.libelle, aide: r.aide, metres: r.valeur }));
}

const prixPublic = (prix: number | null | undefined): number | null => (typeof prix === "number" && Number.isFinite(prix) && prix > 0 ? Math.round(prix * 100) / 100 : null);
const unitePublique = (unite: string | null | undefined, parDefaut: Unite): Unite => ((UNITES as readonly string[]).includes(unite ?? "") ? (unite as Unite) : parDefaut);

/** Pur : les lignes de `tarifsDesPrestations()` → la réponse publique (testable sans base). */
export function versTarifsPublics(lignes: readonly Pick<LigneTarifPrestation, "famille" | "sousPartie" | "prixUnitaire" | "unite">[]): TarifsPublics {
  return {
    version: 1,
    familles: FAMILLES.map((f) => ({
      id: f.id,
      sousParties: f.sousParties.map((sp) => {
        const ligne = lignes.find((l) => l.famille === f.id && l.sousPartie === sp.id);
        const prixUnitaire = prixPublic(ligne?.prixUnitaire);
        return { id: sp.id, libelle: sp.libelle, metrage: sp.metrage === true, prixUnitaire, unite: unitePublique(prixUnitaire === null ? null : ligne?.unite, sp.tarif.unite) };
      }),
      formats: formatsDeLaFamille(f),
    })),
  };
}

/** Les tarifs publics lus dans la base (tarifs actifs de Lucas). */
export async function tarifsPublics(): Promise<TarifsPublics> {
  const { tarifsDesPrestations } = await import("@/lib/prestations/tarifs");
  return versTarifsPublics(await tarifsDesPrestations());
}

/** Sans base (erreur de lecture) : la même forme, aucun prix — le site retombe sur ses fourchettes. */
export function tarifsPublicsSansPrix(): TarifsPublics {
  return versTarifsPublics([]);
}
