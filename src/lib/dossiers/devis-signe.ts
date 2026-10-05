import type { Transaction } from "@/lib/prisma";
import { ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE } from "./constants";
import { changerEtapeDansTransaction, type ChangementEtape } from "./transitions";

/**
 * Mission 18 (B4, écart 4) — un devis noté « accepté » par Lucas (déposé « accepté », ou devis repris corrigé en
 * « accepté ») vaut signature, comme un bon pour accord donné dans l'espace : le dossier pas encore signé passe en
 * « Signé » DANS la transaction du geste (main et statut du lead compris), et les autres devis proposés passent
 * « non retenu » (il n'en signe qu'un, mission 11). Les effets d'après (Meta, agenda, tâches) partent après la
 * transaction, par l'appelant (`suitesEvenementDossier`).
 */

/**
 * Les étapes d'où un devis noté « accepté » fait signer le dossier (`ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE`, constants.ts) :
 * les étapes actives d'avant « Signé » (les mêmes que le contrôle `DEVIS_ACCEPTE_AVANT_SIGNE`). En pause ou perdu, rien
 * ne bouge : l'étape d'avant la sortie peut être plus loin que « Signé » (un avenant), et un dossier perdu se reprend
 * d'abord.
 */
export const estSigneeParDevisAccepte = (etape: string | null | undefined): boolean => (ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE as readonly string[]).includes(etape ?? "");

export type DevisNonRetenu = { id: string; numero: string | null; libelleVariante: string | null };

/**
 * Il n'en signe qu'un : les autres devis proposés du dossier (émis ou envoyés, non archivés) passent « non retenu »
 * (gardés en historique ; un retour avant « Signé » les rend de nouveau au choix, transitions.ts). Dans la transaction
 * de l'appelant ; rend ceux qui ont changé.
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

/**
 * Le devis `devisId` (déjà « accepté » ou à l'accepter) signe le dossier, s'il est à une étape d'avant « Signé »
 * (`ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE`) : les autres devis « non retenus », puis le passage en « Signé » (bon pour
 * accord déclaré ; la raison nomme les devis écartés). Rend null si l'étape ne s'y prête pas (rien n'est écrit).
 * Dans la transaction de l'appelant.
 */
export async function signerParDevisAccepte(tx: Transaction, dossierId: string, devisId: string, raison: string): Promise<{ changement: ChangementEtape; nonRetenus: DevisNonRetenu[] } | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier || !estSigneeParDevisAccepte(dossier.etape)) return null;
  const nonRetenus = await retenirDevis(tx, dossierId, devisId);
  const suite = nonRetenus.length ? ` ; non retenu${nonRetenus.length > 1 ? "s" : ""} : ${libelleNonRetenus(nonRetenus)}` : "";
  const changement = await changerEtapeDansTransaction(tx, dossierId, { vers: "SIGNE", devisAccepteId: devisId, confirmations: { BON_POUR_ACCORD: true }, raison: `${raison}${suite}` });
  return { changement, nonRetenus };
}
