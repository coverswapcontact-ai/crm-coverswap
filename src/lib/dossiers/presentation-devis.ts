import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { annoncerDevisEnLigne, mettreEnLigneDevis, STATUTS_DEVIS_ENVOYE, type AnnonceMiseEnLigne } from "./devis-envoye";
import { phraseRetrait, retirerDevis } from "./devis-retire";
import { ErreurMetier } from "./erreurs";
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
  /**
   * Mission 14 (R1) : rendu visible, le devis a fait passer le dossier en « Devis envoyé » ; mission 18 (B6) : masqué,
   * il l'a fait revenir avant « Devis envoyé » (nature RETOUR) quand plus aucun devis n'attend la réponse du client.
   * Null : l'étape n'a pas bougé.
   */
  passage: ChangementEtape | null;
  /** Mission 18 (B5) : rendu visible, le mail « Devis disponible » est-il parti (null : pas mis en ligne) ? */
  annonce: AnnonceMiseEnLigne | null;
  /** Mission 18 (B6) : masqué, ce que le retour a fait, dit à Lucas (null : l'étape n'a pas bougé). */
  retrait: string | null;
};

/**
 * Libellé de variante et visibilité dans l'espace d'un devis émis (généré ou repris) : la présentation, jamais le contenu.
 * Mission 14 (R1) : rendu visible, un devis émis ou envoyé vaut envoi (le dossier passe en « Devis envoyé » depuis
 * Qualification, Simulation ou Relance, la main au client).
 * Mission 18 (B5, écart 5) : la mise en ligne s'écrit d'un bloc (visibilité, événement « Devis envoyé » qui date la
 * relance, étape, prochaine action, main : `mettreEnLigneDevis`), puis elle est annoncée par l'automatisme existant
 * « Devis disponible » (une fois par devis ; pas pour un devis repris ou déjà envoyé par mail : `annoncerDevisEnLigne`).
 * Mission 18 (B6, écart 6) : masqué, il passe par le point d'entrée dans la même transaction (devis-retire.ts ›
 * retirerDevis) : sans autre devis en attente de sa réponse, retour avant « Devis envoyé », main à Lucas (« refaire le
 * devis »), relances en attente annulées ; sinon la main est relue (il n'attend plus la réponse sur CE devis).
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
      if (devientMasque) return { maj, suites: await retirerDevis(tx, dossierId, { id: devis.id, numero }, "MASQUE") };
      return { maj, suites: null };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
  if (suites) await suitesEvenementDossier(suites);
  const annonce = devientVisible ? await annoncerDevisEnLigne(dossierId, devis) : null;
  return { id: maj.id, numero, libelleVariante: maj.libelleVariante, visibleEspace: maj.visibleEspace, passage: suites?.changements[0] ?? null, annonce, retrait: devientMasque && suites ? phraseRetrait({ retour: suites.changements[0] ?? null }) : null };
}
