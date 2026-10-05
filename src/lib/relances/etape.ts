import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { appliquerChangementEtape, effetsDuChangementEtape, type ChangementEtape } from "@/lib/dossiers/transitions";
import { resoudreContexte } from "@/lib/journal/acteur";

/**
 * Mission 14 (29/09/2026), partie 6 — une relance de devis faite, quel que soit son canal (le mail de relance parti,
 * le SMS de relance copié par Lucas) : LA même fonction fait passer le dossier de « Devis envoyé » à « Relance »
 * (nature AUTOMATIQUE), dans la transaction de l'appelant. Rien ne bouge à une autre étape.
 */
export async function passerEnRelance(tx: Transaction, dossierId: string, raison: string): Promise<ChangementEtape | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  return dossier?.etape === "DEVIS_ENVOYE" ? appliquerChangementEtape(tx, { dossierId, de: "DEVIS_ENVOYE", vers: "RELANCE", nature: "AUTOMATIQUE", raison }) : null;
}

/** La clé d'unicité du mail de relance d'un devis à un rang : une seule proposition par relance, jamais reproposée. */
export const cleRelance = (documentId: string, rang: number) => `${prefixeRelance(documentId)}${rang}`;
/** Le début commun des clés des mails de relance d'un devis, tous rangs confondus (mission 18, B6). */
export const prefixeRelance = (documentId: string) => `relance:${documentId}:`;

/** Le motif posé sur la proposition de mail annulée : la même relance est partie par SMS. */
export const MOTIF_RELANCE_FAITE_PAR_SMS = "Relance faite par SMS";

/**
 * Avant de noter la copie d'un SMS de relance de devis : si le mail du même rang est validé (il part) ou déjà parti,
 * la relance est faite — le SMS en ferait deux. Refus clair (409), rien n'est écrit.
 */
export async function verifierRelanceParSms(entree: { documentId: string; rang: number }): Promise<void> {
  const mail = await prisma.proposition.findUnique({ where: { cleUnicite: cleRelance(entree.documentId, entree.rang) }, select: { statut: true } });
  if (mail?.statut === "VALIDEE") throw new ErreurMetier(`Le mail de relance n° ${entree.rang} de ce devis est validé et part : la relance est faite, pas de SMS en plus.`, 409);
  if (mail?.statut === "EXECUTEE") throw new ErreurMetier(`Le mail de relance n° ${entree.rang} de ce devis est déjà parti : la relance est faite, pas de SMS en plus.`, 409);
}

/**
 * La copie d'un SMS de relance de devis (`sms/copie.ts`) : le dossier passe en « Relance » comme après le mail, et
 * le mail de relance du MÊME rang est annulé (« Relance faite par SMS ») s'il attend encore sa validation, ou s'il a
 * échoué (il ne pourra plus être réessayé) — jamais deux relances pour une. La relance, elle, se compte sur la trace
 * SMS_COPIE (`relances/service.ts`).
 */
export async function relanceDevisFaiteParSms(entree: { dossierId: string; documentId: string; rang: number }): Promise<{ changement: ChangementEtape | null; mailAnnule: string | null }> {
  const changement = await prisma.$transaction((tx) => passerEnRelance(tx, entree.dossierId, "relance envoyée par SMS"));
  if (changement) await effetsDuChangementEtape(changement);
  const mail = await prisma.proposition.findFirst({ where: { type: "ENVOI_MAIL", statut: { in: ["EN_ATTENTE", "ECHEC"] }, cleUnicite: cleRelance(entree.documentId, entree.rang) }, select: { id: true, statut: true } });
  if (mail) {
    // L'écriture d'`annulerProposition` (validation/service), étendue au mail en échec ; l'importer bouclerait :
    // validation/service → catalogue des propositions → mail/propositions → ce module.
    const { acteur } = await resoudreContexte();
    await prisma.proposition.updateMany({ where: { id: mail.id, statut: mail.statut }, data: { statut: "ANNULEE", decideLe: new Date(), decidePar: acteur, commentaireRejet: MOTIF_RELANCE_FAITE_PAR_SMS } });
  }
  return { changement, mailAnnule: mail?.id ?? null };
}
