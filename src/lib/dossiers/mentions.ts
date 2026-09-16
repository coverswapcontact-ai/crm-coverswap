import { exigerParametres } from "@/lib/parametres/service";
import { formaterValeurParametre } from "@/lib/parametres/definitions";
import type { TypeDocument } from "./constants";
import { formatDateCourte } from "./dates";

export type CategorieDestinataire = "PARTICULIER" | "PROFESSIONNEL" | "DONNEUR_ORDRE";

const JOUR_MS = 24 * 60 * 60_000;

export function estProfessionnel(categorie: string | null | undefined): boolean {
  return categorie === "PROFESSIONNEL" || categorie === "DONNEUR_ORDRE";
}

/**
 * Mentions légales d'un document, calculées à l'émission puis figées sur le
 * document : le PDF s'adapte tout seul au destinataire.
 *
 * - Facture à un professionnel (articles L. 441-9 et L. 441-10 du Code de
 *   commerce) : date d'échéance, taux des pénalités de retard, indemnité
 *   forfaitaire de recouvrement, conditions d'escompte. Les valeurs sont des
 *   paramètres datés : sans elles, pas de facture (saisie demandée).
 * - Facture à un particulier : paiement à réception.
 * - Avoir : la facture qu'il annule et le motif.
 * - Devis : ses conditions restent calculées par le gabarit (acompte, validité).
 */
export async function mentionsLegales(entree: {
  type: TypeDocument;
  categorie: CategorieDestinataire;
  dateEmission: Date;
  factureOrigine?: { numero: string; dateEmission: Date } | null;
  motifAvoir?: string | null;
}): Promise<{ mentions: string[] | null; echeanceLe: Date | null }> {
  if (entree.type === "DEVIS") return { mentions: null, echeanceLe: null };

  if (entree.type === "AVOIR") {
    const mentions = [];
    if (entree.factureOrigine) {
      mentions.push(`Avoir sur la facture n° ${entree.factureOrigine.numero} du ${formatDateCourte(entree.factureOrigine.dateEmission)}`);
    }
    if (entree.motifAvoir) mentions.push(`Motif : ${entree.motifAvoir}`);
    return { mentions, echeanceLe: null };
  }

  if (!estProfessionnel(entree.categorie)) {
    return { mentions: ["Paiement à réception de facture"], echeanceLe: null };
  }

  const valeurs = await exigerParametres(
    ["DELAI_PAIEMENT_PROFESSIONNELS", "TAUX_PENALITES_RETARD", "INDEMNITE_RECOUVREMENT", "ESCOMPTE_PAIEMENT_ANTICIPE"],
    entree.dateEmission
  );
  const echeanceLe = new Date(entree.dateEmission.getTime() + Number(valeurs.DELAI_PAIEMENT_PROFESSIONNELS) * JOUR_MS);
  return {
    echeanceLe,
    mentions: [
      `Date d'échéance : ${formatDateCourte(echeanceLe)}`,
      `En cas de retard de paiement, pénalités au taux annuel de ${formaterValeurParametre("TAUX_PENALITES_RETARD", valeurs.TAUX_PENALITES_RETARD)}`,
      `Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : ${formaterValeurParametre("INDEMNITE_RECOUVREMENT", valeurs.INDEMNITE_RECOUVREMENT)}`,
      `Escompte pour paiement anticipé : ${valeurs.ESCOMPTE_PAIEMENT_ANTICIPE}`,
    ],
  };
}
