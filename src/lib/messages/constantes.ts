// Messages (mail aujourd'hui, WhatsApp demain) : valeurs et formes partagées
// par le serveur et l'interface (aucune dépendance serveur ici).

export const CANAUX_MESSAGE = ["EMAIL", "WHATSAPP"] as const;
export type CanalMessage = (typeof CANAUX_MESSAGE)[number];

export const SENS_MESSAGE = ["ENTRANT", "SORTANT"] as const;
export type SensMessage = (typeof SENS_MESSAGE)[number];

export const STATUTS_MESSAGE = ["A_ANALYSER", "A_TRIER", "RATTACHE", "BRUIT", "IGNORE"] as const;
export type StatutMessage = (typeof STATUTS_MESSAGE)[number];

export const LIBELLES_STATUT_MESSAGE: Record<StatutMessage, string> = {
  A_ANALYSER: "En cours d'analyse",
  A_TRIER: "À trier",
  RATTACHE: "Rattaché",
  BRUIT: "Bruit archivé",
  IGNORE: "Hors clients",
};

export const CATEGORIES_MESSAGE = ["CLIENT", "NOUVELLE_DEMANDE", "FOURNISSEUR", "ADMINISTRATIF", "PERSONNEL", "BRUIT", "AUTRE"] as const;
export type CategorieMessage = (typeof CATEGORIES_MESSAGE)[number];

export const LIBELLES_CATEGORIE_MESSAGE: Record<CategorieMessage, string> = {
  CLIENT: "Client",
  NOUVELLE_DEMANDE: "Nouvelle demande",
  FOURNISSEUR: "Fournisseur",
  ADMINISTRATIF: "Administratif (banque, URSSAF, impôts…)",
  PERSONNEL: "Personnel",
  BRUIT: "Publicité, notification",
  AUTRE: "Autre",
};

/** Classements « hors clients » proposés en un clic (ni rattachement, ni bruit). */
export const CATEGORIES_HORS_CLIENTS = ["FOURNISSEUR", "ADMINISTRATIF", "PERSONNEL", "AUTRE"] as const;
export type CategorieHorsClients = (typeof CATEGORIES_HORS_CLIENTS)[number];

export const STATUTS_PIECE = ["A_CONSERVER", "CONSERVEE", "NON_CONSERVEE"] as const;
export type StatutPiece = (typeof STATUTS_PIECE)[number];

export type PieceVue = {
  id: string;
  nom: string;
  typeMime: string;
  taille: number;
  enLigne: boolean;
  statut: StatutPiece;
  raison: string | null;
  /** Adresse de lecture dans le CRM (pièce conservée seulement). */
  url: string | null;
  estImage: boolean;
};

export type AnalyseVue = {
  id: string;
  createdAt: string;
  methode: "REGLES" | "MODELE";
  categorie: string | null;
  libelleCategorie: string | null;
  confiance: number | null;
  raisonnement: string | null;
  erreur: string | null;
  coutEuros: number | null;
};

export type MessageResume = {
  id: string;
  canal: CanalMessage;
  sens: SensMessage;
  de: string;
  deNom: string | null;
  a: string[];
  objet: string | null;
  extrait: string | null;
  recuLe: string;
  statut: StatutMessage;
  categorie: CategorieMessage | null;
  client: { id: string; nom: string } | null;
  dossier: { id: string; objet: string } | null;
  pieces: PieceVue[];
  /** Dernière analyse : ce que l'agent a compris et pourquoi. */
  analyse: AnalyseVue | null;
  /** Propositions de l'agent encore à valider sur ce message. */
  propositionsEnAttente: number;
  boiteArchiveLe: string | null;
};

export type DemandePreremplie = {
  prenom: string | null;
  nomFamille: string | null;
  raisonSociale: string | null;
  categorieClient: string | null;
  telephone: string | null;
  source: string | null;
  ouvrirDossier: "OUI" | "NON" | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  objet: string | null;
  prochaineAction: string | null;
  prochaineActionDate: string | null;
  note: string | null;
};

export type MessageDetail = MessageResume & {
  texte: string | null;
  /** Texte sans l'historique cité des réponses précédentes. */
  texteUtile: string | null;
  analyses: AnalyseVue[];
  /** Autres messages du même fil, du plus ancien au plus récent. */
  fil: { id: string; sens: SensMessage; de: string; objet: string | null; recuLe: string; extrait: string | null }[];
  /** Pré-remplissage d'une nouvelle demande : proposition de l'agent, sinon ce que le mail dit. */
  demande: DemandePreremplie;
  /** Dossiers en cours du client reconnu (pour rattacher en un geste). */
  dossiersDuClient: { id: string; objet: string; etape: string }[];
  /** Lien vers la conversation dans la boîte mail (Gmail). */
  lienBoite: string | null;
  /** L'IA peut-elle relire ce mail maintenant ? */
  ia: { active: boolean; raison: string | null };
};

export type EtatAgentMail = {
  /** Relevé de la boîte actif (compte Google connecté avec l'accès Gmail). */
  actif: boolean;
  raison: string | null;
  compte: string | null;
  dernierReleve: string | null;
  derniereErreur: string | null;
  aTrier: number;
  recusSeptJours: number;
  ia: {
    active: boolean;
    raison: string | null;
    modele: string | null;
    budget: number | null;
    depenseMois: number;
    appelsMois: number;
    manquants: string[];
  };
};

export function formatTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
