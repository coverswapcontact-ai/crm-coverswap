import type { EtapeTunnel, SourceDonnees, Tunnel } from "../types";

/**
 * Mission 17 (partie B) — un tunnel (pur) : taux de passage de chaque étape (valeur / étape précédente) et « l'étape
 * qui perd le plus » = le plus faible taux parmi les passages désignés (`candidates` : la clé de l'étape d'arrivée).
 * Un taux n'est donné que si l'étape est un sous-ensemble de la précédente (valeur ≤ précédente) : 45 leads venus de
 * partout après 30 simulations ne font pas « 150 % ».
 */

export type EntreeEtape = { cle: string; libelle: string; valeur: number | null; source: SourceDonnees };

const LIBELLES_PASSAGE: Record<string, string> = { appeles: "lead → appel", joints: "appel → joint", devis: "joint → devis", signes: "devis → signé", lancees: "visite → simulation", terminees: "simulation lancée → terminée", leads: "simulation → lead" };

export function tunnelDe(etapes: readonly EntreeEtape[], candidates: readonly string[]): Tunnel {
  const resultat: EtapeTunnel[] = etapes.map((e, i) => {
    const avant = i > 0 ? etapes[i - 1].valeur : null;
    const tauxPassage = e.valeur !== null && avant !== null && avant > 0 && e.valeur <= avant ? Math.round((e.valeur / avant) * 1000) / 1000 : null;
    return { ...e, tauxPassage };
  });
  let perteMax: Tunnel["perteMax"] = null;
  let plusFaible = Infinity;
  resultat.forEach((e, i) => {
    if (i === 0 || !candidates.includes(e.cle) || e.tauxPassage === null) return;
    if (e.tauxPassage < plusFaible) {
      plusFaible = e.tauxPassage;
      const de = resultat[i - 1];
      perteMax = { de: de.cle, vers: e.cle, libelle: LIBELLES_PASSAGE[e.cle] ?? `${de.libelle.toLowerCase()} → ${e.libelle.toLowerCase()}`, perdus: (de.valeur ?? 0) - (e.valeur ?? 0) };
    }
  });
  return { etapes: resultat, perteMax };
}
