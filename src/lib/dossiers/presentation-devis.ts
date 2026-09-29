import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { devisRenduVisible, STATUTS_DEVIS_ENVOYE } from "./devis-envoye";
import { ErreurMetier } from "./erreurs";
import { recalculerMain } from "./main";
import type { ChangementEtape } from "./transitions";

/* ── Mission 11 : plusieurs devis par dossier — la présentation d'un devis émis (sorti de documents.ts, mission 14) ── */

export const schemaPresentationDevis = z
  .object({
    visibleEspace: z.boolean("Visibilité invalide.").optional(),
    libelleVariante: z.string("Libellé invalide.").trim().max(80, "Libellé trop long : 80 caractères maximum.").nullable().optional(),
  })
  .refine((entree) => entree.visibleEspace !== undefined || entree.libelleVariante !== undefined, { message: "Rien à modifier." });

export type PresentationDevis = {
  id: string;
  numero: string;
  libelleVariante: string | null;
  visibleEspace: boolean;
  /** Mission 14 (R1) : rendu visible, le devis a fait passer le dossier en « Devis envoyé » (null sinon). */
  passage: ChangementEtape | null;
};

/**
 * Libellé de variante et visibilité dans l'espace d'un devis émis (généré ou repris) : la présentation, jamais le contenu.
 * Mission 14 (R1) : rendu visible, un devis émis ou envoyé vaut envoi (le dossier passe en « Devis envoyé » depuis
 * Qualification, Simulation ou Relance, la main au client) ; masqué, il ne recule pas l'étape, mais la main est relue
 * (un devis que le client ne voit plus n'attend plus sa réponse).
 */
export async function modifierPresentationDevis(dossierId: string, documentId: string, entree: z.output<typeof schemaPresentationDevis>): Promise<PresentationDevis> {
  const devis = await prisma.document.findFirst({ where: { id: documentId, dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } } });
  if (!devis?.numero) throw new ErreurMetier("Devis introuvable dans ce dossier.", 404);
  const maj = await prisma.document.update({
    where: { id: devis.id },
    data: { ...(entree.visibleEspace !== undefined ? { visibleEspace: entree.visibleEspace } : {}), ...(entree.libelleVariante !== undefined ? { libelleVariante: entree.libelleVariante || null } : {}) },
  });
  const changements = [
    entree.visibleEspace !== undefined && entree.visibleEspace !== devis.visibleEspace ? (entree.visibleEspace ? "visible dans l'espace client" : "masqué dans l'espace client") : null,
    entree.libelleVariante !== undefined && (entree.libelleVariante || null) !== devis.libelleVariante ? `libellé « ${entree.libelleVariante || "—"} »` : null,
  ].filter(Boolean);
  // Un devis masqué qui devient visible est envoyé au client : l'événement « Devis envoyé » lui passe la main,
  // et le dossier passe à « Devis envoyé » s'il n'y est pas encore.
  const devientVisible = entree.visibleEspace === true && !devis.visibleEspace && (STATUTS_DEVIS_ENVOYE as readonly string[]).includes(devis.statut);
  const devientMasque = entree.visibleEspace === false && devis.visibleEspace;
  if (changements.length) {
    await prisma.dossierEvenement.create({ data: { dossierId, type: devientVisible ? "DEVIS_ENVOYE" : "NOTE_AJOUTEE", direction: "INTERNE", contenu: `Devis ${devis.numero} : ${changements.join(", ")}`, metadata: JSON.stringify({ documentId: devis.id, presentation: true }) } });
  }
  const passage = devientVisible ? await devisRenduVisible(dossierId, devis.id, devis.numero) : null;
  if (devientMasque) await recalculerMain(dossierId);
  return { id: maj.id, numero: devis.numero, libelleVariante: maj.libelleVariante, visibleEspace: maj.visibleEspace, passage };
}
