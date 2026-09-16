import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { lireParametres } from "@/lib/parametres/service";
import { pseudonyme } from "@/lib/synthese/references";
import { ErreurDefinitive, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { proposer, validerProposition } from "@/lib/validation/service";
import type { PropositionVue } from "@/lib/validation/types";
import { TYPE_TACHE_EFFACEMENT } from "./anonymisation";
import { effacerFichiersAnonymises, type ChargeEffacement } from "./effacement";
import { MOTIFS_ANONYMISATION } from "./propositions";

/**
 * Durées de conservation (paramètres datés, sans valeur par défaut) : une fois
 * la durée écoulée depuis la dernière activité, l'anonymisation est proposée —
 * jamais faite seule. Un contact qui n'a rien signé suit la durée des
 * prospects ; un client qui a signé, celle des clients. Un dossier en cours
 * suspend tout.
 */

const JOUR_MS = 24 * 60 * 60_000;
const ETAPES_SIGNEES = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"];
const ETAPES_CLOSES = ["ENCAISSE", "PERDU"];

function ajouterMois(date: Date, mois: number): Date {
  const resultat = new Date(date);
  resultat.setUTCMonth(resultat.getUTCMonth() + mois);
  return resultat;
}

export type BilanConservation = { proposees: number; dejaProposees: number; parametresManquants: boolean };

export async function proposerAnonymisations(maintenant: Date = new Date()): Promise<BilanConservation> {
  const bilan: BilanConservation = { proposees: 0, dejaProposees: 0, parametresManquants: false };
  const duree = await lireParametres(["RGPD_CONSERVATION_PROSPECTS", "RGPD_CONSERVATION_CLIENTS"], maintenant);
  if (duree.RGPD_CONSERVATION_PROSPECTS === undefined && duree.RGPD_CONSERVATION_CLIENTS === undefined) return { ...bilan, parametresManquants: true };

  const clients = await prisma.client.findMany({
    where: { ...AVEC_ARCHIVES, anonymiseLe: null, fusionneDansId: null },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      premierContactLe: true,
      dossiers: { where: AVEC_ARCHIVES, select: { etape: true, perteEtape: true, updatedAt: true, archiveLe: true } },
      leads: { where: AVEC_ARCHIVES, select: { createdAt: true, updatedAt: true } },
      messages: { where: AVEC_ARCHIVES, orderBy: { recuLe: "desc" }, take: 1, select: { recuLe: true } },
      encaissements: { orderBy: { recuLe: "desc" }, select: { recuLe: true } },
    },
  });

  for (const client of clients) {
    if (client.dossiers.some((dossier) => !dossier.archiveLe && !ETAPES_CLOSES.includes(dossier.etape))) continue;
    const aSigne =
      client.encaissements.length > 0 || client.dossiers.some((dossier) => ETAPES_SIGNEES.includes(dossier.etape) || (dossier.perteEtape !== null && ETAPES_SIGNEES.includes(dossier.perteEtape)));
    const mois = aSigne ? duree.RGPD_CONSERVATION_CLIENTS : duree.RGPD_CONSERVATION_PROSPECTS;
    if (typeof mois !== "number") continue;
    const derniere = new Date(
      Math.max(
        client.premierContactLe.getTime(),
        client.updatedAt.getTime(),
        ...client.dossiers.map((dossier) => dossier.updatedAt.getTime()),
        ...client.leads.map((lead) => Math.max(lead.createdAt.getTime(), lead.updatedAt.getTime())),
        ...client.messages.map((message) => message.recuLe.getTime()),
        ...client.encaissements.map((encaissement) => encaissement.recuLe.getTime())
      )
    );
    if (ajouterMois(derniere, mois) > maintenant) continue;
    const { creee } = await proposer({
      type: "ANONYMISATION_CLIENT",
      titre: `Anonymiser un ${aSigne ? "client" : "contact"} (réf. ${pseudonyme(client.id)}) : dernière activité le ${formatDateCourte(derniere)}`,
      resume: `Durée de conservation des ${aSigne ? "clients" : "contacts sans signature"} : ${mois} mois, écoulée. Factures, avoirs et paiements restent conservés ; photos, mails et coordonnées sont effacés.`,
      raisonnement: `Aucun dossier en cours ; dernière activité (échange, dossier, paiement ou modification de la fiche) le ${formatDateCourte(derniere)}.`,
      contenu: { clientId: client.id, motif: "DUREE_ECOULEE", commentaire: null, derniereActivite: jourParis(derniere) },
      cleUnicite: `rgpd:${client.id}:${jourParis(derniere)}`,
      clientId: client.id,
      expireLe: new Date(maintenant.getTime() + 30 * JOUR_MS),
    });
    if (creee) bilan.proposees++;
    else bilan.dejaProposees++;
  }
  return bilan;
}

/* ── Demande depuis la fiche ───────────────────────────────────────── */

export const schemaDemandeAnonymisation = z.object({
  motif: z.enum(MOTIFS_ANONYMISATION, "Choisis le motif."),
  commentaire: z.string().trim().max(500, "Précision trop longue.").nullable().optional().transform((valeur) => valeur || null),
  confirmation: z.literal(true, "Coche la confirmation : l'anonymisation est définitive."),
});

/** Anonymisation décidée par la personne depuis la fiche : même circuit (proposition validée, trace, bilan). */
export async function anonymiserClient(clientId: string, entree: z.output<typeof schemaDemandeAnonymisation>): Promise<PropositionVue> {
  if (entree.motif === "AUTRE" && (!entree.commentaire || entree.commentaire.length < 3)) throw new ErreurMetier("Précise le motif en quelques mots.", 400);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new ErreurMetier("Client introuvable.", 404);
  const { id } = await proposer({
    type: "ANONYMISATION_CLIENT",
    titre: `Anonymiser un client (réf. ${pseudonyme(clientId)}) : décision depuis la fiche`,
    contenu: { clientId, motif: entree.motif, commentaire: entree.commentaire, derniereActivite: null },
    clientId,
  });
  return validerProposition(id);
}

export function enregistrerTachesRgpd(): void {
  enregistrerTraitement(TYPE_TACHE_EFFACEMENT, {
    libelle: "Effacement des fichiers d'un client anonymisé (RGPD)",
    acteur: "SYSTEME:rgpd",
    delaiMaxMs: 10 * 60_000,
    executer: async (charge) => {
      const lue = charge as Partial<ChargeEffacement> | null;
      if (!lue || !Array.isArray(lue.chemins) || !Array.isArray(lue.dossierIds)) throw new ErreurDefinitive("Charge invalide : chemins et dossiers attendus");
      return effacerFichiersAnonymises({ chemins: lue.chemins, dossierIds: lue.dossierIds });
    },
  });
  enregistrerTravailPeriodique({
    nom: "conservation-rgpd",
    libelle: "Durées de conservation : anonymisations à proposer",
    acteur: "SYSTEME:rgpd",
    intervalleMs: 24 * 60 * 60_000,
    executer: async () => {
      await proposerAnonymisations();
    },
  });
}
