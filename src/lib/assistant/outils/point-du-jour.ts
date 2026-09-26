import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { pilotageCommercial } from "@/lib/commercial/pilotage";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { compterMessagesNonLus } from "@/lib/espace/messages";
import { listerVue } from "@/lib/mail/vues";
import { libelleSourceLead } from "@/lib/prospects/constantes";
import { definirOutil, format, lien } from "../definition";
import { etatCampagne, santeSysteme } from "./lecture";

/**
 * Le point du jour (mission 8) : en un appel, tout ce qui a changé depuis le
 * dernier point, ce qui attend Lucas aujourd'hui, la campagne, les alertes.
 * Données brutes et datées : c'est Claude qui en fait un récit à l'oral,
 * selon les consignes. L'heure du dernier point est mémorisée pour que le
 * suivant ne reprenne que le neuf.
 */

const CLE_DERNIER_POINT = "ASSISTANT_DERNIER_POINT";
const JOUR = 86_400_000;

export async function dernierPoint(): Promise<Date | null> {
  const ligne = await prisma.cleInterne.findUnique({ where: { nom: CLE_DERNIER_POINT } });
  const date = ligne ? new Date(ligne.valeur) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export async function noterPoint(maintenant: Date): Promise<void> {
  await prisma.cleInterne.upsert({ where: { nom: CLE_DERNIER_POINT }, create: { nom: CLE_DERNIER_POINT, valeur: maintenant.toISOString() }, update: { valeur: maintenant.toISOString() } });
}

export async function calculerPointDuJour(maintenant: Date = new Date(), options: { depuis?: Date | null; memoriser?: boolean } = {}) {
  const precedent = options.depuis === undefined ? await dernierPoint() : options.depuis;
  // Sans point précédent : les dernières 24 heures.
  const depuis = precedent ?? new Date(maintenant.getTime() - JOUR);
  const aujourdhui = jourParis(maintenant);
  const debutJour = new Date(`${aujourdhui}T00:00:00+02:00`);
  const finJour = new Date(debutJour.getTime() + JOUR);

  const [leads, simulationsEspace, simulationsSite, demandesDevis, accords, paiements, projetsClients, changements, mails, pilotage, rappels, actionsDossiers, campagne, sante, messagesNonLus, propositionsEnAttente, messagesRecents] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: depuis }, archiveLe: null }, select: { id: true, prenom: true, nom: true, ville: true, source: true, typeProjet: true, createdAt: true, priorite: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.simulationEspace.findMany({ where: { createdAt: { gte: depuis }, archiveLe: null }, select: { id: true, source: true, statut: true, createdAt: true, dossierId: true }, take: 50 }),
    prisma.simulationSite.count({ where: { createdAt: { gte: depuis } } }),
    prisma.lead.count({ where: { createdAt: { gte: depuis }, archiveLe: null, source: "SITE_DEVIS" } }),
    prisma.accordDevis.findMany({ where: { createdAt: { gte: depuis }, retireLe: null }, select: { id: true, documentId: true, totalHt: true, numeroDevis: true, nomSignataire: true, createdAt: true, dossier: { select: { id: true, clientNom: true } } }, take: 50 }),
    prisma.encaissement.findMany({ where: { createdAt: { gte: depuis }, statut: "VALIDE" }, select: { id: true, montant: true, moyen: true, payeur: true, recuLe: true, dossier: { select: { id: true, clientNom: true } } }, take: 50 }),
    prisma.dossier.findMany({ where: { createdAt: { gte: depuis }, source: "ESPACE_CLIENT", archiveLe: null }, select: { id: true, clientNom: true, objet: true, createdAt: true }, take: 50 }),
    prisma.dossierEvenement.findMany({ where: { createdAt: { gte: depuis }, type: "CHANGEMENT_ETAPE", archiveLe: null }, select: { dossierId: true, contenu: true, createdAt: true, dossier: { select: { clientNom: true, etape: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    listerVue("A_TRAITER", { limite: 30 }),
    pilotageCommercial(maintenant),
    prisma.lead.findMany({ where: { rappelLe: { gte: debutJour, lt: finJour }, archiveLe: null }, select: { id: true, prenom: true, nom: true, rappelLe: true, telephone: true }, orderBy: { rappelLe: "asc" }, take: 50 }),
    prisma.dossier.findMany({ where: { prochaineActionDate: { gte: debutJour, lt: finJour }, archiveLe: null }, select: { id: true, clientNom: true, prochaineAction: true, prochaineActionDate: true }, orderBy: { prochaineActionDate: "asc" }, take: 50 }),
    etatCampagne(maintenant),
    santeSysteme(maintenant),
    compterMessagesNonLus(),
    prisma.proposition.count({ where: { statut: "EN_ATTENTE", archiveLe: null } }),
    prisma.messageEspace.findMany({ where: { createdAt: { gte: depuis }, auteur: "CLIENT", archiveLe: null }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, texte: true, source: true, createdAt: true, luLe: true, dossier: { select: { id: true, clientNom: true } } } }),
  ]);

  const nomsDossiers = new Map((await prisma.dossier.findMany({ where: { id: { in: simulationsEspace.map((s) => s.dossierId) } }, select: { id: true, clientNom: true } })).map((d) => [d.id, d.clientNom]));
  // Mission 11 : le libellé du devis choisi (« façades + plan de travail »).
  const libellesDevis = new Map((await prisma.document.findMany({ where: { id: { in: accords.map((a) => a.documentId) } }, select: { id: true, libelleVariante: true } })).map((d) => [d.id, d.libelleVariante]));
  const attendentMoi = pilotage.affaires.filter((a) => a.main === "MOI");
  const point = {
    calculeLe: maintenant.toISOString(),
    depuis: depuis.toISOString(),
    premierPoint: precedent === null,
    nouveautes: {
      leads: leads.map((l) => ({ id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), ville: l.ville, source: libelleSourceLead(l.source), projet: l.typeProjet, priorite: l.priorite, le: l.createdAt.toISOString() })),
      simulations: { site: simulationsSite, espace: simulationsEspace.map((s) => ({ id: s.id, source: s.source, statut: s.statut, dossierId: s.dossierId, client: nomsDossiers.get(s.dossierId) ?? "?", le: s.createdAt.toISOString() })) },
      demandesDevis,
      devisSignes: accords.map((a) => ({ dossierId: a.dossier.id, client: a.dossier.clientNom, numero: a.numeroDevis, libelle: libellesDevis.get(a.documentId) ?? null, montant: a.totalHt, le: a.createdAt.toISOString() })),
      paiements: paiements.map((p) => ({ dossierId: p.dossier?.id ?? null, client: p.dossier?.clientNom ?? p.payeur, montant: p.montant, moyen: p.moyen, le: p.recuLe.toISOString() })),
      projetsClients: projetsClients.map((d) => ({ dossierId: d.id, client: d.clientNom, objet: d.objet, le: d.createdAt.toISOString() })),
      changementsEtape: changements.map((c) => ({ dossierId: c.dossierId, client: c.dossier.clientNom, contenu: c.contenu, le: c.createdAt.toISOString() })),
      messagesEspace: messagesRecents.map((m) => ({ id: m.id, dossierId: m.dossier.id, client: m.dossier.clientNom, source: m.source, texte: m.texte.slice(0, 200), le: m.createdAt.toISOString(), lu: Boolean(m.luLe) })),
    },
    aujourdhui: {
      rappels: rappels.map((r) => ({ leadId: r.id, nom: `${r.prenom} ${r.nom}`.trim(), a: r.rappelLe?.toISOString() ?? null, telephone: r.telephone })),
      actionsDossiers: actionsDossiers.map((d) => ({ dossierId: d.id, client: d.clientNom, action: d.prochaineAction, a: d.prochaineActionDate?.toISOString() ?? null })),
      attendentMoi: attendentMoi.map((a) => ({ nom: a.nom, etape: a.etape, action: a.action, enRetard: a.enRetard, depuisJours: a.depuisJours, dossierId: a.dossierId, leadId: a.leadId })),
      chezLeClient: pilotage.compteurs.chezLeClient,
      mailsATraiter: mails.lignes.map((m) => ({ messageId: m.messageId, de: m.correspondant.nom ?? m.correspondant.adresse, objet: m.objet, mention: m.mention, contact: m.contact?.nom ?? null })),
      messagesEspaceNonLus: messagesNonLus,
      propositionsEnAttente,
    },
    campagne: { enCours: campagne.enCours, jour: campagne.jour, duree: campagne.duree, depenseEstimee: campagne.depenseEstimee, leads: campagne.leads, coutParLead: campagne.coutParLead, regle: campagne.regle },
    alertes: { taches: sante.taches, google: sante.google, meta: sante.meta, ia: sante.ia, disqueLibreMo: sante.disqueLibreMo, disque: sante.disque, coherence: sante.coherence, autres: sante.alertes },
  };
  if (options.memoriser !== false) await noterPoint(maintenant);
  return point;
}

export const outilPointDuJour = definirOutil({
  nom: "point_du_jour",
  titre: "Le point du jour",
  description:
    "En un appel, tout ce qui a changé depuis le dernier point (nouveaux leads et leur source, simulations, demandes de devis, devis signés, paiements, projets ouverts par des clients, changements d'étape), ce qui attend Lucas aujourd'hui (rappels, actions planifiées, dossiers où la main est à lui, mails à traiter), l'état de la campagne (jour et règle du protocole) et les alertes système. Données brutes et datées : raconte-les à l'oral selon les consignes (« Bonjour Lucas », 60 à 90 secondes, finir par le jour de campagne et sa règle). L'heure du point est mémorisée.",
  niveau: "LECTURE",
  schema: z.object({ depuis_heures: z.number().min(1).max(720).optional().describe("Reprendre depuis N heures au lieu du dernier point mémorisé.") }),
  executer: async ({ depuis_heures }, contexte) => {
    const point = await calculerPointDuJour(contexte.maintenant, { depuis: depuis_heures ? new Date(contexte.maintenant.getTime() - depuis_heures * 3_600_000) : undefined });
    const n = point.nouveautes;
    const a = point.aujourdhui;
    const texte = [
      `Point du ${format.jour(contexte.maintenant)}, depuis ${point.premierPoint ? "hier (premier point)" : format.jourCourt(point.depuis) + " " + new Date(point.depuis).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}.`,
      `Nouveau : ${n.leads.length} lead(s)${n.leads.length ? ` (${n.leads.slice(0, 6).map((l) => `${l.nom}${l.ville ? `, ${l.ville}` : ""} — ${l.source}`).join(" ; ")})` : ""} ; ${n.simulations.site} simulation(s) sur le site, ${n.simulations.espace.length} dans les espaces ; ${n.demandesDevis} demande(s) de devis ; ${n.devisSignes.length} devis signé(s)${n.devisSignes.length ? ` (${n.devisSignes.map((d) => `${d.client} a choisi le devis ${d.numero ?? "?"}${d.libelle ? ` (${d.libelle})` : ""} : ${format.euros(d.montant)}`).join(" ; ")})` : ""} ; ${n.paiements.length} paiement(s)${n.paiements.length ? ` (${n.paiements.map((p) => `${p.client} ${format.euros(p.montant)}`).join(", ")})` : ""} ; ${n.projetsClients.length} projet(s) ouvert(s) par des clients ; ${n.changementsEtape.length} changement(s) d'étape ; ${n.messagesEspace.length} message(s) de clients dans leur espace${n.messagesEspace.length ? ` (${n.messagesEspace.slice(0, 4).map((m) => `${m.client} : « ${m.texte.slice(0, 80)} »`).join(" ; ")})` : ""}.`,
      `Aujourd'hui : ${a.rappels.length} rappel(s)${a.rappels.length ? ` (${a.rappels.map((r) => `${r.nom} à ${r.a ? new Date(r.a).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) : "?"}`).join(", ")})` : ""}, ${a.actionsDossiers.length} action(s) planifiée(s)${a.actionsDossiers.length ? ` (${a.actionsDossiers.map((d) => `${d.client} : ${d.action}`).join(", ")})` : ""}, ${a.attendentMoi.length} dossier(s) qui attendent ta réponse${a.attendentMoi.filter((x) => x.enRetard).length ? ` dont ${a.attendentMoi.filter((x) => x.enRetard).length} en retard` : ""}, ${a.chezLeClient} chez le client, ${a.mailsATraiter.length} mail(s) à traiter, ${a.messagesEspaceNonLus} message(s) d'espace non lu(s), ${a.propositionsEnAttente} proposition(s) à valider.`,
      point.campagne.enCours ? `Campagne : jour ${point.campagne.jour} sur ${point.campagne.duree}, ${point.campagne.leads} lead(s)${point.campagne.coutParLead !== null ? `, ≈ ${format.euros(point.campagne.coutParLead)} par lead (dépense estimée)` : ""}. Règle : ${point.campagne.regle ?? "aucune règle trouvée pour ce jour"}.` : "Pas de campagne en cours (ou début non renseigné dans Paramètres).",
      `Alertes : ${[point.alertes.taches.enEchec.length ? `${point.alertes.taches.enEchec.length} tâche(s) en échec` : null, point.alertes.google?.coupee ? "Google coupé" : point.alertes.google ? `Google : jeton ${point.alertes.google.niveau.toLowerCase()} (reconnecter)` : null, point.alertes.meta && point.alertes.meta.etat !== "COMPLETE" ? `Meta : ${point.alertes.meta.etat}` : null, point.alertes.ia && !point.alertes.ia.active ? "IA inactive" : null, point.alertes.disque && point.alertes.disque.niveau !== "OK" ? `disque : ${point.alertes.disque.pourcentUtilise} % utilisé (${point.alertes.disque.libreMo} Mo libres)` : null, point.alertes.coherence?.incoherences.length ? `${point.alertes.coherence.incoherences.length} incohérence(s)` : null, ...point.alertes.autres.filter((x) => x.gravite !== "INFO").map((x) => x.titre)].filter(Boolean).join(", ") || "rien à signaler"}.`,
    ].join("\n");
    return { texte, donnees: point, liens: [lien("Commercial", "/commercial"), lien("Mail", "/mail")] };
  },
});

export function libelleEtapeDossier(etape: string): string {
  return LIBELLES_ETAPE[etape as EtapeDossier] ?? etape;
}
