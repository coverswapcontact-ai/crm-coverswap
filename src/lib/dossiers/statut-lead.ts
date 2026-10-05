import type { Transaction } from "@/lib/prisma";
import type { StatutLead } from "@/lib/prospects/constantes";
import { ETAPES_ACTIVES, type EtapeDossier } from "./constants";

/**
 * Statut du lead B2C (écran /leads) qui reflète l'étape d'un dossier. Mission 18 (B12, écart 12) : LA table, pour toutes
 * les étapes — celle des changements d'étape, des ouvertures et du contrôle de cohérence (`STATUT_DU_LEAD`). EN_PAUSE :
 * `null` explicite, la pause ne dit rien du contact (son statut ne bouge pas, un autre dossier vivant décide).
 */
export const STATUT_LEAD_PAR_ETAPE: Record<EtapeDossier, StatutLead | null> = {
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
  EN_PAUSE: null,
};

const rangActif = (etape: string) => (ETAPES_ACTIVES as readonly string[]).indexOf(etape);

/**
 * Mission 18 (B12) : « le dossier vivant le plus avancé décide ». Parmi les dossiers NON ARCHIVÉS du lead (à l'appelant
 * de les écarter), hors Perdu et En pause, le plus avancé dans le tunnel donne le statut ; à égalité, le premier de la
 * liste. Aucun vivant et tous perdus : PERDU (le premier perdu décide). Sinon (aucun dossier, ou seulement des dossiers
 * en pause, ou en pause et perdus) : null, le statut ne bouge pas.
 */
export function statutLeadSelonDossiers<D extends { etape: string }>(dossiers: readonly D[]): { statut: StatutLead; decideur: D } | null {
  let decideur: D | null = null;
  for (const dossier of dossiers) {
    if (rangActif(dossier.etape) < 0) continue;
    if (!decideur || rangActif(dossier.etape) > rangActif(decideur.etape)) decideur = dossier;
  }
  if (decideur) return { statut: STATUT_LEAD_PAR_ETAPE[decideur.etape as EtapeDossier]!, decideur };
  if (dossiers.length > 0 && dossiers.every((dossier) => dossier.etape === "PERDU")) return { statut: "PERDU", decideur: dossiers[0] };
  return null;
}

/**
 * Le statut que les dossiers du lead lui donnent, lu dans la transaction de l'appelant (null : inchangé).
 * `etapeDe` : l'étape d'un dossier qui vient de changer, si elle n'est pas encore écrite.
 */
export async function statutLeadAttendu(tx: Transaction, leadId: string, etapeDe?: { dossierId: string; etape: EtapeDossier }): Promise<StatutLead | null> {
  const dossiers = await tx.dossier.findMany({ where: { leadId, archiveLe: null }, select: { id: true, etape: true }, orderBy: { createdAt: "asc" } });
  const lus = etapeDe ? dossiers.map((dossier) => (dossier.id === etapeDe.dossierId ? { ...dossier, etape: etapeDe.etape } : dossier)) : dossiers;
  return statutLeadSelonDossiers(lus)?.statut ?? null;
}

/** Aligne le statut du lead sur ses dossiers (règle ci-dessus), dans la transaction de l'appelant. Rend le statut écrit, sinon null. */
export async function alignerStatutLead(tx: Transaction, leadId: string, etapeDe?: { dossierId: string; etape: EtapeDossier }): Promise<{ avant: string; statut: StatutLead } | null> {
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { statut: true } });
  if (!lead) return null;
  const statut = await statutLeadAttendu(tx, leadId, etapeDe);
  if (!statut || statut === lead.statut) return null;
  await tx.lead.update({ where: { id: leadId }, data: { statut } });
  return { avant: lead.statut, statut };
}

/**
 * Le lead d'origine du dossier suit son étape, dans la transaction de l'appelant — d'après TOUS ses dossiers vivants
 * (B12 : un second dossier en Qualification ne ramène pas un client signé à « Contacté »). Rend le statut écrit, sinon null.
 */
export async function ecrireStatutLead(tx: Transaction, dossierId: string, etape: EtapeDossier): Promise<string | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { leadId: true } });
  if (!dossier?.leadId) return null;
  return (await alignerStatutLead(tx, dossier.leadId, { dossierId, etape }))?.statut ?? null;
}
