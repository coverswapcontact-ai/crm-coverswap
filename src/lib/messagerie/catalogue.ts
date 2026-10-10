/**
 * Mission 25 — les messages de la liste validée le 10/10/2026 (cahier « Relances et messagerie CoverSwap », § Les
 * 40 messages) : 32 messages préparés par le moteur (20 en Auto, 12 en Validation en mode Android) et 8 réponses
 * rapides, plus « comme convenu » (CC), que le cahier décrit (bouton « Va signer », garde de silence) sans l'écrire
 * dans la liste. Pur : importable par les écrans comme par le serveur.
 *
 * « Liste fermée » (règle d'or 4) : aucun autre texte n'existe. L'IA part d'ici pour personnaliser (le contrôleur
 * vérifie, sinon le texte validé part tel quel) ; Lucas modifie les textes dans Paramètres → SMS (`ModeleSms`, même
 * code), jamais ailleurs.
 *
 * Variables (en minuscules, sans accent) : {bonjour} « Bonjour Marie, » si le prénom est fiable, sinon « Bonjour, » ;
 * {piece} cuisine, salle de bain… ; {lien} lien de l'espace ; {lien_avis} lien direct vers la fiche Google ;
 * {quand_rappel}, {quand_reponse} « dans la journée », « demain matin », « lundi matin » ; {quand} moment du rappel
 * choisi ; {date_chantier}, {heure} du dossier ; {nombre} de simulations ; {creneau_1}, {creneau_2} de l'agenda.
 */

export const GROUPES_MESSAGES = ["PREMIER_CONTACT", "PHOTOS", "SIMULATION", "DEVIS", "CHANTIER", "APRES", "PERDUS", "REPONSES_AUTO", "RAPIDES"] as const;
export type GroupeMessage = (typeof GROUPES_MESSAGES)[number];
export const LIBELLES_GROUPE_MESSAGE: Record<GroupeMessage, string> = {
  PREMIER_CONTACT: "Premier contact",
  PHOTOS: "Photos",
  SIMULATION: "Simulation",
  DEVIS: "Devis",
  CHANTIER: "Chantier",
  APRES: "Après le chantier",
  PERDUS: "Dossiers perdus",
  REPONSES_AUTO: "Réponses automatiques",
  RAPIDES: "Réponses rapides (envoyées par toi, jamais seules)",
};

export const VARIABLES_MESSAGE = ["bonjour", "piece", "lien", "lien_avis", "quand_rappel", "quand_reponse", "quand", "date_chantier", "heure", "nombre", "creneau_1", "creneau_2"] as const;
export type VariableMessage = (typeof VARIABLES_MESSAGE)[number];
export const LIBELLES_VARIABLE_MESSAGE: Record<VariableMessage, string> = {
  bonjour: "« Bonjour Marie, » si le prénom est fiable, sinon « Bonjour, »",
  piece: "la pièce du projet (cuisine, salle de bain…)",
  lien: "le lien de l'espace du client",
  lien_avis: "le lien direct vers la fiche Google",
  quand_rappel: "« dans la journée », « demain matin » ou « lundi matin »",
  quand_reponse: "« demain matin » ou « lundi matin »",
  quand: "le moment du rappel choisi",
  date_chantier: "la date du chantier (dossier)",
  heure: "l'heure du chantier (dossier)",
  nombre: "le nombre de simulations",
  creneau_1: "premier créneau libre de l'agenda",
  creneau_2: "second créneau libre de l'agenda",
};

/** Mode en mode Android (en mode Manuel, tout passe par Lucas). */
export const MODES_MESSAGE = ["AUTO", "VALIDATION", "DESACTIVE"] as const;
export type ModeMessage = (typeof MODES_MESSAGE)[number];
export const LIBELLES_MODE_MESSAGE: Record<ModeMessage, string> = { AUTO: "Auto", VALIDATION: "Validation", DESACTIVE: "Désactivé" };

/**
 * Nature d'un message pour la garde de silence et les horaires :
 * - REACTIF : répond à un geste du client (A1, S1, D6, D8, E1, E2, réponse proposée) : passe la garde, tous les jours
 *   de 8 h 30 à 21 h ;
 * - EVENEMENT : suit un geste de Lucas ou un fait daté du dossier (appel, publication, devis, date de chantier) : horaires
 *   de travail, gardes dures (STOP, perdu, pause, message en attente), délai propre au message ;
 * - RELANCE : naît d'un silence : horaires, garde de silence complète, une relance tous les 2 jours, trois par étape ;
 * - RAPIDE : réponse rapide, écrite par Lucas, jamais préparée seule.
 */
export type NatureMessage = "REACTIF" | "EVENEMENT" | "RELANCE" | "RAPIDE";

/** Étape d'une relance (trois relances au plus par étape). */
export type EtapeRelance = "CONTACT" | "PHOTOS" | "SIMULATION" | "DEVIS" | "ACOMPTE" | "AVIS" | "SUIVI" | "REACTIVATION";

/** Variantes : le moteur choisit seul d'après les faits (zone, canal du client, nombre, date connue). */
export const VARIANTES_MESSAGE = ["defaut", "proche", "loin", "apresP1", "plusieurs", "smsDabord", "sansHeure", "sansDate", "devis"] as const;
export type VarianteMessage = (typeof VARIANTES_MESSAGE)[number];
export const LIBELLES_VARIANTE: Record<VarianteMessage, string> = {
  defaut: "Texte",
  proche: "À 25 km ou moins",
  loin: "Au-delà de 25 km",
  apresP1: "Après P1",
  plusieurs: "Plusieurs simulations",
  smsDabord: "Client « SMS d'abord », image jointe",
  sansHeure: "Heure inconnue",
  sansDate: "Sans date fixée",
  devis: "Un devis est en ligne",
};

export type DefinitionMessage = {
  code: string;
  groupe: GroupeMessage;
  libelle: string;
  /** Quand il est préparé, tel que validé. */
  quand: string;
  nature: NatureMessage;
  /** Mode validé pour le mode Android. */
  mode: Exclude<ModeMessage, "DESACTIVE">;
  etape: EtapeRelance | null;
  /** Lien attendu dans le texte (contrôleur : présent, et seulement lui). */
  lien: "ESPACE" | "AVIS" | null;
  /** Seul le premier contact se présente (« Lucas de CoverSwap », règle d'or 9). */
  premierContact?: boolean;
  /** L'IA peut personnaliser ce message à partir des faits (sinon il part tel quel). */
  personnalisable?: boolean;
  textes: Partial<Record<VarianteMessage, string>> & { defaut: string };
};

const d = (definition: DefinitionMessage) => definition;

export const CATALOGUE_MESSAGES = [
  // ── Premier contact ─────────────────────────────────────────────────────────
  d({
    code: "A1",
    groupe: "PREMIER_CONTACT",
    libelle: "Nouveau lead",
    quand: "Nouveau lead : tout de suite entre 8 h 30 et 21 h, sinon le lendemain à 8 h 30. Pas de lien : il arrive après l'appel (P1).",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: null,
    premierContact: true,
    textes: { defaut: "{bonjour} Lucas de CoverSwap. Merci pour votre demande ! Je vous appelle {quand_rappel}. Pour gagner du temps, envoyez-moi 2 ou 3 photos de votre {piece} en réponse à ce message." },
  }),
  d({
    code: "A2",
    groupe: "PREMIER_CONTACT",
    libelle: "Premier appel sans réponse",
    quand: "Appel sortant sans réponse (premier), 2 min après.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: "CONTACT",
    lien: null,
    textes: { defaut: "{bonjour} je viens d'essayer de vous joindre pour votre projet de {piece}. Quel moment vous arrange pour un appel de 5 minutes ?" },
  }),
  d({
    code: "A3",
    groupe: "PREMIER_CONTACT",
    libelle: "Appel entrant manqué",
    quand: "Appel entrant manqué aux heures de travail, 1 min après ; une fois par jour et par numéro (détection des appels : lot 9).",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: { defaut: "Bonjour, je n'ai pas pu décrocher, je suis sans doute sur un chantier. Je vous rappelle dès que possible, ou écrivez-moi ici si c'est plus simple." },
  }),
  d({
    code: "A4",
    groupe: "PREMIER_CONTACT",
    libelle: "Deuxième appel sans réponse",
    quand: "Deuxième appel sans réponse, le lendemain de A2.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: "CONTACT",
    lien: null,
    textes: { defaut: "{bonjour} je n'arrive pas à vous joindre. Répondez-moi simplement ici avec un moment qui vous arrange, ou dites-moi si le projet n'est plus d'actualité." },
  }),
  d({
    code: "A5",
    groupe: "PREMIER_CONTACT",
    libelle: "Troisième appel sans réponse",
    quand: "Troisième appel sans réponse, 2 jours après A4. Le CRM propose ensuite « Sans suite ».",
    nature: "EVENEMENT",
    mode: "VALIDATION",
    etape: "CONTACT",
    lien: null,
    textes: { defaut: "{bonjour} je ne veux pas vous déranger, alors je mets votre demande de côté. Si votre projet revient, répondez simplement à ce message et je m'en occupe." },
  }),
  // ── Photos ──────────────────────────────────────────────────────────────────
  d({
    code: "P1",
    groupe: "PHOTOS",
    libelle: "Après l'appel : l'espace",
    quand: "Appel noté « Intéressé », pas encore de photos : tout de suite.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: "ESPACE",
    textes: { defaut: "Merci pour notre échange ! Comme convenu, voici votre espace : déposez-y 2 ou 3 photos de votre {piece} et je vous prépare votre simulation. {lien}" },
  }),
  d({
    code: "P2",
    groupe: "PHOTOS",
    libelle: "Rappel des photos",
    quand: "Toujours aucune photo, 2 jours après P1 ou A1.",
    nature: "RELANCE",
    mode: "AUTO",
    etape: "PHOTOS",
    lien: null,
    textes: {
      defaut: "{bonjour} petit rappel : dès que j'ai 2 ou 3 photos de votre {piece}, je vous prépare votre simulation. Envoyez-les simplement en réponse à ce message.",
      apresP1: "{bonjour} petit rappel : dès que j'ai 2 ou 3 photos de votre {piece}, je vous prépare votre simulation. Envoyez-les simplement en réponse à ce message, ou déposez-les ici : {lien}",
    },
  }),
  d({
    code: "P3",
    groupe: "PHOTOS",
    libelle: "Dernier rappel des photos",
    quand: "Toujours aucune photo, 4 jours après P2. Ensuite, plus de relance photos : tâche « Appeler ».",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "PHOTOS",
    lien: null,
    textes: {
      defaut: "{bonjour} je garde votre projet de côté : dès que vous m'envoyez 2 ou 3 photos ici, je vous prépare votre simulation.",
      proche: "{bonjour} si c'est plus simple, je peux passer voir votre {piece} avec les échantillons et prendre les photos moi-même. Quel jour vous arrange ?",
      loin: "{bonjour} je garde votre projet de côté : dès que vous m'envoyez 2 ou 3 photos ici, je vous prépare votre simulation.",
    },
  }),
  // ── Simulation ──────────────────────────────────────────────────────────────
  d({
    code: "S1",
    groupe: "SIMULATION",
    libelle: "Photos reçues",
    quand: "Photos reçues (espace ou SMS) : tout de suite, une seule fois.",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: { defaut: "Merci, j'ai bien reçu vos photos ! Je prépare votre simulation et je vous préviens dès qu'elle est prête." },
  }),
  d({
    code: "S2",
    groupe: "SIMULATION",
    libelle: "Simulation prête",
    quand: "Simulation publiée : tout de suite, le mail actuel suit. Plusieurs simulations : « vos 3 simulations sont prêtes ».",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: "ESPACE",
    textes: {
      defaut: "{bonjour} votre simulation est prête ! Découvrez votre {piece} rénovée ici : {lien} Dites-moi ce que vous en pensez.",
      plusieurs: "{bonjour} vos {nombre} simulations sont prêtes ! Découvrez votre {piece} rénovée ici : {lien} Dites-moi ce que vous en pensez.",
      smsDabord: "{bonjour} voici votre {piece} rénovée ! Dites-moi ce que vous en pensez. Tout votre projet est aussi ici : {lien}",
    },
  }),
  d({
    code: "S3",
    groupe: "SIMULATION",
    libelle: "Simulation pas encore vue",
    quand: "Simulation jamais ouverte, 2 jours après S2 ; les aperçus de Lucas ne comptent pas. Client « SMS d'abord » : pas de S3.",
    nature: "RELANCE",
    mode: "AUTO",
    etape: "SIMULATION",
    lien: "ESPACE",
    textes: { defaut: "{bonjour} avez-vous pu voir votre simulation ? Elle vous attend ici : {lien}" },
  }),
  d({
    code: "S4",
    groupe: "SIMULATION",
    libelle: "Simulation vue, sans retour",
    quand: "Simulation vue sans retour, 4 jours après la visite (« SMS d'abord » : 4 jours après S2). L'IA cite les teintes regardées.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "SIMULATION",
    lien: null,
    personnalisable: true,
    textes: { defaut: "{bonjour} alors, qu'en pensez-vous ? Si la teinte ne vous convainc pas, dites-moi ce que vous aimeriez voir (plus clair, plus boisé…), je vous prépare une autre simulation." },
  }),
  d({
    code: "S5",
    groupe: "SIMULATION",
    libelle: "Voir les teintes en vrai",
    quand: "Toujours aucun retour, 10 jours après la visite. Ensuite, tâche « Appeler ».",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "SIMULATION",
    lien: null,
    textes: {
      defaut: "{bonjour} pour voir les teintes en vrai, je peux vous envoyer quelques échantillons par la poste. Ça vous intéresse ?",
      proche: "{bonjour} pour voir les teintes en vrai, je peux passer chez vous avec les échantillons : ça prend une vingtaine de minutes. Quel jour vous arrange ?",
      loin: "{bonjour} pour voir les teintes en vrai, je peux vous envoyer quelques échantillons par la poste. Ça vous intéresse ?",
    },
  }),
  // ── Devis ───────────────────────────────────────────────────────────────────
  d({
    code: "D1",
    groupe: "DEVIS",
    libelle: "Devis en ligne",
    quand: "Devis mis en ligne : tout de suite, le mail actuel suit.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: "ESPACE",
    textes: { defaut: "{bonjour} votre devis est prêt dans votre espace : {lien} Prenez le temps de le lire, et n'hésitez pas si vous avez la moindre question." },
  }),
  d({
    code: "D2",
    groupe: "DEVIS",
    libelle: "Devis pas encore ouvert",
    quand: "Devis jamais ouvert, 2 jours après D1.",
    nature: "RELANCE",
    mode: "AUTO",
    etape: "DEVIS",
    lien: "ESPACE",
    textes: { defaut: "{bonjour} avez-vous pu ouvrir votre devis ? Il vous attend ici : {lien}" },
  }),
  d({
    code: "D3",
    groupe: "DEVIS",
    libelle: "Questions sur le devis",
    quand: "Devis ouvert sans réponse, 4 jours après la première ouverture (sauf si D2 est déjà parti).",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "DEVIS",
    lien: null,
    personnalisable: true,
    textes: { defaut: "{bonjour} avez-vous des questions sur le devis ? Je peux l'ajuster si besoin (teintes, surfaces…). Un appel de 5 minutes suffit souvent." },
  }),
  d({
    code: "D4",
    groupe: "DEVIS",
    libelle: "Devis : je reviens vers vous",
    quand: "Toujours rien, 10 jours après D1.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "DEVIS",
    lien: null,
    textes: { defaut: "{bonjour} je reviens vers vous pour votre devis. Si le projet est reporté ou n'est plus d'actualité, dites-le-moi simplement, ça m'aide à m'organiser." },
  }),
  d({
    code: "D5",
    groupe: "DEVIS",
    libelle: "Devis : dossier mis en pause",
    quand: "Toujours rien, 21 jours après D1. Sept jours plus tard, le CRM propose de passer le dossier en Perdu.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "DEVIS",
    lien: null,
    textes: { defaut: "{bonjour} sans nouvelles de votre part, je mets votre dossier en pause. Votre devis reste dans votre espace, et je reste joignable ici si le projet revient." },
  }),
  d({
    code: "D6",
    groupe: "DEVIS",
    libelle: "Accord reçu",
    quand: "Accord donné en ligne : tout de suite. Crée la tâche « Appeler pour la date ».",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: "ESPACE",
    textes: { defaut: "Merci pour votre confiance ! J'ai bien reçu votre accord. Pour réserver votre date, l'acompte se règle dans votre espace : {lien} Je vous appelle pour caler le chantier." },
  }),
  d({
    code: "D7",
    groupe: "DEVIS",
    libelle: "Rappel de l'acompte",
    quand: "Accord sans acompte, 3 jours après.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "ACOMPTE",
    lien: "ESPACE",
    textes: { defaut: "{bonjour} petit rappel : votre date de chantier sera bloquée dès réception de l'acompte, à régler dans votre espace : {lien}" },
  }),
  d({
    code: "D8",
    groupe: "DEVIS",
    libelle: "Acompte reçu",
    quand: "Acompte encaissé : tout de suite, avec le mail actuel.",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: {
      defaut: "Acompte bien reçu, merci ! Votre chantier est réservé pour le {date_chantier}.",
      sansDate: "Acompte bien reçu, merci ! Votre chantier est réservé, je vous appelle pour fixer la date.",
    },
  }),
  // ── Chantier ────────────────────────────────────────────────────────────────
  d({
    code: "C1",
    groupe: "CHANTIER",
    libelle: "Date du chantier",
    quand: "Date du chantier fixée ou déplacée : tout de suite.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: {
      defaut: "C'est noté : votre chantier est prévu le {date_chantier} à {heure}. Je vous enverrai un petit rappel la veille.",
      sansHeure: "C'est noté : votre chantier est prévu le {date_chantier}. Je vous enverrai un petit rappel la veille.",
    },
  }),
  d({
    code: "C2",
    groupe: "CHANTIER",
    libelle: "Veille du chantier",
    quand: "Veille du chantier, 18 h (un dimanche : le samedi matin).",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: {
      defaut: "Petit rappel : j'arrive demain à {heure} pour votre chantier. Pensez simplement à ranger ce qui encombre. Pas besoin de vider les placards ni de faire le ménage, je m'occupe de tout. À demain !",
      sansHeure: "Petit rappel : j'arrive demain pour votre chantier. Pensez simplement à ranger ce qui encombre. Pas besoin de vider les placards ni de faire le ménage, je m'occupe de tout. À demain !",
    },
  }),
  d({
    code: "C3",
    groupe: "CHANTIER",
    libelle: "Fin du chantier",
    quand: "Fin du chantier, le soir même, avec le mail actuel.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: { defaut: "Merci pour votre accueil ! J'espère que votre nouvelle {piece} vous plaît. Pour l'entretien, faites comme avec des façades classiques, avec votre produit ménager habituel : le revêtement résiste même à la javel." },
  }),
  d({
    code: "C4",
    groupe: "CHANTIER",
    libelle: "Demande d'avis",
    quand: "5 jours après la fin du chantier.",
    nature: "RELANCE",
    mode: "AUTO",
    etape: "AVIS",
    lien: "AVIS",
    textes: { defaut: "{bonjour} alors, votre {piece} vous plaît toujours autant ? Si oui, un petit avis m'aiderait énormément, ça prend 30 secondes : {lien_avis}" },
  }),
  d({
    code: "C5",
    groupe: "CHANTIER",
    libelle: "Dernière demande d'avis",
    quand: "Toujours pas d'avis, 7 jours après C4. Dernière demande.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "AVIS",
    lien: "AVIS",
    textes: { defaut: "{bonjour} je me permets de vous relancer une seule fois pour l'avis : c'est ce qui aide le plus une petite entreprise comme la mienne. Merci ! {lien_avis}" },
  }),
  // ── Après le chantier ───────────────────────────────────────────────────────
  d({
    code: "F1",
    groupe: "APRES",
    libelle: "Six mois après",
    quand: "6 mois après la fin du chantier.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "SUIVI",
    lien: null,
    personnalisable: true,
    textes: { defaut: "{bonjour} tout tient bien depuis la pose ? Si une autre pièce vous tente (salle de bain, portes, meubles), je peux vous en préparer une simulation." },
  }),
  // ── Dossiers perdus ─────────────────────────────────────────────────────────
  d({
    code: "R1",
    groupe: "PERDUS",
    libelle: "Perdu pour « trop cher »",
    quand: "Dossier perdu pour « trop cher », 60 jours après.",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "REACTIVATION",
    lien: null,
    textes: { defaut: "{bonjour} je reviens vers vous pour votre projet de {piece}. S'il est toujours d'actualité, je peux vous proposer une version plus simple, par exemple les façades seules. Répondez-moi ici si ça vous intéresse. STOP pour ne plus recevoir de messages." },
  }),
  d({
    code: "R2",
    groupe: "PERDUS",
    libelle: "Perdu depuis six mois",
    quand: "Dossier perdu depuis 6 mois, avec l'accord du client pour les messages commerciaux (règle actuelle).",
    nature: "RELANCE",
    mode: "VALIDATION",
    etape: "REACTIVATION",
    lien: null,
    textes: { defaut: "{bonjour} où en est votre projet de {piece} ? S'il est toujours d'actualité, je peux vous préparer une nouvelle simulation. STOP pour ne plus recevoir de messages." },
  }),
  // ── Réponses automatiques ───────────────────────────────────────────────────
  d({
    code: "E1",
    groupe: "REPONSES_AUTO",
    libelle: "Lien de l'espace",
    quand: "Le client demande son lien ou ne le trouve plus.",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: "ESPACE",
    textes: { defaut: "Voici le lien de votre espace : {lien}" },
  }),
  d({
    code: "E2",
    groupe: "REPONSES_AUTO",
    libelle: "Accusé du soir",
    quand: "Message reçu hors horaires (soir, dimanche), entre 8 h 30 et 21 h. Pas pour un simple merci ; une fois par soirée.",
    nature: "REACTIF",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: { defaut: "Bien reçu, merci ! Je vous réponds {quand_reponse}." },
  }),
  d({
    code: "E3",
    groupe: "REPONSES_AUTO",
    libelle: "Rappel noté",
    quand: "Tu poses un rappel avec l'outil Rappel et choisis de prévenir le client.",
    nature: "EVENEMENT",
    mode: "AUTO",
    etape: null,
    lien: null,
    textes: { defaut: "C'est noté, je vous rappelle {quand}." },
  }),
  d({
    code: "CC",
    groupe: "REPONSES_AUTO",
    libelle: "Comme convenu",
    quand: "Rappel daté posé par toi (« va signer dans 2 semaines ») : pause jusqu'à cette date, puis ce message, en Validation.",
    nature: "EVENEMENT",
    mode: "VALIDATION",
    etape: null,
    lien: null,
    personnalisable: true,
    textes: {
      defaut: "{bonjour} comme convenu, je reviens vers vous pour votre projet de {piece}. Avez-vous pu y réfléchir ?",
      devis: "{bonjour} comme convenu, je reviens vers vous pour votre devis. Avez-vous pu y réfléchir ?",
    },
  }),
  // ── Réponses rapides ────────────────────────────────────────────────────────
  d({ code: "Q1", groupe: "RAPIDES", libelle: "Sur un chantier", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Je suis sur un chantier, je vous rappelle en fin de journée." } }),
  d({ code: "Q2", groupe: "RAPIDES", libelle: "Photo de plus loin", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Pouvez-vous m'envoyer une photo prise d'un peu plus loin, avec toute la pièce ?" } }),
  d({ code: "Q3", groupe: "RAPIDES", libelle: "Dimensions", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Avez-vous une idée des dimensions, même approximatives ?" } }),
  d({ code: "Q4", groupe: "RAPIDES", libelle: "Quelques teintes", quand: "Réponse rapide, avec la planche d'échantillons.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Voici quelques teintes qui pourraient vous plaire :" } }),
  d({
    code: "Q5",
    groupe: "RAPIDES",
    libelle: "Échantillons",
    quand: "Réponse rapide : visite avec deux créneaux libres de l'agenda (25 km ou moins), sinon la poste.",
    nature: "RAPIDE",
    mode: "VALIDATION",
    etape: null,
    lien: null,
    textes: {
      defaut: "Je peux vous envoyer quelques échantillons par la poste. À quelle adresse ?",
      proche: "Je peux passer vous montrer les échantillons. Plutôt {creneau_1} ou {creneau_2} ?",
      loin: "Je peux vous envoyer quelques échantillons par la poste. À quelle adresse ?",
    },
  }),
  d({ code: "Q6", groupe: "RAPIDES", libelle: "Je regarde", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Bien reçu, je regarde et je reviens vers vous très vite." } }),
  d({ code: "Q7", groupe: "RAPIDES", libelle: "C'est noté", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Merci pour votre retour, c'est noté !" } }),
  d({ code: "Q8", groupe: "RAPIDES", libelle: "Devis corrigé", quand: "Réponse rapide.", nature: "RAPIDE", mode: "VALIDATION", etape: null, lien: null, textes: { defaut: "Je vous envoie le devis corrigé dans la journée." } }),
] as const satisfies readonly DefinitionMessage[];

export type CodeMessage = (typeof CATALOGUE_MESSAGES)[number]["code"];
export const CODES_MESSAGE = CATALOGUE_MESSAGES.map((m) => m.code) as CodeMessage[];

/** Hors liste : la réponse proposée par l'analyse (contrôlée) et le texte libre écrit par Lucas. */
export const CODES_HORS_LISTE = ["REPONSE", "LIBRE"] as const;
export type CodeHorsListe = (typeof CODES_HORS_LISTE)[number];
export type CodeFile = CodeMessage | CodeHorsListe;

export function estCodeMessage(code: unknown): code is CodeMessage {
  return typeof code === "string" && (CODES_MESSAGE as string[]).includes(code);
}

export function definitionMessage(code: CodeMessage): DefinitionMessage {
  return CATALOGUE_MESSAGES.find((m) => m.code === code)!;
}

/** Les messages qui répondent à un geste du client : ils passent la garde de silence (et les réponses proposées). */
export function estReactif(code: string): boolean {
  if (code === "REPONSE") return true;
  return estCodeMessage(code) && definitionMessage(code).nature === "REACTIF";
}

/** Une relance de silence (une tous les 2 jours, trois par étape). */
export function estRelance(code: string): boolean {
  return estCodeMessage(code) && definitionMessage(code).nature === "RELANCE";
}

/** Les variantes réellement écrites pour un code, dans l'ordre de la liste. */
export function variantesDe(code: CodeMessage): VarianteMessage[] {
  const textes = definitionMessage(code).textes as Partial<Record<VarianteMessage, string>>;
  return VARIANTES_MESSAGE.filter((v) => typeof textes[v] === "string");
}

/** Les variables que le texte d'un code peut porter (toutes variantes confondues). */
export function variablesDe(code: CodeMessage): VariableMessage[] {
  const textes = Object.values(definitionMessage(code).textes).join(" ");
  return VARIABLES_MESSAGE.filter((v) => textes.includes(`{${v}}`));
}

/** Code de la ligne `ModeleSms` d'une variante : « P3 » pour le texte par défaut, « P3.proche » sinon. */
export const codeModele = (code: CodeMessage, variante: VarianteMessage = "defaut") => (variante === "defaut" ? code : `${code}.${variante}`);

export function lireCodeModele(cle: string): { code: CodeMessage; variante: VarianteMessage } | null {
  const [code, variante = "defaut"] = cle.split(".");
  if (!estCodeMessage(code) || !(VARIANTES_MESSAGE as readonly string[]).includes(variante)) return null;
  if (!variantesDe(code).includes(variante as VarianteMessage)) return null;
  return { code, variante: variante as VarianteMessage };
}

/** Toutes les lignes de texte de la liste : une par code et par variante (Paramètres → SMS). */
export function lignesDuCatalogue(): { cle: string; code: CodeMessage; variante: VarianteMessage; texte: string }[] {
  return CATALOGUE_MESSAGES.flatMap((m) =>
    variantesDe(m.code).map((variante) => ({ cle: codeModele(m.code, variante), code: m.code, variante, texte: (m.textes as Partial<Record<VarianteMessage, string>>)[variante]! }))
  );
}
