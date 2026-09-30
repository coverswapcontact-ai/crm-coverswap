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
import { familleDeLead, familleDeSource, type ProvenanceParcours } from "./appuis";
import { lireSuivi } from "./suivi";
import { bornes, decalerJour, joursDe, nombreDeJours } from "./periode";
import type { Famille } from "./types";

/**
 * Mission 17 (partie B) — LES définitions de l'Analytique (docs/ANALYTIQUE.md § 4), une fonction chacune. Tout
 * écran, le résumé du jour, les alertes et les outils MCP passent par ici : un chiffre n'a qu'une définition.
 * Jours de Paris partout (`jourParis`, `bornes`) ; montants additionnés en centimes.
 *
 * - lead : `Lead` créé dans la période, archivés compris (une dépense se juge sur tout ce qu'elle a produit),
 *   doublons fusionnés exclus (archivés « Doublon de … », leur historique a rejoint la fiche conservée), leads de test
 *   exclus (archivés « Test », « essai… », `estLeadEcarte`) ;
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

/**
 * Relecture B (point 10) : un lead ARCHIVÉ comme test ou essai (« Test », « Contact d'essai Zapier… », « … essais »),
 * en mot entier, sans casse ni accents — même motif que la reprise de la mission 14 (MOTIF_ECARTE de
 * base/migrations/mission-14-partie-2.ts) — n'est pas un lead ; un doublon fusionné non plus.
 */
export const MOTIF_LEAD_ECARTE = /\b(tests?|essais?|doublons?)\b/;
const aplatir = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const estLeadEcarte = (lead: { archiveLe: Date | null; archiveMotif: string | null }) => estDoublonFusionne(lead) || (Boolean(lead.archiveLe) && MOTIF_LEAD_ECARTE.test(aplatir(lead.archiveMotif ?? "")));

/* ── Famille d'un dossier ────────────────────────────────────────────────── */

const FAMILLE_CLIENT: Record<string, Famille> = { META_ADS: "meta", RESEAUX_SOCIAUX: "reseaux" };
type DossierPourFamille = { lead: { source: string; canal: string | null; campagne: string | null; parcoursId: string | null } | null; client: { source: string | null } | null };
function familleDuDossier(d: DossierPourFamille, sourcesParcours: Map<string, ProvenanceParcours>): Famille {
  if (d.lead) return familleDeLead(d.lead, d.lead.parcoursId ? sourcesParcours.get(d.lead.parcoursId) ?? null : null);
  return FAMILLE_CLIENT[d.client?.source ?? ""] ?? "autre";
}

/**
 * La provenance de chaque parcours du site (famille d'un lead du site sans `canal`) : celle du PREMIER événement dont la
 * famille n'est pas « direct » (relecture B, point 9 : même règle que `familleDesParcours` de l'entonnoir du site —
 * un parcours arrivé en direct puis revenu par une publicité est rangé en publicité, partout pareil). Rien de non
 * direct : pas de provenance (le lead retombe sur sa source).
 */
export async function sourcesDesParcours(parcoursIds: readonly (string | null | undefined)[]): Promise<Map<string, ProvenanceParcours>> {
  const ids = [...new Set(parcoursIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const evenements = await prisma.evenementSite.findMany({
    // Famille calculée à la réception et non directe (`notIn` écarte aussi null), ou ancienne ligne sans famille mais avec une source.
    where: { parcoursId: { in: ids }, OR: [{ famille: { notIn: ["direct"] } }, { famille: null, OR: [{ source: { not: null } }, { referent: { not: null } }] }] },
    orderBy: { createdAt: "asc" },
    select: { parcoursId: true, source: true, referent: true, famille: true, campagne: true },
  });
  const carte = new Map<string, ProvenanceParcours>();
  for (const e of evenements) {
    if (carte.has(e.parcoursId)) continue;
    const famille = e.famille ?? familleDeSource(e.source, e.referent);
    if (famille !== "direct") carte.set(e.parcoursId, { source: e.source, referent: e.referent, famille, campagne: e.campagne });
  }
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
  const bruts = (await prisma.lead.findMany({ where, select: SELECT_LEAD })).filter((l) => !estLeadEcarte(l));
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

/**
 * Le jour de signature d'un dossier (pur ; relecture B, point 1) : le premier accord non retiré ou le premier passage
 * VERS une étape signée (Signé, Planifié, Chantier, Facturé, Encaissé : un dossier qui saute Signé compte quand même) ;
 * à défaut, la dernière mise à jour du devis accepté ; à défaut, l'arrivée du dossier (repris d'avant le CRM déjà
 * signé). Un dossier à une étape signée n'est JAMAIS écarté (même règle que `signe` de la cohorte des leads).
 */
export function instantDeSignature(d: { creeLe: Date; accords: readonly Date[]; passages: readonly { vers: string | null; le: Date }[]; devisAcceptes: readonly Date[] }): Date {
  const signees = ETAPES_SIGNEES as readonly string[];
  const instants = [...d.accords, ...d.passages.filter((p) => p.vers !== null && signees.includes(p.vers)).map((p) => p.le)].sort((a, b) => a.getTime() - b.getTime());
  if (instants.length) return instants[0];
  const accepte = [...d.devisAcceptes].sort((a, b) => a.getTime() - b.getTime())[0];
  return accepte ?? d.creeLe;
}

/** Toutes les signatures en vigueur (un dossier signé une fois), datées. */
export async function toutesLesSignatures(): Promise<Signature[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { archiveLe: null, OR: [{ etape: { in: [...ETAPES_SIGNEES] } }, { accords: { some: { retireLe: null } } }] },
    select: {
      id: true,
      createdAt: true,
      ouvertLe: true,
      ...SELECT_FAMILLE,
      accords: { where: { retireLe: null }, orderBy: { createdAt: "asc" }, select: { totalHt: true, createdAt: true } },
      evenements: { where: { type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { metadata: true, survenuLe: true, createdAt: true } },
      documents: { where: { type: "DEVIS", archiveLe: null }, select: { id: true, statut: true, totalHt: true, dateEmission: true, updatedAt: true } },
    },
  });
  const parcours = await sourcesDesParcours(dossiers.map((d) => d.lead?.parcoursId));
  const signees = ETAPES_SIGNEES as readonly string[];
  return dossiers.map((d): Signature => {
    const passages = d.evenements.map((e) => ({ m: lireMetadataChangementEtape(e.metadata), le: e.survenuLe ?? e.createdAt }));
    const acceptes = d.documents.filter((doc) => doc.statut === "ACCEPTE");
    const instant = instantDeSignature({ creeLe: d.ouvertLe ?? d.createdAt, accords: d.accords.map((a) => a.createdAt), passages: passages.map((p) => ({ vers: p.m?.vers ?? null, le: p.le })), devisAcceptes: acceptes.map((doc) => doc.updatedAt) });
    const dernierAccord = d.accords.at(-1);
    const accepte = [...acceptes].sort((a, b) => (b.dateEmission?.getTime() ?? 0) - (a.dateEmission?.getTime() ?? 0))[0];
    const duPassage = passages.filter((p) => p.m && signees.includes(p.m.vers)).map((p) => p.m?.documentId).filter(Boolean).map((id) => d.documents.find((doc) => doc.id === id)).find(Boolean);
    const montant = dernierAccord?.totalHt ?? accepte?.totalHt ?? duPassage?.totalHt ?? null;
    return { dossierId: d.id, jour: jourParis(instant), montant, famille: familleDuDossier(d, parcours) };
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

/** D'où vient la dépense d'un jour : synchronisée, prorata du budget (estimation), hors campagne (zéro), saisie. */
export type OrigineDepenseJour = "SYNCHRO" | "PRORATA" | "HORS_CAMPAGNE" | "SAISIE";
export type OrigineDepense = "SYNCHRO" | "PRORATA" | "SAISIE" | "MIXTE" | "INCONNUE";
export type DepensePub = {
  /** Somme des jours connus ; null si aucun jour n'est connu (jamais un zéro trompeur). */
  total: number | null;
  /** Les jours CONNUS seulement (un jour inconnu n'a pas de valeur). */
  parJour: Record<string, number>;
  origine: OrigineDepense;
  /** Au moins un jour estimé au prorata du budget. */
  estimation: boolean;
  /** Relecture B (point 3) : l'origine de chaque jour de la période (null : couvert par rien). */
  origineParJour?: Record<string, OrigineDepenseJour | null>;
  /** Jours de la période sans aucune source (la somme est alors partielle). */
  joursInconnus?: number;
  /** Dernier jour couvert par la synchronisation Meta (null sans synchronisation). */
  synchroniseJusquau?: string | null;
};

export type SourcesDepensePub = {
  jours: readonly string[];
  /** Jours couverts par la synchronisation Meta (du premier jour synchronisé au jour de la dernière réussite). */
  couverture: { du: string; au: string } | null;
  synchro: Readonly<Record<string, number>>;
  /** Prorata du budget sur les jours de campagne déjà commencés (`prorataDuBudget`). */
  prorata: Readonly<Record<string, number>>;
  /** Début et budget de campagne connus : hors de la campagne (et hors synchronisation), la dépense est nulle. */
  campagneConnue: boolean;
  /** Dépenses « Publicité » saisies, par jour de paiement. */
  saisies: Readonly<Record<string, number>>;
};

/**
 * La dépense pub jour par jour (pur ; relecture B, point 3) — une source par jour, jamais deux additionnées (une
 * facture Meta saisie et la synchronisation sont la même dépense) :
 * 1. jour couvert par la synchronisation Meta → la dépense synchronisée (0 si Meta n'a rien rendu ce jour-là) ;
 * 2. sinon, campagne connue → le prorata du budget les jours de campagne commencés (estimation), 0 en dehors ;
 * 3. sinon, des dépenses « Publicité » saisies sur la période → la saisie du jour (0 les autres jours) ;
 * 4. sinon → inconnu (null) : ni zéro, ni estimation.
 */
export function combinerDepensePub(s: SourcesDepensePub): DepensePub {
  const parJour: Record<string, number> = {};
  const origineParJour: Record<string, OrigineDepenseJour | null> = {};
  const couvert = (j: string) => Boolean(s.couverture && j >= s.couverture.du && j <= s.couverture.au);
  const saisiesHorsSynchro = s.jours.some((j) => !couvert(j) && (s.saisies[j] ?? 0) > 0);
  let centimes = 0;
  let inconnus = 0;
  for (const j of s.jours) {
    let origine: OrigineDepenseJour | null = null;
    let valeur = 0;
    if (couvert(j)) [origine, valeur] = ["SYNCHRO", s.synchro[j] ?? 0];
    else if (s.campagneConnue) [origine, valeur] = j in s.prorata ? ["PRORATA", s.prorata[j]] : ["HORS_CAMPAGNE", 0];
    else if (saisiesHorsSynchro) [origine, valeur] = ["SAISIE", s.saisies[j] ?? 0];
    origineParJour[j] = origine;
    if (origine === null) {
      inconnus += 1;
      continue;
    }
    parJour[j] = Math.round(valeur * 100) / 100;
    centimes += versCentimes(valeur);
  }
  const connues = Object.values(origineParJour).filter((o): o is OrigineDepenseJour => o !== null);
  const familles = new Set(connues.map((o) => (o === "HORS_CAMPAGNE" ? "PRORATA" : o)));
  const origine: OrigineDepense = !connues.length ? "INCONNUE" : familles.size > 1 ? "MIXTE" : ([...familles][0] as OrigineDepense);
  return {
    total: connues.length ? centimes / 100 : null,
    parJour,
    origine,
    estimation: connues.includes("PRORATA"),
    origineParJour,
    joursInconnus: inconnus,
    synchroniseJusquau: s.couverture?.au ?? null,
  };
}

/**
 * Les jours couverts par la synchronisation Meta : la plage notée par le connecteur (`couverture`, fusion des passages
 * réussis), sinon celle du dernier passage, sinon du premier jour synchronisé en base ; jamais au-delà du jour de la
 * dernière réussite. null : aucune synchronisation réussie.
 */
export async function couvertureMeta(): Promise<{ du: string; au: string } | null> {
  const suivi = await lireSuivi("META");
  if (!suivi?.derniereReussiteLe) return null;
  const jourReussite = jourParis(suivi.derniereReussiteLe);
  const notee = suivi.detail.couverture as { du?: unknown; au?: unknown } | undefined;
  let du = typeof notee?.du === "string" ? notee.du : typeof suivi.detail.du === "string" ? suivi.detail.du : null;
  let au = typeof notee?.au === "string" ? notee.au : typeof suivi.detail.au === "string" ? suivi.detail.au : jourReussite;
  if (!du) du = (await prisma.depensePubJour.findFirst({ where: { plateforme: "META" }, orderBy: { jour: "asc" }, select: { jour: true } }))?.jour ?? null;
  if (!du) return null;
  if (au > jourReussite) au = jourReussite;
  return du <= au ? { du, au } : null;
}

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

/** Dépense pub de la période, jour par jour (`combinerDepensePub`) : synchronisée où Meta couvre, sinon prorata, sinon saisies. */
export async function depensePubDeLaPeriode(periode: Periode, maintenant: Date, synchroMeta: boolean): Promise<DepensePub> {
  const { debut, fin } = bornes(periode);
  const [couverture, campagne, saisiesLues] = await Promise.all([
    synchroMeta ? couvertureMeta() : Promise.resolve(null),
    lireCampagne(maintenant),
    prisma.depense.findMany({ where: { categorie: "PUBLICITE", payeeLe: { gte: debut, lt: fin } }, select: { payeeLe: true, montant: true } }),
  ]);
  const synchro: Record<string, number> = {};
  if (couverture) {
    const lignes = await prisma.depensePubJour.findMany({ where: { jour: { gte: periode.du, lte: periode.au } }, select: { jour: true, depense: true } });
    for (const l of lignes) synchro[l.jour] = (synchro[l.jour] ?? 0) + versCentimes(l.depense);
    for (const j of Object.keys(synchro)) synchro[j] = synchro[j] / 100;
  }
  const saisies: Record<string, number> = {};
  for (const x of saisiesLues) saisies[jourParis(x.payeeLe)] = Math.round(((saisies[jourParis(x.payeeLe)] ?? 0) + x.montant) * 100) / 100;
  return combinerDepensePub({ jours: joursDe(periode), couverture, synchro, prorata: prorataDuBudget(campagne, periode, maintenant), campagneConnue: Boolean(campagne.debut && campagne.budget !== null), saisies });
}

/** Le détail d'une dépense pub pour une tuile (« réel Meta, synchronisé le 28/09 », « estimation… », « partiel… »). */
export function detailDepensePub(depense: DepensePub, etatMeta: { etat: string; derniereReussite: string | null } | null): string | null {
  if (depense.total === null) return "Dépense pub inconnue";
  const morceaux: string[] = [];
  if (depense.origine === "SYNCHRO" || depense.origine === "MIXTE") morceaux.push(etatMeta?.etat === "EN_ECHEC" && etatMeta.derniereReussite ? `réel Meta, synchronisé le ${jourParis(new Date(etatMeta.derniereReussite)).split("-").reverse().slice(0, 2).join("/")}` : "réel Meta");
  if (depense.estimation) morceaux.push("estimation : prorata du budget");
  if (depense.origine === "SAISIE" || (depense.origine === "MIXTE" && Object.values(depense.origineParJour ?? {}).includes("SAISIE"))) morceaux.push("dépenses « Publicité » saisies");
  if (depense.joursInconnus) morceaux.push(`${depense.joursInconnus} jour${depense.joursInconnus > 1 ? "s" : ""} sans chiffre`);
  return morceaux.join(", ") || null;
}

/* ── Leads Meta, coûts (une seule définition : relecture B, point 5) ─────── */

/** Les leads Meta d'une période : les leads de la période (définition ci-dessus) de la famille « meta ». */
export const leadsMeta = (leads: readonly LeadAnalyse[]) => leads.filter((l) => l.famille === "meta");
/** Les chantiers signés Meta d'une période : les signatures datées dans la période, de la famille « meta ». */
export const signesMeta = <T extends { famille: Famille }>(signatures: readonly T[]) => signatures.filter((s) => s.famille === "meta");
/** Coût par unité (lead, devis, chantier signé) : dépense / nombre, au centime ; null sans dépense connue ou sans unité. */
export const coutPar = (depense: number | null, nombre: number): number | null => (depense === null || nombre <= 0 ? null : Math.round((depense / nombre) * 100) / 100);

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
