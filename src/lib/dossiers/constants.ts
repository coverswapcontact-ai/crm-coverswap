// ─────────────────────────────────────────────
// Module Dossiers — constantes partagées (client et serveur)
// SQLite ne supporte pas les enums Prisma : les valeurs autorisées des champs
// `String` du schéma sont définies ici, source de vérité côté code
// (même convention que src/lib/prospection/constants.ts).
// ─────────────────────────────────────────────

/* ── Étapes du tunnel ─────────────────────────────────────────── */

export const ETAPES_ACTIVES = [
  "QUALIFICATION",
  "SIMULATION",
  "DEVIS_ENVOYE",
  "RELANCE",
  "SIGNE",
  "PLANIFIE",
  "CHANTIER",
  "FACTURE",
  "ENCAISSE",
] as const;
export type EtapeActive = (typeof ETAPES_ACTIVES)[number];

export const ETAPES_SORTIE = ["PERDU", "EN_PAUSE"] as const;
export type EtapeSortie = (typeof ETAPES_SORTIE)[number];

export const ETAPES = [...ETAPES_ACTIVES, ...ETAPES_SORTIE] as const;
export type EtapeDossier = (typeof ETAPES)[number];

export const LIBELLES_ETAPE: Record<EtapeDossier, string> = {
  QUALIFICATION: "Qualification",
  SIMULATION: "Simulation",
  DEVIS_ENVOYE: "Devis envoyé",
  RELANCE: "Relance",
  SIGNE: "Signé",
  PLANIFIE: "Planifié",
  CHANTIER: "Chantier",
  FACTURE: "Facturé",
  ENCAISSE: "Encaissé",
  PERDU: "Perdu",
  EN_PAUSE: "En pause",
};

/* ── Règles d'entrée et de sortie ─────────────────────────────────
   Écrites pour qu'un humain ET un futur agent sachent ce qu'une étape
   suppose. Signaler, jamais bloquer : toute étape peut passer à toute
   autre, dans les deux sens (src/lib/dossiers/regles.ts). Lecture :
   - `entree`  : ce qui devrait être vrai en entrant dans l'étape ; ce qui
                 manque devient un avertissement, lu puis confirmé, gardé
                 dans l'historique du passage ;
   - `sorties` : le chemin habituel depuis cette étape, mis en avant.
   Avancer de plusieurs étapes rappelle les critères de chaque étape
   franchie ; un retour, une pause ou une reprise ne rappellent rien.
──────────────────────────────────────────────────────────────── */

export const CRITERES_ENTREE = [
  "COORDONNEES_COMPLETES", // nom, adresse, code postal, ville, téléphone renseignés
  "OBJET", // objet du chantier renseigné
  "PHOTO", // au moins une photo du chantier archivée
  "DEVIS_GENERE", // au moins un devis généré (statut ≠ BROUILLON)
  "BON_POUR_ACCORD", // déclaratif : bon pour accord signé reçu
  "ACOMPTE_ENCAISSE", // acompte enregistré (encaissement), ou signature sans acompte motivée
  "DATE_CHANTIER", // date de chantier fixée
  "FACTURE_GENEREE", // au moins une facture générée (statut ≠ BROUILLON)
  "SOLDE_ENCAISSE", // factures du dossier réglées par des encaissements enregistrés
  "MOTIF_PERTE", // motif de perte choisi dans MOTIFS_PERTE
] as const;
export type CritereEntree = (typeof CRITERES_ENTREE)[number];

export const LIBELLES_CRITERE: Record<CritereEntree, string> = {
  COORDONNEES_COMPLETES: "Coordonnées client complètes (nom, adresse, code postal, ville, téléphone)",
  OBJET: "Objet du chantier renseigné",
  PHOTO: "Au moins une photo du chantier",
  DEVIS_GENERE: "Un devis généré",
  BON_POUR_ACCORD: "Bon pour accord reçu",
  ACOMPTE_ENCAISSE: "Acompte enregistré (ou motif d'absence d'acompte)",
  DATE_CHANTIER: "Date de chantier fixée",
  FACTURE_GENEREE: "Une facture générée",
  SOLDE_ENCAISSE: "Factures réglées",
  MOTIF_PERTE: "Motif de perte",
};

/* Qui doit agir pour faire avancer le dossier : MOI (Lucas) ou le CLIENT.
   Un dossier dont la prochaine action est dépassée repasse à moi, quel que soit
   le responsable de l'étape : quand le client tarde, c'est à moi de relancer
   (voir mainDe dans pilotage.ts). null : dossier perdu, plus personne ne joue. */
export const RESPONSABLES = ["MOI", "CLIENT"] as const;
export type Responsable = (typeof RESPONSABLES)[number];

export type RegleEtape = {
  description: string;
  responsable: Responsable | null;
  entree: readonly CritereEntree[];
  sorties: readonly EtapeActive[];
  terminale?: boolean;
};

export const REGLES_ETAPES: Record<EtapeDossier, RegleEtape> = {
  QUALIFICATION: {
    description: "Infos reçues, dossier ouvert",
    responsable: "MOI",
    entree: ["COORDONNEES_COMPLETES", "OBJET", "PHOTO"],
    sorties: ["SIMULATION", "DEVIS_ENVOYE"],
  },
  SIMULATION: {
    description: "Préparation des visuels et rendus",
    responsable: "MOI",
    entree: [],
    sorties: ["DEVIS_ENVOYE"],
  },
  DEVIS_ENVOYE: {
    description: "Devis généré et transmis au client",
    responsable: "CLIENT",
    entree: ["DEVIS_GENERE"],
    sorties: ["RELANCE", "SIGNE"],
  },
  RELANCE: {
    description: "Client relancé, en attente de décision",
    responsable: "CLIENT",
    entree: ["DEVIS_GENERE"],
    sorties: ["SIGNE"],
  },
  SIGNE: {
    description: "Bon pour accord reçu, acompte enregistré (ou motif d'absence)",
    responsable: "CLIENT",
    entree: ["DEVIS_GENERE", "BON_POUR_ACCORD", "ACOMPTE_ENCAISSE"],
    sorties: ["PLANIFIE"],
  },
  PLANIFIE: {
    description: "Date de chantier calée",
    responsable: "MOI",
    entree: ["DATE_CHANTIER"],
    sorties: ["CHANTIER"],
  },
  CHANTIER: {
    description: "Pose en cours ou faite",
    responsable: "MOI",
    entree: [],
    sorties: ["FACTURE"],
  },
  FACTURE: {
    description: "Facture émise",
    responsable: "MOI",
    entree: ["FACTURE_GENEREE"],
    sorties: ["ENCAISSE"],
  },
  ENCAISSE: {
    description: "Solde encaissé — étape terminale",
    // Plus personne n'a la main : ni badge « chez le client », ni place dans « À faire ».
    responsable: null,
    entree: ["SOLDE_ENCAISSE"],
    sorties: [],
    terminale: true,
  },
  PERDU: {
    description: "Affaire perdue",
    responsable: null,
    entree: ["MOTIF_PERTE"],
    sorties: [],
  },
  EN_PAUSE: {
    description: "Client injoignable ou projet reporté",
    responsable: "CLIENT",
    entree: [],
    sorties: [],
  },
};

/* ── Sources, motifs de perte ─────────────────────────────────── */

export const SOURCES_DOSSIER = [
  "PROSPECTION",
  "RECOMMANDATION",
  "SOUS_TRAITANCE",
  "ENTRANT",
  "AUTRE",
  "INCONNUE", // non renseignée à l'ouverture : signalée, à compléter
] as const;
export type SourceDossier = (typeof SOURCES_DOSSIER)[number];

export const LIBELLES_SOURCE: Record<SourceDossier, string> = {
  PROSPECTION: "Prospection",
  RECOMMANDATION: "Recommandation",
  SOUS_TRAITANCE: "Sous-traitance",
  ENTRANT: "Entrant (site, Meta, appel)",
  AUTRE: "Autre",
  INCONNUE: "Non renseignée",
};

export const MOTIFS_PERTE = [
  "PRIX",
  "DELAI",
  "SANS_REPONSE",
  "PROJET_ABANDONNE",
  "CONCURRENT",
  "AUTRE",
] as const;
export type MotifPerte = (typeof MOTIFS_PERTE)[number];

export const LIBELLES_MOTIF_PERTE: Record<MotifPerte, string> = {
  PRIX: "Prix",
  DELAI: "Délai",
  SANS_REPONSE: "Sans réponse",
  PROJET_ABANDONNE: "Projet abandonné",
  CONCURRENT: "Concurrent",
  AUTRE: "Autre",
};

/* ── Événements (socle des futurs agents mail / WhatsApp) ─────── */

export const TYPES_EVENEMENT = [
  "MAIL_RECU",
  "MAIL_ENVOYE",
  "WHATSAPP_RECU",
  "WHATSAPP_ENVOYE",
  "APPEL",
  "DEVIS_GENERE",
  "DEVIS_ENVOYE",
  "FACTURE_GENEREE",
  "AVOIR_GENERE",
  "DOCUMENT_REPRIS",
  "ENCAISSEMENT_ENREGISTRE",
  "ENCAISSEMENT_CREDITE",
  "ENCAISSEMENT_REJETE",
  "ENCAISSEMENT_ANNULE",
  "ENCAISSEMENT_CORRIGE",
  "CHANGEMENT_ETAPE",
  "NOTE_AJOUTEE",
  // Simulation du site rangée dans le dossier (photo avant + rendu)
  "SIMULATION_SITE",
  // Messagerie SMS et espace client (mission du 20/09/2026)
  "SMS_RECU",
  "SMS_ENVOYE",
  "ESPACE_LIEN_CREE",
  "ESPACE_VISITE",
  "ESPACE_PHOTOS",
  "ESPACE_SOUHAITS",
  "ESPACE_SIMULATION_DEPOSEE",
  "ESPACE_SIMULATION_CHOISIE",
  "ESPACE_COMMENTAIRE",
  "ESPACE_COORDONNEES",
  "ESPACE_DEVIS_ACCEPTE",
  // Écrits depuis la mission espace client v2 (21/09/2026) ; les derniers avec l'espace v3
  "ESPACE_AVIS",
  "ESPACE_DEVIS_CONSULTE",
  "ESPACE_NOUVELLE_PROPOSITION",
  "ESPACE_SIMULATION_SITE",
  "SIMULATION_BROUILLON",
  "ESPACE_SIMULATION_CLIENT",
  "ESPACE_SIMULATIONS_DEMANDEES",
  "ESPACE_SIMULATIONS_ACCORDEES",
  // Notes prises pendant un appel au contact, reprises à leur date (NoteAppel)
  "NOTE_APPEL",
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

export const DIRECTIONS_EVENEMENT = ["ENTRANT", "SORTANT", "INTERNE"] as const;
export type DirectionEvenement = (typeof DIRECTIONS_EVENEMENT)[number];

export const LIBELLES_TYPE_EVENEMENT: Record<TypeEvenement, string> = {
  MAIL_RECU: "Mail reçu",
  MAIL_ENVOYE: "Mail envoyé",
  WHATSAPP_RECU: "WhatsApp reçu",
  WHATSAPP_ENVOYE: "WhatsApp envoyé",
  APPEL: "Appel",
  DEVIS_GENERE: "Devis généré",
  DEVIS_ENVOYE: "Devis envoyé",
  FACTURE_GENEREE: "Facture générée",
  AVOIR_GENERE: "Avoir généré",
  DOCUMENT_REPRIS: "Document repris",
  ENCAISSEMENT_ENREGISTRE: "Paiement reçu",
  ENCAISSEMENT_CREDITE: "Chèque crédité",
  ENCAISSEMENT_REJETE: "Chèque rejeté",
  ENCAISSEMENT_ANNULE: "Paiement annulé",
  ENCAISSEMENT_CORRIGE: "Paiement corrigé",
  CHANGEMENT_ETAPE: "Changement d'étape",
  NOTE_AJOUTEE: "Note ajoutée",
  SIMULATION_SITE: "Simulation faite sur le site",
  SMS_RECU: "SMS reçu",
  SMS_ENVOYE: "SMS envoyé",
  ESPACE_LIEN_CREE: "Espace client ouvert",
  ESPACE_VISITE: "Espace client consulté",
  ESPACE_PHOTOS: "Photos déposées par le client",
  ESPACE_SOUHAITS: "Souhaits du client",
  ESPACE_SIMULATION_DEPOSEE: "Simulation déposée dans l'espace",
  ESPACE_SIMULATION_CHOISIE: "Simulation choisie par le client",
  ESPACE_COMMENTAIRE: "Commentaire du client",
  ESPACE_COORDONNEES: "Coordonnées complétées par le client",
  ESPACE_DEVIS_ACCEPTE: "Bon pour accord du client",
  ESPACE_AVIS: "Avis du client",
  ESPACE_DEVIS_CONSULTE: "Devis consulté par le client",
  ESPACE_NOUVELLE_PROPOSITION: "Autre proposition demandée",
  ESPACE_SIMULATION_SITE: "Simulation refaite sur le site",
  SIMULATION_BROUILLON: "Simulation en brouillon",
  ESPACE_SIMULATION_CLIENT: "Simulation faite par le client",
  ESPACE_SIMULATIONS_DEMANDEES: "Simulations supplémentaires demandées",
  ESPACE_SIMULATIONS_ACCORDEES: "Simulations supplémentaires accordées",
  NOTE_APPEL: "Note d'appel",
};
// Structure du champ metadata d'un CHANGEMENT_ETAPE : voir MetadataChangementEtape (regles.ts).

/* ── Documents (devis et factures) ────────────────────────────── */

export const TYPES_DOCUMENT = ["DEVIS", "FACTURE", "AVOIR"] as const;
export type TypeDocument = (typeof TYPES_DOCUMENT)[number];
/** Documents générés depuis l'éditeur de lignes (un avoir se génère depuis sa facture). */
export const TYPES_DOCUMENT_EDITABLES = ["DEVIS", "FACTURE"] as const;

export const LIBELLES_TYPE_DOCUMENT: Record<TypeDocument, string> = {
  DEVIS: "Devis",
  FACTURE: "Facture",
  AVOIR: "Avoir",
};

export const STATUTS_DOCUMENT = ["BROUILLON", "GENERE", "ENVOYE", "ACCEPTE", "REFUSE", "REMPLACE", "ANNULEE"] as const;
export type StatutDocument = (typeof STATUTS_DOCUMENT)[number];

export const LIBELLES_STATUT_DOCUMENT: Record<StatutDocument, string> = {
  BROUILLON: "Brouillon",
  GENERE: "Généré",
  ENVOYE: "Envoyé",
  ACCEPTE: "Accepté",
  REFUSE: "Refusé",
  REMPLACE: "Remplacé",
  ANNULEE: "Annulée par avoir",
};

export const MOTIFS_AVOIR = [
  { code: "ERREUR_MONTANT", libelle: "Erreur de montant ou de quantité" },
  { code: "ERREUR_CLIENT", libelle: "Erreur sur le client ou l'adresse" },
  { code: "PRESTATION_ANNULEE", libelle: "Prestation annulée" },
  { code: "GESTE_COMMERCIAL", libelle: "Geste commercial" },
  { code: "AUTRE", libelle: "Autre" },
] as const;

export const UNITES = ["ml", "jour", "forfait"] as const;
export type Unite = (typeof UNITES)[number];

export const ACOMPTE_PCT_DEFAUT = 30;

/* Structure du champ JSON Document.lignes */
export type LignePrestation = {
  type: "PRESTATION";
  designation: string;
  sousDesignation?: string; // gras italique, entre parenthèses, sur une seconde ligne
  quantite: number;
  unite: Unite;
  prixUnitaire: number;
};
export type LigneSection = {
  type: "SECTION"; // bandeau gris fusionné sur toute la largeur
  libelle: string;
};
export type LigneDocument = LignePrestation | LigneSection;

/* ── Numérotation ─────────────────────────────────────────────────
   Avant le CRM, 2026 a été numéroté à la main en UNE série partagée entre
   devis et factures (2026-001 à 2026-037 ; 030 et 032 sont des factures).
   L'ancien écran du CRM numérotait « 2026-0001 » (devis) et
   « FACT-2026-0001 » (factures).

   Choix retenu, le plus prudent, À FAIRE VALIDER PAR LE COMPTABLE :
   - devis : la série sans préfixe continue après le plus haut numéro connu ;
   - factures et avoirs : une seule série à préfixe F (F2026-001…), continue
     et chronologique, ce qu'une série partagée avec les devis ne permet pas.

   Garanties (src/lib/dossiers/numerotation.ts) :
   - tout numéro émis où que ce soit est inscrit au registre NumeroDocument
     (numérotation manuelle déclarée, ancien écran, CRM) ; un numéro inscrit
     est sauté, jamais réattribué ;
   - une série démarre après le plus haut rang inscrit de ses familles
     précédentes (famillesPrecedentes), à défaut après AMORCES_COMPTEURS ;
   - un numéro est attribué à la génération du PDF, dans la transaction qui
     crée le document : un brouillon abandonné ne crée pas de trou ;
   - une facture ne peut pas être datée avant la dernière de sa série.

   Si le comptable préfère une série unique : FACTURE et AVOIR à
   { compteur: "DEVIS", prefixe: "", famillesPrecedentes: [""] }.
──────────────────────────────────────────────────────────────── */

export const NUMEROTATION: Record<TypeDocument, { compteur: string; prefixe: string; famillesPrecedentes: readonly string[] }> = {
  // Les devis continuent la série partagée de la numérotation manuelle de 2026.
  DEVIS: { compteur: "DEVIS", prefixe: "", famillesPrecedentes: [""] },
  // Factures et avoirs : une seule série continue et chronologique, qui démarre
  // après la plus haute facture de l'ancien écran de l'année (« FACT-2026-… »).
  FACTURE: { compteur: "FACTURE", prefixe: "F", famillesPrecedentes: ["F", "FACT"] },
  AVOIR: { compteur: "FACTURE", prefixe: "F", famillesPrecedentes: ["F", "FACT"] },
};

/** Dernier numéro déjà attribué, par compteur et par année, avant le premier
 *  document émis par le CRM. Lu uniquement à la création de la ligne du compteur. */
export const AMORCES_COMPTEURS: Record<string, Record<number, number>> = {
  DEVIS: { 2026: 37 },
  FACTURE: {},
};

/* ── Presets de tarifs de départ ──────────────────────────────── */

export const PRESETS_DEPART: { designation: string; unite: Unite; prixUnitaire: number | null }[] = [
  { designation: "Revêtement adhésif — cuisine / façades", unite: "ml", prixUnitaire: 110 },
  { designation: "Revêtement adhésif — cuisine (variante)", unite: "ml", prixUnitaire: 120 },
  { designation: "Revêtement adhésif — portes de dressing", unite: "ml", prixUnitaire: 50 },
  { designation: "Revêtement adhésif — meuble TV", unite: "ml", prixUnitaire: 65 },
  { designation: "Revêtement adhésif — bar / comptoir", unite: "ml", prixUnitaire: 55 },
  { designation: "Prestation de pose — tarif journalier", unite: "jour", prixUnitaire: 300 },
  { designation: "Dépose / repose nouvelle crédence", unite: "forfait", prixUnitaire: 650 },
  { designation: "Nouvelle crédence Dibond", unite: "forfait", prixUnitaire: 350 },
  { designation: "Consommables", unite: "forfait", prixUnitaire: 80 },
  { designation: "Frais de carburant", unite: "forfait", prixUnitaire: null },
  { designation: "Frais de péage", unite: "forfait", prixUnitaire: null },
  { designation: "Frais de mission (hébergement et restauration)", unite: "forfait", prixUnitaire: null },
];

export const LIBELLES_UNITE: Record<Unite, string> = {
  ml: "ml",
  jour: "jour",
  forfait: "forfait",
};

/* ── Photos ───────────────────────────────────────────────────────
   Une photo par requête : avec un middleware, Next.js ne garde que les
   10 premiers Mo du corps d'une requête (proxyClientMaxBodySize), sans
   erreur. Le navigateur réduit les photos avant l'envoi quand il sait
   les décoder ; le serveur refuse au-delà de PHOTO_OCTETS_MAX.
──────────────────────────────────────────────────────────────── */

export const PHOTO_OCTETS_MAX = 9 * 1024 * 1024;

export const FORMATS_PHOTO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/* ── Identité de l'émetteur (devis et factures) ───────────────── */

export const EMETTEUR = {
  raisonSociale: "COVER SWAP",
  gerant: "Monsieur Lucas VILLEMIN",
  adresse: "73 rue Simone Veil",
  codePostalVille: "34470 Pérols",
  email: "coverswap.contact@gmail.com",
  telephone: "06 70 35 28 69",
  ligneSiret:
    "SIRET de l'établissement : 94518036200010 00010 / Code APE de l'établissement : 4334Z",
  ligneRib: "RIB : FR76 1610 6700 2096 0145 0427 085 – Code BIC – Code SWIFT : AGRIFRPP861",
  piedSiret: "SIRET de l'établissement : 94518036200010",
  piedApe: "Code APE de l'établissement : 4334Z",
  piedNom: "Cover Swap",
  mentionTva: "TVA : NON APPLICABLE, ARTICLE 293 B DU CGI",
} as const;
