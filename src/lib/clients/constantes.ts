// Clients pérennes : valeurs autorisées des champs texte (SQLite n'a pas
// d'enum). Aucune dépendance serveur : partagé avec l'interface.

export const CATEGORIES_CLIENT = ["PARTICULIER", "PROFESSIONNEL", "DONNEUR_ORDRE"] as const;
export type CategorieClient = (typeof CATEGORIES_CLIENT)[number];

export const LIBELLES_CATEGORIE_CLIENT: Record<CategorieClient, string> = {
  PARTICULIER: "Particulier",
  PROFESSIONNEL: "Professionnel",
  DONNEUR_ORDRE: "Donneur d'ordre (sous-traitance)",
};

/** D'où vient le client. Pensé pour comparer ce que rapporte chaque canal. */
export const SOURCES_CLIENT = [
  "META_ADS",
  "SITE_SIMULATEUR",
  "SITE_DEVIS",
  "SITE_CONTACT",
  "RECOMMANDATION",
  "BOUCHE_A_OREILLE",
  "RESEAUX_SOCIAUX",
  "ORGANIQUE",
  "PROSPECTION",
  "SOUS_TRAITANCE",
  "SALON",
  "AUTRE",
  "INCONNUE",
] as const;
export type SourceClient = (typeof SOURCES_CLIENT)[number];

export const LIBELLES_SOURCE_CLIENT: Record<SourceClient, string> = {
  META_ADS: "Publicité Meta",
  SITE_SIMULATEUR: "Site : simulateur",
  SITE_DEVIS: "Site : demande de devis",
  SITE_CONTACT: "Site : formulaire de contact",
  RECOMMANDATION: "Recommandation (personne connue)",
  BOUCHE_A_OREILLE: "Bouche-à-oreille",
  RESEAUX_SOCIAUX: "Réseaux sociaux (non payé)",
  ORGANIQUE: "Organique, canal inconnu",
  PROSPECTION: "Prospection (démarchage)",
  SOUS_TRAITANCE: "Sous-traitance",
  SALON: "Salon, événement",
  AUTRE: "Autre",
  INCONNUE: "Inconnue",
};

/** Familles de canaux, pour « bouche-à-oreille contre Meta » et le reste. */
export const FAMILLES_SOURCE = {
  PAYANT: ["META_ADS"],
  SITE: ["SITE_SIMULATEUR", "SITE_DEVIS", "SITE_CONTACT"],
  RELATIONNEL: ["RECOMMANDATION", "BOUCHE_A_OREILLE", "SOUS_TRAITANCE"],
  ORGANIQUE: ["RESEAUX_SOCIAUX", "ORGANIQUE", "SALON"],
  DEMARCHAGE: ["PROSPECTION"],
  NON_RENSEIGNE: ["AUTRE", "INCONNUE"],
} as const satisfies Record<string, readonly SourceClient[]>;
export type FamilleSource = keyof typeof FAMILLES_SOURCE;

export const LIBELLES_FAMILLE_SOURCE: Record<FamilleSource, string> = {
  PAYANT: "Publicité payante",
  SITE: "Site internet",
  RELATIONNEL: "Relations (recommandation, bouche-à-oreille, sous-traitance)",
  ORGANIQUE: "Organique (réseaux, salons)",
  DEMARCHAGE: "Démarchage",
  NON_RENSEIGNE: "Non renseigné",
};

export function familleDeSource(source: string): FamilleSource {
  for (const [famille, sources] of Object.entries(FAMILLES_SOURCE) as [FamilleSource, readonly string[]][]) {
    if (sources.includes(source)) return famille;
  }
  return "NON_RENSEIGNE";
}

export const STATUTS_CONSENTEMENT = ["ACCORDE", "REFUSE", "RETIRE"] as const;
export type StatutConsentement = (typeof STATUTS_CONSENTEMENT)[number];

export const LIBELLES_STATUT_CONSENTEMENT: Record<StatutConsentement, string> = {
  ACCORDE: "Accepte les mails commerciaux",
  REFUSE: "Refuse les mails commerciaux",
  RETIRE: "A retiré son accord",
};

export const MOYENS_CONSENTEMENT = ["FORMULAIRE_SITE", "META_ADS", "ORAL", "ECRIT", "EMAIL", "AUTRE"] as const;
export type MoyenConsentement = (typeof MOYENS_CONSENTEMENT)[number];

export const LIBELLES_MOYEN_CONSENTEMENT: Record<MoyenConsentement, string> = {
  FORMULAIRE_SITE: "Case cochée sur le site",
  META_ADS: "Formulaire Meta",
  ORAL: "À l'oral (noté par moi)",
  ECRIT: "Par écrit (devis, courrier)",
  EMAIL: "Par mail",
  AUTRE: "Autre",
};
