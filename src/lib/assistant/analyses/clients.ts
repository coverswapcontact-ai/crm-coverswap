import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { LIBELLES_SOURCE_CLIENT, type SourceClient } from "@/lib/clients/constantes";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { definirOutil, format, lien } from "../definition";
import { avertissementMinces, familleDuDossier, joursEntre, libelleFamille, repartir, somme } from "./commun";
import { pluriel } from "@/lib/commun/format";

/**
 * Manager clients (mission 8) : la base clients par état (prospect, en cours,
 * signé, terminé, perdu), les clients à réactiver, les avis reçus et à
 * demander, l'usage des espaces. État du jour, pas une période.
 */

const ETAPES_EN_COURS: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "EN_PAUSE"];
const ETAPES_SIGNEES: EtapeDossier[] = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE"];
export const JOURS_REACTIVATION = 180;

export type ClientLu = {
  id: string;
  nom: string;
  categorie: string;
  source: string;
  ville: string | null;
  premierContactLe: Date;
  dossiers: { id: string; etape: string; famille: string; updatedAt: Date; dateChantier: Date | null; encaisse: number; avis: { note: number | null; le: Date } | null; espace: { dernierAccesLe: Date | null; nbAcces: number; revoque: boolean } | null }[];
  espacePermanent: { dernierAccesLe: Date | null; nbAcces: number; premierAccesLe: Date | null; revoque: boolean } | null;
  recommandations: number;
};

export type EtatClient = "PROSPECT" | "EN_COURS" | "SIGNE" | "TERMINE" | "PERDU";

/** L'état d'un client : son dossier le plus avancé décide (pur). */
export function etatDuClient(c: ClientLu): EtatClient {
  if (c.dossiers.some((d) => ETAPES_SIGNEES.includes(d.etape as EtapeDossier))) return "SIGNE";
  if (c.dossiers.some((d) => ETAPES_EN_COURS.includes(d.etape as EtapeDossier))) return "EN_COURS";
  if (c.dossiers.some((d) => d.etape === "ENCAISSE")) return "TERMINE";
  if (c.dossiers.length && c.dossiers.every((d) => d.etape === "PERDU")) return "PERDU";
  return "PROSPECT";
}

export const LIBELLES_ETAT_CLIENT: Record<EtatClient, string> = { PROSPECT: "Prospect (sans dossier)", EN_COURS: "Dossier en cours", SIGNE: "Signé, chantier à venir ou en cours", TERMINE: "Terminé (encaissé)", PERDU: "Perdu" };

/** Clients terminés dont le dernier mouvement date de plus de six mois, sans dossier ouvert (pur). */
export function aReactiver(clients: ClientLu[], maintenant: Date, jours = JOURS_REACTIVATION) {
  return clients
    .filter((c) => etatDuClient(c) === "TERMINE")
    .map((c) => {
      const dernier = c.dossiers.reduce<Date | null>((m, d) => (m === null || d.updatedAt > m ? d.updatedAt : m), null);
      return { id: c.id, nom: c.nom, ville: c.ville, dernierMouvementLe: dernier, joursDepuis: dernier ? Math.floor(joursEntre(dernier, maintenant)) : null, familles: [...new Set(c.dossiers.map((d) => d.famille))], encaisse: somme(c.dossiers.map((d) => d.encaisse)) };
    })
    .filter((c) => c.joursDepuis !== null && c.joursDepuis >= jours)
    .sort((a, b) => (b.joursDepuis ?? 0) - (a.joursDepuis ?? 0));
}

async function chargerClients(): Promise<ClientLu[]> {
  const clients = await prisma.client.findMany({
    where: { archiveLe: null, fusionneDansId: null, anonymiseLe: null },
    select: {
      id: true, nom: true, categorie: true, source: true, ville: true, premierContactLe: true,
      dossiers: { where: { archiveLe: null }, select: { id: true, etape: true, prestations: true, updatedAt: true, dateChantier: true, lead: { select: { typeProjet: true } }, encaissements: { where: { statut: "VALIDE" }, select: { montant: true } }, espaces: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { avis: true, avisLe: true, dernierAccesLe: true, nbAcces: true, revoqueLe: true } } } },
      espacePermanent: { select: { dernierAccesLe: true, nbAcces: true, premierAccesLe: true, revoqueLe: true, archiveLe: true } },
      _count: { select: { recommandations: true } },
    },
  });
  return clients.map((c) => ({
    id: c.id,
    nom: c.nom,
    categorie: c.categorie,
    source: c.source,
    ville: c.ville,
    premierContactLe: c.premierContactLe,
    dossiers: c.dossiers.map((d) => {
      const espace = d.espaces[0] ?? null;
      let note: number | null = null;
      if (espace?.avis) {
        try {
          const lu = JSON.parse(espace.avis) as { note?: number };
          note = typeof lu.note === "number" ? lu.note : null;
        } catch {
          note = null;
        }
      }
      return { id: d.id, etape: d.etape, famille: familleDuDossier(d.prestations, d.lead?.typeProjet), updatedAt: d.updatedAt, dateChantier: d.dateChantier, encaisse: somme(d.encaissements.map((e) => e.montant)), avis: espace?.avisLe ? { note, le: espace.avisLe } : null, espace: espace ? { dernierAccesLe: espace.dernierAccesLe, nbAcces: espace.nbAcces, revoque: Boolean(espace.revoqueLe) } : null };
    }),
    espacePermanent: c.espacePermanent && !c.espacePermanent.archiveLe ? { dernierAccesLe: c.espacePermanent.dernierAccesLe, nbAcces: c.espacePermanent.nbAcces, premierAccesLe: c.espacePermanent.premierAccesLe, revoque: Boolean(c.espacePermanent.revoqueLe) } : null,
    recommandations: c._count.recommandations,
  }));
}

export async function analyseClients(maintenant: Date = new Date()) {
  const clients = await chargerClients();
  const semaine = new Date(maintenant.getTime() - 7 * 86_400_000);
  const parEtat = repartir(clients, (c) => etatDuClient(c), (e) => LIBELLES_ETAT_CLIENT[e as EtatClient] ?? e);
  const termines = clients.flatMap((c) => c.dossiers.filter((d) => ["FACTURE", "ENCAISSE"].includes(d.etape)).map((d) => ({ client: c, dossier: d })));
  const avisRecus = termines.filter((t) => t.dossier.avis);
  const avisADemander = termines.filter((t) => !t.dossier.avis).map((t) => ({ clientId: t.client.id, dossierId: t.dossier.id, nom: t.client.nom, etape: LIBELLES_ETAPE[t.dossier.etape as EtapeDossier] ?? t.dossier.etape, espaceOuvert: Boolean(t.dossier.espace && !t.dossier.espace.revoque), termineDepuisJours: Math.floor(joursEntre(t.dossier.updatedAt, maintenant)) }));
  const notes = avisRecus.map((t) => t.dossier.avis!.note).filter((n): n is number => n !== null);
  const avecEspace = clients.filter((c) => c.espacePermanent && !c.espacePermanent.revoque);
  const reactivables = aReactiver(clients, maintenant);
  return {
    calculeLe: maintenant.toISOString(),
    definitions: {
      etat: "Le dossier le plus avancé du client décide : signé (chantier à venir ou en cours) > en cours > terminé (encaissé) > perdu ; sans dossier = prospect.",
      aReactiver: `Clients terminés dont le dernier mouvement de dossier date de plus de ${JOURS_REACTIVATION} jours, sans dossier ouvert.`,
      avis: "Avis déposé dans l'espace du client après son chantier ; à demander = dossier facturé ou encaissé sans avis (la séquence « demande d'avis » s'en charge si elle est active).",
      espaces: "Espace permanent du client (un par client) ; actif cette semaine = ouvert dans les 7 derniers jours.",
    },
    avertissement: avertissementMinces(clients.length, "clients"),
    total: clients.length,
    parEtat,
    parCategorie: repartir(clients, (c) => c.categorie),
    parSource: repartir(clients, (c) => c.source, (s) => LIBELLES_SOURCE_CLIENT[s as SourceClient] ?? s),
    parFamille: repartir(clients.flatMap((c) => c.dossiers), (d) => d.famille, libelleFamille),
    nouveaux30Jours: clients.filter((c) => c.premierContactLe >= new Date(maintenant.getTime() - 30 * 86_400_000)).length,
    recommandeurs: clients.filter((c) => c.recommandations > 0).map((c) => ({ id: c.id, nom: c.nom, recommandations: c.recommandations })).sort((a, b) => b.recommandations - a.recommandations).slice(0, 10),
    aReactiver: { nombre: reactivables.length, encaisseCumule: somme(reactivables.map((r) => r.encaisse)), clients: reactivables.slice(0, 20) },
    avis: { recus: avisRecus.length, noteMoyenne: notes.length ? Math.round((notes.reduce((t, n) => t + n, 0) / notes.length) * 10) / 10 : null, aDemander: avisADemander.length, listeADemander: avisADemander.sort((a, b) => a.termineDepuisJours - b.termineDepuisJours).slice(0, 20) },
    espaces: { ouverts: avecEspace.length, jamaisOuverts: avecEspace.filter((c) => !c.espacePermanent!.premierAccesLe).length, actifsSemaine: avecEspace.filter((c) => c.espacePermanent!.dernierAccesLe && c.espacePermanent!.dernierAccesLe >= semaine).length, sansEspace: clients.length - avecEspace.length },
  };
}

export const outilManagerClients = definirOutil({
  nom: "manager_clients",
  titre: "Manager clients : états, à réactiver, avis, espaces",
  description:
    "État du jour de la base clients : nombre par état (prospect, en cours, signé, terminé, perdu), par catégorie, source et famille de prestations ; nouveaux clients sur 30 jours ; clients qui recommandent ; clients à réactiver (terminés depuis plus de 6 mois, sans dossier ouvert) ; avis reçus, note moyenne, avis à demander ; espaces clients ouverts, jamais ouverts, actifs cette semaine. Sert à « qui relancer ? », « à qui demander un avis ? ».",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const a = await analyseClients(contexte.maintenant);
    const texte = [
      `Clients au ${format.jourCourt(a.calculeLe.slice(0, 10))} : ${a.total} (${a.parEtat.map((e) => `${e.libelle} ${e.valeur}`).join(", ") || "—"}), ${a.nouveaux30Jours} nouveaux sur 30 jours.${a.avertissement ? ` ${a.avertissement}` : ""}`,
      `Sources : ${a.parSource.slice(0, 5).map((s) => `${s.libelle} ${s.valeur}`).join(", ") || "—"}. Familles : ${a.parFamille.map((f) => `${f.libelle} ${f.valeur}`).join(", ") || "—"}.`,
      `À réactiver : ${pluriel(a.aReactiver.nombre, "client terminé", "clients terminés")} depuis plus de ${JOURS_REACTIVATION} jours${a.aReactiver.clients.length ? ` (${a.aReactiver.clients.slice(0, 5).map((c) => `${c.nom}, ${c.joursDepuis} j`).join(" · ")})` : ""}.`,
      `Avis : ${pluriel(a.avis.recus, "reçu")}${a.avis.noteMoyenne !== null ? `, note moyenne ${a.avis.noteMoyenne}/5` : ""} ; ${a.avis.aDemander} à demander${a.avis.listeADemander.length ? ` (${a.avis.listeADemander.slice(0, 5).map((c) => c.nom).join(", ")})` : ""}.`,
      `Espaces : ${a.espaces.ouverts} ouverts, ${a.espaces.jamaisOuverts} jamais ouverts, ${a.espaces.actifsSemaine} actifs cette semaine, ${a.espaces.sansEspace} clients sans espace.`,
      a.recommandeurs.length ? `Recommandent : ${a.recommandeurs.map((r) => `${r.nom} (${r.recommandations})`).join(", ")}.` : "",
    ].filter(Boolean).join("\n");
    return { texte, donnees: a, liens: [lien("Clients", "/clients"), lien("Espaces", "/espaces")] };
  },
});
