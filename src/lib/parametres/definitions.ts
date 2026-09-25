// Paramètres fiscaux, sociaux et de facturation. AUCUNE valeur par défaut :
// un seuil ou un taux faux dans le code serait faux sans que personne ne le
// voie. Chaque paramètre se saisit à sa première utilisation, avec sa date
// d'effet et sa source ; l'historique reste. Aucune dépendance serveur.

export type NatureParametre = "euros" | "dollars" | "pourcentage" | "jours" | "mois" | "choix" | "texte";

export type DefinitionParametre = {
  libelle: string;
  /** Où trouver la valeur. Jamais la valeur elle-même. */
  aide: string;
  nature: NatureParametre;
  options?: readonly { valeur: string; libelle: string }[];
  groupe: GroupeParametre;
};

export const GROUPES_PARAMETRES = {
  FISCAL: "Seuils fiscaux",
  SOCIAL: "Cotisations sociales",
  ENCAISSEMENT: "Encaissements",
  FACTURATION: "Factures aux professionnels",
  COMMERCIAL: "Suivi commercial",
  PILOTAGE: "Pilotage de l'activité",
  RGPD: "Données personnelles (RGPD)",
  AGENT: "Agent mail et IA",
  SIMULATEUR: "Simulateur",
  PUBLICITE: "Campagne publicitaire",
} as const;
export type GroupeParametre = keyof typeof GROUPES_PARAMETRES;

export const DEFINITIONS_PARAMETRES = {
  SEUIL_FRANCHISE_TVA: {
    libelle: "Seuil de franchise en base de TVA (prestations de services)",
    aide: "Chiffre d'affaires annuel sous lequel la TVA n'est pas facturée (article 293 B du CGI). Montant en vigueur sur impots.gouv.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  SEUIL_FRANCHISE_TVA_MAJORE: {
    libelle: "Seuil majoré de franchise de TVA",
    aide: "Seuil de tolérance au-delà duquel la TVA est due immédiatement. Montant en vigueur sur impots.gouv.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  PLAFOND_MICRO_ENTREPRISE: {
    libelle: "Plafond de chiffre d'affaires du régime micro (prestations de services)",
    aide: "Au-delà, sortie du régime micro-entreprise. Montant en vigueur sur autoentrepreneur.urssaf.fr ou auprès du comptable.",
    nature: "euros",
    groupe: "FISCAL",
  },
  TAUX_COTISATIONS_SOCIALES: {
    libelle: "Taux des cotisations sociales",
    aide: "Pourcentage du chiffre d'affaires encaissé dû à l'URSSAF pour l'activité déclarée. Taux affiché dans l'espace autoentrepreneur.urssaf.fr.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  TAUX_CFP: {
    libelle: "Taux de la contribution à la formation professionnelle",
    aide: "Pourcentage du chiffre d'affaires encaissé, selon l'activité (artisan ou commerçant). Visible sur la déclaration URSSAF.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  VERSEMENT_LIBERATOIRE: {
    libelle: "Option pour le versement libératoire de l'impôt",
    aide: "Choix fait auprès de l'URSSAF. Si oui, le taux correspondant est demandé ensuite.",
    nature: "choix",
    options: [
      { valeur: "NON", libelle: "Non" },
      { valeur: "OUI", libelle: "Oui" },
    ],
    groupe: "SOCIAL",
  },
  TAUX_VERSEMENT_LIBERATOIRE: {
    libelle: "Taux du versement libératoire",
    aide: "Pourcentage du chiffre d'affaires encaissé, selon l'activité. Visible sur la déclaration URSSAF.",
    nature: "pourcentage",
    groupe: "SOCIAL",
  },
  PERIODICITE_DECLARATION: {
    libelle: "Périodicité de la déclaration de chiffre d'affaires",
    aide: "Mensuelle ou trimestrielle, telle que choisie dans l'espace URSSAF.",
    nature: "choix",
    options: [
      { valeur: "MENSUELLE", libelle: "Mensuelle" },
      { valeur: "TRIMESTRIELLE", libelle: "Trimestrielle" },
    ],
    groupe: "SOCIAL",
  },
  DATE_RECETTE_CHEQUE: {
    libelle: "Date à laquelle un chèque compte comme recette",
    aide: "À faire confirmer par le comptable : à la réception du chèque, ou à son crédit sur le compte. La même règle doit s'appliquer à tous les chèques.",
    nature: "choix",
    options: [
      { valeur: "RECEPTION", libelle: "À la réception du chèque" },
      { valeur: "CREDIT_BANCAIRE", libelle: "Au crédit sur le compte" },
    ],
    groupe: "ENCAISSEMENT",
  },
  DELAI_PAIEMENT_PROFESSIONNELS: {
    libelle: "Délai de paiement des factures aux professionnels",
    aide: "Nombre de jours entre la facture et son échéance, imprimé sur la facture. Plafonné par l'article L. 441-10 du Code de commerce.",
    nature: "jours",
    groupe: "FACTURATION",
  },
  TAUX_PENALITES_RETARD: {
    libelle: "Taux annuel des pénalités de retard",
    aide: "Mention obligatoire sur les factures aux professionnels (article L. 441-10 du Code de commerce). Ne peut être inférieur au minimum légal : voir le comptable.",
    nature: "pourcentage",
    groupe: "FACTURATION",
  },
  INDEMNITE_RECOUVREMENT: {
    libelle: "Indemnité forfaitaire pour frais de recouvrement",
    aide: "Mention obligatoire sur les factures aux professionnels ; montant fixé par l'article D. 441-5 du Code de commerce.",
    nature: "euros",
    groupe: "FACTURATION",
  },
  ESCOMPTE_PAIEMENT_ANTICIPE: {
    libelle: "Conditions d'escompte pour paiement anticipé",
    aide: "Mention obligatoire sur les factures aux professionnels, même s'il n'y en a pas (écrire alors « Néant »).",
    nature: "texte",
    groupe: "FACTURATION",
  },
  DELAI_RELANCE_DEVIS: {
    libelle: "Délai avant de proposer une relance de devis",
    aide: "Nombre de jours sans réponse après l'envoi d'un devis avant que le système propose une relance (jamais envoyée sans validation).",
    nature: "jours",
    groupe: "COMMERCIAL",
  },
  TRESORERIE_RESERVE: {
    libelle: "Réserve de trésorerie à garder",
    aide: "En euros : le matelas sous lequel la trésorerie ne doit pas descendre (3 000 € au départ). L'assistant s'en sert pour dire si une dépense ou une campagne est raisonnable ; il ne décide jamais seul.",
    nature: "euros",
    groupe: "PILOTAGE",
  },
  CAPACITE_CHANTIERS_MOIS: {
    libelle: "Capacité : chantiers par mois",
    aide: "Le nombre de chantiers que l'équipe peut poser dans un mois (15 au départ). L'assistant le compare aux dossiers signés et planifiés pour dire si le carnet est plein.",
    nature: "choix",
    options: [
      { valeur: "5", libelle: "5" },
      { valeur: "8", libelle: "8" },
      { valeur: "10", libelle: "10" },
      { valeur: "12", libelle: "12" },
      { valeur: "15", libelle: "15" },
      { valeur: "20", libelle: "20" },
      { valeur: "25", libelle: "25" },
      { valeur: "30", libelle: "30" },
    ],
    groupe: "PILOTAGE",
  },
  ZONE_DEPARTEMENTS: {
    libelle: "Zone d'intervention : départements",
    aide: "Numéros des départements où les chantiers se font sans se poser de question, séparés par des virgules (ex. 34). Sert à classer les contacts entrants : hors de la zone et des départements voisins, un contact est « à écarter ».",
    nature: "texte",
    groupe: "COMMERCIAL",
  },
  ZONE_DEPARTEMENTS_PROCHES: {
    libelle: "Zone d'intervention : départements voisins acceptés",
    aide: "Départements proches encore traités comme dans la zone, séparés par des virgules (ex. 30, 11). Écrire « aucun » pour n'en accepter aucun.",
    nature: "texte",
    groupe: "COMMERCIAL",
  },
  RGPD_CONSERVATION_PROSPECTS: {
    libelle: "Conservation des contacts qui n'ont rien signé",
    aide: "Nombre de mois après le dernier échange au-delà duquel l'anonymisation d'un prospect est proposée (jamais faite seule). La CNIL recommande 3 ans pour la prospection ; à confirmer avec un avocat ou un conseil RGPD.",
    nature: "mois",
    groupe: "RGPD",
  },
  RGPD_CONSERVATION_CLIENTS: {
    libelle: "Conservation des clients",
    aide: "Nombre de mois après le dernier dossier clos au-delà duquel l'anonymisation d'un client est proposée. Tient compte des garanties et délais de réclamation ; les factures restent conservées 10 ans quoi qu'il arrive. À fixer avec un avocat.",
    nature: "mois",
    groupe: "RGPD",
  },
  IA_CRM_ACTIVE: {
    libelle: "IA appelée par le CRM lui-même",
    aide: "En pause (par défaut) : le CRM n'appelle aucun modèle d'IA, ni pour lire les mails ni pour rédiger — c'est l'assistant Claude, connecté par le MCP avec votre abonnement, qui lit, classe, résume et dépose les brouillons ; le bouton « Rédiger » de l'onglet Mail affiche « via l'assistant Claude ». Active : l'ancien chemin (clé ANTHROPIC_API_KEY du serveur, coût par appel) est de nouveau permis, selon les interrupteurs ci-dessous.",
    nature: "choix",
    options: [
      { valeur: "ACTIVE", libelle: "Active" },
      { valeur: "EN_PAUSE", libelle: "En pause" },
    ],
    groupe: "AGENT",
  },
  IA_AGENT_MAIL: {
    libelle: "Lecture des mails par l'IA",
    aide: "Active : l'agent fait lire chaque mail utile à un modèle d'IA pour proposer un rattachement, une note, une réponse (coût par mail, plafonné par le budget mensuel). En pause : seules les règles sûres trient. L'IA ne décide jamais : tout passe par « À valider ».",
    nature: "choix",
    options: [
      { valeur: "ACTIVE", libelle: "Active" },
      { valeur: "EN_PAUSE", libelle: "En pause" },
    ],
    groupe: "AGENT",
  },
  IA_REDACTION: {
    libelle: "Rédaction des mails par l'IA",
    aide: "Active : le bouton « Rédiger avec l'IA » de l'onglet Mail appelle le modèle, à votre demande seulement (coût par brouillon, plafonné par le budget mensuel). Rien n'est rédigé ni dépensé sans votre clic.",
    nature: "choix",
    options: [
      { valeur: "ACTIVE", libelle: "Active" },
      { valeur: "EN_PAUSE", libelle: "En pause" },
    ],
    groupe: "AGENT",
  },
  MAIL_RANGEMENT_GMAIL: {
    libelle: "Rangement d'office dans Gmail",
    aide: "Actif : ce que le tri range (notifications, plateformes, newsletters, promotions) est aussi marqué lu et rangé dans Gmail sous le libellé « CoverSwap/Rangé », hors de la boîte de réception. Réversible : « Remonter » le remet, et son expéditeur n'est plus jamais rangé. Inactif : le tri ne touche pas à Gmail.",
    nature: "choix",
    options: [
      { valeur: "ACTIF", libelle: "Actif" },
      { valeur: "INACTIF", libelle: "Inactif" },
    ],
    groupe: "AGENT",
  },
  MAIL_EXPEDITEUR: {
    libelle: "Adresse d'expédition des séquences",
    aide: "Adresse qui enverra les séquences le jour où elles seront activées (aujourd'hui la boîte Gmail connectée ; demain une adresse de votre domaine, avec un service d'envoi dédié). Vide : la boîte Gmail connectée.",
    nature: "texte",
    groupe: "AGENT",
  },
  IA_MODELE: {
    libelle: "Modèle d'IA",
    aide: "Identifiant exact du modèle chez Anthropic (page « Models » de la documentation Anthropic). En changer impose de saisir ses prix à la même date.",
    nature: "texte",
    groupe: "AGENT",
  },
  IA_PRIX_ENTREE: {
    libelle: "Prix du modèle : texte lu, par million de jetons",
    aide: "En euros, d'après la page « Pricing » d'Anthropic pour ce modèle (colonne « Input », convertie du dollar). Sert à chiffrer chaque analyse.",
    nature: "euros",
    groupe: "AGENT",
  },
  IA_PRIX_SORTIE: {
    libelle: "Prix du modèle : texte écrit, par million de jetons",
    aide: "En euros, d'après la page « Pricing » d'Anthropic pour ce modèle (colonne « Output », convertie du dollar).",
    nature: "euros",
    groupe: "AGENT",
  },
  IA_BUDGET_MENSUEL: {
    libelle: "Budget mensuel de l'IA",
    aide: "Plafond en euros par mois civil, pour tout ce que fait l'IA (lecture des mails, brouillons, guide de style). Une fois atteint, elle s'arrête jusqu'au mois suivant ; le tri de la boîte, lui, continue (il n'utilise pas l'IA).",
    nature: "euros",
    groupe: "AGENT",
  },
  CAMPAGNE_DEBUT: {
    libelle: "Début de la campagne en cours",
    aide: "Jour du lancement de la campagne Meta en cours, au format AAAA-MM-JJ. L'assistant en déduit le jour de campagne (« jour 3 sur 21 ») et la règle du protocole qui s'applique (consignes de l'assistant).",
    nature: "texte",
    groupe: "PUBLICITE",
  },
  CAMPAGNE_BUDGET: {
    libelle: "Budget total de la campagne",
    aide: "En euros, pour toute la durée. Le CRM ne lit pas la dépense réelle chez Meta : la dépense est estimée au prorata des jours écoulés, et dite comme telle.",
    nature: "euros",
    groupe: "PUBLICITE",
  },
  CAMPAGNE_DUREE_JOURS: {
    libelle: "Durée de la campagne",
    aide: "En jours (21 pour le protocole habituel).",
    nature: "jours",
    groupe: "PUBLICITE",
  },
  SIMULATEUR_CREDIT_OPENAI: {
    libelle: "Crédit OpenAI (solde relevé)",
    aide: "Le solde affiché sur platform.openai.com → Billing, en dollars, daté du jour où vous le relevez (après chaque recharge). Le CRM en retire les générations faites depuis cette date pour estimer le solde restant, et vous prévient sous 2 $.",
    nature: "dollars",
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_ESPACE_GRATUITES: {
    libelle: "Simulations offertes à chaque client (espace client)",
    aide: "Nombre de simulations qu'un client peut créer lui-même dans son espace (chacune coûte environ 0,21 à 0,34 $ de crédit OpenAI). Sans valeur saisie : 5. Les simulations qu'il a faites sur coverswap.fr avant de recevoir son lien comptent aussi. Au-delà, il vous en demande d'autres, que vous accordez depuis Espaces clients.",
    nature: "choix",
    options: [
      { valeur: "0", libelle: "0 (simulateur fermé)" },
      { valeur: "1", libelle: "1" },
      { valeur: "2", libelle: "2" },
      { valeur: "3", libelle: "3" },
      { valeur: "4", libelle: "4" },
      { valeur: "5", libelle: "5" },
      { valeur: "6", libelle: "6" },
      { valeur: "8", libelle: "8" },
      { valeur: "10", libelle: "10" },
    ],
    groupe: "SIMULATEUR",
  },
} as const satisfies Record<string, DefinitionParametre>;

export type CleParametre = keyof typeof DEFINITIONS_PARAMETRES;
export const CLES_PARAMETRES = Object.keys(DEFINITIONS_PARAMETRES) as CleParametre[];

export type ValeurParametre = number | string;

export type ParametreVue = {
  cle: CleParametre;
  libelle: string;
  aide: string;
  nature: NatureParametre;
  options: readonly { valeur: string; libelle: string }[];
  groupe: GroupeParametre;
  /** Valeur en vigueur aujourd'hui, ou null si jamais saisie. */
  courante: { valeur: ValeurParametre; valableDu: string; source: string | null } | null;
  /** Valeurs futures déjà saisies et anciennes valeurs, de la plus récente à la plus ancienne. */
  historique: { id: string; valeur: ValeurParametre; valableDu: string; source: string | null; saisiLe: string; saisiPar: string | null }[];
};

export function formaterValeurParametre(cle: CleParametre, valeur: ValeurParametre): string {
  const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
  switch (definition.nature) {
    case "euros":
      return `${Number(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
    case "dollars":
      return `${Number(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} $`;
    case "pourcentage":
      return `${Number(valeur).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`;
    case "jours":
      return `${valeur} jour${Number(valeur) > 1 ? "s" : ""}`;
    case "mois":
      return `${valeur} mois`;
    case "choix":
      return definition.options?.find((option) => option.valeur === valeur)?.libelle ?? String(valeur);
    default:
      return String(valeur);
  }
}
