import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { annoncerDevisEnLigne, mettreEnLigneDevis, STATUTS_DEVIS_ENVOYE, type AnnonceMiseEnLigne } from "./devis-envoye";
import { ErreurMetier } from "./erreurs";
import { recalculerMain } from "./main";
import { suitesEvenementDossier } from "./synchro";
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
  /** Mission 18 (B5) : rendu visible, le mail « Devis disponible » est-il parti (null : pas mis en ligne) ? */
  annonce: AnnonceMiseEnLigne | null;
};

/**
 * Libellé de variante et visibilité dans l'espace d'un devis émis (généré ou repris) : la présentation, jamais le contenu.
 * Mission 14 (R1) : rendu visible, un devis émis ou envoyé vaut envoi (le dossier passe en « Devis envoyé » depuis
 * Qualification, Simulation ou Relance, la main au client) ; masqué, il ne recule pas l'étape, mais la main est relue
 * (un devis que le client ne voit plus n'attend plus sa réponse).
 * Mission 18 (B5, écart 5) : la mise en ligne s'écrit d'un bloc (visibilité, événement « Devis envoyé » qui date la
 * relance, étape, prochaine action, main : `mettreEnLigneDevis`), puis elle est annoncée par l'automatisme existant
 * « Devis disponible » (une fois par devis ; pas pour un devis repris ou déjà envoyé par mail : `annoncerDevisEnLigne`).
 */
export async function modifierPresentationDevis(dossierId: string, documentId: string, entree: z.output<typeof schemaPresentationDevis>): Promise<PresentationDevis> {
  const devis = await prisma.document.findFirst({ where: { id: documentId, dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } } });
  if (!devis?.numero) throw new ErreurMetier("Devis introuvable dans ce dossier.", 404);
  const numero = devis.numero;
  const changements = [
    entree.visibleEspace !== undefined && entree.visibleEspace !== devis.visibleEspace ? (entree.visibleEspace ? "visible dans l'espace client" : "masqué dans l'espace client") : null,
    entree.libelleVariante !== undefined && (entree.libelleVariante || null) !== devis.libelleVariante ? `libellé « ${entree.libelleVariante || "—"} »` : null,
  ].filter(Boolean);
  // Un devis masqué qui devient visible est envoyé au client : l'événement « Devis envoyé » lui passe la main,
  // et le dossier passe à « Devis envoyé » s'il n'y est pas encore.
  const devientVisible = entree.visibleEspace === true && !devis.visibleEspace && (STATUTS_DEVIS_ENVOYE as readonly string[]).includes(devis.statut);
  const devientMasque = entree.visibleEspace === false && devis.visibleEspace;
  const { maj, suites } = await prisma.$transaction(
    async (tx) => {
      const maj = await tx.document.update({
        where: { id: devis.id },
        data: { ...(entree.visibleEspace !== undefined ? { visibleEspace: entree.visibleEspace } : {}), ...(entree.libelleVariante !== undefined ? { libelleVariante: entree.libelleVariante || null } : {}) },
      });
      const contenu = `Devis ${numero} : ${changements.join(", ")}`;
      if (devientVisible) return { maj, suites: await mettreEnLigneDevis(tx, dossierId, { id: devis.id, numero }, contenu) };
      if (changements.length) {
        await tx.dossierEvenement.create({ data: { dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu, metadata: JSON.stringify({ documentId: devis.id, presentation: true }) } });
      }
      return { maj, suites: null };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
  if (suites) await suitesEvenementDossier(suites);
  if (devientMasque) await recalculerMain(dossierId);
  const annonce = devientVisible ? await annoncerDevisEnLigne(dossierId, devis) : null;
  return { id: maj.id, numero, libelleVariante: maj.libelleVariante, visibleEspace: maj.visibleEspace, passage: suites?.changements[0] ?? null, annonce };
}
