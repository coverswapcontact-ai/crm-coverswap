import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { libelleSourceLead } from "@/lib/prospects/constantes";
import { departementDuCodePostal, zoneDuDepartement, type ZoneIntervention } from "@/lib/prospects/priorite";
import { zoneIntervention } from "@/lib/prospects/qualification";
import { definirOutil, format, lien } from "../definition";
import { etatCampagne } from "../outils/lecture";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { etatsDesSources } from "@/lib/analytique/appuis";
import { depensePubDeLaPeriode, estDoublonFusionne, type OrigineDepense } from "@/lib/analytique/calculs";
import { chiffresDisponibles, etatDe } from "@/lib/analytique/ecrans/commun";
import { calculerPublicite } from "@/lib/analytique/ecrans/publicite";
import { LIBELLES_VERDICT } from "@/lib/analytique/types";
import { resoudrePeriode, schemaPeriode } from "../periodes";
import { arrondi, avertissementMinces, evolution, grouper, repartir, somme, taux } from "./commun";
import { pluriel } from "@/lib/commun/format";

/**
 * Manager marketing (mission 8) : par campagne et par publicité, la dépense,
 * les leads, le coût par lead, par devis, par chantier signé, le chiffre
 * d'affaires et le retour sur dépense ; la qualité des leads par source ; la
 * géographie. Mission 17 (partie B) : mêmes définitions que l'Analytique
 * (src/lib/analytique/calculs.ts) — dépense réelle Meta quand la synchronisation
 * est branchée, sinon prorata du budget (estimation, dit comme tel), sinon les
 * dépenses « Publicité » saisies ; par publicité, sa propre dépense et le verdict
 * du protocole (plus de prorata par leads qui donnait à toutes le même coût).
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
  // Mission 17 (partie B) : archivés compris (la définition le disait, l'extension du journal les retirait), doublons fusionnés exclus.
  const tous = await prisma.lead.findMany({
    where: { ...AVEC_ARCHIVES, createdAt: { gte: debut, lt: fin } },
    select: {
      id: true, createdAt: true, source: true, campagne: true, publicite: true, ville: true, codePostal: true, occupation: true, doublonDe: true, doublonTraiteLe: true, archiveLe: true, archiveMotif: true,
      notesAppel: { where: { archiveLe: null }, select: { issue: true } },
      interactions: { where: { archiveLe: null, type: "APPEL" }, select: { id: true }, take: 1 },
      dossiers: { where: { archiveLe: null }, select: { etape: true, documents: { where: { type: "DEVIS", numero: { not: null }, archiveLe: null }, select: { id: true }, take: 1 }, accords: { where: { retireLe: null }, select: { id: true }, take: 1 }, encaissements: { where: { statut: "VALIDE" }, select: { montant: true } } } },
    },
  });
  const leads = tous.filter((l) => !estDoublonFusionne(l));
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

/** Origine de la dépense retenue (mission 17 : la dépense réelle Meta passe en premier). */
const ORIGINES: Record<OrigineDepense, "DEPENSE_META" | "PRORATA_CAMPAGNE" | "DEPENSES_SAISIES" | "INCONNUE"> = { SYNCHRO: "DEPENSE_META", PRORATA: "PRORATA_CAMPAGNE", SAISIE: "DEPENSES_SAISIES", INCONNUE: "INCONNUE" };

export async function analyseMarketing(entree: z.output<typeof schemaPeriode>, maintenant: Date = new Date()) {
  const { periode, precedente } = resoudrePeriode(entree, maintenant);
  const [zone, etats] = await Promise.all([zoneIntervention(maintenant), etatsDesSources(maintenant)]);
  const synchro = chiffresDisponibles(etatDe(etats, "META"));
  const plage = { du: periode.du, au: periode.au };
  const plageAvant = { du: precedente.du, au: precedente.au };
  const [leads, leadsAvant, depensesPub, campagne, depense, depenseAvant, pub, pubAvant] = await Promise.all([
    chargerLeads(periode.debut, periode.fin, zone),
    chargerLeads(precedente.debut, precedente.fin, zone),
    prisma.depense.findMany({ where: { archiveLe: null, categorie: "PUBLICITE", payeeLe: { gte: precedente.debut, lt: periode.fin } }, select: { montant: true, payeeLe: true, libelle: true, fournisseur: true } }),
    etatCampagne(maintenant),
    depensePubDeLaPeriode(plage, maintenant, synchro),
    depensePubDeLaPeriode(plageAvant, maintenant, synchro),
    calculerPublicite(plage, maintenant, synchro),
    calculerPublicite(plageAvant, maintenant, synchro),
  ]);
  const depenseSaisie = somme(depensesPub.filter((d) => d.payeeLe >= periode.debut).map((d) => d.montant));
  const depenseSaisieAvant = somme(depensesPub.filter((d) => d.payeeLe < periode.debut).map((d) => d.montant));
  // Mission 17 (partie B) : la définition unique de l'Analytique — dépense synchronisée, sinon prorata du budget jour par jour (estimation), sinon dépenses saisies ; jamais les deux additionnées.
  const depenseRetenue = depense.total;
  const origineDepense = ORIGINES[depense.origine];
  // Payants : les leads de source Meta ET ceux rattachés à un formulaire Meta payé (contact déjà connu : sa source d'origine reste).
  const idsMeta = new Set(pub.leadsCrm.map((l) => l.id));
  const idsMetaAvant = new Set(pubAvant.leadsCrm.map((l) => l.id));
  const payants = leads.filter((l) => l.source === "META_ADS" || idsMeta.has(l.id));
  const payantsAvant = leadsAvant.filter((l) => l.source === "META_ADS" || idsMetaAvant.has(l.id));
  const verdicts = new Map(campagne.parPublicite.map((p) => [p.id, p]));
  const parLeads = new Map(leads.map((l) => [l.id, l]));

  // Par campagne et par publicité : attribution par identifiants (MetaLead → Lead), dépense PROPRE à chaque ligne quand
  // Meta est synchronisé ; sans synchronisation, pas de dépense par ligne (plus de prorata qui donnait à toutes le même coût).
  const parAxe = (niveau: "CAMPAGNE" | "PUBLICITE") =>
    pub.lignes
      .filter((l) => l.niveau === niveau && l.plateforme === "META")
      .map((l) => {
        const groupe = l.leadIds.map((id) => parLeads.get(id)).filter((x): x is LeadMarketing => Boolean(x));
        const v = niveau === "PUBLICITE" ? verdicts.get(l.id) : undefined;
        return {
          id: l.id,
          nom: l.nom,
          leads: l.leadsCrm,
          leadsMeta: synchro ? l.leadsPlateforme : null,
          devis: l.devis,
          signes: l.signes,
          encaisse: l.encaisse,
          depense: synchro ? l.depense : null,
          coutParLead: l.coutParLead,
          coutParDevis: l.coutParDevis,
          coutParChantier: l.coutParSigne,
          retourSurDepense: l.retourSurDepense,
          verdict: v?.verdict ?? null,
          raisonVerdict: v?.raisonVerdict ?? null,
          qualite: qualiteDe(groupe),
        };
      })
      .sort((a, b) => b.leads - a.leads || a.nom.localeCompare(b.nom));

  const geographie = repartir(leads.filter((l) => !l.archive), (l) => l.ville.trim().replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) || "—").slice(0, 15);
  const parZone = repartir(leads, (l) => l.zone, (z) => ({ ZONE: "Dans la zone", PROCHE: "Département voisin", HORS_ZONE: "Hors zone", INCONNUE: "Zone inconnue" })[z] ?? z);
  const parDepartement = repartir(leads, (l) => departementDuCodePostal(l.codePostal) ?? "?").slice(0, 10);

  return {
    calculeLe: maintenant.toISOString(),
    periode: { du: periode.du, au: periode.au, libelle: periode.libelle, jours: periode.jours },
    precedente: { du: precedente.du, au: precedente.au },
    definitions: {
      leads: "Leads reçus dans la période, archivés compris pour les coûts (une dépense se juge sur tout ce qu'elle a produit), doublons fusionnés exclus ; les taux excluent les archivés.",
      depense: origineDepense === "DEPENSE_META" ? "Dépense réelle lue chez Meta (synchronisation des statistiques publicitaires, jour par jour)." : origineDepense === "PRORATA_CAMPAGNE" ? "Estimation : la synchronisation Meta n'est pas branchée, prorata du budget de la campagne jour par jour (le jour en cours au prorata des heures). Ce n'est pas la dépense réelle Meta." : origineDepense === "DEPENSES_SAISIES" ? "Dépenses de catégorie « Publicité » saisies dans le CRM sur la période (ni synchronisation Meta ni campagne en cours)." : "Aucune dépense connue : ni synchronisation Meta, ni campagne, ni dépense « Publicité » saisie. Les coûts par lead ne sont pas calculables.",
      parAxe: synchro ? "Chaque campagne et chaque publicité a sa propre dépense (Meta) ; leads du CRM attribués par identifiants (formulaire Meta → lead), une personne une fois." : "Sans synchronisation Meta, la dépense d'une campagne ou d'une publicité n'est pas connue : pas de coût par lead par publicité (le budget n'existe qu'en total).",
      verdict: "Verdict du protocole de campagne (consignes), jugé sur la campagne entière : jours 1 à 3 trop tôt, 4 à 7 garder, 8 à 14 couper si le coût par lead dépasse 2 × la meilleure sur au moins 5 leads (surveiller avec moins de 5 leads), 15 et suivants au coût par devis et par chantier signé (300 €).",
      coutParChantier: "Dépense divisée par le nombre de leads signés (bon pour accord non retiré ou dossier signé et au-delà).",
      retourSurDepense: "Encaissé sur les dossiers de ces leads (à ce jour) divisé par la dépense.",
      joignables: "Parmi les leads appelés : au moins une issue autre que « pas de réponse ».",
      zone: "D'après le code postal et la zone d'intervention des paramètres.",
    },
    avertissement: avertissementMinces(payants.length, "leads Meta"),
    depense: { retenue: depenseRetenue, origine: origineDepense, estimation: depense.estimation, saisie: depenseSaisie, saisiePrecedente: depenseSaisieAvant, lignes: depensesPub.filter((d) => d.payeeLe >= periode.debut).map((d) => ({ le: d.payeeLe.toISOString().slice(0, 10), montant: d.montant, fournisseur: d.fournisseur, libelle: d.libelle })) },
    campagne: { debut: campagne.debut, jour: campagne.jour, duree: campagne.duree, enCours: campagne.enCours, budget: campagne.budget, depense: campagne.depense, estimation: campagne.estimation, depenseEstimee: campagne.depenseEstimee, regleDuJour: campagne.regle, leadsMetaSurLaCampagne: campagne.leads },
    global: { meta: rendementDe(payants, depenseRetenue), metaPrecedent: rendementDe(payantsAvant, depenseAvant.total), evolutionLeadsMeta: evolution(payants.length, payantsAvant.length), tous: rendementDe(leads, null) },
    parCampagne: parAxe("CAMPAGNE"),
    parPublicite: parAxe("PUBLICITE"),
    qualiteParSource: [...grouper(leads, (l) => l.source).entries()].map(([source, groupe]) => ({ source, libelle: libelleSourceLead(source), ...qualiteDe(groupe), devis: groupe.filter((l) => l.devis).length, signes: groupe.filter((l) => l.signe).length })).sort((a, b) => b.leads - a.leads),
    geographie: { villes: geographie, zones: parZone, departements: parDepartement, zoneIntervention: zone },
  };
}

export const outilManagerMarketing = definirOutil({
  nom: "manager_marketing",
  titre: "Manager marketing : dépense, coût par lead, par devis, par chantier, retour",
  description:
    "Chiffres marketing calculés sur la base pour une période (défaut 30 jours) et la précédente, avec les mêmes calculs que l'Analytique : dépense publicitaire (réelle Meta quand la synchronisation est branchée ; sinon estimée au prorata du budget de campagne, ou dépenses « Publicité » saisies — dis laquelle), leads Meta, coût par lead, par devis, par chantier signé, chiffre d'affaires encaissé et retour sur dépense, par campagne et par publicité (dépense propre à chaque publicité, verdict du protocole : garder, surveiller, couper, trop tôt) ; jour de campagne et règle du protocole ; qualité des leads par source (joignables, hors zone, locataires, doublons, archivés) ; géographie (villes, départements, zone). Sert à « puis-je monter mon budget pub ? », « quelle publicité couper ? ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree, contexte) => {
    const a = await analyseMarketing(entree, contexte.maintenant);
    const m = a.global.meta;
    const origine = { DEPENSE_META: "réel Meta", PRORATA_CAMPAGNE: "estimation : prorata du budget de campagne, la synchronisation Meta n'est pas branchée", DEPENSES_SAISIES: "dépenses « Publicité » saisies", INCONNUE: "ni synchronisation Meta, ni campagne, ni dépense saisie" }[a.depense.origine];
    const texte = [
      `Marketing, ${a.periode.libelle} (${a.periode.du} → ${a.periode.au}).${a.avertissement ? ` ${a.avertissement}` : ""}`,
      `Dépense retenue : ${a.depense.retenue !== null ? format.euros(a.depense.retenue) : "inconnue"} (${origine}).`,
      `Meta : ${m.leads} leads (${a.global.metaPrecedent.leads} avant), ${m.devis} devis, ${pluriel(m.signes, "chantier signé", "chantiers signés")}, ${format.euros(m.encaisse)} encaissés. Coût par lead ${m.coutParLead !== null ? format.euros(m.coutParLead) : "—"}, par devis ${m.coutParDevis !== null ? format.euros(m.coutParDevis) : "—"}, par chantier ${m.coutParChantier !== null ? format.euros(m.coutParChantier) : "—"}, retour sur dépense ${m.retourSurDepense !== null ? `×${m.retourSurDepense}` : "—"}.`,
      a.parPublicite.length ? `Par publicité : ${a.parPublicite.map((p) => `${p.nom} ${p.leads} leads, ${p.devis} devis, ${p.signes} signés${p.coutParLead !== null ? `, ${format.euros(p.coutParLead)}/lead` : ""}${p.verdict ? ` — ${LIBELLES_VERDICT[p.verdict]}${p.raisonVerdict ? ` (${p.raisonVerdict})` : ""}` : ""}`).join(" · ")}.${a.depense.origine === "DEPENSE_META" ? "" : " Coût par publicité inconnu sans la synchronisation Meta."}` : "Aucun lead Meta rattaché à une publicité sur la période.",
      `Campagne : ${a.campagne.debut ? (a.campagne.enCours ? `jour ${a.campagne.jour} sur ${a.campagne.duree}` : `commencée le ${format.jourCourt(a.campagne.debut)}, ${a.campagne.jour !== null && a.campagne.jour > a.campagne.duree ? "terminée" : "à venir"}`) : "non renseignée"}${a.campagne.regleDuJour ? ` — règle du jour : ${a.campagne.regleDuJour}` : ""}.`,
      `Qualité par source : ${a.qualiteParSource.map((s) => `${s.libelle} ${s.leads} leads (${s.joignables}/${s.appeles} joignables, ${s.horsZone} hors zone, ${s.locataires} locataires, ${s.doublons} doublons, ${s.archives} archivés)`).join(" · ") || "—"}.`,
      `Géographie : ${a.geographie.villes.slice(0, 6).map((v) => `${v.libelle} ${v.valeur}`).join(", ") || "—"} ; ${a.geographie.zones.map((z) => `${z.libelle} ${z.valeur}`).join(", ")}.`,
    ].join("\n");
    return { texte, donnees: a, liens: [lien("Analytique — Publicité", "/analytique?onglet=publicite"), lien("Leads", "/leads")] };
  },
});
