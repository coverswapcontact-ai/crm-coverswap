import { lireParametres } from "@/lib/parametres/service";
import { estQualite, type Qualite } from "@/lib/simulations/prix";
import { SEUIL_CONTROLE_PAR_DEFAUT } from "./moteur/controle-rendu";

/**
 * Les réglages du simulateur (mission 15, partie 2), lus dans Paramètres →
 * Simulateur avec leurs valeurs par défaut : moteur V1 tant que Lucas n'a pas
 * basculé, planche oui, medium pour le site, high pour l'espace et le CRM,
 * seuil de contrôle 7 ; correction des teintes non (mission 23, L3).
 */

export type Moteur = "V1" | "V2";

export type ReglagesSimulateur = {
  moteur: Moteur;
  planche: boolean;
  qualiteSite: Qualite;
  qualiteEspace: Qualite;
  seuilControle: number;
  /** Mission 23 (L3) : le rendu est recalé sur les teintes du catalogue (`correction-teintes.ts`) ; non par défaut. */
  correctionTeintes: boolean;
};

export const REGLAGES_PAR_DEFAUT: ReglagesSimulateur = { moteur: "V1", planche: true, qualiteSite: "medium", qualiteEspace: "high", seuilControle: SEUIL_CONTROLE_PAR_DEFAUT, correctionTeintes: false };

export async function reglagesSimulateur(maintenant: Date = new Date()): Promise<ReglagesSimulateur> {
  const v = await lireParametres(["SIMULATEUR_MOTEUR", "SIMULATEUR_PLANCHE", "SIMULATEUR_QUALITE_SITE", "SIMULATEUR_QUALITE_ESPACE", "SIMULATEUR_SEUIL_CONTROLE", "SIMULATEUR_CORRECTION_TEINTES"], maintenant).catch(() => ({}) as Record<string, unknown>);
  const seuil = Number(v.SIMULATEUR_SEUIL_CONTROLE);
  return {
    moteur: v.SIMULATEUR_MOTEUR === "V2" ? "V2" : "V1",
    planche: v.SIMULATEUR_PLANCHE !== "NON",
    qualiteSite: estQualite(v.SIMULATEUR_QUALITE_SITE) ? v.SIMULATEUR_QUALITE_SITE : REGLAGES_PAR_DEFAUT.qualiteSite,
    qualiteEspace: estQualite(v.SIMULATEUR_QUALITE_ESPACE) ? v.SIMULATEUR_QUALITE_ESPACE : REGLAGES_PAR_DEFAUT.qualiteEspace,
    seuilControle: Number.isInteger(seuil) && seuil >= 0 && seuil <= 10 ? seuil : REGLAGES_PAR_DEFAUT.seuilControle,
    correctionTeintes: v.SIMULATEUR_CORRECTION_TEINTES === "OUI",
  };
}

/** La qualité selon l'origine du rendu : le site en medium, l'espace client et le CRM en high (par défaut). */
export function qualitePourOrigine(reglages: ReglagesSimulateur, origine: "SITE" | "CRM" | "ESPACE"): Qualite {
  return origine === "SITE" ? reglages.qualiteSite : reglages.qualiteEspace;
}
