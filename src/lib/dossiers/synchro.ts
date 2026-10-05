import prisma, { type Transaction } from "@/lib/prisma";
import { synchroniserRappel } from "@/lib/agenda/rappels";
import { signalerChangementTaches } from "@/lib/a-faire/signal";
import { PROCHAINE_ACTION_APRES_DEVIS, PROCHAINE_ACTION_ENVOYER_DEVIS, PROCHAINE_ACTION_PREPARER_DEVIS } from "./constants";
import { dateDepuisJour, jourParis } from "./dates";
import { ecrireMain, type MainCalculee } from "./main";
import { ecrireProchaineActionAuto, type IssueProchaineAction, type ProchaineActionAuto } from "./prochaine-action-auto";
import { effetsDuChangementEtape, type ChangementEtape } from "./transitions";

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
 * restent tels quels : ce sont des actions manuelles.
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
  /** Bon pour accord donné dans l'espace (service.ts › accepterDevis). */
  | { type: "DEVIS_ACCEPTE"; documentId: string }
  /** Bon pour accord retiré (validations.ts › retirerAccord). */
  | { type: "ACCORD_RETIRE"; auteur: "CLIENT" | "LUCAS" }
  /** Simulations publiées dans l'espace (simulations/dossier.ts › publierSimulations). */
  | { type: "SIMULATION_PUBLIEE"; simulationIds: string[] }
  /** Devis généré par le CRM (documents.ts › emettre) ; `envoye` : annoncé au client (mission 18, B1 : générer n'est pas envoyer). */
  | { type: "DEVIS_GENERE"; documentId: string; envoye: boolean }
  /** Devis émis ailleurs, déposé (documents-existants.ts › rattacherDocumentExistant). */
  | { type: "DEVIS_DEPOSE"; documentId: string }
  /** Chèque d'acompte rejeté (encaissements/service.ts › rejeterEncaissement, terminerEncaissement). */
  | { type: "ACOMPTE_REJETE"; encaissementId: string };

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
  "DEVIS_GENERE",
  "DEVIS_DEPOSE",
  "ACOMPTE_REJETE",
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

/** « Préparer le devis… » (posé par l'espace quand le client a choisi), ou « Envoyer le devis au client » (B1). */
const devisAPreparerOuAEnvoyer = (actuelle: string | null) => Boolean(actuelle?.startsWith(PROCHAINE_ACTION_PREPARER_DEVIS) || actuelle?.startsWith(PROCHAINE_ACTION_ENVOYER_DEVIS));

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
    case "DEVIS_ACCEPTE":
      return { code: "accord", texte: "Appeler le client : fixer la date du chantier, suivre l'acompte", date: maintenant, niveau: 1 };
    case "ACCORD_RETIRE":
      return { code: "accord-retire", texte: evenement.auteur === "CLIENT" ? "Appeler : il a retiré son bon pour accord" : "Refaire signer le devis", date: maintenant, niveau: 1 };
    case "SIMULATION_PUBLIEE":
      return { code: "simulation-publiee", texte: "Attendre le retour du client sur la simulation", date: null, niveau: 3 };
    // « Préparer le devis », posé par l'espace quand le client a choisi, est fait dès qu'un devis est émis ou déposé.
    // Mission 18 (B1) : émis sans être envoyé, il reste à l'envoyer ; la tâche ENVOYER_DEVIS (détecteur des dossiers)
    // le dit, même sous une action posée à la main : rien n'est rangé à sa place.
    case "DEVIS_GENERE":
      return evenement.envoye
        ? { code: "devis", texte: PROCHAINE_ACTION_APRES_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3 }
        : { code: "devis-a-envoyer", texte: PROCHAINE_ACTION_ENVOYER_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3, tache: false };
    case "DEVIS_DEPOSE":
      return { code: "devis", texte: PROCHAINE_ACTION_APRES_DEVIS, date: null, si: devisAPreparerOuAEnvoyer, niveau: 3 };
    case "ACOMPTE_REJETE":
      return { code: "acompte-rejete", texte: "Chèque d'acompte rejeté : réclamer un nouveau paiement", date: dateDepuisJour(jourParis(maintenant)), niveau: 1 };
  }
}

/**
 * Applique un événement au dossier dans la transaction de l'appelant (après ses propres écritures) : prochaine action
 * (ou tâche à la place d'une action posée à la main), puis la main. Rend les suites, à passer à `suitesEvenementDossier`
 * une fois la transaction terminée.
 */
export async function appliquerEvenementDossier(tx: Transaction, dossierId: string, evenement: EvenementDossier, maintenant: Date = new Date()): Promise<Suites> {
  const voulue = prochaineActionDe(evenement, maintenant);
  const prochaineAction = voulue ? await ecrireProchaineActionAuto(tx, dossierId, voulue, maintenant) : null;
  const main = await ecrireMain(tx, dossierId);
  return { dossierId, changements: [], prochaineAction, main };
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
