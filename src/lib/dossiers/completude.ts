// Ce qui manque à un dossier, dit une seule fois pour tous les écrans : le
// panneau du dossier (« À compléter »), les cartes et la liste (un compte),
// la qualité des données de /synthese. Rien n'est exigé : un dossier
// incomplet reste utilisable, la discipline vient de ce qui se voit.
// Fonction pure, sans accès à la base.

import { ETAPES_ACTIVES, type EtapeActive, type EtapeDossier } from "./constants";

export const CODES_COMPLETUDE = [
  "CLIENT_NON_RATTACHE",
  "TELEPHONE",
  "ADRESSE",
  "OBJET",
  "PHOTO",
  "SOURCE",
  "DEVIS",
  "ACOMPTE",
  "DATE_CHANTIER",
  "FACTURE",
  "SOLDE",
  "DATES_ETAPES",
  "MOTIF_PERTE",
] as const;
export type CodeCompletude = (typeof CODES_COMPLETUDE)[number];

/** Libellés de la qualité des données (/synthese) : un nombre de dossiers suit. */
export const LIBELLES_QUALITE_DOSSIERS: Record<CodeCompletude, string> = {
  CLIENT_NON_RATTACHE: "Dossiers sans fiche client rattachée",
  TELEPHONE: "Dossiers sans téléphone du client",
  ADRESSE: "Dossiers sans adresse complète du chantier",
  OBJET: "Dossiers sans objet",
  PHOTO: "Dossiers sans photo du chantier",
  SOURCE: "Dossiers dont la source n'est pas renseignée",
  DEVIS: "Dossiers au-delà de « Devis envoyé » sans devis",
  ACOMPTE: "Dossiers signés sans acompte ni motif d'absence",
  DATE_CHANTIER: "Dossiers planifiés sans date de chantier",
  FACTURE: "Dossiers facturés sans facture",
  SOLDE: "Dossiers encaissés dont les factures ne sont pas réglées",
  DATES_ETAPES: "Dossiers dont des dates d'étape sont inconnues",
  MOTIF_PERTE: "Dossiers perdus sans motif",
};

export type FaitsCompletude = {
  etape: EtapeDossier;
  /** Perdu ou en pause : l'étape active quittée. */
  etapeAvantSortie: EtapeActive | null;
  clientId: string | null;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  clientTelephone: string;
  objet: string;
  source: string;
  nbPhotos: number;
  dateChantier: Date | string | null;
  /** Devis émis (générés ou déjà émis), remplacés compris. */
  nbDevis: number;
  /** Factures émises non annulées. */
  nbFactures: number;
  /** Encaissements valides du dossier. */
  nbPaiements: number;
  /** Une signature sans acompte a été motivée. */
  sansAcompteMotive: boolean;
  /** Factures actives moins paiements valides du dossier, en euros (jamais négatif). */
  resteDu: number;
  motifPerte: string | null;
  /** Passages d'étape dont la date réelle n'est pas connue. */
  nbDatesInconnues: number;
};

export type PointACompleter = { code: CodeCompletude; libelle: string };

const formatEuros = (montant: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(montant)} €`;

const rang = (etape: EtapeActive) => ETAPES_ACTIVES.indexOf(etape);

export function pointsACompleter(faits: FaitsCompletude): PointACompleter[] {
  const points: PointACompleter[] = [];
  const ajouter = (code: CodeCompletude, libelle: string) => points.push({ code, libelle });

  // Un dossier perdu n'a plus rien à compléter, sauf de quoi comprendre la perte.
  if (faits.etape === "PERDU") {
    if (!faits.motifPerte) ajouter("MOTIF_PERTE", "Motif de la perte");
    return points;
  }

  if (!faits.clientId) ajouter("CLIENT_NON_RATTACHE", "Fiche client à rattacher");
  if (!faits.clientTelephone.trim()) ajouter("TELEPHONE", "Téléphone du client");
  const adresse = [
    ...(faits.clientAdresse.trim() ? [] : ["rue"]),
    ...(faits.clientCp.trim() ? [] : ["code postal"]),
    ...(faits.clientVille.trim() ? [] : ["ville"]),
  ];
  if (adresse.length) ajouter("ADRESSE", `Adresse du chantier (${adresse.join(", ")})`);
  if (!faits.objet.trim()) ajouter("OBJET", "Objet du chantier");
  if (faits.nbPhotos === 0) ajouter("PHOTO", "Photos du chantier");
  if (faits.source === "INCONNUE") ajouter("SOURCE", "Source du dossier");

  const reference = faits.etape === "EN_PAUSE" ? faits.etapeAvantSortie : (faits.etape as EtapeActive);
  const atteinte = (etape: EtapeActive) => reference !== null && rang(reference) >= rang(etape);
  if (atteinte("DEVIS_ENVOYE") && faits.nbDevis === 0) ajouter("DEVIS", "Devis : aucun généré ni enregistré");
  if (atteinte("SIGNE") && faits.nbPaiements === 0 && !faits.sansAcompteMotive) {
    ajouter("ACOMPTE", "Acompte : ni enregistré ni motif d'absence");
  }
  if (atteinte("PLANIFIE") && !faits.dateChantier) ajouter("DATE_CHANTIER", "Date du chantier");
  if (atteinte("FACTURE") && faits.nbFactures === 0) ajouter("FACTURE", "Facture : aucune générée ni enregistrée");
  if (faits.etape === "ENCAISSE" && faits.nbFactures > 0 && faits.resteDu > 0.005) {
    ajouter("SOLDE", `Encaissé, mais ${formatEuros(faits.resteDu)} restent dus sur les factures`);
  }
  if (faits.nbDatesInconnues > 0) {
    ajouter("DATES_ETAPES", faits.nbDatesInconnues > 1 ? `${faits.nbDatesInconnues} dates d'étape inconnues` : "Une date d'étape inconnue");
  }
  return points;
}
