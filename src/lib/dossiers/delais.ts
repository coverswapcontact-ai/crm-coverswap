// Délais et écarts d'un dossier, calculés depuis son historique. Fonctions
// pures : le panneau du dossier et la synthèse s'en servent de la même façon.

import { ETAPES, type EtapeDossier } from "./constants";

export type PassageEtape = {
  etape: EtapeDossier;
  debut: string; // ISO
  fin: string | null; // null : étape en cours
  dureeMs: number;
};

type Changement = { createdAt: Date | string; vers: string };

const JOUR_MS = 24 * 60 * 60_000;

function estEtape(valeur: string): valeur is EtapeDossier {
  return (ETAPES as readonly string[]).includes(valeur);
}

/** Suite des étapes traversées, dans l'ordre, avec la durée de chacune (l'étape en cours court jusqu'à maintenant). */
export function parcoursEtapes(changements: Changement[], maintenant: Date = new Date()): PassageEtape[] {
  const tries = changements
    .filter((changement) => estEtape(changement.vers))
    .map((changement) => ({ date: new Date(changement.createdAt), vers: changement.vers as EtapeDossier }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return tries.map((changement, index) => {
    const suivant = tries[index + 1];
    const fin = suivant ? suivant.date : null;
    return {
      etape: changement.vers,
      debut: changement.date.toISOString(),
      fin: fin?.toISOString() ?? null,
      dureeMs: Math.max(0, (fin ?? maintenant).getTime() - changement.date.getTime()),
    };
  });
}

/** Temps cumulé par étape (une étape traversée deux fois, après un retour, compte ses deux passages). */
export function dureeParEtape(parcours: PassageEtape[]): Partial<Record<EtapeDossier, number>> {
  const durees: Partial<Record<EtapeDossier, number>> = {};
  for (const passage of parcours) durees[passage.etape] = (durees[passage.etape] ?? 0) + passage.dureeMs;
  return durees;
}

export type DelaisCles = {
  /** De l'ouverture au premier passage en « Signé ». */
  ouvertureASignature: number | null;
  /** Du premier passage en « Signé » au premier passage en « Chantier ». */
  signatureAChantier: number | null;
  /** Du premier passage en « Facturé » au premier passage en « Encaissé ». */
  facturationAEncaissement: number | null;
  /** De l'ouverture au premier passage en « Encaissé ». */
  boutEnBout: number | null;
};

export function delaisCles(parcours: PassageEtape[]): DelaisCles {
  const premier = (etape: EtapeDossier) => parcours.find((passage) => passage.etape === etape)?.debut ?? null;
  const ecart = (de: string | null, a: string | null) =>
    de && a && new Date(a) >= new Date(de) ? new Date(a).getTime() - new Date(de).getTime() : null;
  const ouverture = parcours[0]?.debut ?? null;
  return {
    ouvertureASignature: ecart(ouverture, premier("SIGNE")),
    signatureAChantier: ecart(premier("SIGNE"), premier("CHANTIER")),
    facturationAEncaissement: ecart(premier("FACTURE"), premier("ENCAISSE")),
    boutEnBout: ecart(ouverture, premier("ENCAISSE")),
  };
}

export function enJours(dureeMs: number): number {
  return Math.floor(dureeMs / JOUR_MS);
}

/** « 3 j », « moins d'un jour » */
export function formatDuree(dureeMs: number): string {
  const jours = enJours(dureeMs);
  if (jours === 0) {
    const heures = Math.floor(dureeMs / (60 * 60_000));
    return heures <= 0 ? "moins d'une heure" : `${heures} h`;
  }
  return `${jours} j`;
}

type DocumentPourEcart = { type: string; statut: string; totalHt: number; dateEmission: Date | string | null; createdAt: Date | string };

export type EcartsPrix = {
  estimation: number | null;
  premierDevis: number | null;
  dernierDevis: number | null;
  devisSigne: number | null;
  facture: number | null;
  /** Devis signé moins premier devis (négatif : remise accordée en route). */
  ecartSignature: number | null;
  ecartSignaturePct: number | null;
};

/** Du premier prix proposé au prix signé, puis facturé. Seuls les documents émis comptent. */
export function ecartsPrix(documents: DocumentPourEcart[], estimation: number | null): EcartsPrix {
  const emis = documents
    .filter((document) => document.statut !== "BROUILLON")
    .sort((a, b) => new Date(a.dateEmission ?? a.createdAt).getTime() - new Date(b.dateEmission ?? b.createdAt).getTime());
  const devis = emis.filter((document) => document.type === "DEVIS");
  const signe = [...devis].reverse().find((document) => document.statut === "ACCEPTE") ?? null;
  const factures = emis.filter((document) => document.type === "FACTURE");
  const premierDevis = devis[0]?.totalHt ?? null;
  const ecartSignature = signe && premierDevis !== null ? Math.round((signe.totalHt - premierDevis) * 100) / 100 : null;
  return {
    estimation,
    premierDevis,
    dernierDevis: devis.at(-1)?.totalHt ?? null,
    devisSigne: signe?.totalHt ?? null,
    facture: factures.length > 0 ? Math.round(factures.reduce((somme, document) => somme + document.totalHt, 0) * 100) / 100 : null,
    ecartSignature,
    ecartSignaturePct:
      ecartSignature !== null && premierDevis ? Math.round((ecartSignature / premierDevis) * 1000) / 10 : null,
  };
}
