import { reference as lireReference } from "@/lib/simulateur/catalogue";
import type { FideliteSurface } from "./fidelite";
import type { ReferenceMesure } from "./mesure-rendu";

/**
 * Mission 23 (L3) — la fin du pipeline (`pipeline.ts › genererAvecMoteur`), pour les trois origines (site, espace,
 * CRM) et les deux moteurs :
 *  - réglage `correctionTeintes` actif (Paramètres › Simulateur, non par défaut) : le rendu corrigé remplace le rendu,
 *    l'original est rendu à part (`imageOriginale`) pour être gardé à côté (suffixe `-original`, `rendu-original.ts`) ;
 *  - réglage inactif : la fidélité est mesurée quand même, en lecture seule (l'image n'est pas touchée ; 1 à 2 s de
 *    calcul après une génération de 30 à 90 s) ;
 *  - une erreur de correction ne casse jamais une simulation : le rendu d'origine est gardé, l'erreur journalisée,
 *    la fidélité vide.
 * La mesure et la correction sont chargées à l'appel (import dynamique) : `teintes.ts` passe par `ambiances.ts`, qui
 * importe le pipeline ; un import statique ferait un cycle où `teintes.ts` n'est pas encore initialisé.
 */

export type ResultatCorrectionPipeline = { image: Buffer; imageOriginale: Buffer | null; fidelite: FideliteSurface[] | null };

/** Les références des zones, telles que la mesure les lit (hex et classe de texture du catalogue) ; sans hex, ignorée. */
async function referencesMesure(zones: { zone: string; ref: string }[]): Promise<ReferenceMesure[]> {
  const { classeTexture } = await import("./mesure-rendu");
  const sortie: ReferenceMesure[] = [];
  for (const ref of [...new Set(zones.map((z) => z.ref))]) {
    const r = await lireReference(ref).catch(() => null);
    if (!r?.hex) continue;
    sortie.push({ ref: r.id, nom: r.nom, hex: r.hex, classe: classeTexture(r) });
  }
  return sortie;
}

export async function corrigerSortiePipeline(entree: { avant: Buffer; image: Buffer; zones: { zone: string; ref: string }[]; appliquer: boolean; origine: string }): Promise<ResultatCorrectionPipeline> {
  try {
    const references = await referencesMesure(entree.zones);
    if (references.length === 0) return { image: entree.image, imageOriginale: null, fidelite: null };
    const { corrigerTeintes } = await import("./correction-teintes");
    const r = await corrigerTeintes({ avant: entree.avant, apres: entree.image, zones: entree.zones, references, appliquer: entree.appliquer });
    const resume = r.fidelite.map((s) => `${s.ref} ${s.etat}${s.deltaEAvant !== null ? ` ${s.deltaEAvant}→${s.deltaEApres}` : ""}`).join(", ");
    console.log(`[correction-teintes] ${entree.origine} : ${r.corrigee ? "rendu corrigé" : entree.appliquer ? "rien à corriger" : "mesure seule"} en ${r.dureeMs} ms (${resume})`);
    return r.corrigee ? { image: r.image, imageOriginale: entree.image, fidelite: r.fidelite } : { image: entree.image, imageOriginale: null, fidelite: r.fidelite };
  } catch (erreur) {
    console.error(`[correction-teintes] ${entree.origine} : correction impossible, rendu d'origine gardé :`, erreur instanceof Error ? erreur.message : erreur);
    return { image: entree.image, imageOriginale: null, fidelite: null };
  }
}
