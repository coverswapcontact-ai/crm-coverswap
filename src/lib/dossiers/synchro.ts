import prisma, { type Transaction } from "@/lib/prisma";
import { synchroniserRappel } from "@/lib/agenda/rappels";
import { signalerChangementTaches } from "@/lib/a-faire/signal";
import { PROCHAINE_ACTION_APRES_DEVIS, PROCHAINE_ACTION_ENVOYER_DEVIS, PROCHAINE_ACTION_PREPARER_DEVIS, PROCHAINE_ACTION_REFAIRE_DEVIS } from "./constants";
import { dateDepuisJour, jourParis } from "./dates";
import { ecrireMain, type MainCalculee } from "./main";
import { ecrireProchaineActionAuto, type IssueProchaineAction, type ProchaineActionAuto } from "./prochaine-action-auto";
import { ecrireStatutLead } from "./statut-lead";
import { appliquerChangementEtape, effetsDuChangementEtape, marquerSynchronise, type ChangementEtape } from "./transitions";

/**
 * Mission 18 (partie B) : le point d'entrée unique de ce qui arrive à un dossier (docs/SYNCHRO.md, la matrice).
 *
 * Un événement (geste du client dans son espace, geste de Lucas, fait automatique) passe par `appliquerEvenementDossier`
 * DANS la transaction de l'appelant, après les écritures propres au geste (photo, choix, document, accord…) :
 * - la prochaine action prévue par la matrice (`prochaineActionDe`), sauf si une action posée à la main est en place :
 *   elle n'est jamais écrasée, une tâche est rangée à la place (prochaine-action-auto.ts) ;
 * - la main, recalculée et écrite (main.ts › ecrireMain), en dernier : elle lit tout ce que la transaction a écrit.
 * Puis, APRÈS la transaction, `suitesEvenementDossier` : effets des changements d'étape (Meta, chantier terminé,
 * agenda), agenda si la prochaine action a changé, signal des tâches. Jamais bloquant.
 *
 * Livraison progressive (B0) : le module porte la prochaine action et la main ; l'étape, l'état de l'espace, les relances,
 * l'historique et le statut du lead y passeront événement par événement (écarts 1 à 13). Les changements d'étape
 * demandés (`changerEtapeDansTransaction`) écrivent déjà la main et le statut du lead dans leur transaction.
 * Les gestes de Lucas qui posent eux-mêmes la prochaine action (appel noté, rappel, planifier, modifier le dossier)
 * restent tels quels : ce sont des actions manuelles. Mission 18 (relecture) : un « Rappeler… » daté pour aujourd'hui ou
 * plus tard (appel noté, rappel repris du lead) est gardé comme une action posée à la main, une tâche à la place
 * (prochaine-action-auto.ts › estRappelAVenir) : ni le texte ni l'agenda ne bougent.
 *
 * SQLite n'a qu'un écrivain : dans la transaction, rien ne lit ni n'écrit par le client global.
 */

export type EvenementDossier =
  /** Le client dépose des photos dans son espace (espace/service.ts › deposerPhotos). */
  | { type: "PHOTOS_RECUES" }
  /** Projet validé, par le client ou par Lucas à sa place (espace/validations.ts › validerProjet). */
  | { type: "PROJET_VALIDE" }
  /** Projet dévalidé (validations.ts › devaliderProjet). */
  | { type: "PROJET_DEVALIDE" }
  /** Simulation (ou mélange de teintes) validée (espace/service.ts › choisir). */
  | { type: "CHOIX_VALIDE" }
  /** Simulation dévalidée (validations.ts › devaliderChoix). */
  | { type: "CHOIX_DEVALIDE" }
  /** « Proposez-moi autre chose » (service.ts › demanderProposition). */
  | { type: "PROPOSITION_DEMANDEE"; commentaire?: string | null }
  /** Demande d'autre proposition retirée (validations.ts › retirerDemandeProposition) ; `choixValide` : une simulation reste validée. */
  | { type: "PROPOSITION_RETIREE"; choixValide: boolean }
  /**
   * Bon pour accord donné dans l'espace (service.ts › accepterDevis) ; ou, mission 18 (B4), devis noté « accepté » par
   * Lucas qui signe le dossier (documents-existants.ts : déposé « accepté », ou devis repris corrigé en « accepté »).
   */
  | { type: "DEVIS_ACCEPTE"; documentId: string; avenant?: { numero: string | null } }
  /**
   * Bon pour accord retiré (validations.ts › retirerAccord). Mission 18 (B7) : `avenant`, l'accord d'un avenant (le devis
   * signé d'origine tient toujours, le dossier ne recule pas).
   */
  | { type: "ACCORD_RETIRE"; auteur: "CLIENT" | "LUCAS"; avenant?: boolean }
  /**
   * Simulations publiées dans l'espace (simulations/dossier.ts › publierSimulations ; mission 18, B9 : aussi « Publier »
   * depuis le bloc Espace, `changerStatutSimulation(…, "afficher")`).
   */
  | { type: "SIMULATION_PUBLIEE"; simulationIds: string[] }
  /**
   * Mission 18 (B9) : une simulation faite par le client lui-même, visible dans son espace : créée dans son espace
   * (simulateur/preparation.ts › publierSimulationDuClient, `ESPACE`) ou faite sur coverswap.fr et rangée dans son espace
   * (simulations/dossier.ts › synchroniserSimulationsSite, `SITE`).
   */
  | { type: "SIMULATION_DU_CLIENT"; simulationIds: string[]; origine: "ESPACE" | "SITE" }
  /** Devis généré par le CRM (documents.ts › emettre) ; `envoye` : annoncé au client (mission 18, B1 : générer n'est pas envoyer). */
  | { type: "DEVIS_GENERE"; documentId: string; envoye: boolean }
  /**
   * Devis émis ailleurs, déposé (documents-existants.ts › rattacherDocumentExistant). `accepte` : déposé « accepté »
   * sur un dossier déjà signé (ou en pause, perdu) — il n'attend l'accord de personne (B4 ; avant « Signé », c'est
   * `DEVIS_ACCEPTE`).
   */
  | { type: "DEVIS_DEPOSE"; documentId: string; accepte?: boolean }
  /**
   * Devis envoyé après sa génération : par le mail du CRM (mail/propositions.ts, mission 18, B2) ; ou depuis Gmail, hors
   * du CRM, enregistré après coup (devis-gmail.ts › enregistrerDevisGmail, mission 18, B3) ; ou mis en ligne, masqué
   * rendu visible dans l'espace (devis-envoye.ts › mettreEnLigneDevis, mission 18, B5).
   */
  | { type: "DEVIS_ENVOYE"; documentId: string; canal: "MAIL" | "GMAIL" | "ESPACE" }
  /**
   * Devis annulé (documents.ts › annulerDevis) ou masqué dans l'espace (presentation-devis.ts), par devis-retire.ts ›
   * retirerDevis (mission 18, B6). `retour` : le dossier est revenu avant « Devis envoyé » dans la même transaction (plus
   * aucun devis n'attend la réponse du client) ; `refaire` : il n'y a plus de devis à proposer, « Refaire le devis ».
   */
  | { type: "DEVIS_RETIRE"; documentId: string; geste: "ANNULE" | "MASQUE"; retour: boolean; refaire: boolean }
  /** Chèque d'acompte rejeté (encaissements/service.ts › rejeterEncaissement, terminerEncaissement). */
  | { type: "ACOMPTE_REJETE"; encaissementId: string }
  /**
   * Mission 18 (B10) : un paiement reçu (encaissements/service.ts › enregistrerEncaissement : saisi à l'écran ou par
   * l'assistant, ou payé en ligne par carte, webhook Stripe). `signe` : l'acompte a fait passer le dossier en « Signé »
   * dans la même transaction (un paiement reçu vaut accord).
   */
  | { type: "PAIEMENT_RECU"; encaissementId: string; signe: boolean }
  /**
   * Mission 18 (B13) : une correction du contrôle de cohérence (coherence/controle.ts › appliquerCorrection) qui touche
   * à la phase du devis ou du chantier : retour d'avant « Devis envoyé » sans devis actif (`DEVIS_ENVOYE_SANS_DEVIS_ACTIF`)
   * ou sans devis parti (`DEVIS_ENVOYE_SANS_ENVOI`), « Attendre l'accord » sans devis (`ATTENTE_ACCORD_SANS_DEVIS`),
   * date du chantier posée en « Signé » (`DATE_CHANTIER_EN_SIGNE`).
   */
  | { type: "CORRECTION_COHERENCE"; code: CodeCorrectionSynchro };

/** Mission 18 (B13) : les corrections de cohérence qui passent par le point d'entrée (leur prochaine action). */
export type CodeCorrectionSynchro = "DEVIS_ENVOYE_SANS_DEVIS_ACTIF" | "DEVIS_ENVOYE_SANS_ENVOI" | "ATTENTE_ACCORD_SANS_DEVIS" | "DATE_CHANTIER_EN_SIGNE";

/** Le texte d'une prochaine action de dossier signé qui demande de fixer la date du chantier (accord, acompte reçu). */
export const DIT_DE_FIXER_LA_DATE = /fixer la date du chantier/i;

export type TypeEvenementDossier = EvenementDossier["type"];

/** Tous les événements du point d'entrée : chacun a sa ligne dans docs/SYNCHRO.md (un essai le vérifie). */
export const TYPES_EVENEMENT_DOSSIER = [
  "PHOTOS_RECUES",
  "PROJET_VALIDE",
  "PROJET_DEVALIDE",
  "CHOIX_VALIDE",
  "CHOIX_DEVALIDE",
  "PROPOSITION_DEMANDEE",
  "PROPOSITION_RETIREE",
  "DEVIS_ACCEPTE",
  "ACCORD_RETIRE",
  "SIMULATION_PUBLIEE",
  "SIMULATION_DU_CLIENT",
  "DEVIS_GENERE",
  "DEVIS_DEPOSE",
  "DEVIS_ENVOYE",
  "DEVIS_RETIRE",
  "ACOMPTE_REJETE",
  "PAIEMENT_RECU",
  "CORRECTION_COHERENCE",
] as const satisfies readonly TypeEvenementDossier[];

/** Ce qu'il reste à faire après la transaction, et ce qui a été écrit (pour les écrans, l'assistant et les essais). */
export type Suites = {
  dossierId: string;
  /** Changements d'étape écrits pendant l'événement : leurs effets partent après. */
  changements: ChangementEtape[];
  /** Ce qu'est devenue la prochaine action (null : l'événement n'en pose pas). */
  prochaineAction: IssueProchaineAction | null;
  /** La main écrite dans la transaction. */
  main: MainCalculee | null;
};

/** Mission 18 (B7) : la prochaine action d'un avenant signé dans l'espace (le dossier est déjà signé). */
export const texteAvenantSigne = (numero: string | null): string => `Avenant signé${numero ? ` (devis ${numero})` : ""} : le prévoir au chantier et sur la facture`;
/** Mission 18 (B7) : ce qu'un avenant ne remplace pas — fixer la date du chantier, réclamer un paiement (le devis d'origine). */
const nePasCouvrirLeChantier = (actuelle: string | null): boolean => !actuelle || !(DIT_DE_FIXER_LA_DATE.test(actuelle) || /réclamer un nouveau paiement/i.test(actuelle));

/** Mission 18 (B10) : la prochaine action d'un dossier signé par son acompte. */
export const PROCHAINE_ACTION_ACOMPTE_RECU = "Appeler le client : fixer la date du chantier (acompte reçu)";

/** « Préparer le devis… » (posé par l'espace quand le client a choisi), « Envoyer le devis au client » (B1) ou « Refaire le devis » (B6). */
const devisAPreparerOuAEnvoyer = (actuelle: string | null) =>
  Boolean(actuelle?.startsWith(PROCHAINE_ACTION_PREPARER_DEVIS) || actuelle?.startsWith(PROCHAINE_ACTION_ENVOYER_DEVIS) || actuelle?.startsWith(PROCHAINE_ACTION_REFAIRE_DEVIS));

/**
 * La prochaine action de chaque événement (la colonne « prochaine action » de docs/SYNCHRO.md). Les textes et les
 * conditions sont ceux d'avant la mission 18, à l'identique : des expressions régulières les relisent (« attendre les
 * photos », « préparer le devis (simulation », PROCHAINE_ACTION_PERIMEE, migrations 13 et 14).
 */
export function prochaineActionDe(evenement: EvenementDossier, maintenant: Date): ProchaineActionAuto | null {
  switch (evenement.type) {
    case "PHOTOS_RECUES":
      return { code: "photos", texte: "Préparer la simulation (photos reçues)", date: maintenant, si: (a) => !a || /attendre les photos/i.test(a) };
    case "PROJET_VALIDE":
      return { code: "projet-valide", texte: "Suivre ses simulations, ou lui en préparer une (projet validé)", date: maintenant, si: (a) => !a || /attendre (les photos|qu'il|le projet)/i.test(a) };
    case "PROJET_DEVALIDE":
      return { code: "projet-devalide", texte: "Attendre qu'il valide son projet (il le modifie)", date: null, si: (a) => Boolean(a && /\(projet validé\)/i.test(a)) };
    case "CHOIX_VALIDE":
      return { code: "choix", texte: "Préparer le devis (simulation choisie)", date: maintenant };
    case "CHOIX_DEVALIDE":
      return { code: "choix-devalide", texte: "Attendre qu'il valide une simulation (il a dévalidé la sienne)", date: null, si: (a) => Boolean(a && /préparer le devis \(simulation/i.test(a)) };
    case "PROPOSITION_DEMANDEE": {
      const mot = evenement.commentaire?.trim();
      return { code: "proposition", texte: `Préparer une autre proposition${mot ? ` — « ${mot.slice(0, 120)} »` : " (demande du client)"}`, date: maintenant };
    }
    case "PROPOSITION_RETIREE":
      return {
        code: "proposition-retiree",
        ...(evenement.choixValide ? { texte: "Préparer le devis (simulation choisie)", date: maintenant } : { texte: null, date: null }),
        si: (a) => Boolean(a && /autre proposition/i.test(a)),
      };
    // Mission 18 (B7) : un avenant signé (le dossier l'est déjà) ne remplace pas ce qui reste à faire pour le devis d'origine
    // (« fixer la date du chantier », un paiement à réclamer : la main et l'alerte disent l'avenant) ; une action posée à
    // la main reste, la tâche à côté.
    case "DEVIS_ACCEPTE":
      return evenement.avenant
        ? { code: "avenant-signe", texte: texteAvenantSigne(evenement.avenant.numero), date: maintenant, si: nePasCouvrirLeChantier, niveau: 2 }
        : { code: "accord", texte: "Appeler le client : fixer la date du chantier, suivre l'acompte", date: maintenant, niveau: 1 };
    case "ACCORD_RETIRE":
      if (evenement.avenant) return { code: "accord-retire", texte: evenement.auteur === "CLIENT" ? "Appeler : il a retiré son accord sur l'avenant" : "Refaire signer l'avenant", date: maintenant, si: nePasCouvrirLeChantier, niveau: 1 };
      return { code: "accord-retire", texte: evenement.auteur === "CLIENT" ? "Appeler : il a retiré son bon pour accord" : "Refaire signer le devis", date: maintenant, niveau: 1 };
    // Mission 18 (relecture) : les attentes du client (« Attendre … ») ne rangent pas de tâche à la place d'une action posée
    // à la main : rien à faire de mon côté, la main passe au client (`tache: false`).
    case "SIMULATION_PUBLIEE":
      return { code: "simulation-publiee", texte: "Attendre le retour du client sur la simulation", date: null, niveau: 3, tache: false };
    // Mission 18 (B9) : sa propre simulation ne pose pas de prochaine action (comme avant) : l'étape et la main suivent.
    case "SIMULATION_DU_CLIENT":
      return null;
    // « Préparer le devis », posé par l'espace quand le client a choisi, est fait dès qu'un devis est émis ou déposé.
    // Mission 18 (B1) : émis sans être envoyé, il reste à l'envoyer ; la tâche ENVOYER_DEVIS (détecteur des dossiers)
    // le dit, même sous une action posée à la main : rien n'est rangé à sa place.
    case "DEVIS_GENERE":
      return evenement.envoye
        ? { code: "devis", texte: PROCHAINE_ACTION_APRES_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3, tache: false }
        : { code: "devis-a-envoyer", texte: PROCHAINE_ACTION_ENVOYER_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3, tache: false };
    case "DEVIS_DEPOSE":
      // Mission 18 (B4) : un devis déposé « accepté » n'attend l'accord de personne.
      return evenement.accepte ? null : { code: "devis", texte: PROCHAINE_ACTION_APRES_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3, tache: false };
    // Mission 18 (B2, B3, B5) : envoyé par mail (CRM ou Gmail) ou mis en ligne, il l'est comme un devis annoncé (« Envoyer le devis au client » est fait).
    case "DEVIS_ENVOYE":
      return { code: "devis", texte: PROCHAINE_ACTION_APRES_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3, tache: false };
    // Mission 18 (B6) : le devis retiré (annulé, masqué) n'attend plus l'accord. Revenu avant « Devis envoyé », tout ce que
    // le système avait posé pour la phase du devis est dépassé : « Refaire le devis » (une action posée à la main reste,
    // avec la tâche à côté). Sans retour (étape Qualification ou Simulation), seulement à la place de « Attendre
    // l'accord » ou « Envoyer le devis » devenus sans objet.
    case "DEVIS_RETIRE":
      if (!evenement.refaire) return null;
      return evenement.retour
        ? { code: "devis-a-refaire", texte: PROCHAINE_ACTION_REFAIRE_DEVIS, date: maintenant }
        : { code: "devis-a-refaire", texte: PROCHAINE_ACTION_REFAIRE_DEVIS, date: maintenant, si: (a) => !a || a.startsWith(PROCHAINE_ACTION_APRES_DEVIS) || a.startsWith(PROCHAINE_ACTION_ENVOYER_DEVIS) };
    case "ACOMPTE_REJETE":
      return { code: "acompte-rejete", texte: "Chèque d'acompte rejeté : réclamer un nouveau paiement", date: dateDepuisJour(jourParis(maintenant)), niveau: 1 };
    // Mission 18 (B10) : l'acompte qui signe le dossier, c'est l'accord — « Attendre l'accord » est dépassé, la date du
    // chantier reste à fixer (une action posée à la main reste, une tâche à côté). Un autre paiement ne fait que clore
    // « réclamer un nouveau paiement » (chèque rejeté) : il est arrivé.
    case "PAIEMENT_RECU":
      return evenement.signe
        ? { code: "acompte-recu", texte: PROCHAINE_ACTION_ACOMPTE_RECU, date: maintenant, niveau: 1 }
        : { code: "paiement-recu", texte: null, date: null, si: (a) => Boolean(a && /réclamer un nouveau paiement/i.test(a)) };
    // Mission 18 (B13) : les corrections du contrôle de cohérence. Revenu avant « Devis envoyé », tout ce que le système
    // avait posé pour la phase du devis est dépassé (comme DEVIS_RETIRE) : « Refaire le devis » s'il n'y a plus de devis,
    // « Envoyer le devis au client » si le devis n'est jamais parti (une action posée à la main reste, une tâche à côté).
    // « Attendre l'accord » sans devis, et « fixer la date du chantier » une fois la date posée, s'effacent (rien à ranger
    // sous une action posée à la main : c'est elle qui compte).
    case "CORRECTION_COHERENCE":
      switch (evenement.code) {
        case "DEVIS_ENVOYE_SANS_DEVIS_ACTIF":
          return { code: "devis-a-refaire", texte: PROCHAINE_ACTION_REFAIRE_DEVIS, date: maintenant };
        case "DEVIS_ENVOYE_SANS_ENVOI":
          return { code: "devis-a-envoyer", texte: PROCHAINE_ACTION_ENVOYER_DEVIS, date: maintenant };
        case "ATTENTE_ACCORD_SANS_DEVIS":
          return { code: "attente-sans-devis", texte: null, date: null, si: (a) => Boolean(a?.startsWith(PROCHAINE_ACTION_APRES_DEVIS)), tache: false };
        case "DATE_CHANTIER_EN_SIGNE":
          return { code: "date-chantier", texte: null, date: null, si: (a) => Boolean(a && DIT_DE_FIXER_LA_DATE.test(a)), tache: false };
      }
  }
}

/**
 * Applique un événement au dossier dans la transaction de l'appelant (après ses propres écritures) : l'étape
 * (Qualification → Simulation, mission 18, B9), la prochaine action (ou tâche à la place d'une action posée à la main),
 * puis la main. Rend les suites, à passer à `suitesEvenementDossier`
 * une fois la transaction terminée.
 */
export async function appliquerEvenementDossier(tx: Transaction, dossierId: string, evenement: EvenementDossier, maintenant: Date = new Date()): Promise<Suites> {
  const raison = raisonDuPassageEnSimulation(evenement);
  const changement = raison ? await passerEnSimulation(tx, dossierId, raison) : null;
  const voulue = prochaineActionDe(evenement, maintenant);
  const prochaineAction = voulue ? await ecrireProchaineActionAuto(tx, dossierId, voulue, maintenant) : null;
  const main = await ecrireMain(tx, dossierId);
  return { dossierId, changements: changement ? [changement] : [], prochaineAction, main };
}

/** Raison écrite dans le passage en Simulation d'un projet validé : c'est elle qui permet de le défaire (espace/validations.ts). */
export const RAISON_PROJET_VALIDE = "projet validé dans l'espace client";

/**
 * Mission 18 (B9, écart 9) : les événements qui font passer un dossier de Qualification à Simulation, et la raison
 * écrite dans le changement d'étape. Une simulation est dans son espace (publiée par Lucas, faite par lui), il en a
 * validé une, ou il a validé son projet. Ailleurs qu'en Qualification, l'étape ne bouge pas.
 */
export function raisonDuPassageEnSimulation(evenement: EvenementDossier): string | null {
  switch (evenement.type) {
    case "SIMULATION_PUBLIEE":
      return evenement.simulationIds.length > 1 ? "simulations publiées dans son espace" : "simulation publiée dans son espace";
    case "SIMULATION_DU_CLIENT":
      return evenement.origine === "SITE" ? "simulation faite sur coverswap.fr, rangée dans son espace" : "simulation créée par le client dans son espace";
    case "CHOIX_VALIDE":
      return "simulation validée dans l'espace client";
    case "PROJET_VALIDE":
      return RAISON_PROJET_VALIDE;
    default:
      return null;
  }
}

/**
 * Qualification → Simulation dans la transaction de l'événement (changement AUTOMATIQUE, raison écrite), avec le statut
 * du lead ; la main est écrite ensuite par le point d'entrée. Rend le changement (marqué synchronisé : ses effets
 * d'après ne refont ni la main ni le lead), ou null si le dossier n'est pas en Qualification.
 */
async function passerEnSimulation(tx: Transaction, dossierId: string, raison: string): Promise<ChangementEtape | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (dossier?.etape !== "QUALIFICATION") return null;
  const changement = await appliquerChangementEtape(tx, { dossierId, de: "QUALIFICATION", vers: "SIMULATION", nature: "AUTOMATIQUE", raison });
  await ecrireStatutLead(tx, dossierId, "SIMULATION");
  return marquerSynchronise(changement);
}

/**
 * Après la transaction : effets des changements d'étape (Meta, chantier terminé, agenda), l'agenda si la prochaine
 * action a changé (un « Rappeler » daté remplacé), le signal des tâches. Jamais bloquant.
 */
export async function suitesEvenementDossier(suites: Suites): Promise<void> {
  try {
    for (const changement of suites.changements) await effetsDuChangementEtape(changement);
    if (suites.changements.length === 0 && suites.prochaineAction === "ECRITE") await synchroniserRappel({ type: "DOSSIER", id: suites.dossierId });
    await signalerChangementTaches();
  } catch (erreur) {
    console.error(`[synchro] suites de l'événement du dossier ${suites.dossierId} :`, erreur);
  }
}

/** Un événement seul, dans sa propre transaction, puis ses suites. */
export async function evenementDossier(dossierId: string, evenement: EvenementDossier, maintenant: Date = new Date()): Promise<Suites> {
  const suites = await prisma.$transaction((tx) => appliquerEvenementDossier(tx, dossierId, evenement, maintenant), { maxWait: 10_000, timeout: 30_000 });
  await suitesEvenementDossier(suites);
  return suites;
}
