// Libellés du journal pour l'écran /journal (aucune dépendance serveur).

export const OPERATIONS_JOURNAL = ["ETAT_INITIAL", "CREATION", "MODIFICATION", "ARCHIVAGE", "RESTAURATION"] as const;
export type OperationJournal = (typeof OPERATIONS_JOURNAL)[number];

export const LIBELLES_OPERATION: Record<OperationJournal, string> = {
  ETAT_INITIAL: "État initial",
  CREATION: "Création",
  MODIFICATION: "Modification",
  ARCHIVAGE: "Archivage",
  RESTAURATION: "Restauration",
};

export const LIBELLES_MODELE: Record<string, string> = {
  Client: "Fiche client",
  ClientEmail: "Adresse e-mail",
  ClientTelephone: "Téléphone",
  ConsentementMail: "Consentement",
  Lead: "Lead",
  Interaction: "Interaction (ancien écran)",
  Simulation: "Simulation",
  Devis: "Devis (ancien écran)",
  Facture: "Facture (ancien écran)",
  Chantier: "Chantier (ancien écran)",
  Commande: "Commande",
  Objectif: "Objectif",
  AgentProfile: "Profil de prospection",
  Prospect: "Prospect",
  EmailDraft: "Brouillon de prospection",
  ProspectActivity: "Activité de prospection",
  Dossier: "Dossier",
  DossierNote: "Note de dossier",
  DossierEvenement: "Historique de dossier",
  Document: "Devis, facture ou avoir",
  CompteurNumerotation: "Compteur de numérotation",
  PresetTarif: "Tarif enregistré",
  MigrationDonnees: "Migration de données",
  Proposition: "Proposition",
  Parametre: "Paramètre",
  NumeroDocument: "Registre des numéros",
  Encaissement: "Encaissement",
  AffectationEncaissement: "Imputation d'un paiement",
  Fichier: "Fichier",
  Depense: "Dépense",
  InstantaneMensuel: "Mois figé",
  ConnexionGoogle: "Connexion Google",
  Message: "Mail",
  PieceMessage: "Pièce jointe",
  AnalyseMessage: "Analyse d'un mail",
  AppelIa: "Appel à l'IA",
};

export const FAMILLES_ACTEUR = [
  { valeur: "HUMAIN", libelle: "Personnes" },
  { valeur: "AGENT", libelle: "Agent" },
  { valeur: "SYSTEME", libelle: "Système" },
  { valeur: "EXTERNE", libelle: "Site et webhooks" },
  { valeur: "SCRIPT", libelle: "Scripts" },
  { valeur: "MIGRATION", libelle: "Reprise des données" },
  { valeur: "INCONNU", libelle: "Inconnu (hors de l'application)" },
] as const;

export function libelleActeurJournal(acteur: string): string {
  const [type, ...reste] = acteur.split(":");
  const nom = reste.join(":");
  switch (type) {
    case "HUMAIN":
      return nom === "poste-local" ? "Moi (poste local)" : nom;
    case "AGENT":
      return nom === "mail" ? "Agent mail" : `Agent ${nom}`;
    case "SYSTEME":
      return `Système · ${nom}`;
    case "EXTERNE":
      return `Extérieur · ${nom}`;
    case "SCRIPT":
      return `Script · ${nom}`;
    case "MIGRATION":
      return `Reprise · ${nom}`;
    default:
      return `Inconnu · ${nom || acteur}`;
  }
}

export type ChangementJournal = { champ: string; avant: string | null; apres: string | null };

export type LigneJournalVue = {
  id: string;
  horodatage: string;
  modele: string;
  libelleModele: string;
  enregistrementId: string;
  operation: OperationJournal | string;
  acteur: string;
  libelleActeur: string;
  origine: string | null;
  requete: string | null;
  caviarde: boolean;
  /** Résumé lisible : champs changés (modification) ou champs principaux (création). */
  changements: ChangementJournal[];
  /** Écran où voir l'enregistrement, quand il y en a un. */
  lien: string | null;
};

export type PageJournal = { lignes: LigneJournalVue[]; suite: string | null };
