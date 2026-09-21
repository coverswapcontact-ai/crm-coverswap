import { calculerMontants, formatCentimes } from "@/lib/dossiers/montants";
import type { LigneDocument } from "@/lib/dossiers/constants";

/**
 * Conditions de règlement d'un devis — une seule source pour le PDF et pour
 * l'espace client : ce que le client lit sur son téléphone est mot pour mot ce
 * qui est imprimé sur le devis.
 */
export const MODES_REGLEMENT = "Paiement par virement – chèque ou espèces";
export const VALIDITE_DEVIS_JOURS = 30;

export function conditionsDuDevis(lignes: LigneDocument[], acomptePct: number | null): string[] {
  const { totalTtcCentimes, acompteCentimes, soldeCentimes } = calculerMontants(lignes, acomptePct);
  const reglement =
    acompteCentimes > 0
      ? [
          `Acompte de ${acomptePct}% à la signature du devis, soit ${formatCentimes(acompteCentimes)} TTC`,
          ...(soldeCentimes > 0 ? [`Solde de ${formatCentimes(soldeCentimes)} TTC à régler à la réception des travaux`] : []),
        ]
      : [`Montant de ${formatCentimes(totalTtcCentimes)} TTC à régler à la réception des travaux`];
  return [...reglement, MODES_REGLEMENT, `Devis valable ${VALIDITE_DEVIS_JOURS} jours à compter de la date d'émission`];
}
