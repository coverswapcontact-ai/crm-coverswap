import type { Transaction } from "@/lib/prisma";

/**
 * Mission 18 (B4, B10) — il n'en signe qu'un (mission 11) : quand un devis est retenu (bon pour accord, devis noté
 * « accepté », acompte reçu sur ce devis, passage en « Signé » à l'écran ou par la cohérence), les autres devis proposés
 * du dossier passent « non retenu ». Une seule fonction pour tous ces chemins ; sans dépendance aux transitions (elles
 * l'appellent).
 */

export type DevisNonRetenu = { id: string; numero: string | null; libelleVariante: string | null };

/**
 * Les autres devis proposés du dossier (émis ou envoyés, non archivés) passent « non retenu » (gardés en historique ; un
 * retour avant « Signé » les rend de nouveau au choix, transitions.ts). Dans la transaction de l'appelant ; rend ceux
 * qui ont changé.
 */
export async function retenirDevis(tx: Transaction, dossierId: string, devisId: string): Promise<DevisNonRetenu[]> {
  const autres = await tx.document.findMany({
    where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, id: { not: devisId }, statut: { in: ["GENERE", "ENVOYE"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, numero: true, libelleVariante: true },
  });
  if (autres.length > 0) await tx.document.updateMany({ where: { id: { in: autres.map((a) => a.id) } }, data: { statut: "NON_RETENU" } });
  return autres;
}

/** « 2026-012 (façades), 2026-013 » : les devis non retenus, pour l'historique. */
export const libelleNonRetenus = (devis: readonly DevisNonRetenu[]): string => devis.map((d) => `${d.numero ?? "?"}${d.libelleVariante ? ` (${d.libelleVariante})` : ""}`).join(", ");

/** « non retenu : 2026-012 (façades) » (« non retenus : … » au pluriel), ou chaîne vide : la suite d'une raison. */
export const suiteNonRetenus = (devis: readonly DevisNonRetenu[]): string => (devis.length ? `non retenu${devis.length > 1 ? "s" : ""} : ${libelleNonRetenus(devis)}` : "");
