// Paramètres fiscaux, sociaux et de facturation. AUCUNE valeur par défaut :
// un seuil ou un taux faux dans le code serait faux sans que personne ne le
// voie. Chaque paramètre se saisit à sa première utilisation, avec sa date
// d'effet et sa source ; l'historique reste. Aucune dépendance serveur.

export type NatureParametre = "euros" | "pourcentage" | "jours" | "choix" | "texte";

export type DefinitionParametre = {
  libelle: string;
  /** Où trouver la valeur. Jamais la valeur elle-même. */
  aide: string;
  nature: NatureParametre;
  options?: readonly { valeur: string; libelle: string }[];
  groupe: GroupeParametre;
};

export const GROUPES_PARAMETRES = {
  FISCAL: "Seuils fiscaux",
  SOCIAL: "Cotisations sociales",
  ENCAISSEMENT: "Encaissements",
  FACTURATION: "Factures aux professionnels",
  COMMERCIAL: "Suivi commercial",
} as const;
export type GroupeParametre = keyof typeof GROUPES_PARAMETRES;

export const DEFINITIONS_PARAMETRES = {
  SEUIL_FRANCHISE_TVA: {
    libelle: "Seuil de franchise en base de TVA (prestations de services)",
    aide: "Chiffre d'affaires annuel sous lequel la TVA n'est pas facturée (article 293 B du CGI). Montant en vigueur sur impots.gouv.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  SEUIL_FRANCHISE_TVA_MAJORE: {
    libelle: "Seuil majoré de franchise de TVA",
    aide: "Seuil de tolérance au-delà duquel la TVA est due immédiatement. Montant en vigueur sur impots.gouv.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  PLAFOND_MICRO_ENTREPRISE: {
    libelle: "Plafond de chiffre d'affaires du régime micro (prestations de services)",
    aide: "Au-delà, sortie du régime micro-entreprise. Montant en vigueur sur autoentrepreneur.urssaf.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  TAUX_COTISATIONS_SOCIALES: {
    libelle: "Taux des cotisations sociales",
    aide: "Pourcentage du chiffre d'affaires encaissé dû à l'URSSAF pour l'activité déclarée. Taux affiché dans l'espace autoentrepreneur.urssaf.fr.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  TAUX_CFP: {
    libelle: "Taux de la contribution à la formation professionnelle",
    aide: "Pourcentage du chiffre d'affaires encaissé, selon l'activité (artisan ou commerçant). Visible sur la déclaration URSSAF.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  VERSEMENT_LIBERATOIRE: {
    libelle: "Option pour le versement libératoire de l'impôt",
    aide: "Choix fait auprès de l'URSSAF. Si oui, le taux correspondant est demandé ensuite.",
    nature: "choix",
    options: [
      { valeur: "NON", libelle: "Non" },
      { valeur: "OUI", libelle: "Oui" },
    ],
    groupe: "SOCIAL",
  },
  TAUX_VERSEMENT_LIBERATOIRE: {
    libelle: "Taux du versement libératoire",
    aide: "Pourcentage du chiffre d'affaires encaissé, selon l'activité. Visible sur la déclaration URSSAF.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  PERIODICITE_DECLARATION: {
    libelle: "Périodicité de la déclaration de chiffre d'affaires",
    aide: "Mensuelle ou trimestrielle, telle que choisie dans l'espace URSSAF.",
    nature: "choix",
    options: [
      { valeur: "MENSUELLE", libelle: "Mensuelle" },
      { valeur: "TRIMESTRIELLE", libelle: "Trimestrielle" },
    ],
    groupe: "SOCIAL",
  },
  DATE_RECETTE_CHEQUE: {
    libelle: "Date à laquelle un chèque compte comme recette",
    aide: "À faire confirmer par le comptable : à la réception du chèque, ou à son crédit sur le compte. La même règle doit s'appliquer à tous les chèques.",
    nature: "choix",
    options: [
      { valeur: "RECEPTION", libelle: "À la réception du chèque" },
      { valeur: "CREDIT_BANCAIRE", libelle: "Au crédit sur le compte" },
    ],
    groupe: "ENCAISSEMENT",
  },
  DELAI_PAIEMENT_PROFESSIONNELS: {
    libelle: "Délai de paiement des factures aux professionnels",
    aide: "Nombre de jours entre la facture et son échéance, imprimé sur la facture. Plafonné par l'article L. 441-10 du Code de commerce.",
    nature: "jours",
    groupe: "FACTURATION",
  },
  TAUX_PENALITES_RETARD: {
    libelle: "Taux annuel des pénalités de retard",
    aide: "Mention obligatoire sur les factures aux professionnels (article L. 441-10 du Code de commerce). Ne peut être inférieur au minimum légal : voir le comptable.",
    nature: "pourcentage",
    groupe: "FACTURATION",
  },
  INDEMNITE_RECOUVREMENT: {
    libelle: "Indemnité forfaitaire pour frais de recouvrement",
    aide: "Mention obligatoire sur les factures aux professionnels ; montant fixé par l'article D. 441-5 du Code de commerce.",
    nature: "euros",
    groupe: "FACTURATION",
  },
  ESCOMPTE_PAIEMENT_ANTICIPE: {
    libelle: "Conditions d'escompte pour paiement anticipé",
    aide: "Mention obligatoire sur les factures aux professionnels, même s'il n'y en a pas (écrire alors « Néant »).",
    nature: "texte",
    groupe: "FACTURATION",
  },
  DELAI_RELANCE_DEVIS: {
    libelle: "Délai avant de proposer une relance de devis",
    aide: "Nombre de jours sans réponse après l'envoi d'un devis avant que le système propose une relance (jamais envoyée sans validation).",
    nature: "jours",
    groupe: "COMMERCIAL",
  },
} as const satisfies Record<string, DefinitionParametre>;

export type CleParametre = keyof typeof DEFINITIONS_PARAMETRES;
export const CLES_PARAMETRES = Object.keys(DEFINITIONS_PARAMETRES) as CleParametre[];

export type ValeurParametre = number | string;

export type ParametreVue = {
  cle: CleParametre;
  libelle: string;
  aide: string;
  nature: NatureParametre;
  options: readonly { valeur: string; libelle: string }[];
  groupe: GroupeParametre;
  /** Valeur en vigueur aujourd'hui, ou null si jamais saisie. */
  courante: { valeur: ValeurParametre; valableDu: string; source: string | null } | null;
  /** Valeurs futures déjà saisies et anciennes valeurs, de la plus récente à la plus ancienne. */
  historique: { id: string; valeur: ValeurParametre; valableDu: string; source: string | null; saisiLe: string; saisiPar: string | null }[];
};

export function formaterValeurParametre(cle: CleParametre, valeur: ValeurParametre): string {
  const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
  switch (definition.nature) {
    case "euros":
      return `${Number(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
    case "pourcentage":
      return `${Number(valeur).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`;
    case "jours":
      return `${valeur} jour${Number(valeur) > 1 ? "s" : ""}`;
    case "choix":
      return definition.options?.find((option) => option.valeur === valeur)?.libelle ?? String(valeur);
    default:
      return String(valeur);
  }
}
