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
  MESSAGERIE: "Messagerie et relances",
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
    aide: "Nombre de jours sans réponse après l'envoi d'un devis (ou la dernière relance) avant que le CRM propose de le relancer : le SMS à copier, et le mail à valider s'il a une adresse. Rien ne part tout seul ; deux relances au plus par devis. Sans valeur : 5 jours.",
    nature: "jours",
    groupe: "COMMERCIAL",
  },
  DELAI_RELANCE_PHOTOS: {
    libelle: "Délai avant de relancer un espace sans photo",
    aide: "Nombre de jours après l'ouverture de son espace (ou le dernier lien envoyé) sans aucune photo ni simulation avant que le CRM propose le SMS avec le lien de son espace, à copier. Rien ne part tout seul ; deux relances au plus par projet. Sans valeur : 3 jours.",
    nature: "jours",
    groupe: "COMMERCIAL",
  },
  // Mission 18 (A4) : la demande d'avis après chantier, un type de relance (relances/avis.ts).
  DELAI_RELANCE_AVIS: {
    libelle: "Délai avant de demander un avis après le chantier",
    aide: "Nombre de jours après la fin du chantier (le mail « projet terminé », sinon le passage en Facturé ou Encaissé) sans avis dans son espace avant que le CRM propose le SMS de demande d'avis, avec le lien de son espace, à copier. Rien ne part tout seul ; une seule demande par projet, plus rien après 60 jours. Sans valeur : 7 jours.",
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
  // Mission 17 (partie A) : la notification du matin des tâches (a-faire/matin.ts). Sans valeur saisie : Oui.
  NOTIF_TACHES_MATIN: {
    libelle: "Notification du matin : les tâches du jour",
    aide: "Chaque jour à partir de 8 h, une notification sur le téléphone (Telegram, ntfy, push) dit combien de tâches attendent aujourd'hui et le temps estimé ; rien quand il n'y en a aucune. Oui par défaut. Rien n'est jamais envoyé aux clients.",
    nature: "choix",
    options: [
      { valeur: "OUI", libelle: "Oui" },
      { valeur: "NON", libelle: "Non" },
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
  // Mission 25 : la messagerie et les relances préparées (src/lib/messagerie). Sans valeur saisie : Manuel, active.
  MESSAGERIE_MODE_ENVOI: {
    libelle: "Mode d'envoi des SMS",
    aide: "Manuel (aujourd'hui) : chaque message préparé t'attend ; tu l'envoies depuis ton téléphone (« Ouvrir Messages ») et tu confirmes « Envoyé ». Android (lot 8, pas encore branché) : seuls les messages réglés Auto partiront seuls, par le téléphone Android. Rien d'autre ne change : conversations, historique et réglages restent.",
    nature: "choix",
    options: [
      { valeur: "MANUEL", libelle: "Manuel" },
      { valeur: "ANDROID", libelle: "Android (lot 8, pas encore branché)" },
    ],
    groupe: "MESSAGERIE",
  },
  MESSAGERIE_PAUSE: {
    libelle: "Préparation des messages",
    aide: "Active (par défaut) : le CRM prépare les messages et les relances à l'heure prévue. En pause : « Tout mettre en pause » arrête toutes les préparations et tous les envois d'un coup ; le journal et « Où on en est » restent à jour.",
    nature: "choix",
    options: [
      { valeur: "ACTIVE", libelle: "Active" },
      { valeur: "EN_PAUSE", libelle: "En pause" },
    ],
    groupe: "MESSAGERIE",
  },
  MESSAGERIE_LANCEMENT: {
    libelle: "Mise en service de la messagerie",
    aide: "Posé au premier démarrage de la messagerie (instant au format ISO). Rien n'est préparé pour un fait plus ancien (devis mis en ligne, lead reçu avant) ; les dossiers ouverts avant ne donnent que des propositions pendant 14 jours, 8 par jour au plus. Il n'y a rien à saisir ici.",
    nature: "texte",
    groupe: "MESSAGERIE",
  },
  MESSAGERIE_LIEN_AVIS: {
    libelle: "Lien direct vers la fiche Google (avis)",
    aide: "Le lien qui ouvre la page « Donner un avis » de la fiche Google de CoverSwap (fiche Google → Demander des avis → copier le lien). Les demandes d'avis (C4, C5) le portent ; sans lien saisi, elles portent celui de l'espace du client (rubrique « Après le chantier »).",
    nature: "texte",
    groupe: "MESSAGERIE",
  },
  IA_MESSAGERIE: {
    libelle: "Analyse des messages et des notes par l'IA",
    aide: "Active : chaque réponse d'un client, chaque note et chaque relance à personnaliser passe par le modèle (Claude Haiku conseillé ; moins d'un centime par analyse), plafonné par le budget ci-dessous et par le budget mensuel. En pause, ou plafond atteint : la même analyse se fait par des règles fixes (le message validé tel quel). L'IA ne décide jamais de ce qui part.",
    nature: "choix",
    options: [
      { valeur: "ACTIVE", libelle: "Active" },
      { valeur: "EN_PAUSE", libelle: "En pause" },
    ],
    groupe: "AGENT",
  },
  IA_MESSAGERIE_BUDGET: {
    libelle: "Plafond mensuel de l'IA de la messagerie",
    aide: "En euros par mois civil, pour l'analyse des messages et des notes (10 € sans valeur saisie). Une alerte part à 80 % ; au plafond, la messagerie continue par les règles fixes jusqu'au mois suivant.",
    nature: "euros",
    groupe: "AGENT",
  },
  JOURNAL_VU_LE: {
    libelle: "Journal lu jusqu'à",
    aide: "Posé par le bouton « Tout vu » du journal « Depuis ta dernière visite » (interface v2) : l'instant, au format ISO, jusqu'auquel le journal a été lu. Le journal le repose à chaque « Tout vu » ; il n'y a rien à saisir ici.",
    nature: "texte",
    groupe: "PILOTAGE",
  },
  DERNIER_DOSSIER_OUVERT: {
    libelle: "Dernier dossier ouvert",
    aide: "Posé par l'interface v2 à chaque ouverture d'un dossier (bandeau « Reprendre » d'Aujourd'hui, 48 h) : l'identifiant du dossier et l'instant, séparés par une barre verticale. Il n'y a rien à saisir ici.",
    nature: "texte",
    groupe: "PILOTAGE",
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
    aide: "Nombre de simulations qu'un client peut créer lui-même dans son espace (chacune coûte environ 0,21 à 0,34 $ de crédit OpenAI). Sans valeur saisie : 5. Les simulations qu'il a faites sur coverswap.fr avant de recevoir son lien comptent aussi. Au-delà, il vous en demande d'autres, que vous accordez depuis le bloc Espace du dossier.",
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
  SIMULATEUR_MOTEUR: {
    libelle: "Moteur de prompt du simulateur",
    aide: "V1 : l'ancien prompt (échantillons bruts, sans analyse de la photo ni contrôle du rendu) — pour le site, celui qu'il envoie ; pour l'espace et le CRM, le « V1 revu » du CRM (même structure, textes des zones partagés avec le V2, quelques retouches de pose). V2 : le moteur « studio » de la mission 15 (analyse de la photo, planche d'échantillons étiquetés, direction artistique, contrôle automatique, seconde tentative sous le seuil). Sans valeur saisie : V1, jusqu'à la campagne du banc de comparaison.",
    nature: "choix",
    options: [
      { valeur: "V1", libelle: "V1 — ancien prompt" },
      { valeur: "V2", libelle: "V2 — moteur studio" },
    ],
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_PLANCHE: {
    libelle: "Planche d'échantillons étiquetés (moteur V2)",
    aide: "Oui (par défaut) : le modèle reçoit la photo et UNE planche où chaque échantillon porte sa lettre et sa zone (Image 2). Non : les échantillons bruts sont joints un par un (Images 2, 3…), comme avant.",
    nature: "choix",
    options: [
      { valeur: "OUI", libelle: "Oui" },
      { valeur: "NON", libelle: "Non" },
    ],
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_QUALITE_SITE: {
    libelle: "Qualité des rendus du site coverswap.fr",
    aide: "Qualité demandée au modèle d'image pour les visiteurs du site. Sans valeur saisie : medium (environ 0,21 $ par rendu à un échantillon). High coûte environ 1,7 fois plus ; low environ 0,4 fois (mesures de référence à confirmer par le banc).",
    nature: "choix",
    options: [
      { valeur: "low", libelle: "low" },
      { valeur: "medium", libelle: "medium" },
      { valeur: "high", libelle: "high" },
    ],
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_QUALITE_ESPACE: {
    libelle: "Qualité des rendus de l'espace client et du CRM",
    aide: "Qualité demandée au modèle d'image pour les simulations créées dans l'espace client et depuis le CRM (mode API). Sans valeur saisie : high (environ 1,7 fois le coût de medium).",
    nature: "choix",
    options: [
      { valeur: "low", libelle: "low" },
      { valeur: "medium", libelle: "medium" },
      { valeur: "high", libelle: "high" },
    ],
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_SEUIL_CONTROLE: {
    libelle: "Seuil du contrôle automatique des rendus (moteur V2)",
    aide: "Note sur 10 donnée par le contrôle automatique (le modèle compare la photo et le rendu). En dessous, une seconde génération est faite avec les défauts relevés dans la consigne, et la meilleure des deux est gardée ; une seconde génération coûte autant que la première. Sans valeur saisie : 7.",
    nature: "choix",
    options: [
      { valeur: "5", libelle: "5" },
      { valeur: "6", libelle: "6" },
      { valeur: "7", libelle: "7" },
      { valeur: "8", libelle: "8" },
      { valeur: "9", libelle: "9" },
    ],
    groupe: "SIMULATEUR",
  },
  SIMULATEUR_CORRECTION_TEINTES: {
    libelle: "Correction des teintes après le rendu",
    aide: "Oui : chaque rendu est recalé sur la teinte du catalogue, surface par surface, sous la lumière de la pièce (le grain du bois et les ombres restent) ; le rendu d'origine est gardé à côté. Une surface que le modèle a mal posée n'est pas retouchée et la simulation est marquée « à régénérer ». Non (par défaut) : le rendu est livré tel quel, sa fidélité est seulement mesurée.",
    nature: "choix",
    options: [
      { valeur: "NON", libelle: "Non" },
      { valeur: "OUI", libelle: "Oui" },
    ],
    groupe: "SIMULATEUR",
  },
  NOTIF_SIMULATION_SITE_PRETE: {
    libelle: "Mail « simulation prête » aux visiteurs du site (« Me prévenir »)",
    aide: "Sur coverswap.fr, un visiteur qui attend son rendu peut laisser son adresse pour être prévenu. Actif (par défaut) : UN mail part quand le rendu est prêt, avec l'image jointe et le lien pour le retrouver. Inactif : rien ne part (la demande reste notée sur le lead). Un numéro de téléphone seul ne déclenche jamais de SMS.",
    nature: "choix",
    options: [
      { valeur: "ACTIF", libelle: "Actif" },
      { valeur: "INACTIF", libelle: "Inactif" },
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
      // Mission 25 : un instant posé par le CRM (mise en service de la messagerie) se lit en date et heure de Paris.
      if (cle === "MESSAGERIE_LANCEMENT" && typeof valeur === "string" && !Number.isNaN(Date.parse(valeur))) {
        return new Date(valeur).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ");
      }
      return String(valeur);
  }
}
