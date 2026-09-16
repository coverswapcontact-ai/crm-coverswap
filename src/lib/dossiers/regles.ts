// Évaluation des règles d'étape (REGLES_ETAPES). Fonctions pures, sans accès
// à la base : l'interface s'en sert pour griser un bouton et dire ce qui
// manque, le serveur les rejoue avant d'écrire. Un futur agent passera par
// les mêmes fonctions pour proposer un changement d'étape.

import {
  ETAPES,
  ETAPES_ACTIVES,
  ETAPES_SORTIE,
  LIBELLES_CRITERE,
  LIBELLES_ETAPE,
  MOTIFS_PERTE,
  REGLES_ETAPES,
  type CritereEntree,
  type EtapeActive,
  type EtapeDossier,
  type EtapeSortie,
  type MotifPerte,
} from "./constants";

export function estEtape(valeur: string): valeur is EtapeDossier {
  return (ETAPES as readonly string[]).includes(valeur);
}

export function estEtapeActive(valeur: string): valeur is EtapeActive {
  return (ETAPES_ACTIVES as readonly string[]).includes(valeur);
}

export function estEtapeSortie(valeur: string): valeur is EtapeSortie {
  return (ETAPES_SORTIE as readonly string[]).includes(valeur);
}

export function rangEtape(etape: EtapeActive): number {
  return ETAPES_ACTIVES.indexOf(etape);
}

/** Ce qu'il faut savoir d'un dossier pour évaluer les critères d'entrée. */
export type FaitsDossier = {
  etape: EtapeDossier;
  clientNom: string;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  clientTelephone: string;
  objet: string;
  nbPhotos: number;
  dateChantier: Date | string | null;
  aDevisGenere: boolean;
  aFactureGeneree: boolean;
};

export const CRITERES_DECLARATIFS = ["BON_POUR_ACCORD", "ACOMPTE_ENCAISSE", "SOLDE_ENCAISSE"] as const;
export type CritereDeclaratif = (typeof CRITERES_DECLARATIFS)[number];

export function estCritereDeclaratif(critere: CritereEntree): critere is CritereDeclaratif {
  return (CRITERES_DECLARATIFS as readonly string[]).includes(critere);
}

/** Ce que la personne (ou l'agent) apporte au moment du changement d'étape. */
export type DonneesTransition = {
  motifPerte?: MotifPerte;
  /** Perte : qui a remporté le marché, à quel prix, précisions (facultatifs). */
  perteConcurrent?: string;
  perteMontantConcurrent?: number;
  perteCommentaire?: string;
  dateChantier?: string; // AAAA-MM-JJ
  confirmations?: Partial<Record<CritereDeclaratif, boolean>>;
};

export function critereRempli(
  critere: CritereEntree,
  faits: FaitsDossier,
  donnees: DonneesTransition = {}
): boolean {
  switch (critere) {
    case "COORDONNEES_COMPLETES":
      return [faits.clientNom, faits.clientAdresse, faits.clientCp, faits.clientVille, faits.clientTelephone].every(
        (valeur) => valeur.trim().length > 0
      );
    case "OBJET":
      return faits.objet.trim().length > 0;
    case "PHOTO":
      return faits.nbPhotos > 0;
    case "DEVIS_GENERE":
      return faits.aDevisGenere;
    case "FACTURE_GENEREE":
      return faits.aFactureGeneree;
    case "DATE_CHANTIER":
      return Boolean(donnees.dateChantier || faits.dateChantier);
    case "MOTIF_PERTE":
      return Boolean(donnees.motifPerte && (MOTIFS_PERTE as readonly string[]).includes(donnees.motifPerte));
    case "BON_POUR_ACCORD":
    case "ACOMPTE_ENCAISSE":
    case "SOLDE_ENCAISSE":
      return donnees.confirmations?.[critere] === true;
  }
}

/**
 * SUIVANTE : avancer vers une sortie prévue par REGLES_ETAPES (critères vérifiés).
 * RETOUR   : revenir à une étape active antérieure (correction, critères non revérifiés).
 * SORTIE   : passer en PERDU ou EN_PAUSE (critères de l'état de sortie vérifiés).
 * REPRISE  : quitter PERDU ou EN_PAUSE vers l'étape active quittée.
 */
export type NatureTransition = "SUIVANTE" | "RETOUR" | "SORTIE" | "REPRISE";

export type TransitionPossible = { vers: EtapeDossier; nature: NatureTransition };

export function transitionsPossibles(
  etape: EtapeDossier,
  etapeAvantSortie: EtapeActive | null
): TransitionPossible[] {
  if (etape === "PERDU" || etape === "EN_PAUSE") {
    const reprise: TransitionPossible = { vers: etapeAvantSortie ?? "QUALIFICATION", nature: "REPRISE" };
    return etape === "EN_PAUSE" ? [reprise, { vers: "PERDU", nature: "SORTIE" }] : [reprise];
  }
  const regle = REGLES_ETAPES[etape];
  return [
    ...regle.sorties.map((vers): TransitionPossible => ({ vers, nature: "SUIVANTE" })),
    ...(regle.terminale
      ? []
      : ETAPES_SORTIE.map((vers): TransitionPossible => ({ vers, nature: "SORTIE" }))),
    ...ETAPES_ACTIVES.slice(0, rangEtape(etape))
      .reverse()
      .map((vers): TransitionPossible => ({ vers, nature: "RETOUR" })),
  ];
}

/** Critères d'entrée à vérifier pour une transition donnée. */
export function criteresAVerifier(transition: TransitionPossible): readonly CritereEntree[] {
  return transition.nature === "SUIVANTE" || transition.nature === "SORTIE"
    ? REGLES_ETAPES[transition.vers].entree
    : [];
}

export type VerificationTransition =
  | { ok: true; nature: NatureTransition }
  | { ok: false; erreur: string; criteresManquants: CritereEntree[] };

export function verifierTransition(
  faits: FaitsDossier,
  vers: EtapeDossier,
  donnees: DonneesTransition,
  etapeAvantSortie: EtapeActive | null
): VerificationTransition {
  if (vers === faits.etape) {
    return { ok: false, erreur: `Le dossier est déjà à l'étape « ${LIBELLES_ETAPE[vers]} ».`, criteresManquants: [] };
  }
  const transition = transitionsPossibles(faits.etape, etapeAvantSortie).find((t) => t.vers === vers);
  if (!transition) {
    return {
      ok: false,
      erreur: `Passage de « ${LIBELLES_ETAPE[faits.etape]} » à « ${LIBELLES_ETAPE[vers]} » non autorisé.`,
      criteresManquants: [],
    };
  }
  const manquants = criteresAVerifier(transition).filter((critere) => !critereRempli(critere, faits, donnees));
  if (manquants.length > 0) {
    const liste = manquants.map((critere) => LIBELLES_CRITERE[critere].toLowerCase()).join(", ");
    return {
      ok: false,
      erreur: `Pour passer à « ${LIBELLES_ETAPE[vers]} », il manque : ${liste}.`,
      criteresManquants: manquants,
    };
  }
  return { ok: true, nature: transition.nature };
}

/** Structure du champ metadata d'un événement CHANGEMENT_ETAPE. */
export type MetadataChangementEtape = {
  de: EtapeDossier | null; // null à l'ouverture du dossier
  vers: EtapeDossier;
  nature: NatureTransition | "OUVERTURE" | "AUTOMATIQUE";
  motifPerte?: MotifPerte;
  perteConcurrent?: string;
  perteMontantConcurrent?: number;
  perteCommentaire?: string;
  /** Notre dernier prix au moment de la perte. */
  perteMontantPropose?: number;
  /** Étape active quittée au moment de la perte. */
  perteEtape?: EtapeDossier;
  dateChantier?: string; // AAAA-MM-JJ
  confirmations?: CritereDeclaratif[];
  documentId?: string;
};

/**
 * Étape active quittée lors de la dernière sortie (PERDU ou EN_PAUSE), lue
 * dans les événements CHANGEMENT_ETAPE du plus récent au plus ancien.
 * Un passage EN_PAUSE → PERDU est ignoré : la reprise ramène à l'étape active.
 */
export function etapeAvantSortie(
  metadonnees: Pick<MetadataChangementEtape, "de" | "vers">[]
): EtapeActive | null {
  for (const { de, vers } of metadonnees) {
    if (estEtapeSortie(vers) && de && estEtapeActive(de)) return de;
  }
  return null;
}

export function lireMetadataChangementEtape(json: string): MetadataChangementEtape | null {
  try {
    const valeur = JSON.parse(json) as Partial<MetadataChangementEtape>;
    if (typeof valeur.vers === "string" && estEtape(valeur.vers)) {
      return {
        ...valeur,
        de: typeof valeur.de === "string" && estEtape(valeur.de) ? valeur.de : null,
        vers: valeur.vers,
      } as MetadataChangementEtape;
    }
  } catch {
    // metadata illisible : l'événement est ignoré
  }
  return null;
}
