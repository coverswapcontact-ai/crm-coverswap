import type { Transaction } from "@/lib/prisma";
import type { EtapeDossier } from "./constants";

/**
 * Statut du lead B2C (écran /leads) qui reflète l'étape du dossier. EN_PAUSE ne change rien.
 * Mission 18 (B0) : écrit dans la transaction du changement d'étape (`changerEtapeDansTransaction`), et plus après.
 * La table complète et la règle « le dossier vivant le plus avancé décide » viennent en B12.
 */
export const STATUT_LEAD_PAR_ETAPE: Partial<Record<EtapeDossier, string>> = {
  QUALIFICATION: "CONTACTE",
  SIMULATION: "CONTACTE",
  DEVIS_ENVOYE: "DEVIS_ENVOYE",
  RELANCE: "DEVIS_ENVOYE",
  SIGNE: "SIGNE",
  PLANIFIE: "CHANTIER_PLANIFIE",
  CHANTIER: "CHANTIER_PLANIFIE",
  FACTURE: "TERMINE",
  ENCAISSE: "TERMINE",
  PERDU: "PERDU",
};

/** Le lead d'origine du dossier suit son étape, dans la transaction de l'appelant. Rend le statut écrit, sinon null. */
export async function ecrireStatutLead(tx: Transaction, dossierId: string, etape: EtapeDossier): Promise<string | null> {
  const statut = STATUT_LEAD_PAR_ETAPE[etape];
  if (!statut) return null;
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { lead: { select: { id: true, statut: true } } } });
  const lead = dossier?.lead;
  if (!lead || lead.statut === statut) return null;
  await tx.lead.update({ where: { id: lead.id }, data: { statut } });
  return statut;
}
