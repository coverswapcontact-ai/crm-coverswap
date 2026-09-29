/**
 * Mission 14 (29/09/2026), partie 5 — le catalogue des SMS : les textes n'existent
 * qu'ici. Chaque code dit quand il sert, quelles variables il accepte, s'il porte
 * le lien de l'espace (toujours en fin de message) et son texte de départ.
 *
 * Pur, sans base : importable par les écrans (Paramètres → SMS, écran SMS). Les
 * textes modifiés par Lucas vivent en base (`ModeleSms`, une ligne par code) et se
 * lisent par une seule fonction serveur, `texteDuCatalogue` (`./modeles`).
 *
 * Règles d'écriture (pour tous les textes, existants compris) : parler du projet,
 * pas de la pièce ; ne jamais promettre de simulation ; court et naturel ; le lien
 * toujours en fin de message. Rien ne part tout seul, sauf les deux accusés de
 * réception ; les autres SMS sont copiés par Lucas, et copier vaut envoi.
 *
 * Partie 6 : l'ancien circuit de relances (SMS proposés puis envoyés par le
 * fournisseur : INJOIGNABLE_J3, RELANCE_PHOTOS, RELANCE_SIMULATION, RELANCE_DEVIS,
 * RELANCE_DEVIS_QUESTIONS, RELANCE_DERNIERE) est retiré : ses modèles sont archivés
 * (migration `relances-un-circuit-14-6`), les relances sont des SMS à copier.
 */

export const GROUPES_SMS = ["AUTOMATIQUES", "APRES_APPEL", "ESPACE", "RELANCES"] as const;
export type GroupeSms = (typeof GROUPES_SMS)[number];

export const LIBELLES_GROUPE_SMS: Record<GroupeSms, string> = {
  AUTOMATIQUES: "Automatiques",
  APRES_APPEL: "Après un appel",
  ESPACE: "Espace client",
  RELANCES: "Relances",
};

export type VariableSms = "prenom" | "quand" | "lien" | "validite" | "montant";

export const LIBELLES_VARIABLE_SMS: Record<VariableSms, string> = {
  prenom: "son prénom (« Bonjour, » s'il manque)",
  quand: "le rappel posé (« demain vers 18 h », « prochainement »)",
  lien: "le lien de son espace, toujours à la fin",
  validite: "la fin de validité du devis",
  montant: "le montant du devis",
};

export type DefinitionSms = {
  code: string;
  /** Le nom du message dans Paramètres. */
  libelle: string;
  groupe: GroupeSms;
  /** Une phrase : quand il sert. */
  usage: string;
  /** Les seules variables permises dans son texte. */
  variables: readonly VariableSms[];
  /** Le texte porte le lien de l'espace : il doit finir par {lien}. */
  lien: boolean;
  /** Part tout seul (les deux accusés de réception, et eux seuls). */
  automatique: boolean;
  /**
   * Peut partir par le fournisseur, facturé au SMS (accusés, nouveau lien, simulation en ligne) :
   * le texte doit rester en GSM-7, un accent hors GSM triple le coût. Les autres sont copiés par Lucas.
   */
  fournisseur: boolean;
  /** Le texte de départ. */
  defaut: string;
};

export const CATALOGUE_SMS = [
  // ── Automatiques : textes inchangés (écrits en GSM-7, envoyés par le fournisseur).
  {
    code: "ACCUSE_RECEPTION",
    libelle: "Accusé de réception (automatique, en journée)",
    groupe: "AUTOMATIQUES",
    usage: "Part tout seul dans la minute qui suit un nouveau lead (pub Meta ou site), de 8 h 30 à 19 h 30, sauf le dimanche.",
    variables: ["prenom"],
    lien: false,
    automatique: true,
    fournisseur: true,
    defaut: "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dans les prochaines minutes. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.",
  },
  {
    code: "ACCUSE_RECEPTION_HORS_HORAIRES",
    libelle: "Accusé de réception (automatique, soir et dimanche)",
    groupe: "AUTOMATIQUES",
    usage: "Part tout seul à la place du premier le soir et le dimanche, s'il est actif.",
    variables: ["prenom"],
    lien: false,
    automatique: true,
    fournisseur: true,
    defaut: "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dès demain matin. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.",
  },
  // ── Après un appel.
  {
    code: "PAS_DE_REPONSE_SIMULATION",
    libelle: "A — Pas de réponse (simulation du site)",
    groupe: "APRES_APPEL",
    usage: "Premier appel sans réponse d'un lead venu d'une simulation du site.",
    variables: ["prenom", "quand"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre simulation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.",
  },
  {
    code: "PAS_DE_REPONSE",
    libelle: "A — Pas de réponse (pub ou autre)",
    groupe: "APRES_APPEL",
    usage: "Premier appel sans réponse d'un lead venu d'une pub Meta, d'un formulaire ou d'ailleurs.",
    variables: ["prenom", "quand"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.",
  },
  {
    code: "PAS_DE_REPONSE_2",
    libelle: "D — 2ᵉ tentative sans réponse",
    groupe: "APRES_APPEL",
    usage: "Dès le deuxième appel sans réponse d'affilée.",
    variables: ["prenom"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour, c'est encore Lucas de CoverSwap. Je n'arrive pas à vous joindre : répondez-moi ici avec un moment qui vous arrange, ou dites-moi simplement si le projet n'est plus d'actualité.",
  },
  {
    code: "A_RAPPELER",
    libelle: "B — À rappeler",
    groupe: "APRES_APPEL",
    usage: "Il a décroché et veut être rappelé : {quand} donne le rappel posé, ou « prochainement » sans date.",
    variables: ["prenom", "quand"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Merci pour votre réponse ! C'est noté, je vous rappelle {quand}. À très vite, Lucas de CoverSwap.",
  },
  // ── Espace client : le lien en dernier.
  {
    code: "LIEN_ESPACE",
    libelle: "Lien de l'espace (premier envoi)",
    groupe: "ESPACE",
    usage: "Après un appel « intéressé », le premier lien envoyé depuis sa fiche, ou la relance photos d'un client qui n'a encore jamais reçu son lien.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. {lien}",
  },
  {
    code: "LIEN_ESPACE_SIMULATION",
    libelle: "Lien de l'espace (lead venu d'une simulation du site)",
    groupe: "ESPACE",
    usage: "Même moment que le premier lien, pour un lead venu d'une simulation du site : elle est déjà dans son espace.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel, avec la suite de votre projet : {lien}",
  },
  {
    code: "INJOIGNABLE_LIEN",
    libelle: "Pas de réponse : le lien de l'espace",
    groupe: "ESPACE",
    usage: "Il ne répond pas, son espace est prêt : le lien pour qu'il avance sans attendre l'appel.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet. Votre espace personnel est prêt, vous pouvez y déposer quelques photos quand vous voulez : {lien}",
  },
  {
    code: "LIEN_ESPACE_RAPPEL",
    libelle: "Renvoyer le lien de l'espace",
    groupe: "ESPACE",
    usage: "Il a déjà reçu son lien (ou ouvert son espace) : le lui redonner, pour un projet en cours, ou pour la relance photos d'un client qui l'a déjà reçu.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : {lien}",
  },
  {
    code: "LIEN_ESPACE_NOUVEAU",
    libelle: "Nouveau lien de l'espace",
    groupe: "ESPACE",
    usage: "Après « Nouveau lien » : l'ancien ne fonctionne plus.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: true,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici le nouveau lien de votre espace, l'ancien ne fonctionne plus : {lien}",
  },
  {
    code: "SIMULATION_PRETE",
    libelle: "Simulation en ligne dans l'espace",
    groupe: "ESPACE",
    usage: "À la publication d'une simulation, pour le prévenir.",
    variables: ["prenom", "lien"],
    lien: true,
    automatique: false,
    fournisseur: true,
    defaut: "Bonjour {prenom}, c'est Lucas de CoverSwap. Votre simulation est en ligne dans votre espace, dites-moi ce que vous en pensez : {lien}",
  },
  // ── Relances de devis.
  {
    code: "RELANCE_DEVIS_1",
    libelle: "Relance du devis (1re)",
    groupe: "RELANCES",
    usage: "Première relance d'un devis resté sans réponse.",
    variables: ["prenom"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour, c'est Lucas de CoverSwap. Avez-vous pu regarder votre devis ? Il est toujours dans votre espace client. Je reste disponible si vous avez des questions.",
  },
  {
    code: "RELANCE_DEVIS_2",
    libelle: "Relance du devis (2de, la dernière)",
    groupe: "RELANCES",
    usage: "Seconde et dernière relance du même devis.",
    variables: ["prenom"],
    lien: false,
    automatique: false,
    fournisseur: false,
    defaut: "Bonjour, c'est Lucas de CoverSwap. Je reviens vers vous pour votre devis : s'il vous reste une question ou si le projet n'est plus d'actualité, dites-le-moi simplement.",
  },
] as const satisfies readonly DefinitionSms[];

export type CodeSms = (typeof CATALOGUE_SMS)[number]["code"];
export const CODES_SMS = CATALOGUE_SMS.map((d) => d.code) as readonly CodeSms[] as readonly [CodeSms, ...CodeSms[]];

export function estCodeSms(code: string): code is CodeSms {
  return (CODES_SMS as readonly string[]).includes(code);
}

export function definitionSms(code: string): DefinitionSms | null {
  return CATALOGUE_SMS.find((d) => d.code === code) ?? null;
}

/** Les codes qui communiquent le lien de l'espace (leur texte de départ finit par le lien). */
export const CODES_LIEN_ESPACE = ["LIEN_ESPACE", "LIEN_ESPACE_SIMULATION", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "LIEN_ESPACE_NOUVEAU", "SIMULATION_PRETE"] as const satisfies readonly CodeSms[];

/**
 * Ce SMS porte-t-il le lien d'un espace client (« …/e/<jeton> ») ? LA règle, lue sur le texte tel qu'il est parti,
 * quel que soit son code (un texte libre compris, un lien retiré à la main exclu) : pour la main (`dossiers/main.ts`)
 * comme pour « Lien pas encore envoyé » (`espace/suivi.ts › liensEnvoyes`).
 */
export function porteLienEspace(texte: string | null | undefined): boolean {
  return /\/e\/[A-Za-z0-9]/.test(texte ?? "");
}

/**
 * Le message a un interrupteur (« Couper » / « Réactiver ») : les deux accusés, lus par `lireModele`. Les autres
 * codes n'en ont pas : ils ne partent que si Lucas les copie (ou les envoie) lui-même.
 */
export function aUnInterrupteur(definition: Pick<DefinitionSms, "automatique">): boolean {
  return definition.automatique;
}

/** Un SMS sans lien vise un seul SMS (160 caractères) ; avec le lien, il peut en faire deux. */
export const LONGUEUR_VISEE = 160;

/**
 * Le texte d'un code respecte-t-il ses règles ? Toute accolade doit être une variable du code, écrite exactement
 * (`{prénom}` est refusé : il partirait tel quel) ; `{lien}` une seule fois et à la toute fin pour un code à lien,
 * absent sinon. Rend le message d'erreur (tutoiement : c'est Lucas qui écrit), ou null. Partagé par l'écran et le
 * serveur.
 */
export function verifierTexteSms(code: string, texte: string): string | null {
  const definition = definitionSms(code);
  if (!definition) return null;
  const propre = texte.trim();
  const variables = [...propre.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const permises = definition.variables as readonly string[];
  if (definition.lien) {
    if (!propre.endsWith("{lien}")) return "Le lien doit rester à la fin du message.";
    if (variables.filter((v) => v === "lien").length > 1) return "Le lien ne doit apparaître qu'une fois, à la fin du message.";
  } else if (variables.includes("lien")) {
    return "Ce message ne porte pas le lien de l'espace : retire {lien}.";
  }
  const inconnue = variables.find((v) => !permises.includes(v));
  if (inconnue !== undefined) return `Variable non permise : {${inconnue}}. Celles de ce message : ${permises.map((v) => `{${v}}`).join(", ")}.`;
  return null;
}

/* ── Proposer un SMS (types partagés avec l'écran SMS) ─────────────────────── */

/** Ce que l'écran demande : l'action (issue d'appel, lien, relance) et la cible. Le serveur choisit le code. */
export const ACTIONS_SMS = ["PAS_DE_REPONSE", "A_RAPPELER", "INTERESSE", "LIEN_ESPACE", "ENVOYER_LIEN", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "RELANCE_DEVIS", "RELANCE_PHOTOS"] as const;
export type ActionSms = (typeof ACTIONS_SMS)[number];

/**
 * Une relance : de devis (le devis et le rang, 1 ou 2), ou photos (mission 14, partie 6 : `type: "PHOTOS"` et le rang,
 * pour un espace ouvert sans photo ni simulation). La copie la range dans la trace (`metadata.relance`) : c'est elle
 * qui compte les relances faites, deux au plus.
 */
export type RelanceDevisSms = { documentId: string; rang: number };
export type RelancePhotosSms = { type: "PHOTOS"; rang: number };
export type RelanceSms = RelanceDevisSms | RelancePhotosSms;

export function estRelancePhotos(relance: RelanceSms | null | undefined): relance is RelancePhotosSms {
  return Boolean(relance && "type" in relance && relance.type === "PHOTOS");
}

/** Le SMS prérempli rendu à l'écran (et à l'assistant) : rien n'est écrit tant qu'il n'est pas copié. */
export type PropositionSms = {
  code: CodeSms;
  texte: string;
  telephone: string | null;
  /** Prénom + nom, pour « SMS à … ». */
  nom: string;
  prenom: string;
  leadId: string | null;
  dossierId: string | null;
  lien?: string;
  relance?: RelanceSms;
};
