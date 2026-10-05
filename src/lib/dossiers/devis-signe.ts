import type { Transaction } from "@/lib/prisma";
import { signeParDevisAccepte } from "./constants";
import { libelleNonRetenus, retenirDevis, type DevisNonRetenu } from "./devis-retenu";
import { changerEtapeDansTransaction, chargerEtatEtape, type ChangementEtape } from "./transitions";

/**
 * Mission 18 (B4, écart 4) — un devis noté « accepté » par Lucas (déposé « accepté », ou devis repris corrigé en
 * « accepté ») vaut signature, comme un bon pour accord donné dans l'espace : le dossier pas encore signé passe en
 * « Signé » DANS la transaction du geste (main et statut du lead compris), et les autres devis proposés passent
 * « non retenu » (il n'en signe qu'un, mission 11). Les effets d'après (Meta, agenda, tâches) partent après la
 * transaction, par l'appelant (`suitesEvenementDossier`).
 */

/**
 * Les étapes d'où un devis noté « accepté » fait signer le dossier (`ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE`, constants.ts) :
 * les étapes actives d'avant « Signé » (les mêmes que le contrôle `DEVIS_ACCEPTE_AVANT_SIGNE`). Mission 18 (relecture) :
 * EN PAUSE depuis une de ces étapes aussi (le passage en « Signé » sort de la pause) ; en pause après la signature (un
 * avenant), rien ne bouge ; perdu non plus : il se reprend d'abord. Lu dans la transaction de l'appelant.
 */
export async function estSigneeParDevisAccepte(tx: Transaction, dossierId: string): Promise<boolean> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier) return false;
  if (dossier.etape !== "EN_PAUSE") return signeParDevisAccepte(dossier.etape);
  return signeParDevisAccepte(dossier.etape, (await chargerEtatEtape(tx, dossierId)).avantSortie);
}

// Mission 18 (B10) : « il n'en signe qu'un » vit dans devis-retenu.ts (les transitions s'en servent aussi) ; réexporté ici.
export { libelleNonRetenus, retenirDevis, type DevisNonRetenu } from "./devis-retenu";

/**
 * Le devis `devisId` (déjà « accepté » ou à l'accepter) signe le dossier, s'il est à une étape d'avant « Signé »
 * (`ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE`) : les autres devis « non retenus », puis le passage en « Signé » (bon pour
 * accord déclaré ; la raison nomme les devis écartés). Rend null si l'étape ne s'y prête pas (rien n'est écrit).
 * Dans la transaction de l'appelant.
 */
export async function signerParDevisAccepte(tx: Transaction, dossierId: string, devisId: string, raison: string): Promise<{ changement: ChangementEtape; nonRetenus: DevisNonRetenu[] } | null> {
  if (!(await estSigneeParDevisAccepte(tx, dossierId))) return null;
  const nonRetenus = await retenirDevis(tx, dossierId, devisId);
  const suite = nonRetenus.length ? ` ; non retenu${nonRetenus.length > 1 ? "s" : ""} : ${libelleNonRetenus(nonRetenus)}` : "";
  const changement = await changerEtapeDansTransaction(tx, dossierId, { vers: "SIGNE", devisAccepteId: devisId, confirmations: { BON_POUR_ACCORD: true }, raison: `${raison}${suite}` });
  return { changement, nonRetenus };
}
