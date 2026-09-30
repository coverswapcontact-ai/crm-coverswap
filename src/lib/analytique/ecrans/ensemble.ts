import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { jourParis } from "@/lib/dossiers/dates";
import { visitesDuSite } from "../appuis";
import { carnetDeCommandes, comptesDesLeads, depensePubDeLaPeriode, devisDeLaPeriode, encaissementsDeLaPeriode, leadsDeLaPeriode, PLAFOND_PUB, toutesLesSignatures, totalEncaisse, type LeadAnalyse } from "../calculs";
import { bornes, decalerMois, dernierJourDuMoisDe, joursDe, periodePrecedente } from "../periode";
import { COULEURS_FAMILLE, FAMILLES, LIBELLES_FAMILLE, type EcranEnsemble, type EtatSource, type Famille, type LigneSource, type Periode, type ResumeDuJour } from "../types";
import { arrondi2, chiffresDisponibles, etatDe, indicateur, ratio, serieParJour } from "./commun";
import { calculerPublicite, campagneAnalytique, verdictsDeLaCampagne } from "./publicite";
import { chiffresFiche, chiffresSeo, vuesFicheParMois } from "./seo";
import { simulationsDuSite } from "./site";
import { tunnelDe } from "./tunnel";

/**
 * Mission 17 (partie B) — la Vue d'ensemble : six tuiles (visites, simulations, leads, devis, chantiers signés, coût
 * par chantier signé — le coût par lead Meta en détail), comparées à la période précédente ; leads et devis par jour
 * et par famille ; le tunnel visites → simulations → leads → appelés → joints → devis → signés → encaissés (cohorte des
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
      { cle: "simulations", libelle: "Simulations", valeur: e.simulations, source: "SITE" },
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

export async function construireEcranEnsemble(periode: Periode, options: { etats: EtatSource[]; source?: Famille | null; resume?: ResumeDuJour | null }, maintenant: Date): Promise<Omit<EcranEnsemble, "genereLe" | "alertes">> {
  const filtre = options.source ?? null;
  const precedente = periodePrecedente(periode);
  const etatMeta = etatDe(options.etats, "META");
  const synchro = chiffresDisponibles(etatMeta);
  const scOk = chiffresDisponibles(etatDe(options.etats, "SEARCH_CONSOLE"));
  const ficheOk = chiffresDisponibles(etatDe(options.etats, "FICHE_GOOGLE"));
  const moisCourant = jourParis(maintenant).slice(0, 7);
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
    depensePubDeLaPeriode({ du: `${moisCourant}-01`, au: jourParis(maintenant) }, maintenant, synchro),
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
  const leadsMeta = leads.filter((l) => l.famille === "meta").length;
  const signesMeta = signes.filter((s) => s.famille === "meta").length;
  const signesMetaAvant = signesAvant.filter((s) => s.famille === "meta").length;
  const cplMeta = arrondi2(ratio(depense.total, leadsMeta, 6));
  const carnetMontant = Math.round(carnet.reduce((t, c) => t + c.montant, 0) * 100) / 100;
  const c = comptesDesLeads(leads);

  const indicateurs = [
    indicateur({ cle: "visites", libelle: "Visites du site", valeur: visites?.visites ?? null, precedente: visitesAvant?.visites ?? null, format: "nombre", favorable: "hausse", serie: visites ? visites.parJour.map((p) => p.visites) : [], source: "SITE", detail: visites ? null : "Mesure du site illisible pour l'instant" }),
    indicateur({ cle: "simulations", libelle: "Simulations", valeur: simulations.terminees.length, precedente: simulationsAvant.terminees.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, simulations.terminees), source: "SITE", detail: simulations.terminees.length ? `${pct(ratio(simulations.terminees.filter((t) => t.lead).length, simulations.terminees.length))} laissent leurs coordonnées` : null }),
    indicateur({ cle: "leads", libelle: "Leads", valeur: c.leads, precedente: leadsAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, leads), source: "CRM", detail: !filtre && leadsMeta ? `dont ${leadsMeta} Meta` : null }),
    indicateur({ cle: "devis", libelle: "Devis envoyés", valeur: devis.length, precedente: devisAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, devis), source: "CRM", detail: c.leads ? `${pct(ratio(devis.length, c.leads))} des leads` : null }),
    indicateur({ cle: "signes", libelle: "Chantiers signés", valeur: signes.length, precedente: signesAvant.length, format: "nombre", favorable: "hausse", serie: serieParJour(periode, signes), source: "CRM", detail: carnetMontant > 0 ? `${eurosCourts(carnetMontant)} en attente (${carnet.length} devis)` : null }),
    indicateur({ cle: "coutParSigne", libelle: "Coût par chantier signé", valeur: arrondi2(ratio(depense.total, signesMeta, 6)), precedente: arrondi2(ratio(depenseAvant.total, signesMetaAvant, 6)), format: "euros", favorable: "baisse", serie: [], source: depense.origine === "SYNCHRO" ? "META" : "CRM", detail: depense.total === null ? "Dépense pub inconnue" : `Coût par lead Meta : ${cplMeta === null ? "—" : `${cplMeta.toLocaleString("fr-FR")} €`}${depense.estimation ? " (estimation)" : depense.origine === "SYNCHRO" ? " (réel Meta)" : ""}` }),
  ];

  const famillesCourbe = FAMILLES.filter((f) => leads.some((l) => l.famille === f));
  const courbeLeads = {
    titre: "Leads par jour et par source",
    sousTitre: campagne.debut && campagne.debut >= periode.du && campagne.debut <= periode.au ? `Campagne lancée le ${campagne.debut.slice(8, 10)}/${campagne.debut.slice(5, 7)}` : undefined,
    series: [...famillesCourbe.map((f) => ({ cle: f, libelle: LIBELLES_FAMILLE[f], couleur: COULEURS_FAMILLE[f] })), { cle: "devis", libelle: "Devis", couleur: "#F2F3F5" }],
    points: jours.map((jour) => ({ jour, valeurs: { ...Object.fromEntries(famillesCourbe.map((f) => [f, leads.filter((l) => l.jour === jour && l.famille === f).length])), devis: devis.filter((d) => d.jour === jour).length } })),
  };

  const pubs = calculPub.lignes.filter((l) => l.niveau === "PUBLICITE" && l.plateforme === "META").sort((a, b) => b.leadsCrm - a.leadsCrm);
  const devisPub = calculPub.leadsCrm.filter((l) => l.devis).length;
  const publicite = campagne.debut || calculPub.leadsCrm.length || (calculPub.depense.total ?? 0) > 0
    ? {
        jourCampagne: campagne.jour,
        dureeCampagne: campagne.debut ? campagne.duree : null,
        depense: calculPub.depense.total,
        budget: campagne.budget,
        leads: calculPub.leadsCrm.length,
        coutParLead: arrondi2(ratio(calculPub.depense.total, calculPub.leadsCrm.length, 6)),
        coutParDevis: arrondi2(ratio(calculPub.depense.total, devisPub, 6)),
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
    tunnel: tunnelEnsemble({ visites: visites?.visites ?? null, simulations: simulations.lancees.length, leads }),
    publicite,
    seo: { clics: seo?.actuel.clics ?? null, impressions: seo?.actuel.impressions ?? null, position: seo?.actuel.position ?? null, opportunites: (seo?.actuel.opportunites.sansClic ?? []).slice(0, 3).map((o) => ({ requete: o.cle, impressions: o.impressions, clics: o.clics })) },
    fiche: { vues: fiche ? fiche.actuel.vues : null, interactions: fiche ? fiche.actuel.interactions : null, avis: fiche?.actuel.avis.nombre ?? null, note: fiche?.actuel.avis.note ?? null, mois: moisFiche },
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
