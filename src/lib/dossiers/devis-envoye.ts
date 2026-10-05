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

/**
 * Mission 18 (B1) : générer un devis n'est pas l'envoyer. À la génération, le devis est :
 * - ANNONCÉ (visible, envoyé : l'étape avance, la main passe au client) s'il part avec la notification « Devis
 *   disponible » : notifier demandé, espace ouvert, adresse valide ; ou interrupteur du modèle coupé dans Paramètres
 *   (alors la mise en ligne dans un espace ouvert vaut envoi, décision de la mission 18) ;
 * - sinon, en Qualification ou Simulation : MASQUÉ dans l'espace, pas envoyé (tâche « Envoyer le devis ») ;
 * - sinon (Devis envoyé, Relance, après la signature…) : visible ; une variante silencieuse (`notifier: false`) dans un
 *   espace ouvert vaut mise en ligne (le client a déjà ses devis là, il a été prévenu du premier) ; sans espace ouvert ou
 *   sans adresse pour l'annoncer, il n'est pas envoyé.
 * Pure (essais) ; `mail` dit si la notification est à programmer après la transaction.
 */
export function envoiALaGeneration(e: { etape: EtapeDossier; notifier: boolean; modeleActif: boolean; espaceOuvert: boolean; possible: boolean }): { visible: boolean; envoye: boolean; mail: boolean } {
  const annonce = e.notifier && e.espaceOuvert && (e.possible || !e.modeleActif);
  if (annonce) return { visible: true, envoye: true, mail: e.modeleActif };
  if (ETAPES_DEVIS_MASQUE.includes(e.etape)) return { visible: false, envoye: false, mail: false };
  return { visible: true, envoye: !e.notifier && e.espaceOuvert, mail: false };
}

/** Les étapes où un devis généré sans être annoncé reste masqué dans l'espace (avant tout devis envoyé). */
export const ETAPES_DEVIS_MASQUE: readonly EtapeDossier[] = ["QUALIFICATION", "SIMULATION"];

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

/**
 * Mission 18 (B1) : les devis générés mais pas encore envoyés — leur événement DEVIS_GENERE dit `envoye: false`, le
 * devis est toujours « Généré » (le mail du CRM le passe « Envoyé »), non archivé, et aucun « Devis envoyé » ne l'a
 * mis en ligne depuis (interrupteur de l'espace). Dossiers vivants seulement (ni archivés, ni perdus). Les devis émis
 * avant la mission 18 n'ont pas la marque : ils ne sont jamais pris pour des devis à envoyer.
 */
export async function devisAEnvoyer(client: Transaction = prisma, dossierIds?: readonly string[]): Promise<{ dossierId: string; documentId: string; numero: string; visible: boolean; le: Date }[]> {
  const generes = await client.dossierEvenement.findMany({
    where: { type: "DEVIS_GENERE", archiveLe: null, metadata: { contains: MARQUE_PAS_ENVOYE }, ...(dossierIds ? { dossierId: { in: [...dossierIds] } } : {}) },
    select: { dossierId: true, metadata: true, createdAt: true },
  });
  const parDocument = new Map<string, Date>();
  for (const e of generes) {
    const id = idDocumentDe(e.metadata);
    if (id) parDocument.set(id, e.createdAt);
  }
  if (parDocument.size === 0) return [];
  const documents = await client.document.findMany({
    where: { id: { in: [...parDocument.keys()] }, type: "DEVIS", statut: "GENERE", archiveLe: null, numero: { not: null }, dossier: { archiveLe: null, etape: { not: "PERDU" } } },
    select: { id: true, dossierId: true, numero: true, visibleEspace: true },
  });
  if (documents.length === 0) return [];
  const misEnLigne = await client.dossierEvenement.findMany({
    where: { type: "DEVIS_ENVOYE", archiveLe: null, dossierId: { in: [...new Set(documents.map((d) => d.dossierId))] } },
    select: { metadata: true },
  });
  const envoyes = new Set(misEnLigne.map((e) => idDocumentDe(e.metadata)).filter((id): id is string => Boolean(id)));
  return documents
    .filter((d) => !envoyes.has(d.id))
    .map((d) => ({ dossierId: d.dossierId, documentId: d.id, numero: d.numero!, visible: d.visibleEspace, le: parDocument.get(d.id)! }))
    .sort((a, b) => a.le.getTime() - b.le.getTime());
}

/** La marque d'un devis généré sans être envoyé, dans la metadata de son DEVIS_GENERE (JSON.stringify). */
export const MARQUE_PAS_ENVOYE = '"envoye":false';

function idDocumentDe(metadata: string): string | null {
  try {
    const valeur = JSON.parse(metadata) as { documentId?: unknown };
    return typeof valeur?.documentId === "string" ? valeur.documentId : null;
  } catch {
    return null;
  }
}
