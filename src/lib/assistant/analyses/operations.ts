import { z } from "zod/v4";
import { lireDelaiRelanceAvis } from "@/lib/relances/avis";
import { lireDelaiRelancePhotos } from "@/lib/relances/photos";
import { relancesProposables } from "@/lib/relances/proposables";
import { JOURS_REACTIVATION } from "@/lib/relances/reactivation";
import { lireDelaiRelance } from "@/lib/relances/service";
import prisma from "@/lib/prisma";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { lireParametre } from "@/lib/parametres/service";
import { rappelsDesLeads } from "@/lib/prospects/leads";
import { lireConsignes } from "../consignes";
import { definirOutil, format, lien } from "../definition";
import { santeSysteme } from "../outils/lecture";
import { joursEntre } from "./commun";
import { pluriel } from "@/lib/commun/format";

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
  const [planifies, sansDate, actions, rappels, relances, delaiRelance, delaiPhotos, delaiAvis, consignes, sante] = await Promise.all([
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["PLANIFIE", "CHANTIER"] }, dateChantier: { not: null } }, select: { id: true, clientNom: true, clientVille: true, etape: true, dateChantier: true, objet: true }, orderBy: { dateChantier: "asc" } }),
    prisma.dossier.findMany({ where: { archiveLe: null, etape: { in: ["SIGNE", "PLANIFIE"] }, dateChantier: null }, select: { id: true, clientNom: true, etape: true, updatedAt: true } }),
    prisma.dossier.findMany({ where: { archiveLe: null, prochaineAction: { not: null }, etape: { notIn: ["ENCAISSE", "PERDU"] } }, select: { id: true, clientNom: true, etape: true, prochaineAction: true, prochaineActionDate: true }, orderBy: { prochaineActionDate: "asc" } }),
    // Mission 14 : les rappels de l'onglet Leads (ni perdus, ni avec un dossier), en retard dès l'heure passée.
    rappelsDesLeads(maintenant),
    // Mission 14 (partie 6) : LA liste des relances proposables (feuille « Relances », voir_relances), pas une seconde règle.
    relancesProposables(maintenant),
    lireDelaiRelance(maintenant),
    lireDelaiRelancePhotos(maintenant),
    lireDelaiRelanceAvis(maintenant),
    lireConsignes(),
    santeSysteme(maintenant),
  ]);
  // Mission 12 : la capacité est un paramètre (Pilotage de l'activité) ; la ligne des consignes ne sert plus que de repli.
  const capaciteParametre = Number(await lireParametre("CAPACITE_CHANTIERS_MOIS", maintenant));
  const capacite = Number.isFinite(capaciteParametre) && capaciteParametre > 0 ? capaciteParametre : lireCapaciteMensuelle(consignes.texte);
  const chantiers = planifies.map((d) => ({ id: d.id, client: d.clientNom, ville: d.clientVille, etape: d.etape, dateChantier: d.dateChantier!, objet: d.objet }));
  const aVenir = chantiers.filter((c) => c.dateChantier >= debutJour);
  const datePassee = chantiers.filter((c) => c.dateChantier < debutJour && c.etape === "PLANIFIE");
  const enRetardActions = actions.filter((a) => a.prochaineActionDate && a.prochaineActionDate < debutJour);
  const rappelsEnRetard = rappels.filter((r) => r.enRetard);
  const delai = delaiRelance;
  const devisDus = relances.devis.map((d) => ({ dossierId: d.dossierId, client: d.clientNom, numero: d.numero, montant: d.totalHt, emisLe: d.emisLe, joursDepuis: d.joursDepuisEmission, rang: d.rang }));
  const photosDues = relances.photos.map((p) => ({ dossierId: p.dossierId, client: p.clientNom, joursDepuisOuverture: p.joursDepuisOuverture, rang: p.rang }));
  // Mission 18 (A4) : la demande d'avis après chantier et la réactivation à 6 mois, des relances comme les autres.
  const avisDus = relances.avis.map((a) => ({ dossierId: a.dossierId, client: a.clientNom, joursDepuisFin: a.joursDepuisFin }));
  const reactivationsDues = relances.reactivations.map((r) => ({ leadId: r.leadId, client: r.nom, joursDepuisPerte: r.joursDepuisPerte }));
  const chantiersSur30Jours = aVenir.filter((c) => c.dateChantier < dans30).length;
  return {
    calculeLe: maintenant.toISOString(),
    definitions: {
      capacite: capacite !== null ? `Capacité (${Number.isFinite(capaciteParametre) && capaciteParametre > 0 ? "Paramètres → Pilotage de l'activité" : "consignes"}) : ${capacite} chantiers par mois (≈ ${Math.round((capacite * 12) / 52)} par semaine).` : "Aucune capacité posée (Paramètres → Pilotage de l'activité, CAPACITE_CHANTIERS_MOIS).",
      charge: "Dossiers « planifié » ou « chantier » avec une date, par semaine (du lundi).",
      relances: `Les relances proposables (celles de la feuille « Relances » et de « lister » RELANCES) : devis sans réponse sur un dossier « devis envoyé » ou « relance », ${delai.jours} jours après le devis ou la dernière relance (paramètre DELAI_RELANCE_DEVIS${delai.parametre ? "" : ", non renseigné : 5 jours par défaut"}), mail ou SMS, deux au plus ; espaces ouverts sans photo ni simulation depuis ${delaiPhotos.jours} jours (DELAI_RELANCE_PHOTOS) ; demande d'avis ${delaiAvis.jours} jours après la fin du chantier, sans avis (DELAI_RELANCE_AVIS, une fois, par SMS) ; réactivation des contacts perdus depuis ${JOURS_REACTIVATION} jours qui ont donné leur accord aux messages commerciaux (une fois, par SMS).`,
      retards: "Actions planifiées dont la date est passée, rappels de leads passés (ceux de l'onglet Leads, en retard dès l'heure passée ; un lead perdu ou avec un dossier n'en a pas : le rappel vit sur le dossier), chantiers « planifié » dont la date est passée, dossiers signés sans date de chantier.",
    },
    capacite: { mensuelle: capacite, chantiersSur30Jours, resteSur30Jours: capacite !== null ? capacite - chantiersSur30Jours : null },
    chantiers: { aVenir: aVenir.slice(0, 20).map((c) => ({ ...c, dateChantier: c.dateChantier.toISOString().slice(0, 10) })), total: aVenir.length, parSemaine: chargeParSemaine(chantiers, maintenant, capacite), datePassee: datePassee.map((c) => ({ dossierId: c.id, client: c.client, dateChantier: c.dateChantier.toISOString().slice(0, 10) })), sansDate: sansDate.map((d) => ({ dossierId: d.id, client: d.clientNom, etape: LIBELLES_ETAPE[d.etape as EtapeDossier], depuisJours: Math.floor(joursEntre(d.updatedAt, maintenant)) })) },
    actions: { planifiees: actions.slice(0, 30).map((a) => ({ dossierId: a.id, client: a.clientNom, etape: LIBELLES_ETAPE[a.etape as EtapeDossier], action: a.prochaineAction, le: a.prochaineActionDate?.toISOString().slice(0, 10) ?? null, enRetard: Boolean(a.prochaineActionDate && a.prochaineActionDate < debutJour) })), total: actions.length, enRetard: enRetardActions.length },
    rappels: { aVenir: rappels.filter((r) => !r.enRetard).slice(0, 20).map((r) => ({ leadId: r.leadId, nom: r.nom, le: r.le.toISOString() })), enRetard: rappelsEnRetard.map((r) => ({ leadId: r.leadId, nom: r.nom, le: r.le.toISOString(), joursDeRetard: Math.floor(joursEntre(r.le, maintenant)) })) },
    relances: { devisDus: devisDus.slice(0, 20), nombreDevisDus: devisDus.length, photosDues: photosDues.slice(0, 20), nombrePhotosDues: photosDues.length, avisDus: avisDus.slice(0, 20), nombreAvisDus: avisDus.length, reactivationsDues: reactivationsDues.slice(0, 20), nombreReactivationsDues: reactivationsDues.length },
    retards: { actions: enRetardActions.length, rappels: rappelsEnRetard.length, chantiersDatePassee: datePassee.length, signesSansDate: sansDate.length, total: enRetardActions.length + rappelsEnRetard.length + datePassee.length + sansDate.length },
    sante,
  };
}

export const outilManagerOperations = definirOutil({
  nom: "manager_operations",
  titre: "Manager opérations : chantiers, charge, actions, relances, retards, santé",
  description:
    "État du jour des opérations : chantiers planifiés (liste et charge par semaine sur 6 semaines face à la capacité des consignes, reste disponible sur 30 jours), actions planifiées sur les dossiers, rappels de leads à venir et en retard, relances dues (les relances proposables : devis sans réponse depuis le délai paramétré, mail ou SMS, deux au plus ; espaces sans photo ni simulation ; demandes d'avis après chantier ; réactivations à 6 mois), retards (actions et rappels passés, chantiers « planifié » à date passée, dossiers signés sans date), santé du système. Sert à « qu'est-ce que je dois faire en priorité cette semaine ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const a = await analyseOperations(contexte.maintenant);
    const texte = [
      `Opérations au ${format.jourCourt(a.calculeLe.slice(0, 10))}. ${a.definitions.capacite}`,
      `Chantiers à venir : ${a.chantiers.total} (${a.capacite.chantiersSur30Jours} sur 30 jours${a.capacite.resteSur30Jours !== null ? `, reste ${pluriel(a.capacite.resteSur30Jours, "place")}` : ""}). Par semaine : ${a.chantiers.parSemaine.map((s) => `${format.jourCourt(s.semaineDu)} : ${s.chantiers}${s.capacite !== null ? `/${s.capacite}` : ""}`).join(" · ")}.${a.chantiers.aVenir.length ? ` Prochains : ${a.chantiers.aVenir.slice(0, 5).map((c) => `${c.client} le ${format.jourCourt(c.dateChantier)}`).join(", ")}.` : ""}`,
      `Actions planifiées : ${a.actions.total}, dont ${a.actions.enRetard} en retard${a.actions.planifiees.filter((x) => x.enRetard).length ? ` (${a.actions.planifiees.filter((x) => x.enRetard).slice(0, 5).map((x) => `${x.client} : ${x.action}`).join(" · ")})` : ""}.`,
      `Rappels de leads : ${a.rappels.aVenir.length} à venir, ${a.rappels.enRetard.length} en retard${a.rappels.enRetard.length ? ` (${a.rappels.enRetard.slice(0, 5).map((r) => `${r.nom}, ${r.joursDeRetard ? `${r.joursDeRetard} j` : "aujourd'hui"}`).join(" · ")})` : ""}.`,
      `Relances dues : ${a.relances.nombreDevisDus} devis sans réponse${a.relances.devisDus.length ? ` (${a.relances.devisDus.slice(0, 5).map((d) => `${d.client} ${format.euros(d.montant)}, ${d.joursDepuis} j, relance ${d.rang}/2`).join(" · ")})` : ""} ; ${pluriel(a.relances.nombrePhotosDues, "espace")} sans photo ni simulation${a.relances.photosDues.length ? ` (${a.relances.photosDues.slice(0, 5).map((p) => `${p.client}, ${p.joursDepuisOuverture} j`).join(" · ")})` : ""} ; ${pluriel(a.relances.nombreAvisDus, "avis à demander", "avis à demander")}${a.relances.avisDus.length ? ` (${a.relances.avisDus.slice(0, 5).map((v) => `${v.client}, ${v.joursDepuisFin} j`).join(" · ")})` : ""} ; ${pluriel(a.relances.nombreReactivationsDues, "réactivation")}${a.relances.reactivationsDues.length ? ` (${a.relances.reactivationsDues.slice(0, 5).map((r) => r.client).join(" · ")})` : ""}.`,
      `Retards : ${a.retards.total} (${a.retards.actions} actions, ${a.retards.rappels} rappels, ${a.retards.chantiersDatePassee} chantiers à date passée, ${a.retards.signesSansDate} signés sans date${a.chantiers.sansDate.length ? ` : ${a.chantiers.sansDate.slice(0, 4).map((d) => d.client).join(", ")}` : ""}).`,
      `Santé : ${pluriel(a.sante.taches.enEchec.length, "tâche")} en échec, ${pluriel(a.sante.alertes.length, "alerte")}${a.sante.google?.coupee ? ", Google COUPÉ" : ""}${a.sante.ia && !a.sante.ia.cleApi ? ", clé Anthropic absente" : ""}.`,
    ].join("\n");
    return { texte, donnees: a, liens: [lien("Dossiers", "/dossiers"), lien("Leads", "/leads"), lien("Tâches de fond", "/taches-de-fond")] };
  },
});
