import { jourParis } from "@/lib/dossiers/dates";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { carnetDeCommandes, depensePubDeLaPeriode, depensesDeChantier, depensesDeLaPeriode, encaissementsDeLaPeriode, margeEstimee, montantSigne, panierMoyen, PLAFOND_PUB, regle20, toutesLesSignatures, totalEncaisse } from "../calculs";
import { decalerMois, dernierJourDuMoisDe, periodePrecedente } from "../periode";
import type { EcranArgent, EtatSource, MoisArgent, Periode } from "../types";
import { chiffresDisponibles, etatDe, indicateur, serieDepuis } from "./commun";

/**
 * Mission 17 (partie B) — l'onglet Argent : encaissé, signé, marge estimée, panier moyen, dépense pub, carnet de
 * commandes (définitions de calculs.ts) ; les 12 derniers mois (jusqu'au mois de la fin de période) ; la règle des 20 %
 * mois par mois ; la franchise de TVA et l'URSSAF, repris de l'ancien écran Finances (`chargerTableauFinances` : seuils
 * et URSSAF de la période en cours, paramètres datés ; un paramètre manquant donne null, jamais une valeur supposée).
 */

type Plage = { du: string; au: string };

export type ChiffresArgent = { encaisse: number; signe: number; signatures: number; panier: number | null; depensesChantier: number; marge: number; depensePub: number | null; estimation: boolean; parJour: { encaisse: Record<string, number>; depensePub: Record<string, number> } };

/** Encaissé, signé, marge, panier et dépense pub d'une période. */
export async function chiffresArgent(periode: Plage, maintenant: Date, synchroMeta: boolean): Promise<ChiffresArgent> {
  const [encaissements, signatures, depenses, pub] = await Promise.all([encaissementsDeLaPeriode(periode), toutesLesSignatures(), depensesDeLaPeriode(periode), depensePubDeLaPeriode(periode, maintenant, synchroMeta)]);
  const signees = signatures.filter((s) => s.jour >= periode.du && s.jour <= periode.au);
  const encaisse = totalEncaisse(encaissements);
  const chantier = depensesDeChantier(depenses);
  const parJourEncaisse: Record<string, number> = {};
  for (const e of encaissements) parJourEncaisse[e.jour] = Math.round(((parJourEncaisse[e.jour] ?? 0) + e.montant) * 100) / 100;
  return { encaisse, signe: montantSigne(signees), signatures: signees.length, panier: panierMoyen(signees), depensesChantier: chantier, marge: margeEstimee(encaisse, chantier), depensePub: pub.total, estimation: pub.estimation, parJour: { encaisse: parJourEncaisse, depensePub: pub.parJour } };
}

/** Les 12 mois glissants (jusqu'au mois de `au`), et la règle des 20 % mois par mois. */
export async function douzeMois(au: string, maintenant: Date, synchroMeta: boolean): Promise<{ mois: MoisArgent[]; regle20: EcranArgent["regle20"] }> {
  const dernier = au.slice(0, 7);
  const premier = decalerMois(dernier, -12); // un mois de plus : l'encaissé du mois précédent du premier mois affiché
  const plage = { du: `${premier}-01`, au: dernierJourDuMoisDe(dernier) };
  const [encaissements, signatures, depenses, pub] = await Promise.all([encaissementsDeLaPeriode(plage), toutesLesSignatures(), depensesDeLaPeriode(plage), depensePubDeLaPeriode(plage, maintenant, synchroMeta)]);
  const liste = Array.from({ length: 13 }, (_, i) => decalerMois(premier, i));
  const dansMois = (jour: string, m: string) => jour.startsWith(m);
  const tous = liste.map((m): MoisArgent => ({
    mois: m,
    encaisse: totalEncaisse(encaissements.filter((e) => dansMois(e.jour, m))),
    signe: montantSigne(signatures.filter((s) => dansMois(s.jour, m))),
    depensesPub: Math.round(Object.entries(pub.parJour).filter(([j]) => dansMois(j, m)).reduce((t, [, v]) => t + v, 0) * 100) / 100,
    depensesChantier: depensesDeChantier(depenses.filter((d) => dansMois(d.jour, m))),
  }));
  const regle = regle20(tous.map((m) => ({ mois: m.mois, encaisse: m.encaisse, depensePub: pub.total === null ? null : m.depensesPub })));
  return { mois: tous.slice(1), regle20: regle };
}

/** Franchise de TVA et URSSAF (période en cours), comme l'écran Finances les affichait. */
export async function fiscalArgent(maintenant: Date): Promise<EcranArgent["fiscal"]> {
  try {
    const tableau = await chargerTableauFinances(Number(jourParis(maintenant).slice(0, 4)), maintenant);
    const seuil = tableau.seuils.etat === "OK" ? tableau.seuils.donnees.seuils.find((s) => s.cle === "SEUIL_FRANCHISE_TVA") ?? null : null;
    const urssaf = tableau.urssaf.etat === "OK" ? tableau.urssaf.donnees.enCours : null;
    const tauxTotal = urssaf ? [urssaf.taux.cotisations, urssaf.taux.cfp, urssaf.taux.versementLiberatoire].reduce<number | null>((t, v) => (v === null ? t : (t ?? 0) + v), null) : null;
    return {
      franchiseTva: seuil ? { plafond: seuil.seuil, atteint: seuil.chiffreAffaires, ratio: Math.round((seuil.pourcentage / 100) * 1000) / 1000 } : null,
      urssaf: urssaf ? { taux: tauxTotal === null ? null : Math.round((tauxTotal / 100) * 10000) / 10000, estime: urssaf.total } : null,
    };
  } catch (erreur) {
    console.error("[analytique] tableau des finances illisible :", erreur);
    return null;
  }
}

export async function construireEcranArgent(periode: Periode, options: { etats: EtatSource[] }, maintenant: Date): Promise<Omit<EcranArgent, "genereLe" | "alertes">> {
  const synchro = chiffresDisponibles(etatDe(options.etats, "META"));
  const [actuel, avant, historique, carnet, fiscal] = await Promise.all([chiffresArgent(periode, maintenant, synchro), chiffresArgent(periodePrecedente(periode), maintenant, synchro), douzeMois(periode.au, maintenant, synchro), carnetDeCommandes(), fiscalArgent(maintenant)]);
  const montantCarnet = Math.round(carnet.reduce((t, c) => t + c.montant, 0) * 100) / 100;
  const indicateurs = [
    indicateur({ cle: "encaisse", libelle: "Encaissé", valeur: actuel.encaisse, precedente: avant.encaisse, format: "euros", favorable: "hausse", serie: serieDepuis(periode, actuel.parJour.encaisse), source: "CRM" }),
    indicateur({ cle: "signe", libelle: "Signé", valeur: actuel.signe, precedente: avant.signe, format: "euros", favorable: "hausse", source: "CRM", detail: `${actuel.signatures} chantier${actuel.signatures > 1 ? "s" : ""} signé${actuel.signatures > 1 ? "s" : ""}` }),
    indicateur({ cle: "marge", libelle: "Marge estimée", valeur: actuel.marge, precedente: avant.marge, format: "euros", favorable: "hausse", source: "CRM", detail: actuel.depensesChantier > 0 ? `${actuel.depensesChantier.toLocaleString("fr-FR")} € de dépenses de chantier` : "aucune dépense de chantier rattachée" }),
    indicateur({ cle: "panier", libelle: "Panier moyen", valeur: actuel.panier, precedente: avant.panier, format: "euros", favorable: "hausse", source: "CRM" }),
    indicateur({ cle: "depensePub", libelle: "Dépense pub", valeur: actuel.depensePub, precedente: avant.depensePub, format: "euros", favorable: "baisse", serie: serieDepuis(periode, actuel.parJour.depensePub), source: synchro ? "META" : "CRM", detail: actuel.estimation ? "estimation : prorata du budget" : null }),
    indicateur({ cle: "carnet", libelle: "Carnet de commandes", valeur: montantCarnet, precedente: null, format: "euros", favorable: "hausse", source: "CRM", detail: `${carnet.length} devis en attente` }),
  ];
  return {
    onglet: "argent",
    periode,
    sources: options.etats,
    indicateurs,
    mois: historique.mois,
    regle20: historique.regle20.map((r) => ({ ...r, plafond: PLAFOND_PUB })),
    carnet: carnet.map((c) => ({ dossierId: c.dossierId, client: c.client, numero: c.numero, montant: c.montant, envoyeLe: c.envoyeLe, relances: c.relances })),
    fiscal,
  };
}
