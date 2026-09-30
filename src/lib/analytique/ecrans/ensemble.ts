import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { jourParis } from "@/lib/dossiers/dates";
import { visitesDuSite } from "../appuis";
import { carnetDeCommandes, comptesDesLeads, coutPar, depensePubDeLaPeriode, detailDepensePub, devisDeLaPeriode, encaissementsDeLaPeriode, leadsDeLaPeriode, leadsMeta as filtrerLeadsMeta, PLAFOND_PUB, signesMeta as filtrerSignesMeta, toutesLesSignatures, totalEncaisse, type DepensePub, type LeadAnalyse } from "../calculs";
import { bornes, decalerMois, dernierJourDuMoisDe, joursDe, periodePrecedente } from "../periode";
import { COULEURS_FAMILLE, FAMILLES, LIBELLES_FAMILLE, type EcranEnsemble, type EtatSource, type Famille, type LigneSource, type Periode, type ResumeDuJour } from "../types";
import { chiffresDisponibles, compterDans, etatDe, indicateur, jourEntame, ratio, serieParJour } from "./commun";
import { calculerPublicite, campagneAnalytique, verdictsDeLaCampagne } from "./publicite";
import { chiffresFiche, chiffresSeo, vuesFicheParMois } from "./seo";
import { simulationsDuSite } from "./site";
import { tunnelDe } from "./tunnel";

/**
 * Mission 17 (partie B) — la Vue d'ensemble : six tuiles (visites, simulations lancées, leads, devis envoyés, chantiers
 * signés, coût par lead Meta avec sa courbe — le coût par chantier signé en détail, maquette), comparées à la période
 * précédente (hors jour entamé : `jourEntame`) ; leads par jour et par famille, devis par jour et par famille ; le tunnel visites → simulations → leads → appelés → joints → devis → signés → encaissés (cohorte des
 * leads de la période) et l'étape qui perd le plus (plus faible taux parmi lead → appel, appel → joint, joint → devis) ;
 * les blocs publicité (campagne entière), SEO, fiche Google, qualité par source et argent. Filtre par famille de source
 * (leads, devis, signés, visites, simulations ; l'argent et la publicité restent globaux).
 */

const pct = (v: number | null) => (v === null ? "—" : `${(Math.round(v * 1000) / 10).toLocaleString("fr-FR")} %`);
const eurosCourts = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} €`;

/** La ligne « ChatGPT (simulations) » : dossiers dont une simulation a été faite dans ChatGPT, hors tunnel. */
async function simulationsChatGpt(periode: Pick<Periode, "du" | "au">): Promise<LigneSource | null> {
  const { debut, fin } = bornes(periode);
  const simulations = await prisma.simulationEspace.findMany({ where: { ...AVEC_ARCHIVES, source: "CHATGPT", createdAt: { gte: debut, lt: fin } }, select: { dossierId: true } });
  const ids = [...new Set(simulations.map((s) => s.dossierId))];
  if (!ids.length) return null;
  const avecDevis = await prisma.dossier.count({ where: { id: { in: ids }, documents: { some: { type: "DEVIS", numero: { not: null }, visibleEspace: true, archiveLe: null } } } });
  return { famille: "ia", libelle: "ChatGPT (simulations)", leads: ids.length, joints: 0, devis: avecDevis, signes: 0, tauxDevis: null, horsTunnel: true, note: "Simulations préparées dans ChatGPT pour des dossiers : hors tunnel, les « leads » sont des dossiers." };
}

/** Qualité par source (pur) : une ligne par famille présente dans la cohorte. */
export function qualiteParSource(leads: readonly LeadAnalyse[]): LigneSource[] {
  return FAMILLES.map((famille) => {
    const groupe = leads.filter((l) => l.famille === famille);
    const c = comptesDesLeads(groupe);
    return { famille, libelle: LIBELLES_FAMILLE[famille], leads: c.leads, joints: c.joints, devis: c.devis, signes: c.signes, tauxDevis: ratio(c.devis, c.leads) };
  }).filter((l) => l.leads > 0).sort((a, b) => b.leads - a.leads);
}

/** Le tunnel de la Vue d'ensemble (pur). */
export function tunnelEnsemble(e: { visites: number | null; simulations: number | null; leads: readonly LeadAnalyse[] }) {
  const c = comptesDesLeads(e.leads);
  return tunnelDe(
    [
      { cle: "visites", libelle: "Visites", valeur: e.visites, source: "SITE" },
      { cle: "simulations", libelle: "Simulations lancées", valeur: e.simulations, source: "SITE" },
      { cle: "leads", libelle: "Leads", valeur: c.leads, source: "CRM" },
      { cle: "appeles", libelle: "Appelés", valeur: c.appeles, source: "CRM" },
      { cle: "joints", libelle: "Joints", valeur: c.joints, source: "CRM" },
      { cle: "devis", libelle: "Devis", valeur: c.devis, source: "CRM" },
      { cle: "signes", libelle: "Signés", valeur: c.signes, source: "CRM" },
      { cle: "encaisses", libelle: "Encaissés", valeur: c.encaisses, source: "CRM" },
    ],
    ["appeles", "joints", "devis"],
  );
}

/** Le coût par lead Meta jour après jour, en cumul depuis le début de la période (sparkline ; pur). Avant le premier lead : la première valeur connue. */
export function serieCoutParLead(jours: readonly string[], depense: DepensePub, leads: readonly { jour: string }[]): number[] {
  let cumulDepense = 0;
  let cumulLeads = 0;
  const brute = jours.map((j) => {
    cumulDepense += depense.parJour[j] ?? 0;
    cumulLeads += leads.filter((l) => l.jour === j).length;
    return coutPar(depense.total === null ? null : cumulDepense, cumulLeads);
  });
  const premiere = brute.find((v): v is number => v !== null) ?? 0;
  let derniere = premiere;
  return brute.map((v) => (v === null ? derniere : (derniere = v)));
}

/** Somme des jours connus d'une dépense jusqu'à `au` inclus ; null si la dépense est inconnue. */
const depenseJusqua = (d: DepensePub, au: string) => (d.total === null ? null : Math.round(Object.entries(d.parJour).filter(([j]) => j <= au).reduce((t, [, v]) => t + v, 0) * 100) / 100);

/** Une courbe « par jour et par famille » d'éléments datés (pur). */
export function courbeParFamille(titre: string, jours: readonly string[], elements: readonly { jour: string; famille: Famille }[], sousTitre?: string) {
  const familles = FAMILLES.filter((f) => elements.some((e) => e.famille === f));
  return {
    titre,
    ...(sousTitre ? { sousTitre } : {}),
    series: familles.map((f) => ({ cle: f, libelle: LIBELLES_FAMILLE[f], couleur: COULEURS_FAMILLE[f] })),
    points: jours.map((jour) => ({ jour, valeurs: Object.fromEntries(familles.map((f) => [f, elements.filter((e) => e.jour === jour && e.famille === f).length])) })),
  };
}

export async function construireEcranEnsemble(periode: Periode, options: { etats: EtatSource[]; source?: Famille | null; resume?: ResumeDuJour | null }, maintenant: Date): Promise<Omit<EcranEnsemble, "genereLe" | "alertes">> {
  const filtre = options.source ?? null;
  const precedente = periodePrecedente(periode);
  const etatMeta = etatDe(options.etats, "META");
  const synchro = chiffresDisponibles(etatMeta);
  const scOk = chiffresDisponibles(etatDe(options.etats, "SEARCH_CONSOLE"));
  const ficheOk = chiffresDisponibles(etatDe(options.etats, "FICHE_GOOGLE"));
  const aujourdhui = jourParis(maintenant);
  const moisCourant = aujourdhui.slice(0, 7);
  const moisPrecedent = decalerMois(moisCourant, -1);

  const [leads, leadsAvant, devis, devisAvant, signatures, visites, visitesAvant, sims, simsAvant, depense, depenseAvant, campagne, carnet, encaisses, pubMois, encaisseMoisPrecedent, seo, fiche, moisFiche, chatgpt] = await Promise.all([
    leadsDeLaPeriode(periode, filtre),
    leadsDeLaPeriode(precedente, filtre),
    devisDeLaPeriode(periode, filtre),
    devisDeLaPeriode(precedente, filtre),
    toutesLesSignatures(),
    visitesDuSite(periode, filtre),
    visitesDuSite(precedente, filtre),
    simulationsDuSite(periode),
    simulationsDuSite(precedente),
    depensePubDeLaPeriode(periode, maintenant, synchro),
    depensePubDeLaPeriode(precedente, maintenant, synchro),
    campagneAnalytique(maintenant),
    carnetDeCommandes(),
    encaissementsDeLaPeriode(periode),
    depensePubDeLaPeriode({ du: `${moisCourant}-01`, au: aujourdhui }, maintenant, synchro),
    encaissementsDeLaPeriode({ du: `${moisPrecedent}-01`, au: dernierJourDuMoisDe(moisPrecedent) }),
    scOk ? chiffresSeo(periode) : Promise.resolve(null),
    ficheOk ? chiffresFiche(periode) : Promise.resolve(null),
    ficheOk ? vuesFicheParMois(periode.au) : Promise.resolve([]),
    filtre === null || filtre === "ia" ? simulationsChatGpt(periode) : Promise.resolve(null),
  ]);
  const jours = joursDe(periode);
  const signesDe = (p: { du: string; au: string }) => signatures.filter((s) => s.jour >= p.du && s.jour <= p.au && (!filtre || s.famille === filtre));
  const signes = signesDe(periode);
  const signesAvant = signesDe(precedente);
  const simsFiltre = (s: typeof sims) => ({ lancees: s.lancees.filter((x) => !filtre || x.famille === filtre), terminees: s.terminees.filter((x) => !filtre || x.famille === filtre) });
  const simulations = simsFiltre(sims);
  const simulationsAvant = simsFiltre(simsAvant);

  // Publicité : la campagne entière quand elle a commencé (jour N sur 21), sinon la période.
  const fenetrePub = campagne.fenetre ?? periode;
  const calculPub = await calculerPublicite(fenetrePub, maintenant, synchro);
  const { verdicts } = await verdictsDeLaCampagne(campagne, maintenant, synchro, calculPub, fenetrePub);
  // Une seule définition (relecture B, point 5) : leads Meta, chantiers signés Meta, coûts — calculs.ts.
  const meta = filtrerLeadsMeta(filtre && filtre !== "meta" ? [] : leads);
  const metaAvant = filtrerLeadsMeta(filtre && filtre !== "meta" ? [] : leadsAvant);
  const signesMeta = filtrerSignesMeta(signes);
  const cplMeta = coutPar(depense.total, meta.length);
  const coutSigne = coutPar(depense.total, signesMeta.length);
  const carnetMontant = Math.round(carnet.reduce((t, c) => t + c.montant, 0) * 100) / 100;
  const c = comptesDesLeads(leads);

  // Relecture B (point 4) : la période qui finit aujourd'hui compte un jour entamé ; l'évolution se compare hors de ce jour, des deux côtés.
  const entame = jourEntame(periode, aujourdhui);
  const comparer = (actuel: readonly { jour: string }[], avant: readonly { jour: string }[]) => (entame ? { valeur: compterDans(actuel, entame.actuel), precedente: compterDans(avant, entame.avant) } : null);
  const visitesJusqua = (v: typeof visites, au: string) => (v ? v.parJour.filter((p) => p.jour <= au).reduce((t, p) => t + p.visites, 0) : null);
  const detailPub = detailDepensePub(depense, etatMeta);

  const indicateurs = [
    indicateur({ cle: "visites", libelle: "Visites du site", valeur: visites?.visites ?? null, precedente: visitesAvant?.visites ?? null, format: "nombre", favorable: "hausse", serie: visites ? visites.parJour.map((p) => p.visites) : [], source: "SITE", detail: visites ? null : "Mesure du site illisible pour l'instant", comparaison: entame ? { valeur: visitesJusqua(visites, entame.actuel.au), precedente: visitesJusqua(visitesAvant, entame.avant.au) } : null }),
    indicateur({ cle: "simulations", libelle: "Simulations lancées", valeur: simulations.lancees.length, precedente: simulationsAvant.lancees.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, simulations.lancees), source: "SITE", detail: simulations.terminees.length ? `${simulations.terminees.length} terminée${simulations.terminees.length > 1 ? "s" : ""}, ${pct(ratio(simulations.terminees.filter((t) => t.lead).length, simulations.terminees.length))} laissent leurs coordonnées` : null, comparaison: comparer(simulations.lancees, simulationsAvant.lancees) }),
    indicateur({ cle: "leads", libelle: "Leads", valeur: c.leads, precedente: leadsAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, leads), source: "CRM", detail: !filtre && meta.length ? `dont ${meta.length} Meta` : null, comparaison: comparer(leads, leadsAvant) }),
    indicateur({ cle: "devis", libelle: "Devis envoyés", valeur: devis.length, precedente: devisAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, devis), source: "CRM", detail: c.leads ? `${pct(ratio(devis.length, c.leads))} des leads` : null, comparaison: comparer(devis, devisAvant) }),
    indicateur({ cle: "signes", libelle: "Chantiers signés", valeur: signes.length, precedente: signesAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, signes), source: "CRM", detail: carnetMontant > 0 ? `${eurosCourts(carnetMontant)} en attente (${carnet.length} devis)` : null, comparaison: comparer(signes, signesAvant) }),
    indicateur({
      cle: "coutParLeadMeta",
      libelle: "Coût par lead Meta",
      valeur: cplMeta,
      precedente: coutPar(depenseAvant.total, metaAvant.length),
      format: "euros",
      favorable: "baisse",
      serie: serieCoutParLead(jours, depense, meta),
      source: depense.origine === "SYNCHRO" ? "META" : "CRM",
      detail: depense.total === null ? "Dépense pub inconnue" : `Coût par chantier signé : ${coutSigne === null ? "—" : `${coutSigne.toLocaleString("fr-FR")} €`}${detailPub ? ` (${detailPub})` : ""}`,
      comparaison: entame ? { valeur: coutPar(depenseJusqua(depense, entame.actuel.au), compterDans(meta, entame.actuel)), precedente: coutPar(depenseJusqua(depenseAvant, entame.avant.au), compterDans(metaAvant, entame.avant)) } : null,
    }),
  ];

  const courbeLeads = courbeParFamille("Leads par jour et par source", jours, leads, campagne.debut && campagne.debut >= periode.du && campagne.debut <= periode.au ? `Campagne lancée le ${campagne.debut.slice(8, 10)}/${campagne.debut.slice(5, 7)}` : undefined);
  const courbeDevis = courbeParFamille("Devis envoyés par jour et par source", jours, devis);

  const pubs = calculPub.lignes.filter((l) => l.niveau === "PUBLICITE" && l.plateforme === "META").sort((a, b) => b.leadsCrm - a.leadsCrm);
  const devisPub = calculPub.leadsMeta.filter((l) => l.devis).length;
  const publicite = campagne.debut || calculPub.leadsMeta.length || calculPub.leadsCrm.length || (calculPub.depense.total ?? 0) > 0
    ? {
        jourCampagne: campagne.jour,
        dureeCampagne: campagne.debut ? campagne.duree : null,
        depense: calculPub.depense.total,
        budget: campagne.budget,
        leads: calculPub.leadsMeta.length,
        coutParLead: coutPar(calculPub.depense.total, calculPub.leadsMeta.length),
        coutParDevis: coutPar(calculPub.depense.total, devisPub),
        // Sans verdict chiffré (dépense par publicité inconnue sans synchronisation, ou pas de campagne) : « Trop tôt », et le détail le dit.
        publicites: pubs.map((p) => {
          const v = verdicts.get(p.id);
          return { nom: p.nom, detail: `${p.joints} joint${p.joints > 1 ? "s" : ""} sur ${p.appeles} appelé${p.appeles > 1 ? "s" : ""}${v && v.verdict === null ? " · dépense par publicité inconnue" : ""}`, verdict: v?.verdict ?? "ATTENDRE" };
        }),
        estimation: calculPub.depense.estimation,
      }
    : null;

  const encaisse = totalEncaisse(encaisses);
  const encaissePrecedentMois = totalEncaisse(encaisseMoisPrecedent);
  return {
    onglet: "ensemble",
    periode,
    sources: options.etats,
    filtreSource: filtre,
    resume: options.resume ?? null,
    indicateurs,
    courbeLeads,
    courbeDevis,
    tunnel: tunnelEnsemble({ visites: visites?.visites ?? null, simulations: simulations.lancees.length, leads }),
    publicite,
    // Relecture B (écran, point 2) : source non branchée (ou en attente d'accès) → null, l'écran dit quoi faire.
    seo: seo ? { clics: seo.actuel.clics, impressions: seo.actuel.impressions, position: seo.actuel.position, opportunites: seo.actuel.opportunites.sansClic.slice(0, 3).map((o) => ({ requete: o.cle, impressions: o.impressions, clics: o.clics })) } : null,
    fiche: fiche ? { vues: fiche.actuel.vues, interactions: fiche.actuel.interactions, avis: fiche.actuel.avis.nombre, note: fiche.actuel.avis.note, mois: moisFiche } : null,
    qualite: [...qualiteParSource(leads), ...(chatgpt ? [chatgpt] : [])],
    argent: {
      encaisse,
      devisEnAttente: carnetMontant,
      depensePub: depense.total,
      // Règle des 20 % : dépense pub du mois en cours / encaissé du mois précédent.
      ratioPub: pubMois.total === null ? null : ratio(pubMois.total, encaissePrecedentMois),
      plafond: PLAFOND_PUB,
    },
  };
}
