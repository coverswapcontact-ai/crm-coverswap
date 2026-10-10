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
  SimulationSite: { remplacer: () => ({ imageBeforePath: null, imageAfterPath: null, ipOrigine: null, references: "[]", promptTexte: null, directionArtistique: null, analyse: null, photoEmpreinte: null }), garde: "projet, dates, page et source du parcours, moteur, score du contrôle (images, consigne et description de la pièce effacées)" },
  // Mission 15 (partie 1) : le travail de génération du site (« Me prévenir » y écrit une adresse ou un numéro).
  TravailSimulation: { remplacer: () => ({ notifierEmail: null, notifierTelephone: null, ipOrigine: null, photoPath: null, promptTexte: null, references: "[]", photoEmpreinte: null }), garde: "projet, statut, dates, durée et raison d'échec du travail (photo effacée)" },
  // Mission 15 (partie 2) : l'analyse d'une photo (description de la pièce), retrouvée par l'empreinte des travaux et simulations de la personne.
  AnalysePhoto: { remplacer: () => ({ json: null, parcoursId: null, photoPath: null, raison: null }), garde: "empreinte, pièce, statut, coût et dates (description de la pièce effacée)" },
  // Mission 15 (partie 3) : un rendu du banc de comparaison fait sur la photo d'un dossier de la personne.
  RenduBanc: { remplacer: () => ({ chemin: null, promptTexte: null, directionArtistique: null, defauts: null, erreur: null }), garde: "cas, variante, statut, score, coût, durée et dates (image et consigne effacées)" },
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
      // Mission 17 (partie A) : le texte de la prochaine action posée à la main (le même que prochaineAction).
      prochaineActionManuelle: null,
      perteCommentaire: null,
      photos: "[]",
    }),
    garde: "objet, étapes, montants, dates, code postal et ville, motif de perte (photos effacées)",
  },
  DossierNote: { remplacer: () => ({ contenu: EFFACE }), garde: "étape et date" },
  // Mission 8 : OAuth de l'assistant. « clientId » y désigne l'application cliente (Claude), jamais une personne ;
  // « utilisateur » est l'e-mail de Lucas, qui a donné son consentement. Jetons et codes ne sont stockés que hachés.
  CodeOAuth: { conserve: "code d'autorisation OAuth (haché) : clientId = application cliente, utilisateur = Lucas ; aucune donnée de client du CRM" },
  JetonOAuth: { conserve: "jeton OAuth (haché) de l'application Claude : clientId = application cliente, utilisateur = Lucas ; révocable depuis Paramètres, aucune donnée de client du CRM" },
  AppelOutil: { conserve: "journal technique de l'assistant (outil, paramètres tronqués, phrase dictée par Lucas) : conservé pour l'audit, comme le journal des modifications" },
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
    remplacer: () => ({ chemin: EFFACE, photoAvant: null, titre: null, description: null, commentaireClient: null, analyse: null, promptTexte: null, directionArtistique: null }),
    garde: "source, statut, teintes, version du prompt, moteur, score du contrôle, coût et dates (images, consigne et description de la pièce effacées)",
  },
  AccordDevis: { conserve: "preuve du bon pour accord donné sur un devis émis (signature au doigt comprise) : conservée avec le document, même durée légale" },
  // Mission 10 (23/09/2026) : ce que l'assistant a modifié (valeurs d'avant et d'après, phrase de Lucas) et les messages de l'espace.
  ModificationDossier: { remplacer: () => ({ champs: "[]", commande: null }), garde: "dates, acteur et annulation : la trace qu'une modification a eu lieu, sans ses valeurs" },
  MessageEspace: { remplacer: () => ({ texte: EFFACE }), garde: "auteur, source, dates (lu, notifié) : la mesure des échanges, sans leur contenu" },
  // Mission 25 : la messagerie. Le suivi perd son nom, son numéro, ses faits et ses trois lignes ; le journal et les
  // messages préparés perdent leurs textes. Restent les codes, statuts et dates : la mesure des relances, sans identité.
  Suivi: {
    remplacer: (_ligne, contexte) => ({ nom: nomAnonyme(contexte), telephone: null, faits: "{}", ouEnEst: "{}", ouEnEstManuel: null, etat: "{}", dernierExtrait: null, prochaineAction: null, pauseMotif: null }),
    garde: "dates, pause et STOP : la mesure de la messagerie, sans identité",
  },
  LigneJournalSuivi: { remplacer: () => ({ texte: EFFACE }), garde: "acteur et date de chaque ligne" },
  MessagePrepare: {
    remplacer: () => ({ texte: EFFACE, texteValide: EFFACE, texteEnvoye: null, destinataire: null, raison: null, motif: null }),
    garde: "code, canal, statut et dates : les taux de réponse par message, sans contenu",
  },
  // Mission 17 (partie C) : la trace commune des modifications de l'outil « modifier » (valeurs d'avant et d'après, nom de
  // ce qui a été modifié, phrase de Lucas). Sans colonne de lien : l'anonymisation la retrouve par (entite,
  // enregistrementId) sur les enregistrements de la personne (lead, dossier, fiche, coordonnées, notes d'appel,
  // documents, paiements, simulations, publications) et la caviarde comme ModificationDossier.
  ModificationAssistant: { remplacer: () => ({ champs: "[]", commande: null, nom: null }), garde: "entité, identifiant, dates, acteur et annulation : la trace qu'une modification a eu lieu, sans ses valeurs" },
  // Mission 17 (partie C) : les fichiers reçus (lien de dépôt, URL, base64, pièce de mail) et rangés sur un dossier, un
  // lead, une fiche client ; le fichier lui-même (photo, Fichier conservé) est effacé avec les autres.
  FichierDepose: { remplacer: () => ({ nom: null, origine: null, cibleNom: null, photoChemin: null, archiveMotif: null }), garde: "voie, type, taille, empreinte, cible (identifiant) et dates : la mesure des dépôts, sans nom de fichier ni nom de personne" },
  // Le lien de dépôt : le nom de la cible s'affiche sur la page (« Photos avant — dossier de Mme Martin »).
  JetonDepot: { remplacer: () => ({ cibleNom: null, archiveMotif: null }), garde: "empreinte du jeton, cible (identifiant), type, compteurs et dates" },
  // Simulateur du CRM (21/09/2026).
  PreparationSimulation: { remplacer: () => ({ photoSource: EFFACE, photoAvant: null, analyse: null, promptTexte: null, directionArtistique: null, photoEmpreinte: null }), garde: "type de surface, teintes, version du prompt, moteur, score du contrôle, mode et dates (photos, consigne et description de la pièce effacées)" },
  GenerationImage: { conserve: "coût d'une génération d'image : jetons, montant et durée, aucune donnée de la personne" },
  // Mission 17 (partie A) : les tâches de Lucas (a-faire/). Le titre et la raison nomment le client ; le raccourci porte
  // son numéro (tel:, SMS) ; les données, ses messages. Type, niveau, dates et réponse restent (la mesure du travail).
  TacheAFaire: {
    remplacer: () => ({ titre: EFFACE, raison: EFFACE, raccourci: "{}", donnees: "{}", reponseTexte: null, precedent: null }),
    garde: "type, source, niveau, montant, dates, statut, réponse et raison codée, durées : la mesure du travail, sans identité",
  },
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
