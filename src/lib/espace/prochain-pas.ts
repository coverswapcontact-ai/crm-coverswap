import type { EtatEspace } from "./service";

/**
 * Mission 18 (B7) : « la prochaine étape » de l'accueil d'un projet (une phrase, un bouton, l'onglet où il mène) et le
 * point rouge de la barre d'onglets, calculés par le CRM : le site ne fait qu'afficher (`EtatEspace.prochainPas`).
 * Repris à l'identique du calcul du site (`EspaceClient.tsx › prochainPas`), plus un cas : signé, un avenant (ou un
 * nouveau devis émis depuis) l'attend — c'est lui d'abord, l'onglet Devis. Fonction pure, testée telle quelle.
 */

export type VueProchainPas = "photos" | "projet" | "simulations" | "devis" | "paiement" | "apres";
export type ProchainPas = { phrase: string; bouton: string; vue: VueProchainPas };

type EtatPourLePas = Pick<EtatEspace, "etape" | "mots" | "familles" | "famillesSuggerees" | "simulations" | "creation" | "monProjet" | "projetValide" | "photos" | "devis" | "devisProposes" | "devisASigner" | "chantier" | "apres">;

/** Comme le site : « 1 250 € », « 1 250,50 € ». */
const euros = (montant: number) => montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: montant % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
/** Comme le site (« 12 octobre »), à l'heure de Paris : le serveur tourne en UTC. */
const dateCourte = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" });

export function prochainPas(etat: EtatPourLePas): ProchainPas {
  const mots = etat.mots;
  const sims = etat.simulations;
  const unePiece = etat.familles.length === 1 || (!etat.familles.length && etat.famillesSuggerees.length === 1);
  // Signé, et un avenant (ou un nouveau devis) à signer : c'est la chose à faire maintenant.
  if (etat.devis?.accepte && etat.devisASigner.length > 0) {
    const nouveaux = etat.devisASigner;
    return nouveaux.length > 1
      ? { phrase: `${nouveaux.length} nouveaux devis vous sont proposés : choisissez celui qui vous convient.`, bouton: "Voir les nouveaux devis", vue: "devis" }
      : { phrase: `Un nouveau devis vous est proposé : ${euros(nouveaux[0].total)}. Votre devis signé reste valable.`, bouton: "Voir le nouveau devis", vue: "devis" };
  }
  switch (etat.etape) {
    case "PHOTOS":
      return { phrase: unePiece ? `Envoyez-nous quelques photos ${mots.de} : c'est la première étape.` : "Envoyez-nous quelques photos de ce que vous voulez rénover : c'est la première étape.", bouton: "Envoyer mes photos", vue: "photos" };
    case "PROJET":
      // Il a déjà rempli son projet : il ne lui reste qu'à le valider.
      if (etat.monProjet && Object.keys(etat.monProjet.familles ?? {}).length > 0 && !etat.projetValide) return { phrase: "Votre projet est presque prêt : relisez-le et validez-le.", bouton: "Valider mon projet", vue: "projet" };
      return { phrase: etat.photos.length > 0 || sims.some((s) => s.source === "SITE") ? "Vos photos sont là : dites-nous ce que vous voulez rénover." : "Dites-nous ce que vous voulez rénover, en quelques gestes.", bouton: "Préciser mon projet", vue: "projet" };
    case "SIMULATIONS":
    case "ATTENTE_SIMULATION": {
      if (etat.creation.enCours.length > 0) return { phrase: "Votre simulation est en préparation : elle arrive dans une minute ou deux.", bouton: "Suivre ma simulation", vue: "simulations" };
      const nouvelles = sims.filter((s) => s.nouvelle && s.source === "CRM").length;
      if (nouvelles > 0) return { phrase: nouvelles > 1 ? "CoverSwap a préparé de nouvelles simulations pour vous." : "CoverSwap a préparé une nouvelle simulation pour vous.", bouton: nouvelles > 1 ? "Voir mes simulations" : "Voir ma simulation", vue: "simulations" };
      if (sims.length === 1) return { phrase: "Votre simulation vous attend.", bouton: "Voir ma simulation", vue: "simulations" };
      if (sims.length > 1) return { phrase: "Vos simulations vous attendent : validez celle qui vous plaît.", bouton: "Voir mes simulations", vue: "simulations" };
      return { phrase: unePiece ? `Tout est prêt : créez votre simulation, sur la photo ${mots.de}.` : "Tout est prêt : créez votre simulation, sur une de vos photos.", bouton: "Créer ma simulation", vue: "simulations" };
    }
    case "ATTENTE_DEVIS":
      return { phrase: "Simulation validée : CoverSwap prépare votre devis.", bouton: "Revoir ma simulation", vue: "simulations" };
    case "DEVIS":
      if (etat.devisProposes.length > 1 && !etat.devis?.accepte) return { phrase: `${etat.devisProposes.length} devis vous sont proposés : choisissez celui qui vous convient.`, bouton: "Voir mes devis", vue: "devis" };
      return { phrase: etat.devis ? `Votre devis est prêt : ${euros(etat.devis.total)}.` : "Votre devis est prêt.", bouton: "Voir mon devis", vue: "devis" };
    case "ACOMPTE":
      return { phrase: "C'est signé ! Il reste l'acompte, qui réserve votre date.", bouton: "Voir le paiement", vue: "paiement" };
    case "CHANTIER":
      return { phrase: etat.chantier?.date ? `Rendez-vous le ${dateCourte(etat.chantier.date)} : tout est prêt.` : "Votre acompte est bien reçu : CoverSwap vous appelle pour fixer la date du chantier.", bouton: "Préparer le chantier", vue: "paiement" };
    case "TERMINE":
      return { phrase: "Votre chantier est terminé. Merci de votre confiance !", bouton: etat.apres?.avis ? "Voir les photos" : "Voir les photos et donner mon avis", vue: "apres" };
  }
}
