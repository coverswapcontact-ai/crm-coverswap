import prisma, { type Transaction } from "@/lib/prisma";
import type { EtapeDossier, TypeDocument } from "./constants";
import { recalculerMain } from "./main";
import { estEtape } from "./regles";
import { appliquerChangementEtape, effetsDuChangementEtape, type ChangementEtape } from "./transitions";

/**
 * Mission 14 (29/09/2026), R1 : un devis visible dans l'espace du client, qu'il
 * soit généré par le CRM, déposé (fait ailleurs) ou rendu visible après avoir
 * été masqué, veut dire « devis envoyé ». Le dossier passe à cette étape s'il
 * n'y est pas encore, la main passe au client, le délai de relance court.
 * Un devis masqué, accepté ou refusé ne fait rien bouger ; une facture non plus
 * (sauf « Chantier → Facturé » à la génération, inchangé).
 */

/** Génération d'un devis : « Devis envoyé » s'il n'y est pas encore ; d'une facture : « Facturé » depuis « Chantier ». Ailleurs, rien. */
export function etapeApresGeneration(type: TypeDocument, etape: EtapeDossier): EtapeDossier | null {
  if (type === "DEVIS" && (etape === "QUALIFICATION" || etape === "SIMULATION" || etape === "RELANCE")) {
    return "DEVIS_ENVOYE";
  }
  if (type === "FACTURE" && etape === "CHANTIER") return "FACTURE";
  return null;
}

/** Statuts d'un devis qui attend la réponse du client (ni accepté, ni refusé, ni remplacé). */
export const STATUTS_DEVIS_ENVOYE = ["GENERE", "ENVOYE"] as const;

/** Un devis « envoyé » au sens du tunnel : numéroté, en attente de réponse, visible dans l'espace. */
export function estDevisEnvoye(document: { type: string; numero: string | null; statut: string; visibleEspace?: boolean | null }): boolean {
  return document.type === "DEVIS" && Boolean(document.numero) && (STATUTS_DEVIS_ENVOYE as readonly string[]).includes(document.statut) && document.visibleEspace !== false;
}

export type OptionsDevisEnvoye = {
  /** Le devis qui justifie le passage (sinon : le plus récent devis envoyé du dossier). */
  documentId?: string;
  /** Écrite dans l'événement CHANGEMENT_ETAPE. */
  raison?: string;
  /** Étapes d'où le passage est permis (défaut : celles de la génération, Qualification, Simulation, Relance). */
  depuis?: readonly EtapeDossier[];
  /** REPRISE : dossier repris d'avant le CRM, rien ne part chez Meta. */
  nature?: "AUTOMATIQUE" | "REPRISE";
};

/**
 * Passe le dossier en « Devis envoyé » dans la transaction de l'appelant, si un
 * devis envoyé (voir `estDevisEnvoye`) le justifie ; rend le changement, ou null.
 * Les effets (lead, Meta, main) se lancent après la transaction : `suitesDevisEnvoye`.
 */
export async function passerEnDevisEnvoye(tx: Transaction, dossierId: string, options: OptionsDevisEnvoye = {}): Promise<ChangementEtape | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier || !estEtape(dossier.etape)) return null;
  if (options.depuis && !options.depuis.includes(dossier.etape)) return null;
  const vers = etapeApresGeneration("DEVIS", dossier.etape);
  if (!vers) return null;
  const devis = await tx.document.findFirst({
    where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: [...STATUTS_DEVIS_ENVOYE] }, visibleEspace: true, ...(options.documentId ? { id: options.documentId } : {}) },
    orderBy: [{ dateEmission: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!devis) return null;
  return appliquerChangementEtape(tx, { dossierId, de: dossier.etape, vers, nature: options.nature ?? "AUTOMATIQUE", documentId: devis.id, ...(options.raison ? { raison: options.raison } : {}) });
}

/** Après la transaction, comme à la génération : effets des changements d'étape (lead, Meta), puis la main recalculée. */
export async function suitesDevisEnvoye(dossierId: string, changements: readonly (ChangementEtape | null)[]): Promise<void> {
  for (const changement of changements) if (changement) await effetsDuChangementEtape(changement);
  await recalculerMain(dossierId);
}

/**
 * Un devis masqué devenu visible (interrupteur de l'espace, outil « presenter_devis », correction d'un devis repris)
 * fait avancer le dossier comme un devis émis. L'appelant a écrit l'événement DEVIS_ENVOYE qui passe la main.
 * Rend le passage en « Devis envoyé », s'il a eu lieu.
 */
export async function devisRenduVisible(dossierId: string, documentId: string, numero: string): Promise<ChangementEtape | null> {
  const changement = await prisma.$transaction((tx) => passerEnDevisEnvoye(tx, dossierId, { documentId, raison: `devis ${numero} rendu visible dans son espace` }));
  await suitesDevisEnvoye(dossierId, [changement]);
  return changement;
}
