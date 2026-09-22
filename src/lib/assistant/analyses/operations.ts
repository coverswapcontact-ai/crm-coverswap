import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { lireParametre } from "@/lib/parametres/service";
import { lireConsignes } from "../consignes";
import { definirOutil, format, lien } from "../definition";
import { santeSysteme } from "../outils/lecture";
import { joursEntre } from "./commun";

/**
 * Manager opérations (mission 8) : chantiers planifiés et charge des
 * prochaines semaines face à la capacité des consignes, actions planifiées,
 * relances dues, retards, santé du système. État du jour.
 */

/** « Capacité : environ 8 chantiers par mois » dans les consignes → 8. */
export function lireCapaciteMensuelle(consignes: string): number | null {
  const m = /capacit[ée]\s*:[^0-9]*(\d{1,3})\s*chantiers?\s*par\s*mois/i.exec(consignes);
  return m ? Number(m[1]) : null;
}

/** Lundi (Paris) de la semaine du jour donné, en AAAA-MM-JJ. */
export function lundiDe(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`);
  const decalage = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - decalage);
  return d.toISOString().slice(0, 10);
}

/** Charge par semaine sur N semaines, face à la capacité hebdomadaire (pur). */
export function chargeParSemaine(chantiers: { dateChantier: Date; client: string; etape: string }[], maintenant: Date, capaciteMensuelle: number | null, semaines = 6) {
  const capaciteSemaine = capaciteMensuelle !== null ? Math.round((capaciteMensuelle * 12) / 52) : null;
  const premierLundi = lundiDe(jourParis(maintenant));
  return Array.from({ length: semaines }, (_, i) => {
    const debut = new Date(`${premierLundi}T00:00:00Z`);
    debut.setUTCDate(debut.getUTCDate() + i * 7);
    const fin = new Date(debut.getTime() + 7 * 86_400_000);
    const liste = chantiers.filter((c) => c.dateChantier >= debut && c.dateChantier < fin);
    return { semaineDu: debut.toISOString().slice(0, 10), chantiers: liste.length, capacite: capaciteSemaine, reste: capaciteSemaine !== null ? capaciteSemaine - liste.length : null, clients: liste.map((c) => c.client) };
  });
}

export async function analyseOperations(maintenant: Date = new Date()) {
  const aujourdhui = jourParis(maintenant);
  const debutJour = new Date(`${aujourdhui}T00:00:00+02:00`);
  const dans30 = new Date(maintenant.getTime() + 30 * 86_400_000);
  const [planifies, sansDate, actions, rappels, relancesSequences, devisARelancer, delaiRelance, consignes, sante] = await Promise.all([
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["PLANIFIE", "CHANTIER"] }, dateChantier: { not: null } }, select: { id: true, clientNom: true, clientVille: true, etape: true, dateChantier: true, objet: true }, orderBy: { dateChantier: "asc" } }),
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["SIGNE", "PLANIFIE"] }, dateChantier: null }, select: { id: true, clientNom: true, etape: true, updatedAt: true } }),
    prisma.dossier.findMany({ where: { archiveLe: null, prochaineAction: { not: null }, etape: { notIn: ["ENCAISSE", "PERDU"] } }, select: { id: true, clientNom: true, etape: true, prochaineAction: true, prochaineActionDate: true }, orderBy: { prochaineActionDate: "asc" } }),
    prisma.lead.findMany({ where: { archiveLe: null, rappelLe: { not: null } }, select: { id: true, prenom: true, nom: true, rappelLe: true }, orderBy: { rappelLe: "asc" } }),
    prisma.inscriptionSequence.findMany({ where: { statut: { in: ["EN_COURS", "EN_VALIDATION"] } }, select: { statut: true, prochainEnvoiLe: true, sequence: { select: { nom: true, mode: true } } } }),
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["DEVIS_ENVOYE", "RELANCE"] } }, select: { id: true, clientNom: true, etape: true, documents: { where: { type: "DEVIS", numero: { not: null }, archiveLe: null, statut: { in: ["GENERE", "ENVOYE"] } }, orderBy: { dateEmission: "desc" }, take: 1, select: { numero: true, dateEmission: true, totalHt: true } } } }),
    lireParametre("DELAI_RELANCE_DEVIS", maintenant),
    lireConsignes(),
    santeSysteme(maintenant),
  ]);
  const capacite = lireCapaciteMensuelle(consignes.texte);
  const chantiers = planifies.map((d) => ({ id: d.id, client: d.clientNom, ville: d.clientVille, etape: d.etape, dateChantier: d.dateChantier!, objet: d.objet }));
  const aVenir = chantiers.filter((c) => c.dateChantier >= debutJour);
  const datePassee = chantiers.filter((c) => c.dateChantier < debutJour && c.etape === "PLANIFIE");
  const enRetardActions = actions.filter((a) => a.prochaineActionDate && a.prochaineActionDate < debutJour);
  const rappelsEnRetard = rappels.filter((r) => r.rappelLe! < debutJour);
  const delai = typeof delaiRelance === "number" ? delaiRelance : null;
  const devisDus = devisARelancer
    .map((d) => ({ dossierId: d.id, client: d.clientNom, etape: LIBELLES_ETAPE[d.etape as EtapeDossier], numero: d.documents[0]?.numero ?? null, montant: d.documents[0]?.totalHt ?? null, emisLe: d.documents[0]?.dateEmission ?? null, joursDepuis: d.documents[0]?.dateEmission ? Math.floor(joursEntre(d.documents[0].dateEmission, maintenant)) : null }))
    .filter((d) => delai === null || d.joursDepuis === null || d.joursDepuis >= delai)
    .sort((a, b) => (b.joursDepuis ?? 0) - (a.joursDepuis ?? 0));
  const chantiersSur30Jours = aVenir.filter((c) => c.dateChantier < dans30).length;
  return {
    calculeLe: maintenant.toISOString(),
    definitions: {
      capacite: capacite !== null ? `Capacité lue dans les consignes : ${capacite} chantiers par mois (≈ ${Math.round((capacite * 12) / 52)} par semaine).` : "Aucune capacité trouvée dans les consignes (« Capacité : environ N chantiers par mois »).",
      charge: "Dossiers « planifié » ou « chantier » avec une date, par semaine (du lundi).",
      relances: `Devis émis, sans accord, sur un dossier « devis envoyé » ou « relance », depuis au moins ${delai ?? "?"} jours (paramètre DELAI_RELANCE_DEVIS) ; plus les séquences mail en cours.`,
      retards: "Actions planifiées dont la date est passée, rappels de leads passés, chantiers « planifié » dont la date est passée, dossiers signés sans date de chantier.",
    },
    capacite: { mensuelle: capacite, chantiersSur30Jours, resteSur30Jours: capacite !== null ? capacite - chantiersSur30Jours : null },
    chantiers: { aVenir: aVenir.slice(0, 20).map((c) => ({ ...c, dateChantier: c.dateChantier.toISOString().slice(0, 10) })), total: aVenir.length, parSemaine: chargeParSemaine(chantiers, maintenant, capacite), datePassee: datePassee.map((c) => ({ dossierId: c.id, client: c.client, dateChantier: c.dateChantier.toISOString().slice(0, 10) })), sansDate: sansDate.map((d) => ({ dossierId: d.id, client: d.clientNom, etape: LIBELLES_ETAPE[d.etape as EtapeDossier], depuisJours: Math.floor(joursEntre(d.updatedAt, maintenant)) })) },
    actions: { planifiees: actions.slice(0, 30).map((a) => ({ dossierId: a.id, client: a.clientNom, etape: LIBELLES_ETAPE[a.etape as EtapeDossier], action: a.prochaineAction, le: a.prochaineActionDate?.toISOString().slice(0, 10) ?? null, enRetard: Boolean(a.prochaineActionDate && a.prochaineActionDate < debutJour) })), total: actions.length, enRetard: enRetardActions.length },
    rappels: { aVenir: rappels.filter((r) => r.rappelLe! >= debutJour).slice(0, 20).map((r) => ({ leadId: r.id, nom: `${r.prenom} ${r.nom}`.trim(), le: r.rappelLe!.toISOString() })), enRetard: rappelsEnRetard.map((r) => ({ leadId: r.id, nom: `${r.prenom} ${r.nom}`.trim(), le: r.rappelLe!.toISOString(), joursDeRetard: Math.floor(joursEntre(r.rappelLe!, maintenant)) })) },
    relances: { devisDus: devisDus.slice(0, 20), nombreDevisDus: devisDus.length, sequencesEnCours: relancesSequences.length, sequencesEnValidation: relancesSequences.filter((s) => s.statut === "EN_VALIDATION").length, prochainEnvoiSequence: relancesSequences.map((s) => s.prochainEnvoiLe).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null },
    retards: { actions: enRetardActions.length, rappels: rappelsEnRetard.length, chantiersDatePassee: datePassee.length, signesSansDate: sansDate.length, total: enRetardActions.length + rappelsEnRetard.length + datePassee.length + sansDate.length },
    sante,
  };
}

export const outilManagerOperations = definirOutil({
  nom: "manager_operations",
  titre: "Manager opérations : chantiers, charge, actions, relances, retards, santé",
  description:
    "État du jour des opérations : chantiers planifiés (liste et charge par semaine sur 6 semaines face à la capacité des consignes, reste disponible sur 30 jours), actions planifiées sur les dossiers, rappels de leads à venir et en retard, relances dues (devis sans réponse depuis le délai paramétré, séquences mail en cours), retards (actions et rappels passés, chantiers « planifié » à date passée, dossiers signés sans date), santé du système. Sert à « qu'est-ce que je dois faire en priorité cette semaine ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const a = await analyseOperations(contexte.maintenant);
    const texte = [
      `Opérations au ${format.jourCourt(a.calculeLe.slice(0, 10))}. ${a.definitions.capacite}`,
      `Chantiers à venir : ${a.chantiers.total} (${a.capacite.chantiersSur30Jours} sur 30 jours${a.capacite.resteSur30Jours !== null ? `, reste ${a.capacite.resteSur30Jours} place(s)` : ""}). Par semaine : ${a.chantiers.parSemaine.map((s) => `${format.jourCourt(s.semaineDu)} : ${s.chantiers}${s.capacite !== null ? `/${s.capacite}` : ""}`).join(" · ")}.${a.chantiers.aVenir.length ? ` Prochains : ${a.chantiers.aVenir.slice(0, 5).map((c) => `${c.client} le ${format.jourCourt(c.dateChantier)}`).join(", ")}.` : ""}`,
      `Actions planifiées : ${a.actions.total}, dont ${a.actions.enRetard} en retard${a.actions.planifiees.filter((x) => x.enRetard).length ? ` (${a.actions.planifiees.filter((x) => x.enRetard).slice(0, 5).map((x) => `${x.client} : ${x.action}`).join(" · ")})` : ""}.`,
      `Rappels de leads : ${a.rappels.aVenir.length} à venir, ${a.rappels.enRetard.length} en retard${a.rappels.enRetard.length ? ` (${a.rappels.enRetard.slice(0, 5).map((r) => `${r.nom}, ${r.joursDeRetard} j`).join(" · ")})` : ""}.`,
      `Relances dues : ${a.relances.nombreDevisDus} devis sans réponse${a.relances.devisDus.length ? ` (${a.relances.devisDus.slice(0, 5).map((d) => `${d.client}${d.montant !== null ? ` ${format.euros(d.montant)}` : ""}, ${d.joursDepuis ?? "?"} j`).join(" · ")})` : ""} ; ${a.relances.sequencesEnCours} séquence(s) mail en cours${a.relances.sequencesEnValidation ? `, ${a.relances.sequencesEnValidation} à valider` : ""}.`,
      `Retards : ${a.retards.total} (${a.retards.actions} actions, ${a.retards.rappels} rappels, ${a.retards.chantiersDatePassee} chantiers à date passée, ${a.retards.signesSansDate} signés sans date${a.chantiers.sansDate.length ? ` : ${a.chantiers.sansDate.slice(0, 4).map((d) => d.client).join(", ")}` : ""}).`,
      `Santé : ${a.sante.taches.enEchec.length} tâche(s) en échec, ${a.sante.alertes.length} alerte(s)${a.sante.google?.coupee ? ", Google COUPÉ" : ""}${a.sante.ia && !a.sante.ia.cleApi ? ", clé Anthropic absente" : ""}.`,
    ].join("\n");
    return { texte, donnees: a, liens: [lien("Dossiers", "/dossiers"), lien("Leads", "/leads"), lien("Tâches de fond", "/taches")] };
  },
});
