import type { EtapeEspace, progression } from "./etapes";

/**
 * Types du suivi des espaces clients, partagés par les écrans (sans dépendance serveur). Mission 18 (A1) : l'onglet
 * Espaces clients est devenu la colonne et le filtre « Espaces » de Dossiers.
 */
export type CodeSignal = "PHOTOS_SANS_SIMULATION" | "PROPOSITION_DEMANDEE" | "SIMULATIONS_DEMANDEES" | "BROUILLONS" | "HESITE" | "JAMAIS_OUVERT" | "EXPIRE_BIENTOT" | "EXPIRE" | "NON_ENVOYE" | "DATE_A_FIXER" | "NOUVEAU_PROJET" | "PROJET_DEMANDE" | "CONFIRMATION_DEMANDEE";
export type Signal = { code: CodeSignal; libelle: string; ton: "rouge" | "ambre" | "gris" };

export type LigneEspace = {
  espaceId: string;
  dossierId: string;
  /** Mission 5 : l'espace permanent du client auquel appartient ce projet. */
  permanentId: string | null;
  nomProjet: string;
  familles: { id: string; libelle: string }[];
  /** Terminé et encaissé, ou non réalisé : figé. */
  fige: "TERMINE" | "NON_REALISE" | null;
  /** Ouvert par le client lui-même dans son espace (un client qui revient). */
  creeParLeClient: boolean;
  clientNom: string;
  ville: string;
  telephone: string;
  /** Mission 7 : l'adresse du client (le nouveau lien part par mail). */
  email: string | null;
  typeProjet: string;
  lien: string | null;
  apercu: string | null;
  creeLe: string;
  lienEnvoyeLe: string | null;
  expireLe: string;
  revoque: boolean;
  expire: boolean;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  derniereActivite: string | null;
  etape: EtapeEspace;
  etapeLibelle: string;
  etapes: ReturnType<typeof progression>;
  faits: {
    photos: number;
    projet: string | null;
    /** Le client (ou Lucas) a validé le projet : pastille verte. */
    projetValideLe: string | null;
    simulationsPubliees: number;
    /** Simulations créées par le client dans son espace, et ce qu'il lui en reste. */
    simulationsClient: number;
    /** Faites sur coverswap.fr : elles comptent dans son quota. */
    simulationsSite: number;
    simulationsRestantes: number;
    simulationsDemandeesLe: string | null;
    brouillons: number;
    choix: string | null;
    /** Teintes de la simulation validée, zone par zone. */
    choixTeintes: string | null;
    /** Demande d'autre proposition en attente : sa date et son mot, entier. */
    proposition: { le: string; message: string | null } | null;
    devis: { numero: string; consultations: number; consulteLe: string | null } | null;
    /** Mission 11 : devis proposés visibles dans son espace (plusieurs → il en choisit un). */
    devisProposes: number;
    accord: string | null;
    /** ESPACE : bon pour accord en ligne ; CRM : devis noté accepté dans le CRM (signé sur papier). */
    accordSource: "ESPACE" | "CRM" | null;
    acompte: { montant: number; recu: number } | null;
    /** Total du devis, reçu, reste : lus sur les encaissements du dossier. */
    paiement: { total: number; recu: number; reste: number; regle: boolean } | null;
  };
  /** Qui a la main ; quand c'est Lucas, le geste qui fait avancer (un bouton dans la carte). */
  attente: { qui: "MOI" | "CLIENT" | "PERSONNE"; libelle: string; geste?: "DEVIS" | "SIMULATEUR" | "PUBLIER" | "APPELER" | "ACCORDER" };
  signaux: Signal[];
};

/** Un client et son espace permanent : son lien, ses visites, ses projets et où il en est dans chacun (mission 5). */
export type ClientEspace = {
  permanentId: string;
  clientId: string;
  clientNom: string;
  ville: string;
  telephone: string;
  /** Mission 7 : l'adresse du client (le nouveau lien part par mail). */
  email: string | null;
  lien: string | null;
  apercu: string | null;
  lienEmisLe: string;
  revoque: boolean;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  /** Plus de 90 jours sans visite : il devra confirmer son téléphone à la prochaine. */
  confirmationRequise: boolean;
  projetsEnCours: number;
  limite: number;
  projetDemandeLe: string | null;
  derniereActivite: string | null;
  /** Le plus pressé de ses projets donne la main : moi, lui, personne. */
  attente: LigneEspace["attente"];
  signaux: Signal[];
  projets: LigneEspace[];
};

/** Mission 13 (lot 6) : une page de clients (50) avec le total. */
export type PageEspaces = { clients: ClientEspace[]; total: number; page: number; parPage: number };

/* ── Mission 18 (A1) : l'onglet Espaces clients devient une colonne et un filtre de Dossiers ─────── */

/** Les signaux du client (son espace permanent), rattachés à son projet le plus récent dans la colonne de Dossiers. */
export const CODES_SIGNAL_CLIENT: readonly CodeSignal[] = ["NOUVEAU_PROJET", "PROJET_DEMANDE", "CONFIRMATION_DEMANDEE"];

/** L'adresse du filtre « Espaces » de Dossiers (là où mène l'ancienne adresse /espaces, et les liens de l'assistant). */
export const ADRESSE_ESPACES = "/dossiers?espace=TOUS";

/** Le filtre « Espaces » de Dossiers : les pastilles de l'ancien onglet Espaces clients. */
export const FILTRES_ESPACE = ["MOI", "CLIENT", "SIGNAUX", "TOUS", "DESACTIVES"] as const;
export type FiltreEspace = (typeof FILTRES_ESPACE)[number];
export const LIBELLES_FILTRE_ESPACE: Record<FiltreEspace, string> = { MOI: "À moi", CLIENT: "Chez le client", SIGNAUX: "Signaux", TOUS: "Tous", DESACTIVES: "Désactivés" };
export const estFiltreEspace = (valeur: unknown): valeur is FiltreEspace => typeof valeur === "string" && (FILTRES_ESPACE as readonly string[]).includes(valeur);
/** Les compteurs des pastilles, sur tous les espaces (pas seulement la page). */
export type CompteursEspaces = Record<FiltreEspace, number>;

/**
 * L'état de l'espace d'un dossier, tel que la colonne « Espace » de Dossiers le montre : les dates sont celles du
 * PROJET (son espace dans l'espace permanent du client) ; « désactivé » = lien du client révoqué. Les signaux du client
 * (projet de plus demandé, nouveau projet, téléphone à confirmer) sont portés par son projet le plus récent.
 */
export type EspaceResume = {
  espaceId: string;
  etape: EtapeEspace;
  etapeLibelle: string;
  fige: LigneEspace["fige"];
  revoque: boolean;
  lienEnvoyeLe: string | null;
  premierAccesLe: string | null;
  dernierAccesLe: string | null;
  nbAcces: number;
  creeLe: string;
  derniereActivite: string | null;
  photos: number;
  /** Simulations publiées par Lucas, faites par le client dans son espace ou sur le site. */
  simulations: number;
  devis: { numero: string; consultations: number } | null;
  accord: boolean;
  attente: LigneEspace["attente"];
  signaux: Signal[];
};

/** Un signal qui demande un geste (rouge ou ambre) : le gris (« lien pas encore envoyé ») n'en est pas un. */
export const aDesSignauxActifs = (espace: Pick<EspaceResume, "signaux">) => espace.signaux.some((s) => s.ton !== "gris");

/** La règle des pastilles de l'ancien onglet Espaces, par dossier : désactivés à part, puis qui a la main, signaux, étape. */
export function espaceDansLeFiltre(espace: Pick<EspaceResume, "revoque" | "attente" | "signaux" | "etape">, filtre: FiltreEspace, etape?: EtapeEspace | null): boolean {
  if (etape && espace.etape !== etape) return false;
  if (filtre === "DESACTIVES") return espace.revoque;
  if (espace.revoque) return false;
  if (filtre === "MOI") return espace.attente.qui === "MOI";
  if (filtre === "CLIENT") return espace.attente.qui === "CLIENT";
  if (filtre === "SIGNAUX") return aDesSignauxActifs(espace);
  return true;
}
