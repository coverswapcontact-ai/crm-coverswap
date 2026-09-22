import { LIBELLES_TYPE_EVENEMENT, type TypeEvenement } from "@/lib/dossiers/constants";

/**
 * Carte des données personnelles : pour chaque modèle rattaché à une personne,
 * ce que l'anonymisation remplace, ou pourquoi tout est gardé. Fonctions pures,
 * appliquées aux lignes ET à leurs copies dans le journal (caviardage).
 *
 * Tout modèle qui porte un lien vers un client, un lead, un dossier, un
 * message ou un prospect doit y figurer : un test le vérifie sur le schéma,
 * pour qu'un modèle ajouté demain ne garde pas des données en silence.
 */

export const EFFACE = "Effacé (RGPD)";

export type ContexteAnonymisation = {
  /** Référence stable et sans identité du client (celle de la synthèse). */
  pseudonyme: string;
  /** Leads dont une facture de l'ancien écran lit l'identité : nom et prénom gardés. */
  leadsAvecFactures: ReadonlySet<string>;
};

type Ligne = Record<string, unknown>;

export type RegleAnonymisation =
  | {
      /** Remplacements des champs personnels (textes ou null uniquement). */
      remplacer: (ligne: Ligne, contexte: ContexteAnonymisation) => Record<string, string | null>;
      /** Ce qui reste, et pourquoi. */
      garde: string;
    }
  | { conserve: string };

/** Métadonnées d'un changement d'étape : la structure reste (étapes, montants, motifs), le texte libre part. */
export function metadataSansTexteLibre(metadata: unknown): string {
  try {
    const valeur = JSON.parse(typeof metadata === "string" ? metadata : "{}") as Record<string, unknown>;
    for (const cle of ["raison", "perteCommentaire", "commentaire", "note", "texte"]) delete valeur[cle];
    return JSON.stringify(valeur);
  } catch {
    return "{}";
  }
}

const nomAnonyme = (contexte: ContexteAnonymisation) => `Client anonymisé · ${contexte.pseudonyme}`;

export const CARTE_DONNEES_PERSONNELLES: Readonly<Record<string, RegleAnonymisation>> = {
  Client: {
    remplacer: (_ligne, contexte) => ({
      nom: nomAnonyme(contexte),
      prenom: null,
      nomFamille: null,
      raisonSociale: null,
      siret: null,
      adresse: null,
      notes: null,
      recommandeParTexte: null,
      sourceDetail: null,
    }),
    garde: "catégorie, provenance, campagne, date du premier contact, code postal et ville, lien de recommandation : statistiques sans identité",
  },
  ClientEmail: { remplacer: (ligne) => ({ adresse: `anonymise-${String(ligne.id)}`, libelle: null }), garde: "la ligne archivée, sans adresse" },
  ClientTelephone: { remplacer: (ligne) => ({ numero: `anonymise-${String(ligne.id)}`, saisi: EFFACE, libelle: null }), garde: "la ligne archivée, sans numéro" },
  ConsentementMail: { conserve: "preuve datée du consentement (statut, moyen, texte de la case) ; la base la refuse à la modification" },
  Lead: {
    remplacer: (ligne, contexte) => ({
      ...(contexte.leadsAvecFactures.has(String(ligne.id)) ? {} : { nom: "Anonymisé", prenom: "Anonymisé" }),
      email: null,
      telephone: EFFACE,
      notes: null,
      lienSimulation: null,
      metaLeadgenId: null,
    }),
    garde: "source, statut, ville et projet ; nom et prénom seulement si une facture de l'ancien écran les imprime",
  },
  Interaction: { remplacer: () => ({ contenu: EFFACE }), garde: "type et date" },
  NoteAppel: { remplacer: () => ({ texte: EFFACE }), garde: "date de l'appel, étiquettes et issue (le texte est effacé) : pourquoi des affaires se perdent, sans identité" },
  Simulation: {
    remplacer: () => ({ notes: null, lienSimulation: null, imageBeforePath: null, imageAfterPath: null, imageOriginalPath: null }),
    garde: "référence, métrage et prix estimés (images effacées)",
  },
  MetaLead: {
    remplacer: () => ({ reponses: null, erreur: null }),
    garde: "identifiants Meta (leadgen, campagne, publicité), dates et statut : le suivi des campagnes sans les réponses du formulaire",
  },
  PhotoLead: { remplacer: () => ({ chemin: EFFACE }), garde: "date et origine de la photo jointe (fichier effacé)" },
  SimulationSite: { remplacer: () => ({ imageBeforePath: null, imageAfterPath: null, ipOrigine: null, references: "[]" }), garde: "projet, dates, page et source du parcours (images effacées)" },
  PublicationSite: { remplacer: () => ({ texte: null, auteur: null, photoAvant: null, photoApres: null }), garde: "titre, ville et type ; sans photo ni texte, la publication disparaît du site" },
  Devis: { remplacer: () => ({ notesInternes: null }), garde: "numéro et montants de l'ancien écran" },
  Facture: { conserve: "facture de l'ancien écran : conservation légale de 10 ans" },
  Chantier: { remplacer: () => ({ adresse: EFFACE, photosAvant: "[]", photosApres: "[]" }), garde: "dates, référence, métrage et montants (photos effacées)" },
  Commande: { conserve: "commande au fournisseur, sans donnée du client" },
  Prospect: {
    remplacer: (ligne) => ({ ...(ligne.emailType === "NOMINATIF" ? { email: null } : {}), avisBruts: null, signalPrincipal: null, angleSuggere: null }),
    garde: "coordonnées publiques de l'établissement (fiche Google), sauf une adresse e-mail nominative",
  },
  EmailDraft: { remplacer: () => ({ sujet: EFFACE, corps: EFFACE, corpsOriginal: null }), garde: "statut et dates d'envoi" },
  ProspectActivity: { remplacer: () => ({ details: null }), garde: "type et date" },
  Dossier: {
    remplacer: (_ligne, contexte) => ({
      clientNom: nomAnonyme(contexte),
      clientAdresse: EFFACE,
      clientEmail: null,
      clientTelephone: EFFACE,
      prochaineAction: null,
      perteCommentaire: null,
      photos: "[]",
    }),
    garde: "objet, étapes, montants, dates, code postal et ville, motif de perte (photos effacées)",
  },
  DossierNote: { remplacer: () => ({ contenu: EFFACE }), garde: "étape et date" },
  DossierEvenement: {
    remplacer: (ligne): Record<string, string | null> =>
      ligne.type === "CHANGEMENT_ETAPE"
        ? { metadata: metadataSansTexteLibre(ligne.metadata) }
        : { contenu: `${LIBELLES_TYPE_EVENEMENT[ligne.type as TypeEvenement] ?? "Événement"} (détail effacé, RGPD)`, metadata: "{}" },
    garde: "type, date et changements d'étape (sans texte libre)",
  },
  Document: { conserve: "document émis : conservation légale de 10 ans, identité figée telle qu'imprimée (PDF compris)" },
  NumeroDocument: { conserve: "registre des numéros : destinataire tel qu'émis, conservation légale" },
  Encaissement: { remplacer: () => ({ note: null }), garde: "payeur, montant, moyen, référence et dates : livre des recettes (conservation légale)" },
  AffectationEncaissement: { conserve: "imputation d'un paiement : montants seulement" },
  Depense: { conserve: "dépense du chantier : fournisseur et montant, aucune donnée du client" },
  Message: { remplacer: () => ({ de: "anonymise", deNom: null, a: "[]", objet: EFFACE, extrait: null }), garde: "canal, sens, date, statut du tri et identifiant chez le fournisseur (évite une réimportation)" },
  ContenuMessage: { remplacer: () => ({ texte: null, entetes: "{}" }), garde: "rien d'autre que la date d'effacement" },
  PieceMessage: { remplacer: () => ({ nom: EFFACE, raison: EFFACE }), garde: "type et taille (fichier effacé)" },
  AnalyseMessage: { remplacer: () => ({ raisonnement: null, resultat: "{}" }), garde: "méthode, catégorie, confiance et coût" },
  Fichier: { remplacer: () => ({ nomOriginal: null }), garde: "type, taille et empreinte (fichier effacé)" },
  // Messagerie SMS : le numéro est la clé de la conversation, il part avec le reste.
  ConversationSms: {
    remplacer: (ligne) => ({ numero: `anonymise:${String(ligne.id)}`, nomAffiche: null, dernierExtrait: null, stopTexte: null, brouillon: null }),
    garde: "dates, compteurs et date d'un éventuel STOP",
  },
  Sms: { remplacer: () => ({ texte: EFFACE, textePropose: null, erreur: null }), garde: "sens, dates, statut de remise, origine et message type : la mesure des relances, sans leur contenu" },
  // Onglet Mail (mission 7) : le contenu part, la mesure des envois et de l'aide à la rédaction reste.
  EnvoiMail: { remplacer: () => ({ a: "anonymise", objet: EFFACE, texte: EFFACE, html: null, entetes: null, erreur: null }), garde: "nature, modèle, statut et dates : la mesure des envois, sans leur contenu" },
  BrouillonMail: {
    remplacer: () => ({ a: null, consigne: null, objetIa: null, texteIa: null, manques: "[]", corrections: "[]", contexte: "{}", objetEnvoye: null, texteEnvoye: null }),
    garde: "statut, coût et dates : la mesure de l'aide à la rédaction, sans aucun texte",
  },
  InscriptionSequence: { remplacer: (ligne) => ({ adresse: `anonymise-${String(ligne.id)}`, arretMotif: null }), garde: "séquence, étape atteinte, statut et dates (une inscription en cours est arrêtée)" },
  // Espace client : ce que la personne y a écrit et les images qui la concernent.
  EspaceClient: { remplacer: () => ({ souhaits: null, choix: null, avis: null, nomProjet: null, propositionMessage: null, photosRetirees: null }), garde: "dates de création, d'accès et d'expiration du lien, compteurs de visites" },
  // L'espace permanent (mission 5) : ses favoris partent ; le code, les dates et les compteurs restent (sans identité).
  EspacePermanent: { remplacer: () => ({ favoris: null }), garde: "code du lien, dates d'accès et de confirmation, compteurs de visites et de projets accordés" },
  SimulationEspace: {
    remplacer: () => ({ chemin: EFFACE, photoAvant: null, titre: null, description: null, commentaireClient: null }),
    garde: "source, statut, teintes, version du prompt, coût et dates (images effacées)",
  },
  AccordDevis: { conserve: "preuve du bon pour accord donné sur un devis émis (signature au doigt comprise) : conservée avec le document, même durée légale" },
  // Simulateur du CRM (21/09/2026).
  PreparationSimulation: { remplacer: () => ({ photoSource: EFFACE, photoAvant: null }), garde: "type de surface, teintes, version du prompt, mode et dates (photos effacées)" },
  GenerationImage: { conserve: "coût d'une génération d'image : jetons, montant et durée, aucune donnée de la personne" },
  Proposition: {
    remplacer: (ligne): Record<string, string | null> =>
      ligne.type === "ANONYMISATION_CLIENT"
        ? {}
        : {
            titre: "Proposition anonymisée (RGPD)",
            resume: null,
            raisonnement: null,
            contenu: '{"anonymise":true}',
            contenuValide: ligne.contenuValide ? '{"anonymise":true}' : null,
            resultat: null,
            commentaireRejet: null,
          },
    garde: "type, auteur, statut, confiance, correction et motif de rejet : la mesure de l'agent",
  },
};

/** Liens par lesquels un modèle se rattache à une personne (vérifiés par le test de couverture). */
export const LIENS_PERSONNELS = ["clientId", "leadId", "dossierId", "messageId", "prospectId", "chantierId", "devisId", "fichierId", "encaissementId"] as const;
