// Section Prospects du pilotage : tout ce qui précède un dossier.
// - Entrants : les contacts qui arrivent d'eux-mêmes (site, simulateur, Meta,
//   Zapier, saisie à la main), modèle Lead ;
// - Démarchage : les établissements sourcés et scorés (Google Places), modèle
//   Prospect.
// Fonctions et libellés purs, partagés par l'écran et le serveur.

/* ── Entrants ─────────────────────────────────────────────────────── */

export const STATUTS_LEAD = ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE", "DEVIS_ENVOYE", "SIGNE", "CHANTIER_PLANIFIE", "TERMINE", "PERDU"] as const;
export type StatutLead = (typeof STATUTS_LEAD)[number];

export const LIBELLES_STATUT_LEAD: Record<StatutLead, string> = {
  NOUVEAU: "À traiter",
  DEVIS_DEMANDE: "Devis demandé",
  CONTACTE: "Contacté",
  DEVIS_ENVOYE: "Devis envoyé",
  SIGNE: "Signé",
  CHANTIER_PLANIFIE: "Chantier",
  TERMINE: "Terminé",
  PERDU: "Sans suite",
};

/** Statuts de l'ancien CRM au-delà du premier contact : devis envoyé, signé, chantier, terminé. */
export const STATUTS_LEAD_APRES_DEVIS = ["DEVIS_ENVOYE", "SIGNE", "CHANTIER_PLANIFIE", "TERMINE"] as const satisfies readonly StatutLead[];

/** Statuts qu'on choisit à la main avant le dossier ; ensuite, le statut suit le dossier. */
export const STATUTS_LEAD_MANUELS = ["NOUVEAU", "DEVIS_DEMANDE", "CONTACTE", "PERDU"] as const satisfies readonly StatutLead[];
export type StatutLeadManuel = (typeof STATUTS_LEAD_MANUELS)[number];

export const SOURCES_LEAD = ["SITE_DEVIS", "SITE_SIMULATEUR", "SITE_CONTACT", "SITE_PRO", "META_ADS", "INSTAGRAM", "TIKTOK", "ORGANIQUE", "REFERENCE", "MAIL", "AUTRE"] as const;
export type SourceLead = (typeof SOURCES_LEAD)[number];

export const LIBELLES_SOURCE_LEAD: Record<string, string> = {
  SITE_DEVIS: "Site : demande de devis",
  SITE_SIMULATEUR: "Site : simulateur",
  SITE_CONTACT: "Site : contact",
  SITE_PRO: "Site : devis pro",
  META_ADS: "Publicité Meta",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  ORGANIQUE: "Organique",
  REFERENCE: "Recommandation",
  MAIL: "Mail (demande reçue dans la boîte)",
  AUTRE: "Autre",
};

export const libelleSourceLead = (source: string): string => LIBELLES_SOURCE_LEAD[source] ?? source;

/**
 * Mission 16 (partie 4) : ce qu'est une demande de devis venue du site, en UNE règle (webhook, classement, intention,
 * push, point du jour). L'ancien formulaire de /devis (encore lu), celui de /pro, et celui de /contact quand il porte
 * un projet : tous les boutons « Demander un devis » du site y mènent ; « Autre » y reste un simple message.
 */
export const SOURCES_DEMANDE_DE_DEVIS = ["SITE_DEVIS", "SITE_PRO"] as const;

export function estDemandeDeDevis(lead: { source: string; typeProjet?: string | null }): boolean {
  if ((SOURCES_DEMANDE_DE_DEVIS as readonly string[]).includes(lead.source)) return true;
  return lead.source === "SITE_CONTACT" && !!lead.typeProjet && lead.typeProjet !== "AUTRE";
}

/** La même règle, en filtre de la base (à poser au niveau d'un `where` sans autre `OR`). */
export const FILTRE_DEMANDE_DE_DEVIS = {
  OR: [{ source: { in: [...SOURCES_DEMANDE_DE_DEVIS] } }, { source: "SITE_CONTACT", typeProjet: { not: "AUTRE" } }],
};

export const TYPES_PROJET = ["CUISINE", "SDB", "MEUBLES", "PRO", "AUTRE"] as const;
export type TypeProjet = (typeof TYPES_PROJET)[number];

export const LIBELLES_TYPE_PROJET: Record<string, string> = {
  CUISINE: "Cuisine",
  SDB: "Salle de bains",
  MEUBLES: "Meubles",
  PRO: "Local professionnel",
  AUTRE: "Autre",
};

export const TYPES_ECHANGE = ["APPEL", "SMS", "EMAIL", "NOTE"] as const;
export type TypeEchange = (typeof TYPES_ECHANGE)[number];

export const LIBELLES_TYPE_ECHANGE: Record<string, string> = {
  APPEL: "Appel",
  SMS: "SMS",
  EMAIL: "E-mail",
  NOTE: "Note",
};

/** Au-delà, un contact jamais traité n'est plus « à traiter » : il rejoint les anciens. */
export const JOURS_A_TRAITER = 60;

export const GROUPES_ENTRANTS = ["A_TRAITER", "CONTACTES", "ANCIENS", "AVEC_DOSSIER", "SANS_SUITE", "ARCHIVES"] as const;
export type GroupeEntrants = (typeof GROUPES_ENTRANTS)[number];

export const LIBELLES_GROUPE_ENTRANTS: Record<GroupeEntrants, string> = {
  A_TRAITER: "À traiter",
  CONTACTES: "Contactés",
  ANCIENS: "Plus de 60 jours",
  AVEC_DOSSIER: "Devis ou dossier",
  SANS_SUITE: "Sans suite",
  ARCHIVES: "Archivés",
};

export type IntentionLead = "DEVIS" | "SIMULATION" | "CONTACT";

/** Ce que le contact a demandé : un devis, une simulation, ou un simple contact. */
export function intentionDuLead(lead: { source: string; statut: string; typeProjet?: string | null; simulations: { source: string }[] }): IntentionLead {
  if (estDemandeDeDevis(lead) || lead.statut === "DEVIS_DEMANDE" || lead.simulations.some((simulation) => simulation.source === "SITE_DEVIS")) return "DEVIS";
  if (lead.source === "SITE_SIMULATEUR" || lead.simulations.length > 0) return "SIMULATION";
  return "CONTACT";
}

/** Groupe d'un contact entrant, dans l'ordre où il est traité. */
export function groupeDuLead(
  lead: { statut: string; createdAt: Date | string; archiveLe: Date | string | null; nbDossiers: number },
  maintenant: Date = new Date()
): GroupeEntrants {
  if (lead.archiveLe) return "ARCHIVES";
  // Un dossier, ou un devis déjà envoyé dans l'ancien CRM : ce n'est plus un contact à relancer.
  if (lead.nbDossiers > 0 || (STATUTS_LEAD_APRES_DEVIS as readonly string[]).includes(lead.statut)) return "AVEC_DOSSIER";
  if (lead.statut === "PERDU") return "SANS_SUITE";
  if (lead.statut === "NOUVEAU" || lead.statut === "DEVIS_DEMANDE") {
    const ageJours = (maintenant.getTime() - new Date(lead.createdAt).getTime()) / 86_400_000;
    return ageJours > JOURS_A_TRAITER ? "ANCIENS" : "A_TRAITER";
  }
  return "CONTACTES";
}
