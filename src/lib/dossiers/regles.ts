// Évaluation des règles d'étape (REGLES_ETAPES). Fonctions pures, sans accès
// à la base : l'interface s'en sert pour dire ce qui manque avant de confirmer,
// le serveur les rejoue et garde les avertissements passés dans l'historique.
// Un futur agent passera par les mêmes fonctions pour proposer un changement
// d'étape.
//
// Signaler, jamais bloquer : toute étape peut passer à toute autre, dans les
// deux sens. Une règle d'entrée non remplie devient un avertissement, que la
// personne lit puis confirme.

import {
  ETAPES,
  ETAPES_ACTIVES,
  ETAPES_SORTIE,
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
  /** Un encaissement valide est enregistré sur le dossier. */
  acompteEnregistre: boolean;
  /** Le dossier a au moins une facture active, et toutes sont réglées. */
  soldeEncaisse: boolean;
  /** Reste à payer sur les factures actives, en euros (pour le dire dans l'avertissement). */
  resteDu?: number;
};

// L'acompte et le solde ne se déclarent plus : ils s'enregistrent (encaissements).
export const CRITERES_DECLARATIFS = ["BON_POUR_ACCORD"] as const;
export type CritereDeclaratif = (typeof CRITERES_DECLARATIFS)[number];

export function estCritereDeclaratif(critere: CritereEntree): critere is CritereDeclaratif {
  return (CRITERES_DECLARATIFS as readonly string[]).includes(critere);
}

/** Ce que la personne (ou l'agent) apporte au moment du changement d'étape. Tout est facultatif. */
export type DonneesTransition = {
  motifPerte?: MotifPerte;
  /** Perte : qui a remporté le marché, à quel prix, précisions (facultatifs). */
  perteConcurrent?: string;
  perteMontantConcurrent?: number;
  perteCommentaire?: string;
  dateChantier?: string; // AAAA-MM-JJ
  confirmations?: Partial<Record<CritereDeclaratif, boolean>>;
  /** Signature : acompte reçu, enregistré avec le changement d'étape. */
  acompte?: { montant: number } | null;
  /** Signature sans acompte : le motif. */
  sansAcompte?: { motif: string; precision?: string } | null;
  /** Encaissement : paiement du solde, enregistré avec le changement d'étape. */
  solde?: { montant: number } | null;
  /** Jour réel du passage (AAAA-MM-JJ), s'il a eu lieu avant aujourd'hui. */
  survenuLe?: string;
};

/** Champs de coordonnées vides, dans l'ordre où on les lit. */
export function coordonneesManquantes(faits: Pick<FaitsDossier, "clientAdresse" | "clientCp" | "clientVille" | "clientTelephone">): string[] {
  const champs: [string, string][] = [
    ["l'adresse", faits.clientAdresse],
    ["le code postal", faits.clientCp],
    ["la ville", faits.clientVille],
    ["le téléphone", faits.clientTelephone],
  ];
  return champs.filter(([, valeur]) => !valeur.trim()).map(([libelle]) => libelle);
}

export function critereRempli(critere: CritereEntree, faits: FaitsDossier, donnees: DonneesTransition = {}): boolean {
  switch (critere) {
    case "COORDONNEES_COMPLETES":
      return faits.clientNom.trim().length > 0 && coordonneesManquantes(faits).length === 0;
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
      return donnees.confirmations?.[critere] === true;
    case "ACOMPTE_ENCAISSE":
      return faits.acompteEnregistre || Boolean(donnees.acompte) || Boolean(donnees.sansAcompte?.motif);
    case "SOLDE_ENCAISSE":
      return faits.soldeEncaisse || Boolean(donnees.solde);
  }
}

/**
 * SUIVANTE : avancer vers une étape active plus loin dans le tunnel (d'un pas ou de plusieurs).
 * RETOUR   : revenir à une étape active antérieure (correction).
 * SORTIE   : passer en PERDU ou EN_PAUSE (ou de l'un à l'autre).
 * REPRISE  : quitter PERDU ou EN_PAUSE vers une étape active.
 */
export type NatureTransition = "SUIVANTE" | "RETOUR" | "SORTIE" | "REPRISE";

export type TransitionPossible = {
  vers: EtapeDossier;
  nature: NatureTransition;
  /** Le chemin habituel depuis cette étape (REGLES_ETAPES), mis en avant à l'écran. */
  suggeree: boolean;
};

export function natureTransition(de: EtapeDossier, vers: EtapeDossier): NatureTransition {
  if (estEtapeSortie(vers)) return "SORTIE";
  if (!estEtapeActive(de)) return "REPRISE";
  return rangEtape(vers as EtapeActive) > rangEtape(de) ? "SUIVANTE" : "RETOUR";
}

/** Toutes les étapes sauf l'actuelle ; le chemin habituel est marqué comme suggéré. */
export function transitionsPossibles(etape: EtapeDossier, etapeAvantSortie: EtapeActive | null): TransitionPossible[] {
  const suggerees = new Set<EtapeDossier>(
    estEtapeActive(etape)
      ? [...REGLES_ETAPES[etape].sorties, ...(REGLES_ETAPES[etape].terminale ? [] : ETAPES_SORTIE)]
      : [etapeAvantSortie ?? "QUALIFICATION", ...(etape === "EN_PAUSE" ? (["PERDU"] as const) : [])]
  );
  return ETAPES.filter((vers) => vers !== etape).map((vers) => ({
    vers,
    nature: natureTransition(etape, vers),
    suggeree: suggerees.has(vers),
  }));
}

/**
 * Critères d'entrée à rappeler pour un passage : ceux de chaque étape
 * franchie en avançant (sauter du devis au chantier rappelle la signature et
 * la date de chantier), le motif pour une perte. Un retour, une reprise vers
 * l'étape quittée ou une pause ne rappellent rien.
 */
export function criteresAVerifier(de: EtapeDossier, vers: EtapeDossier, etapeAvantSortie: EtapeActive | null = null): CritereEntree[] {
  if (vers === "PERDU") return [...REGLES_ETAPES.PERDU.entree];
  if (!estEtapeActive(vers)) return [];
  const reference = estEtapeActive(de) ? de : etapeAvantSortie;
  const depart = reference ? rangEtape(reference) : -1;
  if (rangEtape(vers) <= depart) return [];
  const franchies = ETAPES_ACTIVES.slice(depart + 1, rangEtape(vers) + 1);
  return [...new Set(franchies.flatMap((etape) => REGLES_ETAPES[etape].entree))];
}

export type Avertissement = { critere: CritereEntree; message: string };

const formatEuros = (montant: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(montant)} €`;

function joindre(elements: string[]): string {
  return elements.length <= 1 ? (elements[0] ?? "") : `${elements.slice(0, -1).join(", ")} et ${elements.at(-1)}`;
}

export function messageAvertissement(critere: CritereEntree, faits: FaitsDossier): string {
  switch (critere) {
    case "COORDONNEES_COMPLETES": {
      const manquants = coordonneesManquantes(faits);
      return manquants.length ? `Il manque ${joindre(manquants)} du client.` : "Coordonnées du client incomplètes.";
    }
    case "OBJET":
      return "L'objet du chantier n'est pas renseigné.";
    case "PHOTO":
      return "Aucune photo du chantier.";
    case "DEVIS_GENERE":
      return "Aucun devis n'a été généré pour ce dossier.";
    case "BON_POUR_ACCORD":
      return "Le bon pour accord n'est pas confirmé.";
    case "ACOMPTE_ENCAISSE":
      return "Aucun acompte enregistré.";
    case "DATE_CHANTIER":
      return "Pas de date de chantier.";
    case "FACTURE_GENEREE":
      return "Aucune facture n'a été générée pour ce dossier.";
    case "SOLDE_ENCAISSE":
      return faits.aFactureGeneree
        ? faits.resteDu
          ? `Les factures ne sont pas réglées : il reste ${formatEuros(faits.resteDu)}.`
          : "Les factures ne sont pas entièrement réglées."
        : "Aucune facture à régler dans ce dossier.";
    case "MOTIF_PERTE":
      return "Le motif de perte n'est pas renseigné.";
  }
}

/** Ce qui manque pour ce passage, dit en clair. Vide : rien à signaler. */
export function avertissementsTransition(
  faits: FaitsDossier,
  vers: EtapeDossier,
  donnees: DonneesTransition = {},
  etapeAvantSortie: EtapeActive | null = null
): Avertissement[] {
  const manquants = criteresAVerifier(faits.etape, vers, etapeAvantSortie).filter((critere) => !critereRempli(critere, faits, donnees));
  // Sans facture, « aucune facture générée » suffit : le solde n'a rien à ajouter.
  const sansDoublon = manquants.includes("FACTURE_GENEREE") ? manquants.filter((critere) => critere !== "SOLDE_ENCAISSE") : manquants;
  return sansDoublon.map((critere) => ({ critere, message: messageAvertissement(critere, faits) }));
}

export type VerificationTransition =
  | { ok: true; nature: NatureTransition; avertissements: Avertissement[] }
  | { ok: false; erreur: string };

/** Un passage n'est refusé que s'il ne change rien ; sinon il passe, avec ses avertissements. */
export function verifierTransition(
  faits: FaitsDossier,
  vers: EtapeDossier,
  donnees: DonneesTransition,
  etapeAvantSortie: EtapeActive | null
): VerificationTransition {
  if (vers === faits.etape) {
    return { ok: false, erreur: `Le dossier est déjà à l'étape « ${LIBELLES_ETAPE[vers]} ».` };
  }
  return {
    ok: true,
    nature: natureTransition(faits.etape, vers),
    avertissements: avertissementsTransition(faits, vers, donnees, etapeAvantSortie),
  };
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
  /** Critères déclarés (anciens événements : aussi ACOMPTE_ENCAISSE, SOLDE_ENCAISSE). */
  confirmations?: string[];
  /** Signature : acompte enregistré avec le changement d'étape. */
  acompte?: { montant: number };
  /** Signature sans acompte : motif en clair. */
  sansAcompte?: string;
  /** Changement automatique : ce qui l'a provoqué. */
  raison?: string;
  documentId?: string;
  /** Ce qui manquait, lu et confirmé par la personne au moment du passage. */
  avertissements?: string[];
  /** Dossier repris : le passage a eu lieu, sa date réelle n'est pas connue. */
  dateInconnue?: boolean;
};

/**
 * Étape active quittée lors de la dernière sortie (PERDU ou EN_PAUSE), lue
 * dans les événements CHANGEMENT_ETAPE du plus récent au plus ancien.
 * Un passage EN_PAUSE → PERDU est ignoré : la reprise ramène à l'étape active.
 */
export function etapeAvantSortie(metadonnees: Pick<MetadataChangementEtape, "de" | "vers">[]): EtapeActive | null {
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
