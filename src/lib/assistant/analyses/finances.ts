import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { lireParametre, lireParametres } from "@/lib/parametres/service";
import { lireConsignes } from "../consignes";
import { definirOutil, format, lien } from "../definition";
import { resoudrePeriode, schemaPeriode, type Periode } from "../periodes";
import { arrondi, avertissementMinces, evolution, familleDuDossier, libelleFamille, mois, repartir, somme } from "./commun";

/**
 * Manager finances (mission 8) : chiffre d'affaires encaissé, marge par
 * chantier, trésorerie et projection, seuils fiscaux, provision URSSAF, et ce
 * que Lucas peut se verser selon sa règle de réserve (consignes). Le CRM ne
 * connaît pas le solde bancaire : tout part des encaissements et des dépenses
 * saisis, et le dit.
 */

type EncaissementLu = { montant: number; recuLe: Date; dossierId: string | null; famille: string; categorieClient: string };
type DepenseLue = { montant: number; payeeLe: Date; dossierId: string | null; categorie: string; horsChantier: boolean };
type FactureLue = { dossierId: string; totalHt: number; dateEmission: Date; numero: string | null; client: string };

/** CA encaissé, marges et trésorerie d'une période (pur, testé). */
export function calculerFinances(encaissements: EncaissementLu[], depenses: DepenseLue[], factures: FactureLue[], periode: Periode) {
  const dans = <T extends { [k: string]: unknown }>(liste: T[], champ: keyof T) => liste.filter((e) => (e[champ] as Date) >= periode.debut && (e[champ] as Date) < periode.fin);
  const enc = dans(encaissements, "recuLe");
  const dep = dans(depenses, "payeeLe");
  const fac = dans(factures, "dateEmission");
  const depensesParDossier = new Map<string, number>();
  for (const d of depenses) if (d.dossierId) depensesParDossier.set(d.dossierId, arrondi((depensesParDossier.get(d.dossierId) ?? 0) + d.montant));
  const marges = fac.map((f) => ({ dossierId: f.dossierId, client: f.client, numero: f.numero, mois: mois(f.dateEmission), facture: f.totalHt, depenses: depensesParDossier.get(f.dossierId) ?? 0, marge: arrondi(f.totalHt - (depensesParDossier.get(f.dossierId) ?? 0)) }));
  return {
    encaisse: somme(enc.map((e) => e.montant)),
    encaissements: enc.length,
    parMois: repartir(enc, (e) => mois(e.recuLe), (c) => c, (e) => e.montant).sort((a, b) => a.cle.localeCompare(b.cle)),
    parFamille: repartir(enc, (e) => e.famille, libelleFamille, (e) => e.montant),
    parTypeClient: repartir(enc, (e) => e.categorieClient, (c) => c, (e) => e.montant),
    depenses: somme(dep.map((d) => d.montant)),
    depensesChantier: somme(dep.filter((d) => !d.horsChantier).map((d) => d.montant)),
    depensesParCategorie: repartir(dep, (d) => d.categorie, (c) => c, (d) => d.montant),
    factureEmis: somme(fac.map((f) => f.totalHt)),
    marges: { parChantier: marges, parMois: repartir(marges, (m) => m.mois, (c) => c, (m) => m.marge).sort((a, b) => a.cle.localeCompare(b.cle)), totale: somme(marges.map((m) => m.marge)), tauxMoyen: fac.length ? arrondi(somme(marges.map((m) => m.marge)) / Math.max(1, somme(fac.map((f) => f.totalHt))), 3) : null },
  };
}

/** Projection de trésorerie à 30, 60, 90 jours (pur) : entrées attendues sur les dossiers signés, sorties connues. */
export function projeterTresorerie(entree: { resteAEncaisser: { montant: number; attenduLe: Date | null }[]; urssafProvision: number; urssafEcheance: Date | null; chargesFixesMensuelles: number }, maintenant: Date) {
  return [30, 60, 90].map((jours) => {
    const horizon = new Date(maintenant.getTime() + jours * 86_400_000);
    const entrees = somme(entree.resteAEncaisser.filter((r) => !r.attenduLe || r.attenduLe <= horizon).map((r) => r.montant));
    const urssaf = entree.urssafEcheance && entree.urssafEcheance <= horizon ? entree.urssafProvision : 0;
    const fixes = arrondi(entree.chargesFixesMensuelles * (jours / 30));
    return { jours, entreesAttendues: entrees, sortiesConnues: arrondi(urssaf + fixes), solde: arrondi(entrees - urssaf - fixes) };
  });
}

/** « Plancher de réserve : garder 2 000 € » dans les consignes → 2000. */
export function lirePlancherReserve(consignes: string): number | null {
  const m = /plancher de r[ée]serve\s*:[^0-9]*([\d\s  .]{2,})\s*€/i.exec(consignes);
  if (!m) return null;
  const n = Number(m[1].replace(/[\s  .]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function analyseFinanciere(entree: z.output<typeof schemaPeriode>, maintenant: Date = new Date()) {
  const { periode, precedente } = resoudrePeriode(entree, maintenant);
  const annee = Number(periode.au.slice(0, 4));
  const debutLarge = new Date(Math.min(precedente.debut.getTime(), new Date(`${annee}-01-01T00:00:00Z`).getTime()));
  const [encBruts, depBrutes, facBrutes, signes, tableau, params, consignes] = await Promise.all([
    prisma.encaissement.findMany({ where: { statut: "VALIDE", recuLe: { gte: debutLarge } }, select: { montant: true, recuLe: true, dossierId: true, dossier: { select: { prestations: true, lead: { select: { typeProjet: true } }, client: { select: { categorie: true } } } } } }),
    prisma.depense.findMany({ where: { archiveLe: null, payeeLe: { gte: new Date(debutLarge.getTime() - 365 * 86_400_000) } }, select: { montant: true, payeeLe: true, dossierId: true, categorie: true, horsChantier: true } }),
    prisma.document.findMany({ where: { type: "FACTURE", numero: { not: null }, archiveLe: null, statut: { notIn: ["ANNULEE", "REMPLACE"] }, dateEmission: { gte: debutLarge } }, select: { dossierId: true, totalHt: true, dateEmission: true, numero: true, dossier: { select: { clientNom: true } } } }),
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE"] } }, select: { id: true, clientNom: true, dateChantier: true, accords: { where: { retireLe: null }, select: { totalHt: true }, orderBy: { createdAt: "desc" }, take: 1 }, encaissements: { where: { statut: "VALIDE" }, select: { montant: true } } } }),
    chargerTableauFinances(annee, maintenant),
    lireParametres(["TAUX_COTISATIONS_SOCIALES", "TAUX_CFP"], maintenant),
    lireConsignes(),
  ]);
  const encaissements: EncaissementLu[] = encBruts.map((e) => ({ montant: e.montant, recuLe: e.recuLe, dossierId: e.dossierId, famille: familleDuDossier(e.dossier?.prestations, e.dossier?.lead?.typeProjet), categorieClient: e.dossier?.client?.categorie ?? "PARTICULIER" }));
  const depenses: DepenseLue[] = depBrutes.map((d) => ({ montant: d.montant, payeeLe: d.payeeLe, dossierId: d.dossierId, categorie: d.categorie, horsChantier: d.horsChantier }));
  const factures: FactureLue[] = facBrutes.filter((f) => f.dateEmission).map((f) => ({ dossierId: f.dossierId, totalHt: f.totalHt, dateEmission: f.dateEmission!, numero: f.numero, client: f.dossier.clientNom }));
  const actuel = calculerFinances(encaissements, depenses, factures, periode);
  const avant = calculerFinances(encaissements, depenses, factures, precedente);
  const cumulAnnee = somme(encaissements.filter((e) => e.recuLe.getFullYear() === annee && e.recuLe <= maintenant).map((e) => e.montant));

  // Trésorerie : à encaisser sur les dossiers signés (accord − reçu), attendu au chantier (solde) ou tout de suite (acompte).
  const resteAEncaisser = signes
    .map((d) => ({ dossierId: d.id, client: d.clientNom, montant: arrondi((d.accords[0]?.totalHt ?? 0) - d.encaissements.reduce((t, e) => t + e.montant, 0)), attenduLe: d.dateChantier }))
    .filter((r) => r.montant > 0);
  const tauxCotisations = typeof params.TAUX_COTISATIONS_SOCIALES === "number" ? params.TAUX_COTISATIONS_SOCIALES : null;
  const tauxCfp = typeof params.TAUX_CFP === "number" ? params.TAUX_CFP : 0;
  const urssafEnCours = tableau.urssaf.etat === "OK" ? tableau.urssaf.donnees.enCours : null;
  const seuils = tableau.seuils.etat === "OK" ? tableau.seuils.donnees.seuils : [];
  const parametresManquants = [...new Set([...(tableau.urssaf.etat === "PARAMETRES" ? tableau.urssaf.manquants : []), ...(tableau.seuils.etat === "PARAMETRES" ? tableau.seuils.manquants : [])])];
  // Charges fixes connues : logiciels, assurance, banque des 90 derniers jours, ramenés au mois.
  const fixes90 = depenses.filter((d) => ["LOGICIELS", "ASSURANCE", "BANQUE"].includes(d.categorie) && d.payeeLe >= new Date(maintenant.getTime() - 90 * 86_400_000));
  const chargesFixesMensuelles = arrondi(somme(fixes90.map((d) => d.montant)) / 3);
  const projection = projeterTresorerie({ resteAEncaisser, urssafProvision: urssafEnCours?.total ?? (tauxCotisations !== null ? arrondi(actuel.encaisse * ((tauxCotisations + tauxCfp) / 100)) : 0), urssafEcheance: urssafEnCours ? new Date(`${urssafEnCours.periode.echeanceDeclaration}T12:00:00Z`) : null, chargesFixesMensuelles }, maintenant);

  // Ce que Lucas peut se verser : encaissé − dépenses − provision URSSAF − plancher de réserve (règle des consignes).
  const enc30 = somme(encaissements.filter((e) => e.recuLe >= new Date(maintenant.getTime() - 30 * 86_400_000) && e.recuLe <= maintenant).map((e) => e.montant));
  const dep30 = somme(depenses.filter((d) => d.payeeLe >= new Date(maintenant.getTime() - 30 * 86_400_000) && d.payeeLe <= maintenant).map((d) => d.montant));
  const provision30 = tauxCotisations !== null ? arrondi(enc30 * ((tauxCotisations + tauxCfp) / 100)) : null;
  // Mission 12 : la réserve est un paramètre (Pilotage de l'activité) ; la ligne des consignes ne sert plus que de repli.
  const reserveParametre = await lireParametre("TRESORERIE_RESERVE", maintenant);
  const plancher = typeof reserveParametre === "number" ? reserveParametre : lirePlancherReserve(consignes.texte);
  const versable = provision30 !== null && plancher !== null ? arrondi(enc30 - dep30 - provision30 - chargesFixesMensuelles - plancher) : null;

  return {
    calculeLe: maintenant.toISOString(),
    periode: { du: periode.du, au: periode.au, libelle: periode.libelle, jours: periode.jours },
    precedente: { du: precedente.du, au: precedente.au },
    definitions: {
      encaisse: "Encaissements validés (rejets et annulations exclus), à leur date de réception ; franchise de TVA : HT = TTC.",
      famille: "Famille de prestations du dossier réglé (cuisine, salle de bain, mobilier, professionnel).",
      marge: "Factures émises dans la période, moins les dépenses rattachées à leur dossier (toutes dates) ; hors temps de Lucas.",
      tresorerie: "Le CRM ne connaît pas le solde bancaire : entrées attendues = accords signés moins encaissé, à la date du chantier (le solde) ; sorties connues = provision URSSAF à son échéance + charges fixes (logiciels, assurance, banque, moyenne des 90 derniers jours).",
      seuils: "Chiffre d'affaires encaissé depuis le 1er janvier, projeté au 31 décembre au rythme actuel (écran Finances).",
      versable: "Sur 30 jours : encaissé − dépenses − provision URSSAF − charges fixes mensuelles − plancher de réserve des consignes. Une estimation, pas un conseil comptable.",
    },
    avertissement: avertissementMinces(actuel.encaissements, "encaissements"),
    ca: { actuel: actuel.encaisse, precedent: avant.encaisse, evolution: evolution(actuel.encaisse, avant.encaisse), cumulAnnee, parMois: actuel.parMois, parFamille: actuel.parFamille, parTypeClient: actuel.parTypeClient, encaissements: actuel.encaissements },
    marges: { ...actuel.marges, precedente: avant.marges.totale },
    depenses: { total: actuel.depenses, chantier: actuel.depensesChantier, parCategorie: actuel.depensesParCategorie, precedente: avant.depenses },
    tresorerie: { encaissePeriode: actuel.encaisse, aEncaisserSurSignes: somme(resteAEncaisser.map((r) => r.montant)), detailAEncaisser: resteAEncaisser.slice(0, 20), depensesEngageesPeriode: actuel.depenses, chargesFixesMensuelles, urssafProvision: urssafEnCours ? { periode: urssafEnCours.periode.libelle, total: urssafEnCours.total, echeance: urssafEnCours.periode.echeanceDeclaration } : null, projection },
    seuils: seuils.map((s) => ({ cle: s.cle, libelle: s.libelle, seuil: s.seuil, chiffreAffaires: s.chiffreAffaires, pourcentage: s.pourcentage, projection: s.projection })),
    parametresManquants,
    versable: { sur30Jours: { encaisse: enc30, depenses: dep30, provisionUrssaf: provision30, chargesFixes: chargesFixesMensuelles, plancherReserve: plancher }, estimation: versable, regle: plancher === null ? "Aucune réserve de trésorerie posée (Paramètres → Pilotage de l'activité, TRESORERIE_RESERVE) ni de plancher dans les consignes." : `Réserve de trésorerie à garder (${typeof reserveParametre === "number" ? "Paramètres → Pilotage de l'activité" : "consignes"}) : ${format.euros(plancher)}.` },
  };
}

export const outilManagerFinances = definirOutil({
  nom: "manager_finances",
  titre: "Manager finances : CA, marge, trésorerie, seuils, URSSAF, versement",
  description:
    "Chiffres financiers calculés sur la base pour une période (défaut 30 jours) et la précédente : chiffre d'affaires encaissé par mois, famille, type de client, cumul de l'année ; marge par chantier et par mois (dépenses rattachées) ; trésorerie (encaissé, à encaisser sur devis signés, dépenses, charges fixes, provision URSSAF) et projection à 30, 60, 90 jours ; position face aux seuils (franchise TVA, plafond micro) ; ce que Lucas peut raisonnablement se verser selon la règle de réserve des consignes. Le CRM ne connaît pas le solde bancaire : dis-le. Sert à « combien je peux me verser ? », « puis-je monter mon budget pub ? ».",
  niveau: "LECTURE",
  schema: schemaPeriode,
  executer: async (entree, contexte) => {
    const a = await analyseFinanciere(entree, contexte.maintenant);
    const texte = [
      `Finances, ${a.periode.libelle} (${a.periode.du} → ${a.periode.au}).${a.avertissement ? ` ${a.avertissement}` : ""}`,
      `Encaissé ${format.euros(a.ca.actuel)} (${format.euros(a.ca.precedent)} la période précédente${a.ca.evolution !== null ? `, ${a.ca.evolution >= 0 ? "+" : ""}${Math.round(a.ca.evolution * 100)} %` : ""}) ; cumul de l'année ${format.euros(a.ca.cumulAnnee)}. Par famille : ${a.ca.parFamille.map((f) => `${f.libelle} ${format.euros(f.valeur)}`).join(", ") || "—"}.`,
      `Marge sur les factures émises : ${format.euros(a.marges.totale)}${a.marges.tauxMoyen !== null ? ` (${format.pourcent(a.marges.tauxMoyen)} du facturé)` : ""}, dépenses de la période ${format.euros(a.depenses.total)}.`,
      `Trésorerie : à encaisser sur les dossiers signés ${format.euros(a.tresorerie.aEncaisserSurSignes)} ; charges fixes ≈ ${format.euros(a.tresorerie.chargesFixesMensuelles)} par mois ; URSSAF ${a.tresorerie.urssafProvision ? `${format.euros(a.tresorerie.urssafProvision.total)} pour ${a.tresorerie.urssafProvision.periode}, échéance ${format.jourCourt(a.tresorerie.urssafProvision.echeance)}` : "non calculable (paramètres manquants)"}. Projection : ${a.tresorerie.projection.map((p) => `${p.jours} j : +${format.euros(p.entreesAttendues)} −${format.euros(p.sortiesConnues)} = ${format.euros(p.solde)}`).join(" · ")} (hors solde bancaire, inconnu du CRM).`,
      a.seuils.length ? `Seuils : ${a.seuils.map((s) => `${s.libelle} ${format.euros(s.chiffreAffaires)} sur ${format.euros(s.seuil)} (${Math.round(s.pourcentage)} %${s.projection !== null ? `, projeté ${format.euros(s.projection)}` : ""})`).join(" · ")}.` : `Seuils : paramètres manquants (${a.parametresManquants.join(", ") || "—"}).`,
      `Versement possible (estimation sur 30 jours) : ${a.versable.estimation !== null ? format.euros(a.versable.estimation) : "non calculable"} — encaissé ${format.euros(a.versable.sur30Jours.encaisse)} − dépenses ${format.euros(a.versable.sur30Jours.depenses)} − URSSAF ${a.versable.sur30Jours.provisionUrssaf !== null ? format.euros(a.versable.sur30Jours.provisionUrssaf) : "?"} − charges fixes ${format.euros(a.versable.sur30Jours.chargesFixes)} − réserve ${a.versable.sur30Jours.plancherReserve !== null ? format.euros(a.versable.sur30Jours.plancherReserve) : "?"}. ${a.versable.regle}`,
    ].join("\n");
    return { texte, donnees: a, liens: [lien("Finances", "/finances")] };
  },
});
