import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { lireConsignes, regleDuJour, sectionProtocole } from "@/lib/assistant/consignes";
import { coutPar, depensePubDeLaPeriode, detailDepensePub, jourDeCampagne, leadsDeLaPeriode, leadsMeta, leadsParIds, lireCampagne, signaturesDeLaPeriode, type DepensePub, type LeadAnalyse, type Signature } from "../calculs";
import { bornes, decalerJour, joursDe, periodePrecedente } from "../periode";
import { tranchesDuProtocole, verdictsDesPublicites, type ResultatVerdict } from "../verdicts";
import { COULEURS_FAMILLE, type EcranPublicite, type EtatSource, type LignePublicite, type Periode } from "../types";
import { chiffresDisponibles, etatDe, indicateur, ratio, serieDepuis, arrondi2 } from "./commun";

/**
 * Mission 17 (partie B) — l'onglet Publicité : par campagne, ensemble et publicité, la dépense (réelle quand la
 * synchronisation Meta a réussi, sinon le prorata du budget au niveau de la campagne seulement, marqué estimation),
 * impressions, clics, CTR, CPM, leads Meta (plateforme) et leads CRM (jointure par identifiants : MetaLead.adId,
 * adsetId, campagneId → Lead, dédoublonnés), devis, signés, encaissé, coûts et retour sur dépense ; le jour de campagne,
 * la règle du jour et le verdict du protocole par publicité (verdicts.ts), jugé sur la campagne entière.
 * Google Ads : lignes vides tant que la source n'est pas branchée.
 */

type Niveau = LignePublicite["niveau"];
type Groupe = {
  niveau: Niveau;
  plateforme: "META" | "GOOGLE_ADS";
  id: string;
  nom: string;
  parentNom: string | null;
  depense: number;
  impressions: number;
  clics: number;
  leadsPlateforme: number;
  leadIds: Set<string>;
};

export type LignePubliciteDetail = LignePublicite & { appeles: number; joints: number; leadIds: string[] };

/** La ligne du contrat (sans les détails internes : appelés, joints, identifiants des leads). */
export function versLignePublicite(l: LignePubliciteDetail): LignePublicite {
  const { niveau, plateforme, id, nom, parentNom, depense, impressions, clics, ctr, cpm, leadsPlateforme, leadsCrm, devis, signes, encaisse, coutParLead, coutParDevis, coutParSigne, retourSurDepense, verdict, raisonVerdict } = l;
  return { niveau, plateforme, id, nom, parentNom, depense, impressions, clics, ctr, cpm, leadsPlateforme, leadsCrm, devis, signes, encaisse, coutParLead, coutParDevis, coutParSigne, retourSurDepense, verdict, raisonVerdict };
}

export type CalculPublicite = {
  depense: DepensePub;
  synchro: boolean;
  lignes: LignePubliciteDetail[];
  /** Leads rattachés à une publicité par leur formulaire Meta (détail par campagne, ensemble, publicité). */
  leadsCrm: LeadAnalyse[];
  /** LES leads Meta de la période (définition unique, calculs.ts › leadsMeta) : base des coûts par lead. */
  leadsMeta: LeadAnalyse[];
  /** LES chantiers signés Meta de la période (calculs.ts › signesMeta) : base du coût par chantier signé. */
  signesMeta: Signature[];
  leadsPlateforme: number | null;
  impressions: number | null;
  clics: number | null;
  parJour: { depense: Record<string, number>; leadsCrm: Record<string, number>; leadsPlateforme: Record<string, number> };
};

const cle = (niveau: Niveau, plateforme: string, id: string) => `${plateforme}:${niveau}:${id}`;
const inc = (r: Record<string, number>, k: string, v = 1) => (r[k] = Math.round(((r[k] ?? 0) + v) * 100) / 100);

type MetaLeadLu = { leadId: string | null; soumisLe: Date; adId: string | null; adNom: string | null; adsetId: string | null; adsetNom: string | null; campagneId: string | null; campagneNom: string | null };

/**
 * Relecture B (point 2) : un formulaire Meta sans identifiant (ancien lead, webhook sans ad_id) est rattaché par son
 * NOM à l'identifiant de la même publicité (ensemble, campagne) dans `DepensePubJour` — jamais une ligne « par nom » à
 * côté de la ligne « par identifiant », qui partagerait la dépense de l'une et les leads de l'autre. Un nom porté par
 * deux identifiants reste ambigu : non résolu.
 */
export function resoudreParNom<T extends MetaLeadLu>(formulaires: readonly T[], connues: readonly { publiciteId: string; publiciteNom: string | null; ensembleId: string | null; ensembleNom: string | null; campagneId: string; campagneNom: string | null }[]): T[] {
  const carte = (paires: [string | null, string | null][]) => {
    const m = new Map<string, string | null>();
    for (const [nom, id] of paires) if (nom && id) m.set(nom, m.has(nom) && m.get(nom) !== id ? null : id);
    return m;
  };
  const pubs = carte(connues.map((c) => [c.publiciteNom, c.publiciteId]));
  const ensembles = carte(connues.map((c) => [c.ensembleNom, c.ensembleId]));
  const campagnes = carte(connues.map((c) => [c.campagneNom, c.campagneId]));
  return formulaires.map((f) => ({
    ...f,
    adId: f.adId ?? (f.adNom ? pubs.get(f.adNom) ?? null : null),
    adsetId: f.adsetId ?? (f.adsetNom ? ensembles.get(f.adsetNom) ?? null : null),
    campagneId: f.campagneId ?? (f.campagneNom ? campagnes.get(f.campagneNom) ?? null : null),
  }));
}

async function completerIdentifiants<T extends MetaLeadLu>(formulaires: T[]): Promise<T[]> {
  if (!formulaires.some((f) => (!f.adId && f.adNom) || (!f.adsetId && f.adsetNom) || (!f.campagneId && f.campagneNom))) return formulaires;
  const connues = await prisma.depensePubJour.findMany({ where: { plateforme: "META" }, distinct: ["publiciteId"], select: { publiciteId: true, publiciteNom: true, ensembleId: true, ensembleNom: true, campagneId: true, campagneNom: true } });
  return resoudreParNom(formulaires, connues);
}

/** Le calcul de la publicité sur une période : lignes par campagne, ensemble et publicité, et totaux. */
export async function calculerPublicite(periode: Pick<Periode, "du" | "au">, maintenant: Date, synchro: boolean): Promise<CalculPublicite> {
  const { debut, fin } = bornes(periode);
  const [depense, lignesPub, metaLeadsBruts, cohorteMeta, signesMeta] = await Promise.all([
    depensePubDeLaPeriode(periode, maintenant, synchro),
    synchro ? prisma.depensePubJour.findMany({ where: { jour: { gte: periode.du, lte: periode.au } }, orderBy: { jour: "asc" } }) : Promise.resolve([]),
    prisma.metaLead.findMany({ where: { organique: false, soumisLe: { gte: debut, lt: fin }, leadId: { not: null } }, select: { leadId: true, soumisLe: true, adId: true, adNom: true, adsetId: true, adsetNom: true, campagneId: true, campagneNom: true } }),
    leadsDeLaPeriode(periode, "meta"),
    signaturesDeLaPeriode(periode, "meta"),
  ]);
  const metaLeads = await completerIdentifiants(metaLeadsBruts);
  const groupes = new Map<string, Groupe>();
  const groupe = (niveau: Niveau, plateforme: "META" | "GOOGLE_ADS", id: string, nom: string | null, parentNom: string | null) => {
    const k = cle(niveau, plateforme, id);
    let g = groupes.get(k);
    if (!g) groupes.set(k, (g = { niveau, plateforme, id, nom: nom || id, parentNom, depense: 0, impressions: 0, clics: 0, leadsPlateforme: 0, leadIds: new Set() }));
    else if (nom && g.nom === g.id) g.nom = nom;
    return g;
  };
  const parJour = { depense: { ...depense.parJour }, leadsCrm: {} as Record<string, number>, leadsPlateforme: {} as Record<string, number> };
  for (const l of lignesPub) {
    const plateforme = l.plateforme === "GOOGLE_ADS" ? "GOOGLE_ADS" : "META";
    const niveaux: [Niveau, string, string | null, string | null][] = [
      ["CAMPAGNE", l.campagneId, l.campagneNom, null],
      ...(l.ensembleId ? [["ENSEMBLE", l.ensembleId, l.ensembleNom, l.campagneNom ?? l.campagneId] as [Niveau, string, string | null, string | null]] : []),
      ["PUBLICITE", l.publiciteId, l.publiciteNom, l.ensembleNom ?? l.campagneNom ?? l.campagneId],
    ];
    for (const [niveau, id, nom, parent] of niveaux) {
      const g = groupe(niveau, plateforme, id, nom, parent);
      g.depense += l.depense;
      g.impressions += l.impressions;
      g.clics += l.clics;
      g.leadsPlateforme += l.leadsPlateforme;
    }
    inc(parJour.leadsPlateforme, l.jour, l.leadsPlateforme);
  }
  // Leads CRM, dédoublonnés : une personne compte une fois par ligne, attribuée à son premier formulaire payé.
  const premier = new Map<string, (typeof metaLeads)[number]>();
  for (const m of [...metaLeads].sort((a, b) => a.soumisLe.getTime() - b.soumisLe.getTime())) if (m.leadId && !premier.has(m.leadId)) premier.set(m.leadId, m);
  for (const m of premier.values()) {
    const campagneId = m.campagneId ?? m.campagneNom ?? "inconnue";
    groupe("CAMPAGNE", "META", campagneId, m.campagneNom ?? (m.campagneId ? null : "Campagne inconnue"), null).leadIds.add(m.leadId!);
    if (m.adsetId) groupe("ENSEMBLE", "META", m.adsetId, m.adsetNom, m.campagneNom ?? m.campagneId).leadIds.add(m.leadId!);
    groupe("PUBLICITE", "META", m.adId ?? m.adNom ?? "inconnue", m.adNom ?? (m.adId ? null : "Publicité inconnue"), m.adsetNom ?? m.campagneNom ?? m.campagneId).leadIds.add(m.leadId!);
    inc(parJour.leadsCrm, jourParis(m.soumisLe));
  }
  const leadsCrm = await leadsParIds([...premier.keys()]);
  const parId = new Map(leadsCrm.map((l) => [l.id, l]));
  const lignes = [...groupes.values()].map((g): LignePubliciteDetail => {
    const leads = [...g.leadIds].map((id) => parId.get(id)).filter((l): l is LeadAnalyse => Boolean(l));
    const devis = leads.filter((l) => l.devis).length;
    const signes = leads.filter((l) => l.signe).length;
    const encaisse = Math.round(leads.reduce((t, l) => t + l.encaisse, 0) * 100) / 100;
    // Sans synchronisation, la dépense d'une ligne n'est pas connue (le budget n'existe qu'en total) : aucun coût.
    const connue = synchro;
    const depenseLigne = Math.round(g.depense * 100) / 100;
    return {
      niveau: g.niveau,
      plateforme: g.plateforme,
      id: g.id,
      nom: g.nom,
      parentNom: g.parentNom,
      depense: depenseLigne,
      impressions: g.impressions,
      clics: g.clics,
      ctr: connue ? ratio(g.clics, g.impressions, 4) : null,
      cpm: connue && g.impressions > 0 ? arrondi2((depenseLigne / g.impressions) * 1000) : null,
      leadsPlateforme: g.leadsPlateforme,
      leadsCrm: leads.length,
      devis,
      signes,
      encaisse,
      coutParLead: connue ? arrondi2(ratio(depenseLigne, leads.length, 6)) : null,
      coutParDevis: connue ? arrondi2(ratio(depenseLigne, devis, 6)) : null,
      coutParSigne: connue ? arrondi2(ratio(depenseLigne, signes, 6)) : null,
      retourSurDepense: connue ? ratio(encaisse, depenseLigne, 2) : null,
      verdict: null,
      raisonVerdict: null,
      appeles: leads.filter((l) => l.appele).length,
      joints: leads.filter((l) => l.joint).length,
      leadIds: leads.map((l) => l.id),
    };
  });
  const ordre: Record<Niveau, number> = { CAMPAGNE: 0, ENSEMBLE: 1, PUBLICITE: 2 };
  lignes.sort((a, b) => (a.plateforme === b.plateforme ? 0 : a.plateforme === "META" ? -1 : 1) || ordre[a.niveau] - ordre[b.niveau] || b.depense - a.depense || b.leadsCrm - a.leadsCrm || a.nom.localeCompare(b.nom));
  return {
    depense,
    synchro,
    lignes,
    leadsCrm,
    leadsMeta: leadsMeta(cohorteMeta),
    signesMeta,
    leadsPlateforme: synchro ? lignesPub.filter((l) => l.plateforme === "META").reduce((t, l) => t + l.leadsPlateforme, 0) : null,
    impressions: synchro ? lignesPub.reduce((t, l) => t + l.impressions, 0) : null,
    clics: synchro ? lignesPub.reduce((t, l) => t + l.clics, 0) : null,
    parJour,
  };
}

export type EtatCampagneAnalytique = { debut: string | null; jour: number | null; duree: number; budget: number | null; enCours: boolean; regleDuJour: string | null; protocole: string; fenetre: { du: string; au: string } | null };

/** La campagne : jour en jours de Paris, règle du protocole, fenêtre du début à aujourd'hui (fin de campagne au plus tard). */
export async function campagneAnalytique(maintenant: Date): Promise<EtatCampagneAnalytique> {
  const [campagne, consignes] = await Promise.all([lireCampagne(maintenant), lireConsignes()]);
  const protocole = sectionProtocole(consignes.texte);
  const jour = jourDeCampagne(campagne, maintenant);
  const enCours = jour !== null && jour >= 1 && jour <= campagne.duree;
  const aujourdhui = jourParis(maintenant);
  const finCampagne = campagne.debut ? decalerJour(campagne.debut, campagne.duree - 1) : null;
  const fenetre = campagne.debut && jour !== null && jour >= 1 ? { du: campagne.debut, au: finCampagne && finCampagne < aujourdhui ? finCampagne : aujourdhui } : null;
  return { debut: campagne.debut, jour, duree: campagne.duree, budget: campagne.budget, enCours, regleDuJour: enCours && jour ? regleDuJour(protocole, jour) : null, protocole, fenetre };
}

/** Verdicts des publicités Meta, jugés sur la campagne entière (fenêtre du début à aujourd'hui). */
export async function verdictsDeLaCampagne(campagne: EtatCampagneAnalytique, maintenant: Date, synchro: boolean, calculPeriode?: CalculPublicite, periode?: Pick<Periode, "du" | "au">): Promise<{ verdicts: Map<string, ResultatVerdict>; calcul: CalculPublicite | null }> {
  if (!campagne.fenetre) return { verdicts: new Map(), calcul: null };
  const memeFenetre = calculPeriode && periode && periode.du === campagne.fenetre.du && periode.au === campagne.fenetre.au;
  const calcul = memeFenetre ? calculPeriode : await calculerPublicite(campagne.fenetre, maintenant, synchro);
  const pubs = calcul.lignes.filter((l) => l.niveau === "PUBLICITE" && l.plateforme === "META");
  const verdicts = verdictsDesPublicites(pubs.map((l) => ({ id: l.id, depense: synchro ? l.depense : null, leads: l.leadsCrm, devis: l.devis, signes: l.signes })), campagne.jour, tranchesDuProtocole(campagne.protocole));
  return { verdicts, calcul };
}

export async function construireEcranPublicite(periode: Periode, options: { etats: EtatSource[] }, maintenant: Date): Promise<Omit<EcranPublicite, "genereLe" | "alertes">> {
  const etatMeta = etatDe(options.etats, "META");
  const synchro = chiffresDisponibles(etatMeta);
  const [actuel, avant, campagne] = await Promise.all([calculerPublicite(periode, maintenant, synchro), calculerPublicite(periodePrecedente(periode), maintenant, synchro), campagneAnalytique(maintenant)]);
  const { verdicts } = await verdictsDeLaCampagne(campagne, maintenant, synchro, actuel, periode);
  for (const l of actuel.lignes) {
    const v = l.niveau === "PUBLICITE" && l.plateforme === "META" ? verdicts.get(l.id) : undefined;
    if (v) {
      l.verdict = v.verdict;
      l.raisonVerdict = v.raison;
    }
  }
  const estimation = actuel.depense.estimation;
  const sourceDepense = actuel.depense.origine === "SYNCHRO" ? "META" : "CRM";
  // Une seule définition (relecture B, point 5) : leads Meta et chantiers signés Meta de calculs.ts, pour tous les coûts.
  const signes = (c: CalculPublicite) => c.signesMeta.length;
  const leadsPlateforme = (c: CalculPublicite) => (c.synchro ? c.leadsPlateforme : null);
  const cout = (c: CalculPublicite, n: number) => coutPar(c.depense.total, n);
  const detailDepense = detailDepensePub(actuel.depense, etatMeta);
  const indicateurs = [
    indicateur({ cle: "depense", libelle: "Dépense", valeur: actuel.depense.total, precedente: avant.depense.total, format: "euros", favorable: "baisse", serie: serieDepuis(periode, actuel.parJour.depense), source: sourceDepense, detail: detailDepense }),
    indicateur({ cle: "impressions", libelle: "Impressions", valeur: actuel.impressions, precedente: avant.impressions, format: "nombre", favorable: "hausse", source: "META" }),
    indicateur({ cle: "clics", libelle: "Clics", valeur: actuel.clics, precedente: avant.clics, format: "nombre", favorable: "hausse", source: "META" }),
    indicateur({ cle: "ctr", libelle: "CTR", valeur: ratio(actuel.clics, actuel.impressions, 4), precedente: ratio(avant.clics, avant.impressions, 4), format: "pourcent", favorable: "hausse", source: "META" }),
    indicateur({ cle: "cpm", libelle: "CPM", valeur: actuel.impressions ? arrondi2(((actuel.depense.total ?? 0) / actuel.impressions) * 1000) : null, precedente: avant.impressions ? arrondi2(((avant.depense.total ?? 0) / avant.impressions) * 1000) : null, format: "euros", favorable: "baisse", source: "META" }),
    indicateur({ cle: "leadsMeta", libelle: "Leads Meta", valeur: leadsPlateforme(actuel), precedente: leadsPlateforme(avant), format: "nombre", favorable: "hausse", serie: serieDepuis(periode, actuel.parJour.leadsPlateforme), source: "META", detail: `${actuel.leadsMeta.length} dans le CRM` }),
    indicateur({ cle: "coutParLead", libelle: "Coût par lead Meta", valeur: cout(actuel, actuel.leadsMeta.length), precedente: cout(avant, avant.leadsMeta.length), format: "euros", favorable: "baisse", source: sourceDepense, detail: `${actuel.leadsMeta.length} leads Meta dans le CRM${estimation ? ", dépense estimée" : ""}` }),
    indicateur({ cle: "coutParSigne", libelle: "Coût par chantier signé", valeur: cout(actuel, signes(actuel)), precedente: cout(avant, signes(avant)), format: "euros", favorable: "baisse", source: sourceDepense, detail: signes(actuel) ? `${signes(actuel)} signés` : "aucun chantier signé encore" }),
  ];
  const jours = joursDe(periode);
  const courbeDepense = {
    titre: "Dépense et leads par jour",
    sousTitre: estimation ? "Dépense estimée au prorata du budget" : undefined,
    series: [
      { cle: "depense", libelle: "Dépense (€)", couleur: COULEURS_FAMILLE.meta },
      { cle: "leads", libelle: "Leads CRM", couleur: COULEURS_FAMILLE.seo },
    ],
    points: jours.map((jour) => ({ jour, valeurs: { depense: actuel.parJour.depense[jour] ?? 0, leads: actuel.parJour.leadsCrm[jour] ?? 0 } })),
  };
  return {
    onglet: "publicite",
    periode,
    sources: options.etats,
    campagne: campagne.debut ? { debut: campagne.debut, jour: campagne.jour, duree: campagne.duree, budget: campagne.budget, regleDuJour: campagne.regleDuJour } : null,
    indicateurs,
    courbeDepense,
    lignes: actuel.lignes.map(versLignePublicite),
    estimation,
  };
}
