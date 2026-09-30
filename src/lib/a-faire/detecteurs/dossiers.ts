import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur DOSSIERS — les tâches que l'étape et les faits d'un dossier vivant demandent.
 *
 * TODO (lot 2, docs/TACHES.md § 3 et § 5) : rendre, par dossier non archivé hors PERDU/ENCAISSE,
 * - SIMULATION « Préparer la simulation · Nom » (niveau 3, 10 min ; photos reçues, aucune simulation publiée ni brouillon) ;
 * - DEVIS « Faire le devis · Nom » (niveau 3, 10 min ; simulation choisie ou projet validé, aucun devis visible — `estDevisEnvoye`) ;
 * - DATE_CHANTIER « Fixer la date du chantier · Nom » (niveau 1 ; accord ou étape SIGNE sans `dateChantier`) ;
 * - ENCAISSER « Encaisser l'acompte · Nom » (niveau 1 ; SIGNE/PLANIFIE/CHANTIER sans Encaissement VALIDE, hors « sans acompte » motivé) ;
 * - RAPPELER « Rappeler · Nom » (niveau 2 ; `prochaineAction` /rappel|appeler/ datée au plus tard ce soir) ;
 * - REPONDRE par SMS reçu sans réponse (même clé que MAIL et ESPACE_MESSAGES : `REPONDRE:dossier:<id>`, voir `cleTache`) ;
 * - PROCHAINE_ACTION « (texte) · Nom » (niveau 2) le jour de sa date, pour un dossier dont l'action manuelle est en
 *   vigueur (`contexte.vigueur`) : c'est la seule tâche qui passe le filtre de vigueur (moteur.ts).
 * Montant = devis accepté − encaissé, sinon dernier devis visible, sinon `montantEstime` (comme `clients/fiches.ts`).
 * Ne pas émettre REPONDRE pour un mail ou un message d'espace : MAIL et ESPACE_MESSAGES le font (la fusion préfère une
 * source ≠ DOSSIERS). Le moteur coche lui-même par absence (achevement.ts) : ne rien écrire ici.
 */
export const detecteurDossiers: Detecteur = {
  source: "DOSSIERS",
  async detecter() {
    return [];
  },
};
