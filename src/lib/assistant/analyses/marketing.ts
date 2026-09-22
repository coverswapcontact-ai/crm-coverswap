import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { libelleSourceLead } from "@/lib/prospects/constantes";
import { departementDuCodePostal, zoneDuDepartement, type ZoneIntervention } from "@/lib/prospects/priorite";
import { zoneIntervention } from "@/lib/prospects/qualification";
import { definirOutil, format, lien } from "../definition";
import { etatCampagne } from "../outils/lecture";
import { resoudrePeriode, schemaPeriode } from "../periodes";
import { arrondi, avertissementMinces, evolution, grouper, repartir, somme, taux } from "./commun";

/**
 * Manager marketing (mission 8) : par campagne et par publicité, la dépense,
 * les leads, le coût par lead, par devis, par chantier signé, le chiffre
 * d'affaires et le retour sur dépense ; la qualité des leads par source ; la
 * géographie. La dépense vient des dépenses « Publicité » saisies dans le CRM
 * quand il y en a, sinon du prorata du budget de campagne (Paramètres) : le
 * CRM ne lit pas la dépense réelle chez Meta, et le dit.
 */

export type LeadMarketing = {
  id: string;
  recuLe: Date;
  source: string;
  campagne: string | null;
  publicite: string | null;
  ville: string;
  codePostal: string | null;
  zone: "ZONE" | "PROCHE" | "HORS_ZONE" | "INCONNUE";
  occupation: string | null;
  joignable: boolean;
  appele: boolean;
  doublon: boolean;
  archive: boolean;
  archiveMotif: string | null;
  devis: boolean;
  signe: boolean;
  encaisse: number;
};

/** Coût par lead, par devis, par chantier, chiffre d'affaires et retour sur dépense (pur). */
export function rendementDe(leads: LeadMarketing[], depense: number | null) {
  const utiles = leads.filter((l) => !l.archive);
  const devis = utiles.filter((l) => l.devis).length;
  const signes = utiles.filter((l) => l.signe).length;
  const encaisse = somme(utiles.map((l) => l.encaisse));
  const cout = (n: number) => (depense === null ? null : n === 0 ? null : arrondi(depense / n));
  return {
    leads: leads.length,
    leadsUtiles: utiles.length,
    devis,
    signes,
    encaisse,
    depense,
    coutParLead: cout(leads.length),
    coutParDevis: cout(devis),
    coutParChantier: cout(signes),
    retourSurDepense: depense === null || depense === 0 ? null : arrondi(encaisse / depense, 2),
    tauxDevis: taux(devis, utiles.length),
    tauxSignature: taux(signes, utiles.length),
  };
}

/** Qualité d'un groupe de leads : joignables, hors zone, locataires, doublons (pur). */
export function qualiteDe(leads: LeadMarketing[]) {
  const appeles = leads.filter((l) => l.appele);
  return {
    leads: leads.length,
    appeles: appeles.length,
    joignables: appeles.filter((l) => l.joignable).length,
    tauxJoignable: taux(appeles.filter((l) => l.joignable).length, appeles.length),
    horsZone: leads.filter((l) => l.zone === "HORS_ZONE").length,
    zoneInconnue: leads.filter((l) => l.zone === "INCONNUE").length,
    locataires: leads.filter((l) => l.occupation === "LOCATAIRE").length,
    doublons: leads.filter((l) => l.doublon).length,
    archives: leads.filter((l) => l.archive).length,
    archivesParMotif: repartir(leads.filter((l) => l.archive), (l) => l.archiveMotif ?? "SANS_MOTIF"),
  };
}

async function chargerLeads(debut: Date, fin: Date, zone: ZoneIntervention): Promise<LeadMarketing[]> {
  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: debut, lt: fin } },
    select: {
      id: true, createdAt: true, source: true, campagne: true, publicite: true, ville: true, codePostal: true, occupation: true, doublonDe: true, doublonTraiteLe: true, archiveLe: true, archiveMotif: true,
      notesAppel: { where: { archiveLe: null }, select: { issue: true } },
      interactions: { where: { archiveLe: null, type: "APPEL" }, select: { id: true }, take: 1 },
      dossiers: { where: { archiveLe: null }, select: { etape: true, documents: { where: { type: "DEVIS", numero: { not: null }, archiveLe: null }, select: { id: true }, take: 1 }, accords: { where: { retireLe: null }, select: { id: true }, take: 1 }, encaissements: { where: { statut: "VALIDE" }, select: { montant: true } } } },
    },
  });
  return leads.map((l) => ({
    id: l.id,
    recuLe: l.createdAt,
    source: l.source,
    campagne: l.campagne,
    publicite: l.publicite,
    ville: l.ville,
    codePostal: l.codePostal,
    zone: zoneDuDepartement(departementDuCodePostal(l.codePostal), zone),
    occupation: l.occupation,
    appele: l.notesAppel.length > 0 || l.interactions.length > 0,
    joignable: l.notesAppel.some((n) => n.issue && n.issue !== "PAS_DE_REPONSE") || l.interactions.length > 0,
    doublon: Boolean(l.doublonDe) && !l.doublonTraiteLe,
    archive: Boolean(l.archiveLe),
    archiveMotif: l.archiveMotif,
    devis: l.dossiers.some((d) => d.documents.length > 0),
    signe: l.dossiers.some((d) => d.accords.length > 0 || ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"].includes(d.etape)),
    encaisse: somme(l.dossiers.flatMap((d) => d.encaissements.map((e) => e.montant))),
  }));
}

export async function analyseMarketing(entree: z.output<typeof schemaPeriode>, maintenant: Date = new Date()) {
  const { periode, precedente } = resoudrePeriode(entree, maintenant);
  const zone = await zoneIntervention(maintenant);
  const [leads, leadsAvant, depensesPub, campagne] = await Promise.all([
    chargerLeads(periode.debut, periode.fin, zone),
    chargerLeads(precedente.debut, precedente.fin, zone),
    prisma.depense.findMany({ where: { archiveLe: null, categorie: "PUBLICITE", payeeLe: { gte: precedente.debut, lt: periode.fin } }, select: { montant: true, payeeLe: true, libelle: true, fournisseur: true } }),
    etatCampagne(maintenant),
  ]);
  const depenseSaisie = somme(depensesPub.filter((d) => d.payeeLe >= periode.debut).map((d) => d.montant));
  const depenseSaisieAvant = somme(depensesPub.filter((d) => d.payeeLe < periode.debut).map((d) => d.montant));
  // Dépense retenue : les dépenses « Publicité » saisies si Lucas en a ; sinon le prorata de la campagne en cours (si elle tombe dans la période).
  const campagneDansPeriode = campagne.enCours && campagne.debut !== null && campagne.debut <= periode.au;
  const depenseRetenue = depenseSaisie > 0 ? depenseSaisie : campagneDansPeriode && campagne.depenseEstimee !== null ? campagne.depenseEstimee : null;
  const origineDepense = depenseSaisie > 0 ? "DEPENSES_SAISIES" : depenseRetenue !== null ? "PRORATA_CAMPAGNE" : "INCONNUE";
  const payants = leads.filter((l) => l.source === "META_ADS");
  const payantsAvant = leadsAvant.filter((l) => l.source === "META_ADS");

  const parAxe = (liste: LeadMarketing[], cle: (l: LeadMarketing) => string | null) =>
    [...grouper(liste, cle).entries()].map(([nom, groupe]) => {
      // La dépense d'un axe n'est pas connue : on la répartit au prorata des leads (dit dans les définitions).
      const part = depenseRetenue !== null && payants.length ? arrondi((depenseRetenue * groupe.length) / payants.length) : null;
      return { nom, ...rendementDe(groupe, part), qualite: qualiteDe(groupe) };
    }).sort((a, b) => b.leads - a.leads);

  const geographie = repartir(leads.filter((l) => !l.archive), (l) => l.ville.trim().replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || "—").slice(0, 15);
  const parZone = repartir(leads, (l) => l.zone, (z) => ({ ZONE: "Dans la zone", PROCHE: "Département voisin", HORS_ZONE: "Hors zone", INCONNUE: "Zone inconnue" })[z] ?? z);
  const parDepartement = repartir(leads, (l) => departementDuCodePostal(l.codePostal) ?? "?").slice(0, 10);

  return {
    calculeLe: maintenant.toISOString(),
    periode: { du: periode.du, au: periode.au, libelle: periode.libelle, jours: periode.jours },
    precedente: { du: precedente.du, au: precedente.au },
    definitions: {
      leads: "Leads reçus dans la période, archivés compris pour les coûts (une dépense se juge sur tout ce qu'elle a produit) ; les taux excluent les archivés.",
      depense: origineDepense === "DEPENSES_SAISIES" ? "Somme des dépenses de catégorie « Publicité » saisies dans le CRM sur la période." : origineDepense === "PRORATA_CAMPAGNE" ? "Aucune dépense « Publicité » saisie : prorata du budget de la campagne en cours (Paramètres → Campagne publicitaire). Ce n'est pas la dépense réelle Meta." : "Aucune dépense connue : ni dépense « Publicité » saisie, ni campagne en cours. Les coûts par lead ne sont pas calculables.",
      parAxe: "La dépense d'une campagne ou d'une publicité n'est pas connue individuellement : elle est répartie au prorata de ses leads Meta.",
      coutParChantier: "Dépense divisée par le nombre de leads signés (bon pour accord ou dossier signé et au-delà).",
      retourSurDepense: "Encaissé sur les dossiers de ces leads (à ce jour) divisé par la dépense.",
      joignables: "Parmi les leads appelés : au moins une issue autre que « pas de réponse ».",
      zone: "D'après le code postal et la zone d'intervention des paramètres.",
    },
    avertissement: avertissementMinces(payants.length, "leads Meta"),
    depense: { retenue: depenseRetenue, origine: origineDepense, saisie: depenseSaisie, saisiePrecedente: depenseSaisieAvant, lignes: depensesPub.filter((d) => d.payeeLe >= periode.debut).map((d) => ({ le: d.payeeLe.toISOString().slice(0, 10), montant: d.montant, fournisseur: d.fournisseur, libelle: d.libelle })) },
    campagne: { debut: campagne.debut, jour: campagne.jour, duree: campagne.duree, enCours: campagne.enCours, budget: campagne.budget, depenseEstimee: campagne.depenseEstimee, regleDuJour: campagne.regle, leadsMetaSurLaCampagne: campagne.leads },
    global: { meta: rendementDe(payants, depenseRetenue), metaPrecedent: rendementDe(payantsAvant, depenseSaisieAvant > 0 ? depenseSaisieAvant : null), evolutionLeadsMeta: evolution(payants.length, payantsAvant.length), tous: rendementDe(leads, null) },
    parCampagne: parAxe(payants, (l) => l.campagne ?? "Campagne inconnue"),
    parPublicite: parAxe(payants, (l) => l.publicite ?? "Publicité inconnue"),
    qualiteParSource: [...grouper(leads, (l) => l.source).entries()].map(([source, groupe]) => ({ source, libelle: libelleSourceLead(source), ...qualiteDe(groupe), devis: groupe.filter((l) => l.devis).length, signes: groupe.filter((l) => l.signe).length })).sort((a, b) => b.leads - a.leads),
    geographie: { villes: geographie, zones: parZone, departements: parDepartement, zoneIntervention: zone },
  };
}

export const outilManagerMarketing = definirOutil({
  nom: "manager_marketing",
  titre: "Manager marketing : dépense, coût par lead, par devis, par chantier, retour",
  description:
    "Chiffres marketing calculés sur la base pour une période (défaut 30 jours) et la précédente : dépense publicitaire (dépenses « Publicité » saisies, sinon prorata du budget de campagne — jamais la dépense réelle Meta, dis-le), leads Meta, coût par lead, par devis, par chantier signé, chiffre d'affaires encaissé et retour sur dépense, par campagne et par publicité ; jour de campagne et règle du protocole ; qualité des leads par source (joignables, hors zone, locataires, doublons, archivés) ; géographie (villes, départements, zone). Sert à « puis-je monter mon budget pub ? », « quelle publicité couper ? ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree, contexte) => {
    const a = await analyseMarketing(entree, contexte.maintenant);
    const m = a.global.meta;
    const texte = [
      `Marketing, ${a.periode.libelle} (${a.periode.du} → ${a.periode.au}).${a.avertissement ? ` ${a.avertissement}` : ""}`,
      `Dépense retenue : ${a.depense.retenue !== null ? format.euros(a.depense.retenue) : "inconnue"} (${a.depense.origine === "DEPENSES_SAISIES" ? "dépenses « Publicité » saisies" : a.depense.origine === "PRORATA_CAMPAGNE" ? "prorata du budget de campagne, pas la dépense réelle Meta" : "ni dépense saisie ni campagne en cours"}).`,
      `Meta : ${m.leads} leads (${a.global.metaPrecedent.leads} avant), ${m.devis} devis, ${m.signes} chantier(s) signé(s), ${format.euros(m.encaisse)} encaissés. Coût par lead ${m.coutParLead !== null ? format.euros(m.coutParLead) : "—"}, par devis ${m.coutParDevis !== null ? format.euros(m.coutParDevis) : "—"}, par chantier ${m.coutParChantier !== null ? format.euros(m.coutParChantier) : "—"}, retour sur dépense ${m.retourSurDepense !== null ? `×${m.retourSurDepense}` : "—"}.`,
      a.parPublicite.length ? `Par publicité : ${a.parPublicite.map((p) => `${p.nom} ${p.leads} leads, ${p.devis} devis, ${p.signes} signés${p.coutParLead !== null ? `, ≈ ${format.euros(p.coutParLead)}/lead` : ""}`).join(" · ")}.` : "Aucun lead Meta rattaché à une publicité sur la période.",
      `Campagne : ${a.campagne.debut ? (a.campagne.enCours ? `jour ${a.campagne.jour} sur ${a.campagne.duree}` : `commencée le ${format.jourCourt(a.campagne.debut)}, ${a.campagne.jour !== null && a.campagne.jour > a.campagne.duree ? "terminée" : "à venir"}`) : "non renseignée"}${a.campagne.regleDuJour ? ` — règle du jour : ${a.campagne.regleDuJour}` : ""}.`,
      `Qualité par source : ${a.qualiteParSource.map((s) => `${s.libelle} ${s.leads} leads (${s.joignables}/${s.appeles} joignables, ${s.horsZone} hors zone, ${s.locataires} locataires, ${s.doublons} doublons, ${s.archives} archivés)`).join(" · ") || "—"}.`,
      `Géographie : ${a.geographie.villes.slice(0, 6).map((v) => `${v.libelle} ${v.valeur}`).join(", ") || "—"} ; ${a.geographie.zones.map((z) => `${z.libelle} ${z.valeur}`).join(", ")}.`,
    ].join("\n");
    return { texte, donnees: a, liens: [lien("Publicité", "/publicite"), lien("Leads", "/leads")] };
  },
});
