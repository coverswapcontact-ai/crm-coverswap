import type { EtapeDossier, RubriqueDossier } from "@/lib/dossiers/constants";

/**
 * Mission 22 (A3) — les rubriques du panneau de dossier v2 (les sections de la v1, rangées et toutes fermées sauf
 * une) : laquelle s'ouvre d'office selon l'étape, et laquelle un raccourci `?rubrique=` demande. Pur, testé.
 */
export const RUBRIQUES_V2 = ["completer", "photos", "simulations", "espace", "devis", "paiements", "etapes", "historique", "coordonnees", "familles", "delais", "depenses", "archivage"] as const;
export type RubriqueV2 = (typeof RUBRIQUES_V2)[number];

/** Le titre de chaque rubrique, en phrase (jamais en capitales) ; le nombre s'ajoute à l'écran quand il compte. */
export const TITRES_RUBRIQUES: Record<RubriqueV2, string> = {
  completer: "À compléter",
  photos: "Photos du chantier",
  simulations: "Simulations",
  espace: "Espace client",
  devis: "Devis et factures",
  paiements: "Paiements",
  etapes: "Étapes et notes",
  historique: "Historique",
  coordonnees: "Coordonnées",
  familles: "Familles et teintes",
  delais: "Délais et prix",
  depenses: "Dépenses",
  archivage: "Archiver le dossier",
};

/**
 * Une seule rubrique ouverte d'office, celle de l'étape : Qualification → photos ; Simulation → simulations ;
 * Devis envoyé, Relance, Signé → devis ; Planifié, Chantier → étapes et notes ; Facturé, Encaissé → paiements ;
 * Perdu, En pause → étapes et notes (la reprise s'y fait).
 */
export function rubriqueDeLEtape(etape: EtapeDossier): RubriqueV2 {
  switch (etape) {
    case "QUALIFICATION":
      return "photos";
    case "SIMULATION":
      return "simulations";
    case "DEVIS_ENVOYE":
    case "RELANCE":
    case "SIGNE":
      return "devis";
    case "PLANIFIE":
    case "CHANTIER":
    case "PERDU":
    case "EN_PAUSE":
      return "etapes";
    case "FACTURE":
    case "ENCAISSE":
      return "paiements";
  }
}

/** La rubrique v2 que demande un raccourci `?rubrique=` de la v1 (les adresses ne changent pas). */
export function rubriqueDemandee(rubrique: RubriqueDossier): RubriqueV2 {
  switch (rubrique) {
    case "photos":
      return "photos";
    case "messages":
      return "espace";
    case "devis":
      return "devis";
    case "encaisser":
      return "paiements";
    case "historique":
      return "historique";
    case "etape":
      return "etapes";
  }
}

/** L'identifiant de la section à l'écran (`rubrique-<x>`) ; « messages » vise le fil dans l'espace, comme en v1. */
export function cibleDuDefilement(rubrique: RubriqueDossier): string[] {
  if (rubrique === "messages") return ["rubrique-messages", "rubrique-espace"];
  if (rubrique === "encaisser") return ["rubrique-paiements"];
  if (rubrique === "etape") return ["rubrique-etapes"];
  return [`rubrique-${rubrique}`];
}
