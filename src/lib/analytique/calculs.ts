import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { jourParis } from "@/lib/dossiers/dates";
import { estDevisEnvoye } from "@/lib/dossiers/devis-envoye";
import { lireMetadataChangementEtape } from "@/lib/dossiers/regles";
import { versCentimes } from "@/lib/dossiers/montants";
import { appelSansReponse, issueDesMetadonnees, issueDuContenu } from "@/lib/commercial/sans-reponse";
import { categorieDeChantier, CATEGORIES_DEPENSE } from "@/lib/depenses/constantes";
import { relancesDuDevis } from "@/lib/relances/service";
import { lireParametres } from "@/lib/parametres/service";
import { familleDeLead, type ProvenanceParcours } from "./appuis";
import { bornes, decalerJour, joursDe, nombreDeJours } from "./periode";
import type { Famille } from "./types";

/**
 * Mission 17 (partie B) — LES définitions de l'Analytique (docs/ANALYTIQUE.md § 4), une fonction chacune. Tout
 * écran, le résumé du jour, les alertes et les outils MCP passent par ici : un chiffre n'a qu'une définition.
 * Jours de Paris partout (`jourParis`, `bornes`) ; montants additionnés en centimes.
 *
 * - lead : `Lead` créé dans la période, archivés compris (une dépense se juge sur tout ce qu'elle a produit),
 *   doublons fusionnés exclus (archivés « Doublon de … », leur historique a rejoint la fiche conservée) ;
 * - lead appelé : au moins un appel dans son historique (échange « appel », événement « appel » d'un de ses dossiers,
 *   note d'appel qui dit quelque chose), quelle qu'en soit l'issue ;
 * - lead joint : au moins un appel ABOUTI (`appelSansReponse` faux : issue autre que « pas de réponse », sinon ni
 *   étiquette ni texte ne dit messagerie, répondeur…) ou un échange écrit REÇU après sa création (mail, SMS, message
 *   d'espace ou événement entrant d'un dossier) ;
 * - devis : dossier (non archivé) avec un devis numéroté, visible dans l'espace, émis dans la période — un dossier
 *   compte une fois (variantes et devis refaits ne se cumulent pas) ;
 * - signé : dossier dont l'accord n'est pas retiré, ou passé Signé (étape Signé et au-delà) ; daté du premier accord
 *   non retiré ou du premier passage à Signé ; montant = accord non retiré le plus récent, sinon devis accepté ;
 * - encaissé : encaissements VALIDE reçus (`recuLe`) dans la période ; un encaissement annulé ou rejeté ne compte plus ;
 * - marge estimée : encaissé − dépenses de chantier (matière, fournitures, sous-traitance, déplacement) rattachées à un
 *   dossier et payées dans la période ;
 * - panier moyen : montant signé / signatures de montant connu ;
 * - carnet de commandes : devis envoyés (numérotés, en attente, visibles), non signés, dossier ni perdu ni en pause
 *   ni archivé ; un par dossier (le plus récent) ;
 * - dépense pub : la dépense synchronisée (DepensePubJour) quand la synchronisation Meta a réussi au moins une fois ;
 *   sinon le prorata du budget de campagne (CAMPAGNE_*) jour par jour, marqué « estimation » ; sinon les dépenses
 *   « Publicité » saisies. Une dépense saisie ne s'ajoute JAMAIS à la synchronisation (ce serait la même facture) ;
 * - règle des 20 % : dépense pub du mois ≤ 20 % de l'encaissé du mois précédent.
 */

export const ETAPES_SIGNEES = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"] as const;
export const PLAFOND_PUB = 0.2;
export const CATEGORIES_CHANTIER = CATEGORIES_DEPENSE.filter((c) => c.chantier).map((c) => c.code);
const TYPES_ECRITS_ENTRANTS: string[] = ["MAIL_RECU", "WHATSAPP_RECU", "SMS_RECU"];

type Periode = { du: string; au: string };
const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + versCentimes(v), 0) / 100;
const dans = (jour: string, p: Periode) => jour >= p.du && jour <= p.au;

/* ── Appelé, joint (purs) ────────────────────────────────────────────────── */

export type AppelHistorique = { issue: string | null; etiquettes: string[]; texte: string | null; le: Date };
export type HistoriqueContact = { creeLe: Date; appels: AppelHistorique[]; ecritsRecus: Date[] };

export const estAppele = (h: HistoriqueContact): boolean => h.appels.length > 0;
export const estJoint = (h: HistoriqueContact): boolean => h.appels.some((a) => !appelSansReponse(a)) || h.ecritsRecus.some((d) => d.getTime() > h.creeLe.getTime());

/* ── Doublons fusionnés (purs) ───────────────────────────────────────────── */

export const estDoublonFusionne = (lead: { archiveLe: Date | null; archiveMotif: string | null }) => Boolean(lead.archiveLe) && /^Doublon\b/i.test(lead.archiveMotif ?? "");

/* ── Famille d'un dossier ────────────────────────────────────────────────── */

const FAMILLE_CLIENT: Record<string, Famille> = { META_ADS: "meta", RESEAUX_SOCIAUX: "reseaux" };
type DossierPourFamille = { lead: { source: string; canal: string | null; campagne: string | null; parcoursId: string | null } | null; client: { source: string | null } | null };
function familleDuDossier(d: DossierPourFamille, sourcesParcours: Map<string, ProvenanceParcours>): Famille {
  if (d.lead) return familleDeLead(d.lead, d.lead.parcoursId ? sourcesParcours.get(d.lead.parcoursId) ?? null : null);
  return FAMILLE_CLIENT[d.client?.source ?? ""] ?? "autre";
}

/** La première visite connue de chaque parcours du site (famille d'un lead du site sans `canal`). */
export async function sourcesDesParcours(parcoursIds: readonly (string | null | undefined)[]): Promise<Map<string, ProvenanceParcours>> {
  const ids = [...new Set(parcoursIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const evenements = await prisma.evenementSite.findMany({ where: { parcoursId: { in: ids }, OR: [{ source: { not: null } }, { referent: { not: null } }, { famille: { not: null } }] }, orderBy: { createdAt: "asc" }, select: { parcoursId: true, source: true, referent: true, famille: true, campagne: true } });
  const carte = new Map<string, ProvenanceParcours>();
  for (const e of evenements) if (!carte.has(e.parcoursId)) carte.set(e.parcoursId, { source: e.source, referent: e.referent, famille: e.famille, campagne: e.campagne });
  return carte;
}

/* ── Leads (cohorte de la période) ───────────────────────────────────────── */

export type LeadAnalyse = {
  id: string;
  jour: string;
  source: string;
  famille: Famille;
  archive: boolean;
  appele: boolean;
  joint: boolean;
  /** Un dossier du lead a un devis numéroté visible émis (à ce jour). */
  devis: boolean;
  signe: boolean;
  montantSigne: number | null;
  encaisse: number;
  /** Attribution Meta (premier formulaire payé), par identifiants. */
  meta: { adId: string | null; adsetId: string | null; campagneId: string | null } | null;
  campagne: string | null;
  publicite: string | null;
};

const SELECT_LEAD = {
  id: true, createdAt: true, source: true, canal: true, parcoursId: true, campagne: true, publicite: true, archiveLe: true, archiveMotif: true, dernierAppelLe: true,
  notesAppel: { where: { archiveLe: null }, select: { issue: true, texte: true, etiquettes: true, appelLe: true } },
  interactions: { where: { archiveLe: null, type: "APPEL" }, select: { contenu: true, createdAt: true } },
  messages: { where: { sens: "ENTRANT", archiveLe: null }, select: { recuLe: true } },
  conversationsSms: { select: { messages: { where: { sens: "ENTRANT" }, select: { createdAt: true } } } },
  metaLeads: { where: { organique: false }, orderBy: { soumisLe: "asc" }, select: { adId: true, adsetId: true, campagneId: true } },
  dossiers: {
    where: { archiveLe: null },
    select: {
      etape: true,
      evenements: { where: { archiveLe: null, type: { in: ["APPEL", ...TYPES_ECRITS_ENTRANTS] } }, select: { type: true, contenu: true, metadata: true, survenuLe: true, createdAt: true, direction: true } },
      documents: { where: { type: "DEVIS", numero: { not: null }, visibleEspace: true, archiveLe: null }, select: { totalHt: true, statut: true, dateEmission: true } },
      accords: { where: { retireLe: null }, orderBy: { createdAt: "desc" }, select: { totalHt: true } },
      encaissements: { where: { statut: "VALIDE" }, select: { montant: true } },
      messages: { where: { sens: "ENTRANT", archiveLe: null }, select: { recuLe: true } },
      messagesEspace: { where: { auteur: "CLIENT", archiveLe: null }, select: { createdAt: true } },
    },
  },
} satisfies Prisma.LeadSelect;

function lireEtiquettes(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/** Lead, lead appelé, lead joint, devis, signé et encaissé de la cohorte des leads créés dans la période. */
export async function leadsDeLaPeriode(periode: Periode, familleFiltre: Famille | null = null): Promise<LeadAnalyse[]> {
  const { debut, fin } = bornes(periode);
  const leads = await analyserLeads({ ...AVEC_ARCHIVES, createdAt: { gte: debut, lt: fin } });
  return familleFiltre ? leads.filter((l) => l.famille === familleFiltre) : leads;
}

/** Les mêmes définitions pour des leads désignés (attribution Meta : un formulaire rattaché à un contact plus ancien). */
export async function leadsParIds(ids: readonly string[]): Promise<LeadAnalyse[]> {
  return ids.length ? analyserLeads({ ...AVEC_ARCHIVES, id: { in: [...new Set(ids)] } }) : [];
}

async function analyserLeads(where: Prisma.LeadWhereInput): Promise<LeadAnalyse[]> {
  const bruts = (await prisma.lead.findMany({ where, select: SELECT_LEAD })).filter((l) => !estDoublonFusionne(l));
  const parcours = await sourcesDesParcours(bruts.map((l) => l.parcoursId));
  return bruts.map((l): LeadAnalyse => {
    const appels: AppelHistorique[] = [
      ...l.notesAppel.filter((n) => n.issue || n.texte.trim() || lireEtiquettes(n.etiquettes).length).map((n) => ({ issue: n.issue, etiquettes: lireEtiquettes(n.etiquettes), texte: n.texte, le: n.appelLe })),
      ...l.interactions.map((i) => ({ issue: issueDuContenu(i.contenu), etiquettes: [], texte: i.contenu, le: i.createdAt })),
      ...l.dossiers.flatMap((d) => d.evenements.filter((e) => e.type === "APPEL").map((e) => ({ issue: issueDesMetadonnees(e.metadata), etiquettes: [], texte: e.contenu, le: e.survenuLe ?? e.createdAt }))),
    ];
    const ecritsRecus = [
      ...l.messages.map((m) => m.recuLe),
      ...l.conversationsSms.flatMap((c) => c.messages.map((m) => m.createdAt)),
      ...l.dossiers.flatMap((d) => [...d.messages.map((m) => m.recuLe), ...d.messagesEspace.map((m) => m.createdAt), ...d.evenements.filter((e) => TYPES_ECRITS_ENTRANTS.includes(e.type) && e.direction === "ENTRANT").map((e) => e.survenuLe ?? e.createdAt)]),
    ];
    const historique = { creeLe: l.createdAt, appels, ecritsRecus };
    const signes = l.dossiers.filter((d) => d.accords.length > 0 || (ETAPES_SIGNEES as readonly string[]).includes(d.etape));
    const montants = signes.map((d) => d.accords[0]?.totalHt ?? d.documents.find((doc) => doc.statut === "ACCEPTE")?.totalHt ?? null).filter((m): m is number => m !== null);
    const meta = l.metaLeads[0] ?? null;
    return {
      id: l.id,
      jour: jourParis(l.createdAt),
      source: l.source,
      famille: familleDeLead(l, l.parcoursId ? parcours.get(l.parcoursId) ?? null : null),
      archive: Boolean(l.archiveLe),
      appele: estAppele(historique) || Boolean(l.dernierAppelLe),
      joint: estJoint(historique),
      devis: l.dossiers.some((d) => d.documents.length > 0),
      signe: signes.length > 0,
      montantSigne: montants.length ? somme(montants) : null,
      encaisse: somme(l.dossiers.flatMap((d) => d.encaissements.map((e) => e.montant))),
      meta: meta ? { adId: meta.adId, adsetId: meta.adsetId, campagneId: meta.campagneId } : null,
      campagne: l.campagne,
      publicite: l.publicite,
    };
  });
}

/** Comptes de la cohorte (purs) : leads, appelés, joints, devis, signés, encaissés. */
export function comptesDesLeads(leads: readonly LeadAnalyse[]) {
  return {
    leads: leads.length,
    appeles: leads.filter((l) => l.appele).length,
    joints: leads.filter((l) => l.joint).length,
    devis: leads.filter((l) => l.devis).length,
    signes: leads.filter((l) => l.signe).length,
    encaisses: leads.filter((l) => l.encaisse > 0).length,
    montantEncaisse: somme(leads.map((l) => l.encaisse)),
  };
}

/* ── Activité de la période : devis, signatures, encaissements ─────────── */

const SELECT_FAMILLE = { lead: { select: { source: true, canal: true, campagne: true, parcoursId: true } }, client: { select: { source: true } } } satisfies Prisma.DossierSelect;

export type DevisEmis = { dossierId: string; jour: string; montant: number; famille: Famille };

/** Devis : dossiers avec un devis numéroté visible émis dans la période (un par dossier, le premier de la période). */
export async function devisDeLaPeriode(periode: Periode, familleFiltre: Famille | null = null): Promise<DevisEmis[]> {
  const { debut, fin } = bornes(periode);
  const documents = await prisma.document.findMany({
    where: { type: "DEVIS", numero: { not: null }, visibleEspace: true, dateEmission: { gte: debut, lt: fin }, dossier: { archiveLe: null } },
    orderBy: { dateEmission: "asc" },
    select: { dossierId: true, dateEmission: true, totalHt: true, dossier: { select: SELECT_FAMILLE } },
  });
  const parcours = await sourcesDesParcours(documents.map((d) => d.dossier.lead?.parcoursId));
  const vus = new Set<string>();
  const devis: DevisEmis[] = [];
  for (const d of documents) {
    if (vus.has(d.dossierId) || !d.dateEmission) continue;
    vus.add(d.dossierId);
    devis.push({ dossierId: d.dossierId, jour: jourParis(d.dateEmission), montant: d.totalHt, famille: familleDuDossier(d.dossier, parcours) });
  }
  return familleFiltre ? devis.filter((d) => d.famille === familleFiltre) : devis;
}

export type Signature = { dossierId: string; jour: string; montant: number | null; famille: Famille };

/** Signés : accord non retiré ou dossier passé Signé, datés dans la période. */
export async function signaturesDeLaPeriode(periode: Periode, familleFiltre: Famille | null = null): Promise<Signature[]> {
  const toutes = await toutesLesSignatures();
  return toutes.filter((s) => dans(s.jour, periode) && (!familleFiltre || s.famille === familleFiltre));
}

/** Toutes les signatures en vigueur (un dossier signé une fois), datées. */
export async function toutesLesSignatures(): Promise<Signature[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { archiveLe: null, OR: [{ etape: { in: [...ETAPES_SIGNEES] } }, { accords: { some: { retireLe: null } } }] },
    select: {
      id: true,
      ...SELECT_FAMILLE,
      accords: { where: { retireLe: null }, orderBy: { createdAt: "asc" }, select: { totalHt: true, createdAt: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, survenuLe: true, createdAt: true } },
      documents: { where: { type: "DEVIS", archiveLe: null }, select: { id: true, statut: true, totalHt: true, dateEmission: true } },
    },
  });
  const parcours = await sourcesDesParcours(dossiers.map((d) => d.lead?.parcoursId));
  return dossiers.flatMap((d): Signature[] => {
    const passages = d.evenements.map((e) => ({ m: lireMetadataChangementEtape(e.metadata), le: e.survenuLe ?? e.createdAt })).filter((p) => p.m?.vers === "SIGNE");
    const instants = [...d.accords.map((a) => a.createdAt), ...passages.map((p) => p.le)].sort((a, b) => a.getTime() - b.getTime());
    if (!instants.length) return [];
    const dernierAccord = d.accords.at(-1);
    const accepte = [...d.documents].filter((doc) => doc.statut === "ACCEPTE").sort((a, b) => (b.dateEmission?.getTime() ?? 0) - (a.dateEmission?.getTime() ?? 0))[0];
    const duPassage = passages.map((p) => p.m?.documentId).filter(Boolean).map((id) => d.documents.find((doc) => doc.id === id)).find(Boolean);
    const montant = dernierAccord?.totalHt ?? accepte?.totalHt ?? duPassage?.totalHt ?? null;
    return [{ dossierId: d.id, jour: jourParis(instants[0]), montant, famille: familleDuDossier(d, parcours) }];
  });
}

export type LigneEncaissee = { jour: string; montant: number; dossierId: string | null; famille: Famille };

/** Encaissé : encaissements VALIDE reçus dans la période. */
export async function encaissementsDeLaPeriode(periode: Periode, familleFiltre: Famille | null = null): Promise<LigneEncaissee[]> {
  const { debut, fin } = bornes(periode);
  const lignes = await prisma.encaissement.findMany({ where: { statut: "VALIDE", recuLe: { gte: debut, lt: fin } }, select: { recuLe: true, montant: true, dossierId: true, dossier: { select: SELECT_FAMILLE } } });
  const parcours = await sourcesDesParcours(lignes.map((l) => l.dossier?.lead?.parcoursId));
  const resultat = lignes.map((l) => ({ jour: jourParis(l.recuLe), montant: l.montant, dossierId: l.dossierId, famille: l.dossier ? familleDuDossier(l.dossier, parcours) : ("autre" as Famille) }));
  return familleFiltre ? resultat.filter((l) => l.famille === familleFiltre) : resultat;
}

export const totalEncaisse = (lignes: readonly { montant: number }[]) => somme(lignes.map((l) => l.montant));

/* ── Dépenses de chantier, marge, panier ─────────────────────────────────── */

export type DepenseLue = { jour: string; montant: number; categorie: string; dossierId: string | null; fournisseur: string };

export async function depensesDeLaPeriode(periode: Periode): Promise<DepenseLue[]> {
  const { debut, fin } = bornes(periode);
  const lignes = await prisma.depense.findMany({ where: { payeeLe: { gte: debut, lt: fin } }, select: { payeeLe: true, montant: true, categorie: true, dossierId: true, fournisseur: true } });
  return lignes.map((l) => ({ jour: jourParis(l.payeeLe), montant: l.montant, categorie: l.categorie, dossierId: l.dossierId, fournisseur: l.fournisseur }));
}

/** Dépenses de chantier rattachées à un dossier (pur). */
export const depensesDeChantier = (depenses: readonly DepenseLue[]) => somme(depenses.filter((d) => d.dossierId && categorieDeChantier(d.categorie)).map((d) => d.montant));

/** Marge estimée = encaissé − dépenses de chantier rattachées (pur). */
export const margeEstimee = (encaisse: number, depensesChantier: number) => Math.round((encaisse - depensesChantier) * 100) / 100;

/** Panier moyen = montant signé / signatures de montant connu (pur) ; null sans signature chiffrée. */
export function panierMoyen(signatures: readonly { montant: number | null }[]): number | null {
  const connues = signatures.filter((s): s is { montant: number } => s.montant !== null);
  return connues.length ? Math.round((somme(connues.map((s) => s.montant)) / connues.length) * 100) / 100 : null;
}
export const montantSigne = (signatures: readonly { montant: number | null }[]) => somme(signatures.map((s) => s.montant ?? 0));

/* ── Carnet de commandes ─────────────────────────────────────────────────── */

export type LigneCarnet = { dossierId: string; client: string; numero: string | null; montant: number; envoyeLe: string | null; relances: number; famille: Famille };

/** Carnet de commandes : devis envoyés, visibles, non signés, non annulés (un par dossier, le plus récent). */
export async function carnetDeCommandes(): Promise<LigneCarnet[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { archiveLe: null, etape: { in: ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"] }, accords: { none: { retireLe: null } } },
    select: { id: true, clientNom: true, ...SELECT_FAMILLE, documents: { where: { type: "DEVIS", numero: { not: null }, archiveLe: null }, orderBy: { dateEmission: "desc" }, select: { id: true, type: true, numero: true, statut: true, visibleEspace: true, totalHt: true, dateEmission: true } } },
  });
  const avecDevis = dossiers.map((d) => ({ d, devis: d.documents.find((doc) => estDevisEnvoye(doc)) })).filter((x) => x.devis);
  const ids = avecDevis.map((x) => x.d.id);
  const traces = ids.length ? await prisma.dossierEvenement.findMany({ where: { dossierId: { in: ids }, OR: [{ type: "MAIL_ENVOYE", metadata: { contains: "RELANCE_DEVIS" } }, { type: "SMS_COPIE", metadata: { contains: '"relance"' } }] }, select: { dossierId: true, type: true, metadata: true, createdAt: true } }) : [];
  const parcours = await sourcesDesParcours(avecDevis.map((x) => x.d.lead?.parcoursId));
  return avecDevis
    .map(({ d, devis }) => ({ dossierId: d.id, client: d.clientNom, numero: devis!.numero, montant: devis!.totalHt, envoyeLe: devis!.dateEmission ? jourParis(devis!.dateEmission) : null, relances: relancesDuDevis(traces, d.id, devis!.id).length, famille: familleDuDossier(d, parcours) }))
    .sort((a, b) => b.montant - a.montant);
}

/* ── Dépense publicitaire ────────────────────────────────────────────────── */

export type OrigineDepense = "SYNCHRO" | "PRORATA" | "SAISIE" | "INCONNUE";
export type DepensePub = { total: number | null; parJour: Record<string, number>; origine: OrigineDepense; estimation: boolean };

export type Campagne = { debut: string | null; budget: number | null; duree: number };

export async function lireCampagne(maintenant: Date): Promise<Campagne> {
  const v = await lireParametres(["CAMPAGNE_DEBUT", "CAMPAGNE_BUDGET", "CAMPAGNE_DUREE_JOURS"], maintenant);
  const debut = typeof v.CAMPAGNE_DEBUT === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.CAMPAGNE_DEBUT) ? v.CAMPAGNE_DEBUT : null;
  const budget = typeof v.CAMPAGNE_BUDGET === "number" ? v.CAMPAGNE_BUDGET : null;
  const duree = typeof v.CAMPAGNE_DUREE_JOURS === "number" && v.CAMPAGNE_DUREE_JOURS > 0 ? v.CAMPAGNE_DUREE_JOURS : 21;
  return { debut, budget, duree };
}

/** Le jour de campagne en jours de Paris (1 = premier jour), null sans début. Plus de décalage +02:00 figé. */
export function jourDeCampagne(campagne: { debut: string | null }, maintenant: Date): number | null {
  return campagne.debut ? nombreDeJours(campagne.debut, jourParis(maintenant)) : null;
}

/** Part du jour de Paris écoulée à `maintenant` (0..1). */
function partDuJourEcoulee(maintenant: Date): number {
  const h = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(maintenant);
  const heures = Number(h.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minutes = Number(h.find((p) => p.type === "minute")?.value ?? 0);
  return (heures * 60 + minutes) / 1440;
}

/**
 * Prorata du budget, jour par jour (pur) : budget / durée pour chaque jour de campagne dans la période et déjà
 * commencé ; le jour en cours au prorata des heures écoulées (il n'est plus compté entièrement dépensé).
 */
export function prorataDuBudget(campagne: Campagne, periode: Periode, maintenant: Date): Record<string, number> {
  if (!campagne.debut || campagne.budget === null) return {};
  const aujourdhui = jourParis(maintenant);
  const fin = decalerJour(campagne.debut, campagne.duree - 1);
  const parJourEntier = campagne.budget / campagne.duree;
  const resultat: Record<string, number> = {};
  for (const jour of joursDe(periode)) {
    if (jour < campagne.debut || jour > fin || jour > aujourdhui) continue;
    resultat[jour] = Math.round(parJourEntier * (jour === aujourdhui ? partDuJourEcoulee(maintenant) : 1) * 100) / 100;
  }
  return resultat;
}

/** Dépense pub de la période : synchronisée, sinon prorata (estimation), sinon saisies ; jamais les deux additionnées. */
export async function depensePubDeLaPeriode(periode: Periode, maintenant: Date, synchroMeta: boolean): Promise<DepensePub> {
  const { debut, fin } = bornes(periode);
  if (synchroMeta) {
    const lignes = await prisma.depensePubJour.findMany({ where: { jour: { gte: periode.du, lte: periode.au } }, select: { jour: true, depense: true } });
    const parJour: Record<string, number> = {};
    for (const l of lignes) parJour[l.jour] = Math.round(((parJour[l.jour] ?? 0) + l.depense) * 100) / 100;
    return { total: somme(lignes.map((l) => l.depense)), parJour, origine: "SYNCHRO", estimation: false };
  }
  const campagne = await lireCampagne(maintenant);
  const prorata = prorataDuBudget(campagne, periode, maintenant);
  if (Object.keys(prorata).length) return { total: somme(Object.values(prorata)), parJour: prorata, origine: "PRORATA", estimation: true };
  const saisies = await prisma.depense.findMany({ where: { categorie: "PUBLICITE", payeeLe: { gte: debut, lt: fin } }, select: { payeeLe: true, montant: true } });
  if (saisies.length) {
    const parJour: Record<string, number> = {};
    for (const s of saisies) parJour[jourParis(s.payeeLe)] = Math.round(((parJour[jourParis(s.payeeLe)] ?? 0) + s.montant) * 100) / 100;
    return { total: somme(saisies.map((s) => s.montant)), parJour, origine: "SAISIE", estimation: false };
  }
  // Campagne connue mais hors de la période : zéro réel (aucune diffusion), pas « inconnu ».
  if (campagne.debut && campagne.budget !== null) return { total: 0, parJour: {}, origine: "PRORATA", estimation: true };
  return { total: null, parJour: {}, origine: "INCONNUE", estimation: false };
}

/* ── Règle des 20 % (pure) ───────────────────────────────────────────────── */

export type MoisPourRegle = { mois: string; encaisse: number; depensePub: number | null };

/** Pour chaque mois (sauf le premier, qui n'a pas de mois précédent) : dépense pub du mois / encaissé du mois précédent. */
export function regle20(mois: readonly MoisPourRegle[], plafond = PLAFOND_PUB) {
  return mois.slice(1).map((m, i) => {
    const encaissePrecedent = mois[i].encaisse;
    const depensePub = m.depensePub ?? 0;
    const ratio = encaissePrecedent > 0 ? Math.round((depensePub / encaissePrecedent) * 1000) / 1000 : depensePub > 0 ? null : 0;
    return { mois: m.mois, encaissePrecedent, depensePub, ratio, plafond, depasse: depensePub > plafond * encaissePrecedent };
  });
}
