import type { Transaction } from "@/lib/prisma";
import { resoudreContexte } from "@/lib/journal/acteur";
import { prefixeRelance } from "@/lib/relances/etape";
import { LIBELLES_ETAPE, type EtapeDossier } from "./constants";
import { ETAPES_DEVIS_MASQUE } from "./devis-envoye";
import { estEtape, lireMetadataChangementEtape } from "./regles";
import { ecrireStatutLead } from "./statut-lead";
import { appliquerEvenementDossier, type Suites } from "./synchro";
import { appliquerChangementEtape, marquerSynchronise, type ChangementEtape } from "./transitions";

/**
 * Mission 18 (B6, écart 6) : un devis annulé (documents.ts › annulerDevis) ou masqué dans l'espace
 * (presentation-devis.ts › modifierPresentationDevis), dans la transaction de l'appelant, qui a déjà écrit le statut
 * ou la visibilité et la trace du geste.
 *
 * S'il ne reste aucun autre devis qui attend la réponse du client (visible, émis, envoyé ou non retenu ; ni devis
 * accepté) et que le dossier est en « Devis envoyé » ou « Relance » :
 * - retour (nature RETOUR, pas de conversion Meta) à l'étape d'avant le devis : celle d'où le dossier était passé en
 *   « Devis envoyé » la dernière fois (Qualification ou Simulation), sinon Simulation s'il y a une simulation publiée
 *   ou choisie, sinon Qualification ; le statut du lead suit dans la transaction (CONTACTE) ;
 * - la main revient à Lucas, « Devis N annulé : refaire le devis » (le retour est marqué `devisRetire`, main.ts) ; la
 *   tâche DEVIS s'intitule « Refaire le devis » (détecteur des dossiers) ;
 * - la prochaine action devient « Refaire le devis » (une action posée à la main reste, avec la tâche à côté) ;
 * - les relances s'arrêtent d'elles-mêmes (l'étape quitte « Devis envoyé ») et les mails de relance en attente de
 *   validation (ou en échec) des devis du dossier sont annulés.
 * Sinon, seuls les mails de relance de CE devis sont annulés et la main est relue ; un devis annulé en Qualification ou
 * Simulation, sans autre devis en cours, remplace « Attendre l'accord » ou « Envoyer le devis » par « Refaire le devis ».
 * Les suites (agenda, tâches) partent après la transaction : `suitesEvenementDossier`.
 */

export type GesteRetrait = "ANNULE" | "MASQUE";

/** Les étapes d'où un devis retiré fait revenir le dossier (le client attendait ce devis). */
export const ETAPES_RETOUR_DEVIS: readonly EtapeDossier[] = ["DEVIS_ENVOYE", "RELANCE"];

/** Le motif posé sur les mails de relance annulés : le devis n'attend plus de réponse. */
export const MOTIF_RELANCE_DEVIS_RETIRE = "Devis annulé ou masqué : plus de relance";

export type RetraitDevis = Suites & {
  /** Le retour d'étape écrit (null : le dossier ne bouge pas). */
  retour: ChangementEtape | null;
  /** Nombre de mails de relance en attente annulés. */
  relancesAnnulees: number;
};

/** L'étape d'avant le devis (voir l'en-tête), lue dans la transaction. */
export async function etapeAvantLeDevis(tx: Transaction, dossierId: string): Promise<EtapeDossier> {
  const changements = await tx.dossierEvenement.findMany({
    where: { dossierId, type: "CHANGEMENT_ETAPE", archiveLe: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true },
  });
  const passage = changements.map((c) => lireMetadataChangementEtape(c.metadata)).find((m) => m?.vers === "DEVIS_ENVOYE");
  if (passage?.de && ETAPES_DEVIS_MASQUE.includes(passage.de)) return passage.de;
  const simulations = await tx.simulationEspace.count({ where: { dossierId, archiveLe: null, OR: [{ choisieLe: { not: null } }, { statut: "PUBLIEE" }] } });
  return simulations > 0 ? "SIMULATION" : "QUALIFICATION";
}

/** Le devis annulé ou masqué : retour d'étape, relances, prochaine action et main, dans la transaction de l'appelant. */
export async function retirerDevis(tx: Transaction, dossierId: string, devis: { id: string; numero: string }, geste: GesteRetrait, maintenant: Date = new Date()): Promise<RetraitDevis> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  const etape = dossier && estEtape(dossier.etape) ? dossier.etape : null;
  const autres = await tx.document.findMany({
    where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, id: { not: devis.id }, statut: { in: ["GENERE", "ENVOYE", "NON_RETENU", "ACCEPTE"] } },
    select: { id: true, statut: true, visibleEspace: true },
  });
  // Un devis non retenu redevient « Envoyé » au retour avant « Signé », un devis accepté « Généré » (transitions.ts) : ils
  // comptent comme en attente, sinon le retour les ferait revivre dans un dossier revenu avant le devis.
  const enAttente = autres.some((d) => d.statut === "ACCEPTE" || d.visibleEspace);
  let retour: ChangementEtape | null = null;
  if (etape && ETAPES_RETOUR_DEVIS.includes(etape) && !enAttente) {
    const vers = await etapeAvantLeDevis(tx, dossierId);
    const fait = geste === "ANNULE" ? "annulé" : "masqué dans son espace";
    retour = await appliquerChangementEtape(tx, {
      dossierId,
      de: etape,
      vers,
      nature: "RETOUR",
      documentId: devis.id,
      raison: `devis ${devis.numero} ${fait}, plus aucun devis n'attend sa réponse`,
      devisRetire: { numero: devis.numero, geste },
    });
    await ecrireStatutLead(tx, dossierId, vers);
    marquerSynchronise(retour);
  }

  // Les mails de relance en attente : ceux de ce devis ; revenu avant le devis, ceux de tous les devis du dossier.
  const ids = retour ? [devis.id, ...autres.map((d) => d.id)] : [devis.id];
  const relancesAnnulees = await annulerRelancesEnAttente(tx, ids, maintenant);

  // Plus rien à proposer : revenu avant le devis, ou devis annulé avant tout envoi sans autre devis en cours.
  const refaire = retour !== null || (geste === "ANNULE" && etape !== null && ETAPES_DEVIS_MASQUE.includes(etape) && !autres.some((d) => d.statut === "GENERE" || d.statut === "ENVOYE"));
  const suites = await appliquerEvenementDossier(tx, dossierId, { type: "DEVIS_RETIRE", documentId: devis.id, geste, retour: retour !== null, refaire }, maintenant);
  return { ...suites, changements: retour ? [retour] : [], retour, relancesAnnulees };
}

/**
 * Les mails de relance de ces devis en attente de validation (ou en échec) : annulés, « Devis annulé ou masqué : plus de
 * relance ». Dans la transaction de l'appelant ; rend leur nombre. Mission 18 (B13) : aussi au retour d'avant le devis
 * corrigé par le contrôle de cohérence.
 */
export async function annulerRelancesEnAttente(tx: Transaction, documentIds: readonly string[], maintenant: Date = new Date()): Promise<number> {
  if (documentIds.length === 0) return 0;
  const { acteur } = await resoudreContexte();
  const { count } = await tx.proposition.updateMany({
    where: { type: "ENVOI_MAIL", statut: { in: ["EN_ATTENTE", "ECHEC"] }, OR: documentIds.map((id) => ({ cleUnicite: { startsWith: prefixeRelance(id) } })) },
    data: { statut: "ANNULEE", decideLe: maintenant, decidePar: acteur, commentaireRejet: MOTIF_RELANCE_DEVIS_RETIRE },
  });
  return count;
}

/** La phrase du retrait, pour l'écran et l'assistant (null : le dossier ne bouge pas). */
export function phraseRetrait(retrait: { retour: ChangementEtape | null }): string | null {
  if (!retrait.retour) return null;
  return `Plus aucun devis n'attend sa réponse : le dossier revient à « ${LIBELLES_ETAPE[retrait.retour.vers]} », la main est à toi pour refaire le devis, les relances s'arrêtent.`;
}
