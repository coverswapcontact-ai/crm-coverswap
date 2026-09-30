import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { signalerChangementTaches } from "@/lib/a-faire/signal";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { recalculerMain } from "@/lib/dossiers/main";
import { retenirContactEcrit } from "@/lib/prospects/contact-ecrit";
import { relanceDevisFaiteParSms, verifierRelanceParSms } from "@/lib/relances/etape";
import { CODES_SMS, estRelancePhotos, porteLienEspace, type CodeSms, type RelanceSms } from "./catalogue";
import { LONGUEUR_MAX_SMS } from "./envoi";

/**
 * Mission 14 (29/09/2026), partie 5 — copier vaut envoi. Lucas copie le SMS
 * proposé (modifié ou non) et le colle dans Messages : le CRM l'écrit dans
 * l'histoire du dossier (événement SMS_COPIE), ou du lead s'il n'a pas de
 * dossier (échange SMS), et ses effets suivent :
 *  - un SMS dont le texte porte le lien de l'espace (`porteLienEspace`, quel que
 *    soit son code) passe la main au client (dossiers/main.ts) et fait tomber
 *    « Lien pas encore envoyé » (espace/suivi.ts) : la même règle, lue sur le texte ;
 *  - une relance de devis garde `relance: { documentId, rang }` dans la trace,
 *    pour un devis que le client attend dans son espace (`devisARelancer`) :
 *    elle compte (2 au plus, mail et SMS confondus), passe le dossier de « Devis
 *    envoyé » à « Relance » comme le mail, et annule le mail de relance du même
 *    rang qui attendait ou avait échoué (partie 6) — refusée si ce mail est
 *    validé ou parti ; une relance photos garde `relance: { type: "PHOTOS",
 *    rang }` (partie 6) ;
 *  - un SMS copié répond au message du client qui attendait (règle R2).
 * Un double toucher ne trace qu'une fois : même cible, même code, même texte en
 * moins de 10 minutes rend la trace existante. Rien n'est envoyé par le CRM.
 */

export const CODE_LIBRE = "LIBRE";
const FENETRE_DOUBLON_MS = 10 * 60_000;

/** Une relance (de devis, ou photos) : la forme partagée par la copie et la proposition du SMS. */
export const schemaRelanceSms = z.union([
  z.object({ type: z.literal("PHOTOS"), rang: z.number().int().min(1).max(2) }),
  z.object({ documentId: z.string().min(1).max(40), rang: z.number().int().min(1).max(2) }),
]);

export const schemaCopie = z
  .object({
    code: z.enum([...CODES_SMS, CODE_LIBRE], "Code SMS inconnu."),
    texte: z.string("Le SMS est vide.").trim().min(1, "Le SMS est vide.").max(LONGUEUR_MAX_SMS, `SMS trop long (${LONGUEUR_MAX_SMS} caractères au plus).`),
    leadId: z.string().max(40).nullish(),
    dossierId: z.string().max(40).nullish(),
    relance: schemaRelanceSms.nullish(),
  })
  .refine((v) => v.leadId || v.dossierId, "Indique le contact ou le dossier concerné.");

export type OrigineCopie = "ECRAN" | "ASSISTANT";

export type EntreeCopie = {
  code: CodeSms | typeof CODE_LIBRE;
  texte: string;
  leadId?: string | null;
  dossierId?: string | null;
  relance?: RelanceSms | null;
  origine: OrigineCopie;
};

export type CopieNotee = {
  /** Où la copie est écrite : le dossier (événement SMS_COPIE) ou le lead sans dossier (échange SMS). */
  cible: "DOSSIER" | "CONTACT";
  dossierId: string | null;
  leadId: string | null;
  /** L'événement du dossier ou l'échange du lead. */
  id: string;
  /** Vrai si la même copie était déjà tracée (double toucher) : rien de plus n'est écrit. */
  deja: boolean;
  /** Le SMS porte le lien de l'espace : la main passe au client. */
  lien: boolean;
};

/**
 * Le devis d'une relance : un devis numéroté qui attend la réponse du client (GENERE ou ENVOYE), visible dans son
 * espace, non archivé — le filtre du circuit de relance par mail (`relances/service.ts`) —, et du dossier visé s'il
 * est donné. Sinon une erreur claire : la relance ne serait ni vraie (« il est toujours dans votre espace ») ni à
 * compter. `findUnique` n'est pas filtré par l'extension du journal : l'archivage se contrôle ici.
 */
export async function devisARelancer(documentId: string, dossierId?: string | null): Promise<{ id: string; dossierId: string }> {
  const devis = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true, dossierId: true, type: true, numero: true, statut: true, visibleEspace: true, archiveLe: true } });
  if (!devis || devis.type !== "DEVIS") throw new ErreurMetier("Devis introuvable.", 404);
  if (dossierId && devis.dossierId !== dossierId) throw new ErreurMetier("Ce devis n'est pas celui de ce dossier.", 409);
  if (devis.archiveLe) throw new ErreurMetier("Ce devis est archivé : rien à relancer.", 409);
  if (!devis.numero || !["GENERE", "ENVOYE"].includes(devis.statut)) throw new ErreurMetier("Ce devis n'attend pas de réponse du client : rien à relancer.", 409);
  if (!devis.visibleEspace) throw new ErreurMetier("Ce devis n'est pas visible dans son espace.", 409);
  return { id: devis.id, dossierId: devis.dossierId };
}

/** « SMS LIEN_ESPACE copié : « … » » ; un texte libre : « SMS copié : « … » ». */
export function contenuCopie(code: string, texte: string): string {
  return code === CODE_LIBRE ? `SMS copié : « ${texte} »` : `SMS ${code} copié : « ${texte} »`;
}

/** La cible : le dossier donné, sinon le dossier vivant du lead (le plus récent), sinon le lead. */
async function cibleDe(entree: { leadId?: string | null; dossierId?: string | null }): Promise<{ dossierId: string | null; leadId: string | null }> {
  if (entree.dossierId) {
    const dossier = await prisma.dossier.findUnique({ where: { id: entree.dossierId }, select: { id: true, leadId: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    return { dossierId: dossier.id, leadId: entree.leadId ?? dossier.leadId };
  }
  if (!entree.leadId) throw new ErreurMetier("Indique le contact ou le dossier concerné.", 400);
  const lead = await prisma.lead.findUnique({ where: { id: entree.leadId }, select: { id: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);
  return { dossierId: lead.dossiers[0]?.id ?? null, leadId: lead.id };
}

export async function noterSmsCopie(entree: EntreeCopie, maintenant: Date = new Date()): Promise<CopieNotee> {
  const texte = entree.texte.replace(/\r\n/g, "\n").trim();
  if (!texte) throw new ErreurMetier("Le SMS est vide.", 400);
  if (texte.length > LONGUEUR_MAX_SMS) throw new ErreurMetier(`SMS trop long (${LONGUEUR_MAX_SMS} caractères au plus).`, 400);
  const { dossierId, leadId } = await cibleDe(entree);
  // Une relance se compte sur le dossier du devis (ou de l'espace) : sans dossier, ou pour un autre dossier, elle est refusée.
  const relance = entree.relance ?? null;
  if (relance) {
    if (!dossierId) throw new ErreurMetier(`Une relance ${estRelancePhotos(relance) ? "photos" : "de devis"} se note sur son dossier : ce contact n'en a pas.`, 409);
    if (!estRelancePhotos(relance)) {
      await devisARelancer(relance.documentId, dossierId);
      // Le mail du même rang validé (il part) ou parti : la relance est faite, le SMS en ferait une seconde.
      await verifierRelanceParSms(relance);
    }
  }
  const contenu = contenuCopie(entree.code, texte);
  const depuis = new Date(maintenant.getTime() - FENETRE_DOUBLON_MS);
  const lien = porteLienEspace(texte);

  if (!dossierId) {
    const deja = await prisma.interaction.findFirst({ where: { leadId: leadId!, type: "SMS", contenu, createdAt: { gte: depuis } }, select: { id: true } });
    const id = deja?.id ?? (await prisma.interaction.create({ data: { leadId: leadId!, type: "SMS", contenu }, select: { id: true } })).id;
    // Mission 17 (partie A) : contacté par écrit — il sort d'« À appeler » pour « À rappeler », sans date.
    if (!deja) await retenirContactEcrit(leadId, maintenant);
    await signalerChangementTaches(); // Mission 17 (partie A) : les tâches de Lucas suivent ce geste.
    return { cible: "CONTACT", dossierId: null, leadId, id, deja: Boolean(deja), lien };
  }

  const deja = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "SMS_COPIE", contenu, createdAt: { gte: depuis } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (deja) return { cible: "DOSSIER", dossierId, leadId, id: deja.id, deja: true, lien };
  const trace = relance ? (estRelancePhotos(relance) ? { type: "PHOTOS", rang: relance.rang } : { documentId: relance.documentId, rang: relance.rang }) : null;
  const metadata = { code: entree.code, texte, canal: "SMS", origine: entree.origine, ...(trace ? { relance: trace } : {}) };
  const evenement = await prisma.dossierEvenement.create({ data: { dossierId, type: "SMS_COPIE", direction: "SORTANT", contenu, metadata: JSON.stringify(metadata) }, select: { id: true } });
  // Partie 6 : la relance de devis faite par SMS — le dossier passe en « Relance », le mail du même rang ne partira pas.
  if (relance && !estRelancePhotos(relance)) await relanceDevisFaiteParSms({ dossierId, documentId: relance.documentId, rang: relance.rang });
  // Mission 17 (partie A) : le lead du dossier est contacté par écrit (un lead du simulateur sort d'« À appeler »).
  await retenirContactEcrit(leadId, maintenant);
  // Un SMS avec le lien passe la main au client ; tout SMS copié répond au message du client qui attendait (R2).
  await recalculerMain(dossierId);
  return { cible: "DOSSIER", dossierId, leadId, id: evenement.id, deja: false, lien };
}
