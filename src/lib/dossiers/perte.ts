import { ErreurMetier } from "@/lib/commun/erreurs";
import { LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type MotifPerte } from "./constants";

/**
 * Mission 14 (29/09/2026), partie 4 — la règle unique du motif de perte, pour un
 * lead classé « sans suite » (`modifierEntrant`), un dossier passé « perdu »
 * (`changerEtapeDansTransaction`) et une fin d'appel « pas intéressé »
 * (`noterAppel`) : un motif de la liste est obligatoire, et « autre » exige une
 * précision de 3 caractères au moins. Le message cite TOUS les motifs de la
 * liste (« délai trop long » y manquait).
 */

/** « trop cher, a choisi un concurrent, …, délai trop long, ou autre (précisé) » : la liste entière, dans l'ordre. */
export function motifsPerteLisibles(): string {
  const libelles = MOTIFS_PERTE.map((motif) => (motif === "AUTRE" ? "autre (précisé)" : LIBELLES_MOTIF_PERTE[motif].toLowerCase()));
  return `${libelles.slice(0, -1).join(", ")}, ou ${libelles[libelles.length - 1]}`;
}

/**
 * Refuse une perte sans motif, ou « autre » sans précision. `debut` : « Motif obligatoire pour classer sans suite »
 * (lead, fin d'appel) ou « Motif de perte obligatoire » (dossier).
 */
export function verifierMotifPerte(motif: MotifPerte | null | undefined, precision: string | null | undefined, debut = "Motif obligatoire pour classer sans suite"): asserts motif is MotifPerte {
  if (!motif) throw new ErreurMetier(`${debut} : ${motifsPerteLisibles()}.`, 400);
  if (motif === "AUTRE" && (precision?.trim().length ?? 0) < 3) throw new ErreurMetier("Précise le motif « autre » en quelques mots.", 400);
}

/** Le motif dans une phrase : « délai trop long » ; « autre » : la précision donnée. */
export function motifPerteDansUnePhrase(motif: MotifPerte, precision?: string | null): string {
  if (motif === "AUTRE") return precision?.trim() || "autre motif";
  const libelle = LIBELLES_MOTIF_PERTE[motif];
  return libelle.charAt(0).toLowerCase() + libelle.slice(1);
}
