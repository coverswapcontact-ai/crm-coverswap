import { jourParis } from "@/lib/dossiers/dates";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { statistiquesAcquisition } from "@/lib/clients/fiches";
import { LIBELLES_SOURCE_CLIENT, type SourceClient } from "@/lib/clients/constantes";
import { libelleCategorie } from "@/lib/depenses/constantes";
import { carnetDeCommandes, depensePubDeLaPeriode, depensesDeChantier, depensesDeLaPeriode, detailDepensePub, encaissementsDeLaPeriode, margeEstimee, montantSigne, panierMoyen, PLAFOND_PUB, regle20, toutesLesSignatures, totalEncaisse, type DepenseLue, type DepensePub } from "../calculs";
import { decalerMois, dernierJourDuMoisDe, periodePrecedente } from "../periode";
import type { EcranArgent, EtatSource, MoisArgent, Periode } from "../types";
import { chiffresDisponibles, etatDe, indicateur, serieDepuis } from "./commun";

/**
 * Mission 17 (partie B) — l'onglet Argent : encaissé, signé, marge estimée, panier moyen, dépense pub, carnet de
 * commandes (définitions de calculs.ts) ; les 12 derniers mois (jusqu'au mois de la fin de période) ; la règle des 20 %
 * mois par mois ; les seuils de l'année (franchise de TVA, franchise majorée, plafond micro, avec la projection au 31/12)
 * et l'URSSAF (période en cours, période à déclarer avec son échéance et le détail cotisations / CFP / versement
 * libératoire), repris de l'ancien écran Finances (`chargerTableauFinances`, paramètres datés ; un paramètre manquant est
 * NOMMÉ dans `parametresManquants`, jamais une valeur supposée) ; les dépenses de la période par catégorie (écran
 * Dépenses) et « d'où viennent les clients » (écran Clients, `statistiquesAcquisition` : depuis toujours).
 */

type Plage = { du: string; au: string };

export type ChiffresArgent = { encaisse: number; signe: number; signatures: number; panier: number | null; depensesChantier: number; marge: number; depensePub: number | null; estimation: boolean; pub: DepensePub; depenses: DepenseLue[]; parJour: { encaisse: Record<string, number>; depensePub: Record<string, number> } };

/** Encaissé, signé, marge, panier et dépense pub d'une période. */
export async function chiffresArgent(periode: Plage, maintenant: Date, synchroMeta: boolean): Promise<ChiffresArgent> {
  const [encaissements, signatures, depenses, pub] = await Promise.all([encaissementsDeLaPeriode(periode), toutesLesSignatures(), depensesDeLaPeriode(periode), depensePubDeLaPeriode(periode, maintenant, synchroMeta)]);
  const signees = signatures.filter((s) => s.jour >= periode.du && s.jour <= periode.au);
  const encaisse = totalEncaisse(encaissements);
  const chantier = depensesDeChantier(depenses);
  const parJourEncaisse: Record<string, number> = {};
  for (const e of encaissements) parJourEncaisse[e.jour] = Math.round(((parJourEncaisse[e.jour] ?? 0) + e.montant) * 100) / 100;
  return { encaisse, signe: montantSigne(signees), signatures: signees.length, panier: panierMoyen(signees), depensesChantier: chantier, marge: margeEstimee(encaisse, chantier), depensePub: pub.total, estimation: pub.estimation, pub, depenses, parJour: { encaisse: parJourEncaisse, depensePub: pub.parJour } };
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

/** Seuils de l'année, URSSAF (en cours, à déclarer), paramètres manquants — comme l'écran Finances les affichait. */
export async function fiscalArgent(maintenant: Date): Promise<EcranArgent["fiscal"]> {
  try {
    const tableau = await chargerTableauFinances(Number(jourParis(maintenant).slice(0, 4)), maintenant);
    const manquants = new Set<string>();
    if (tableau.seuils.etat === "PARAMETRES") tableau.seuils.manquants.forEach((m) => manquants.add(m));
    if (tableau.urssaf.etat === "PARAMETRES") tableau.urssaf.manquants.forEach((m) => manquants.add(m));
    const seuils = tableau.seuils.etat === "OK" ? tableau.seuils.donnees.seuils.map((x) => ({ cle: x.cle, libelle: x.libelle, plafond: x.seuil, atteint: x.chiffreAffaires, projection: x.projection, ratio: Math.round((x.pourcentage / 100) * 1000) / 1000 })) : [];
    const u = tableau.urssaf.etat === "OK" ? tableau.urssaf.donnees : null;
    const detail = (x: NonNullable<typeof u>["aDeclarer"]) => [
      { libelle: "Cotisations sociales", montant: x.cotisations },
      { libelle: "Formation professionnelle (CFP)", montant: x.cfp },
      ...(x.versementLiberatoire !== null ? [{ libelle: "Versement libératoire de l'impôt", montant: x.versementLiberatoire }] : []),
    ];
    const franchise = seuils.find((x) => x.cle === "SEUIL_FRANCHISE_TVA") ?? null;
    return {
      seuils,
      urssaf: u
        ? {
            enCours: { libelle: u.enCours.periode.libelle, base: u.enCours.chiffreAffaires, montant: u.enCours.total },
            aDeclarer: { libelle: u.aDeclarer.periode.libelle, base: u.aDeclarer.chiffreAffaires, montant: u.aDeclarer.total, echeance: u.aDeclarer.periode.echeanceDeclaration, detail: detail(u.aDeclarer) },
          }
        : null,
      parametresManquants: [...manquants],
      franchiseTva: franchise ? { plafond: franchise.plafond, atteint: franchise.atteint, ratio: franchise.ratio } : null,
    };
  } catch (erreur) {
    console.error("[analytique] tableau des finances illisible :", erreur);
    return null;
  }
}

/** Dépenses de la période par catégorie (pur), de la plus lourde à la plus légère. */
export function depensesParCategorie(depenses: readonly DepenseLue[]): EcranArgent["depensesParCategorie"] {
  const parCategorie = new Map<string, { centimes: number; nombre: number }>();
  for (const d of depenses) {
    const c = parCategorie.get(d.categorie) ?? { centimes: 0, nombre: 0 };
    c.centimes += Math.round(d.montant * 100);
    c.nombre += 1;
    parCategorie.set(d.categorie, c);
  }
  return [...parCategorie.entries()].map(([categorie, c]) => ({ categorie, libelle: libelleCategorie(categorie), montant: c.centimes / 100, nombre: c.nombre })).sort((a, b) => b.montant - a.montant || a.libelle.localeCompare(b.libelle, "fr"));
}

/** « D'où viennent les clients » (écran Clients) : clients, signés et montant signé par source, depuis toujours. */
async function clientsParSource(): Promise<EcranArgent["clientsParSource"]> {
  try {
    return (await statistiquesAcquisition()).map((l) => ({ source: l.source, libelle: LIBELLES_SOURCE_CLIENT[l.source as SourceClient] ?? l.source, clients: l.clients, signes: l.clientsSignes, montantSigne: Math.round(l.montantSigne * 100) / 100 }));
  } catch (erreur) {
    console.error("[analytique] clients par source illisibles :", erreur);
    return [];
  }
}

export async function construireEcranArgent(periode: Periode, options: { etats: EtatSource[] }, maintenant: Date): Promise<Omit<EcranArgent, "genereLe" | "alertes">> {
  const synchro = chiffresDisponibles(etatDe(options.etats, "META"));
  const etatMeta = etatDe(options.etats, "META");
  const [actuel, avant, historique, carnet, fiscal, clients] = await Promise.all([chiffresArgent(periode, maintenant, synchro), chiffresArgent(periodePrecedente(periode), maintenant, synchro), douzeMois(periode.au, maintenant, synchro), carnetDeCommandes(), fiscalArgent(maintenant), clientsParSource()]);
  const montantCarnet = Math.round(carnet.reduce((t, c) => t + c.montant, 0) * 100) / 100;
  const indicateurs = [
    indicateur({ cle: "encaisse", libelle: "Encaissé", valeur: actuel.encaisse, precedente: avant.encaisse, format: "euros", favorable: "hausse", serie: serieDepuis(periode, actuel.parJour.encaisse), source: "CRM" }),
    indicateur({ cle: "signe", libelle: "Signé", valeur: actuel.signe, precedente: avant.signe, format: "euros", favorable: "hausse", source: "CRM", detail: `${actuel.signatures} chantier${actuel.signatures > 1 ? "s" : ""} signé${actuel.signatures > 1 ? "s" : ""}` }),
    indicateur({ cle: "marge", libelle: "Marge estimée", valeur: actuel.marge, precedente: avant.marge, format: "euros", favorable: "hausse", source: "CRM", detail: actuel.depensesChantier > 0 ? `${actuel.depensesChantier.toLocaleString("fr-FR")} € de dépenses de chantier` : "aucune dépense de chantier rattachée" }),
    indicateur({ cle: "panier", libelle: "Panier moyen", valeur: actuel.panier, precedente: avant.panier, format: "euros", favorable: "hausse", source: "CRM" }),
    indicateur({ cle: "depensePub", libelle: "Dépense pub", valeur: actuel.depensePub, precedente: avant.depensePub, format: "euros", favorable: "baisse", serie: serieDepuis(periode, actuel.parJour.depensePub), source: synchro ? "META" : "CRM", detail: detailDepensePub(actuel.pub, etatMeta) }),
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
    depensesParCategorie: depensesParCategorie(actuel.depenses),
    clientsParSource: clients,
  };
}
