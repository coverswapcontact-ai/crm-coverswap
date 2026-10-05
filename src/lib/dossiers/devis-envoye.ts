import prisma, { type Transaction } from "@/lib/prisma";
import type { EtapeDossier, TypeDocument } from "./constants";
import { ecrireMain, recalculerMain } from "./main";
import { estEtape } from "./regles";
import { ecrireStatutLead } from "./statut-lead";
import { appliquerEvenementDossier, type Suites } from "./synchro";
import { appliquerChangementEtape, effetsDuChangementEtape, marquerSynchronise, type ChangementEtape } from "./transitions";

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
 * Mission 18 (relecture de B1 à B5) : LA règle de l'envoi par l'espace, une seule pour la génération et la mise en ligne
 * (interrupteur, outil « modifier » DOCUMENT). Un devis du CRM qui n'a pas encore atteint le client est « envoyé » quand
 * il est ANNONCÉ : espace ouvert et adresse valide (le mail « Devis disponible » part), ou interrupteur du modèle coupé
 * dans Paramètres (alors la mise en ligne dans un espace ouvert vaut envoi, décision 7 de la mission 18). Sans espace
 * ouvert, ou sans adresse avec le modèle actif, il peut être visible mais il n'est pas envoyé (tâche « Envoyer le
 * devis »). L'autre voie est le mail (CRM ou Gmail). Pure : lit `peutNotifier("DEVIS_DISPONIBLE", …)`.
 */
export function annonceAboutit(e: { modeleActif: boolean; espaceOuvert: boolean; possible: boolean }): boolean {
  return e.espaceOuvert && (e.possible || !e.modeleActif);
}

/**
 * Mission 18 (B1) : générer un devis n'est pas l'envoyer. À la génération, le devis est :
 * - ANNONCÉ (visible, envoyé : l'étape avance, la main passe au client) si la notification est demandée et que
 *   l'annonce aboutit (`annonceAboutit`) ;
 * - sinon, en Qualification ou Simulation : MASQUÉ dans l'espace, pas envoyé (tâche « Envoyer le devis ») ;
 * - sinon (Devis envoyé, Relance, après la signature…) : visible (le client a déjà ses devis là), mais PAS envoyé —
 *   une variante silencieuse (`notifier: false`) comprise (relecture : « Devis envoyé » seulement si visible ET
 *   notifié, ou envoyé par mail) : l'étape ne bouge pas, la tâche « Envoyer le devis » s'ouvre, les relances restent
 *   sur le devis réellement envoyé.
 * Pure (essais) ; `mail` dit si la notification est à programmer après la transaction.
 */
export function envoiALaGeneration(e: { etape: EtapeDossier; notifier: boolean; modeleActif: boolean; espaceOuvert: boolean; possible: boolean }): { visible: boolean; envoye: boolean; mail: boolean } {
  if (e.notifier && annonceAboutit(e)) return { visible: true, envoye: true, mail: e.modeleActif };
  if (ETAPES_DEVIS_MASQUE.includes(e.etape)) return { visible: false, envoye: false, mail: false };
  return { visible: true, envoye: false, mail: false };
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
 * Mission 18 (relecture) : le statut du lead suit DANS la transaction et le changement est marqué synchronisé ; la
 * main est écrite par l'appelant dans la même transaction (point d'entrée : `appliquerEvenementDossier`), ou relue
 * après par `suitesDevisEnvoye` (reprise, migration). Après la transaction, seuls Meta, l'agenda et les tâches suivent.
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
  const changement = await appliquerChangementEtape(tx, { dossierId, de: dossier.etape, vers, nature: options.nature ?? "AUTOMATIQUE", documentId: devis.id, ...(options.raison ? { raison: options.raison } : {}) });
  await ecrireStatutLead(tx, dossierId, vers);
  return marquerSynchronise(changement);
}

/** Après la transaction, comme à la génération : effets des changements d'étape (lead, Meta), puis la main recalculée. */
export async function suitesDevisEnvoye(dossierId: string, changements: readonly (ChangementEtape | null)[]): Promise<void> {
  for (const changement of changements) if (changement) await effetsDuChangementEtape(changement);
  await recalculerMain(dossierId);
}

/**
 * Mission 18 (B5, écart 5) : un devis masqué rendu visible dans l'espace (interrupteur du bloc Espace, outil « modifier »
 * DOCUMENT, correction d'un devis repris) est MIS EN LIGNE, dans la transaction de l'appelant (qui a déjà écrit
 * `visibleEspace`) : l'événement « Devis envoyé » (`canal: "ESPACE"`) date la mise en ligne (référence des relances) et
 * passe la main au client, le dossier passe en « Devis envoyé » depuis Qualification, Simulation ou Relance, puis le
 * point d'entrée (synchro.ts) pose « Attendre l'accord » à la place de « Préparer / Envoyer le devis » (une action posée
 * à la main n'est jamais écrasée) et écrit la main. Les suites (lead, Meta, agenda, tâches) et l'annonce
 * (`annoncerDevisEnLigne`) partent après la transaction.
 */
export async function mettreEnLigneDevis(tx: Transaction, dossierId: string, devis: { id: string; numero: string }, contenu: string): Promise<Suites> {
  await tx.dossierEvenement.create({
    data: { dossierId, type: "DEVIS_ENVOYE", direction: "INTERNE", contenu, metadata: JSON.stringify({ documentId: devis.id, presentation: true, canal: "ESPACE" }) },
  });
  const changement = await passerEnDevisEnvoye(tx, dossierId, { documentId: devis.id, raison: `devis ${devis.numero} rendu visible dans son espace` });
  const suites = await appliquerEvenementDossier(tx, dossierId, { type: "DEVIS_ENVOYE", documentId: devis.id, canal: "ESPACE" });
  return { ...suites, changements: changement ? [changement] : [] };
}

/**
 * Mission 18 (relecture) : le devis a-t-il déjà atteint le client ? Fait ailleurs (repris), envoyé par mail (« Envoyé »,
 * accepté…), ou déjà mis en ligne une fois (événement « Devis envoyé » qui le porte : remasqué puis réaffiché, il l'a
 * déjà eu). Sinon, sa mise en ligne n'est un envoi que si l'annonce aboutit (`annonceAboutit`). Lu hors transaction.
 */
export async function devisDejaParti(devis: { id: string; dossierId: string; origine: string; statut: string }): Promise<boolean> {
  if (devis.origine === "REPRISE" || devis.statut !== "GENERE") return true;
  const misEnLigne = await prisma.dossierEvenement.findFirst({ where: { dossierId: devis.dossierId, type: "DEVIS_ENVOYE", metadata: { contains: devis.id } }, select: { id: true } });
  return Boolean(misEnLigne);
}

/**
 * Mission 18 (relecture) : un devis rendu visible SANS être envoyé (pas d'espace ouvert, ou pas d'adresse avec le modèle
 * « Devis disponible » actif), dans la transaction de l'appelant qui a écrit `visibleEspace` : la trace (note), la main
 * relue ; ni « Devis envoyé », ni étape, ni relance. La tâche « Envoyer le devis » reste ouverte (`devisAEnvoyer`).
 */
export async function rendreVisibleSansEnvoi(tx: Transaction, dossierId: string, devis: { id: string }, contenu: string, raison: string | null): Promise<Suites> {
  await tx.dossierEvenement.create({
    data: { dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: `${contenu}, pas encore envoyé${raison ? ` (${raison.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())})` : ""}`, metadata: JSON.stringify({ documentId: devis.id, presentation: true, envoye: false }) },
  });
  return { dossierId, changements: [], prochaineAction: null, main: await ecrireMain(tx, dossierId) };
}

/** La phrase d'un devis rendu visible sans être envoyé, pour l'écran et l'assistant. */
export function phraseNonEnvoye(raison: string | null): string {
  return `Visible dans son espace, mais pas envoyé${raison ? ` : ${raison.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}. Le dossier ne passe pas en « Devis envoyé », la tâche « Envoyer le devis » reste ouverte (l'envoyer par mail, ou le remettre en ligne une fois l'espace ouvert et l'adresse connue).`;
}

/** Ce qu'il est advenu du mail « Devis disponible » à la mise en ligne : programmé, ou pourquoi rien n'est parti. */
export type AnnonceMiseEnLigne = { mail: boolean; raison: string | null };

/**
 * Mission 18 (B5) : la mise en ligne d'un devis du CRM qui n'a pas encore atteint le client (« Généré ») est annoncée
 * par l'automatisme existant « Devis disponible » (interrupteur dans Paramètres, adresse valide, espace ouvert ; une
 * fois par devis : la clé de l'envoi est le devis, un devis déjà annoncé à sa génération ne l'est pas deux fois).
 * Un devis repris (fait ailleurs) ou déjà « Envoyé » (mail du CRM, Gmail) est déjà chez le client : pas de mail.
 * Après la transaction ; jamais d'erreur.
 */
export async function annoncerDevisEnLigne(dossierId: string, devis: { id: string; origine: string; statut: string }): Promise<AnnonceMiseEnLigne> {
  if (devis.origine === "REPRISE") return { mail: false, raison: "devis repris : il est déjà parti ailleurs" };
  if (devis.statut !== "GENERE") return { mail: false, raison: "devis déjà envoyé par mail" };
  const { notifierClient } = await import("@/lib/mail/notifications");
  const { programme, raison } = await notifierClient("DEVIS_DISPONIBLE", dossierId, devis.id);
  return { mail: programme, raison: programme ? null : (raison ?? "notification impossible") };
}

/** La phrase de l'annonce, pour l'écran et l'assistant. */
export function phraseAnnonce(annonce: AnnonceMiseEnLigne): string {
  if (annonce.mail) return "Le client est prévenu par le mail « Devis disponible ».";
  return `Aucun mail « Devis disponible » : ${annonce.raison ? annonce.raison.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) : "rien à annoncer"}.`;
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
