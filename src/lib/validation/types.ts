// Validation « l'agent propose, je valide » : valeurs et formes partagées par
// le serveur et l'interface (aucune dépendance serveur ici).

export const STATUTS_PROPOSITION = [
  "EN_ATTENTE",
  "VALIDEE",
  "EXECUTEE",
  "ECHEC",
  "REJETEE",
  "EXPIREE",
  "ANNULEE",
  "AUTOMATIQUE",
] as const;
export type StatutProposition = (typeof STATUTS_PROPOSITION)[number];

export const LIBELLES_STATUT_PROPOSITION: Record<StatutProposition, string> = {
  EN_ATTENTE: "À valider",
  VALIDEE: "Validée, en cours d'exécution",
  EXECUTEE: "Exécutée",
  ECHEC: "Échec de l'exécution",
  REJETEE: "Rejetée",
  EXPIREE: "Expirée",
  ANNULEE: "Devenue sans objet",
  AUTOMATIQUE: "Exécutée sans validation (autorisée)",
};

/** Motifs de rejet communs à toutes les propositions, en plus de ceux propres à chaque type. */
export const MOTIFS_REJET_COMMUNS = [
  { code: "INEXACT", libelle: "Information inexacte" },
  { code: "MAUVAISE_CIBLE", libelle: "Mauvais dossier ou mauvais client" },
  { code: "INUTILE", libelle: "Inutile" },
  { code: "DEJA_FAIT", libelle: "Déjà fait" },
  { code: "PREMATURE", libelle: "Trop tôt" },
  { code: "AUTRE", libelle: "Autre (préciser)" },
] as const;

export type MotifRejet = { code: string; libelle: string };

/** Champ que la personne peut corriger avant de valider. */
export type ChampModifiable = {
  cle: string;
  libelle: string;
  nature: "texte" | "texteLong" | "jour" | "choix";
  options?: readonly { valeur: string; libelle: string }[];
  obligatoire?: boolean;
  aide?: string;
};

/** Proposition telle que l'interface la reçoit. */
export type PropositionVue = {
  id: string;
  type: string;
  libelleType: string;
  statut: StatutProposition;
  auteur: string;
  titre: string;
  resume: string | null;
  raisonnement: string | null;
  confiance: number | null;
  contenu: Record<string, unknown>;
  contenuValide: Record<string, unknown> | null;
  /** La personne a corrigé la proposition avant de la valider. */
  modifiee: boolean;
  /** Engage de l'argent ou part chez un client : jamais validée en lot ni exécutée seule. */
  sensible: boolean;
  validationGroupee: boolean;
  champs: ChampModifiable[];
  motifsRejet: MotifRejet[];
  liens: { libelle: string; href: string }[];
  clientId: string | null;
  dossierId: string | null;
  messageId: string | null;
  createdAt: string;
  expireLe: string | null;
  decideLe: string | null;
  decidePar: string | null;
  motifRejet: string | null;
  commentaireRejet: string | null;
  executeLe: string | null;
  erreurExecution: string | null;
};
